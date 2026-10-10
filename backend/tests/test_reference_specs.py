"""The 15 reference specs reproduce the original rules, and the spec store fails safe."""

import copy
import json
import shutil
import sqlite3
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_engine.catalogue import FieldCatalogue
from rule_engine.engine_core import baseline, config, load_jsonl
from rule_engine.legacy_rules import legacy_check
from rule_engine.spec_store import SpecStore, SpecStoreError, reference_seed_file
from rule_benchmark.mutations import mutated_claims

REFERENCE_RULES = [f"R{number:03d}" for number in range(1, 16)]
SPLITS = ("development", "validation", "stress")


def load_split(split):
    claims = load_jsonl(BACKEND_ROOT / "data" / split / "claims.jsonl")
    expected = {
        (row["claim_id"], row["rule_id"]): row["status"]
        for row in load_jsonl(BACKEND_ROOT / "data" / split / "expected_results.jsonl")
    }
    return claims, expected


def has_duplicate_authorization_ids(claim):
    ids = [authorization["authorization_id"] for authorization in claim["authorizations"]]
    return len(ids) != len(set(ids))


class ReferenceSpecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = config(BACKEND_ROOT)
        cls.rules = {rule["rule_id"]: rule for rule in cls.cfg["rules"]}

    def statuses(self, claim):
        return {result["rule_id"]: result["status"] for result in baseline(claim, self.cfg)}

    def test_all_reference_rules_are_active(self):
        for rule_id in REFERENCE_RULES:
            self.assertIn(rule_id, self.cfg["specs"], self.cfg["inactive"].get(rule_id))
            self.assertEqual(self.cfg["specs"][rule_id].origin, "reference")

    def test_every_expected_outcome_is_reproduced(self):
        mismatches = Counter()
        compared = 0
        for split in SPLITS:
            claims, expected = load_split(split)
            for claim in claims:
                for rule_id, status in self.statuses(claim).items():
                    if (claim["claim_id"], rule_id) not in expected:
                        continue  # two stress claims have no expected results
                    compared += 1
                    if status != expected[(claim["claim_id"], rule_id)]:
                        mismatches[rule_id] += 1
        self.assertEqual(compared, 9000)
        self.assertEqual(dict(mismatches), {})

    def test_same_status_as_the_original_python_rules_on_mutated_claims(self):
        claims = [claim for split in SPLITS for claim in load_split(split)[0]]
        differences = Counter()
        for claim in mutated_claims(claims, count=3000, seed=11):
            new = self.statuses(claim)
            for rule_id in REFERENCE_RULES:
                if rule_id == "R009" and has_duplicate_authorization_ids(claim):
                    continue  # intentional difference, see the next test
                old = legacy_check(claim, self.rules[rule_id], self.cfg)["status"]
                if new[rule_id] != old:
                    differences[(rule_id, old, new[rule_id])] += 1
        self.assertEqual(dict(differences), {})

    def test_ambiguous_authorization_reference_needs_a_human(self):
        """Two authorization records with the same id: the old code silently used the
        last one. The reference spec refuses to guess and returns UNABLE_TO_ASSESS."""
        claims, _ = load_split("development")
        claim = copy.deepcopy(next(c for c in claims if c["authorizations"] and self.statuses(c)["R009"] == "PASS"))
        duplicate = {**claim["authorizations"][0], "status": "denied"}
        for order in ([claim["authorizations"][0], duplicate], [duplicate, claim["authorizations"][0]]):
            claim["authorizations"] = order
            self.assertEqual(self.statuses(claim)["R009"], "UNABLE_TO_ASSESS")


class SpecStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Path(self.temp_dir.name) / "rules.sqlite3"
        self.seed = Path(self.temp_dir.name) / "reference_specs.json"
        shutil.copy(reference_seed_file(BACKEND_ROOT), self.seed)
        self.store = SpecStore(self.database, self.seed)
        self.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        self.rules = json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8"))

    def tearDown(self):
        self.store.close()
        self.temp_dir.cleanup()

    def logic(self, rule_id):
        return next(rule["logic"] for rule in self.rules if rule["rule_id"] == rule_id)

    def test_seed_loads_every_reference_rule_once(self):
        self.assertEqual(set(self.store.load_active(self.rules, self.fields).active), set(REFERENCE_RULES))
        SpecStore(self.database, self.seed).close()  # opening again does not add revisions
        self.assertEqual([entry["revision"] for entry in self.store.history("R001")], [1])

    def test_activation_keeps_every_revision(self):
        stored = self.store.read("R015")
        second = self.store.activate("R015", stored.spec, self.logic("R015"), origin="agent", actor="tester")
        self.assertEqual(second.revision, 2)
        self.assertEqual([entry["revision"] for entry in self.store.history("R015")], [1, 2])
        self.assertTrue(self.store.deactivate("R015"))
        self.assertIsNone(self.store.read("R015"))
        self.assertEqual(len(self.store.history("R015")), 2)
        self.assertFalse(self.store.deactivate("R015"))

    def test_history_cannot_be_rewritten(self):
        with self.assertRaises(sqlite3.DatabaseError):
            with self.store._connection:
                self.store._connection.execute("UPDATE rule_spec_revisions SET spec = '{}'")
        with self.assertRaises(sqlite3.DatabaseError):
            with self.store._connection:
                self.store._connection.execute("DELETE FROM rule_spec_revisions")

    def test_changed_seed_updates_reference_rules_but_not_admin_revisions(self):
        self.store.activate("R014", self.store.read("R014").spec, self.logic("R014"), origin="agent", actor="admin")
        seed = json.loads(self.seed.read_text(encoding="utf-8"))
        for rule_id in ("R013", "R014"):
            seed["specs"][rule_id]["spec"]["messages"]["PASS"] = "Updated message."
        self.seed.write_text(json.dumps(seed), encoding="utf-8")
        SpecStore(self.database, self.seed).close()
        self.assertEqual(self.store.read("R013").spec.messages.PASS, "Updated message.")
        self.assertEqual(self.store.read("R013").revision, 2)
        self.assertEqual(self.store.read("R014").origin, "agent")  # the admin's revision stays active

    def test_editing_rule_text_outside_the_flow_deactivates_the_rule(self):
        edited = copy.deepcopy(self.rules)
        next(rule for rule in edited if rule["rule_id"] == "R015")["logic"] += " Edited by hand."
        loaded = self.store.load_active(edited, self.fields)
        self.assertNotIn("R015", loaded.active)
        self.assertIn("rule text changed", loaded.inactive["R015"])
        self.assertIn("R014", loaded.active)

    def test_corrupted_or_unsafe_stored_specs_never_run(self):
        unsafe = self.store.read("R015").spec.to_json()
        unsafe["steps"][0]["need"]["value"] = {"path": "/no_such_field"}
        with self.store._connection as connection:
            for rule_id, spec_text in (("R014", "{not json"), ("R015", json.dumps(unsafe))):
                connection.execute(
                    "INSERT INTO rule_spec_revisions SELECT rule_id, 99, origin, logic_sha256, spec_sha256, "
                    "activated_at, activated_by, provenance, ? FROM rule_spec_revisions WHERE rule_id = ?",
                    (spec_text, rule_id),
                )
                connection.execute("UPDATE active_rule_specs SET revision = 99 WHERE rule_id = ?", (rule_id,))
        loaded = self.store.load_active(self.rules, self.fields)
        self.assertIn("unreadable", loaded.inactive["R014"])
        self.assertIn("fails checks", loaded.inactive["R015"])
        self.assertIn("R013", loaded.active)
        self.assertTrue(self.store.deactivate("R014"))  # the kill switch works on a corrupted rule

    def test_rule_ids_are_validated(self):
        spec = self.store.read("R015").spec
        for bad_id in ("../R015", "R015.json", "R1", "r015", "R015/x"):
            with self.assertRaises(SpecStoreError):
                self.store.activate(bad_id, spec, "logic", origin="agent", actor="tester")


if __name__ == "__main__":
    unittest.main()
