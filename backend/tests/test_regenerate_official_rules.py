"""regenerate_official_rules.py: the official rules drafted like an admin's revision (scripted models only)."""

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

import regenerate_official_rules as regenerate_script
from audit.logger import AuditLogger
from audit.store import AuditStore
from rule_authoring.drafts import AWAITING_CONFIRMATION, DraftStore
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims
from rule_authoring.llm import AuthoringModels, ScriptedChatModel
from rule_authoring.service import AuthoringSettings, RuleAuthoringService
from rule_authoring.sheet import reference_sheets
from rule_benchmark.official import Gate
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl
from score_drafted_rules import waiting_drafts


def propose(sheet):
    return {"action": "propose", "spec": sheet, "intent": "R001 as written", "assumptions": []}


class RegenerateOfficialRulesTest(unittest.TestCase):
    def setUp(self):
        self.workdir = tempfile.TemporaryDirectory()
        self.root = Path(self.workdir.name) / "backend"
        for part in ("rules", "schemas", "data/development"):
            shutil.copytree(BACKEND_ROOT / part, self.root / part)
        self.rules_db = self.root / "outputs" / "rules.sqlite3"
        self.reference_data = ReferenceData.load(self.root / "rules")
        schema = json.loads((self.root / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        edge_cases = EdgeCaseGenerator(choose_base_claims(load_jsonl(self.root / "data" / "development" / "claims.jsonl")),
                                       FieldCatalogue.from_backend_root(self.root), self.reference_data, schema)
        self.admin = regenerate_script.RulebookAdmin(self.root, self.reference_data, edge_cases)
        # The official claims and outcomes of every split (read only).
        self.check = regenerate_script.OfficialCheck(BACKEND_ROOT, self.reference_data, Gate())
        rules = json.loads((self.root / "rules" / "rules.json").read_text(encoding="utf-8"))
        self.r001 = next(rule for rule in rules if rule["rule_id"] == "R001")
        self.right = reference_sheets()["R001"]
        self.wrong = copy.deepcopy(self.right)
        self.wrong["checks"] = self.wrong["checks"][1:]  # forgets the invoice number

    def tearDown(self):
        self.workdir.cleanup()

    def service(self, replies):
        self.drafter = ScriptedChatModel(replies)
        return RuleAuthoringService(
            backend_root=self.root,
            rules_db=self.rules_db,
            drafts=DraftStore(self.rules_db),
            audit_logger=AuditLogger(AuditStore(self.root / "outputs" / "audit.jsonl")),
            models=AuthoringModels(drafter=self.drafter, oracle=ScriptedChatModel([])),
            on_rules_changed=lambda: None,
            settings=AuthoringSettings(drafts_per_hour=1000, missing_data_questions=False),
        )

    def test_wrong_outcomes_are_corrected_until_the_draft_matches_the_rulebook(self):
        service = self.service([propose(self.wrong), propose(self.right)])
        try:
            result = regenerate_script.regenerate(service, self.r001, self.admin)
            self.assertEqual(result["state"], AWAITING_CONFIRMATION)
            self.assertGreater(result["outcomes_corrected"], 0)
            self.assertEqual(len(self.drafter.calls), 2)
            # Nothing is activated: the draft waits for the admin, and the scorer can read it.
            self.assertEqual([r["rule_id"] for r in service.list_rules() if r["origin"] == "agent"], [])
            waiting = waiting_drafts(self.rules_db)["results"]
            self.assertEqual([entry["item_id"] for entry in waiting], ["R001"])
        finally:
            service.close()

    def test_a_rule_with_an_open_draft_is_not_submitted_again(self):
        service = self.service([propose(self.right)])
        try:
            regenerate_script.regenerate(service, self.r001, self.admin)
            again = regenerate_script.regenerate(service, self.r001, self.admin)
            self.assertEqual(again["state"], "not submitted")
            self.assertIn("already has a draft", again["detail"])
        finally:
            service.close()

    def test_replace_cancels_the_open_draft_and_drafts_again(self):
        service = self.service([propose(self.right), propose(self.right)])
        try:
            first = regenerate_script.regenerate(service, self.r001, self.admin)
            again = regenerate_script.regenerate(service, self.r001, self.admin, replace=True)
            self.assertEqual((first["state"], again["state"]), (AWAITING_CONFIRMATION, AWAITING_CONFIRMATION))
            states = sorted(draft.state for draft in service.list_drafts())
            self.assertEqual(states, [AWAITING_CONFIRMATION, "cancelled"])
        finally:
            service.close()

    def test_confirming_puts_the_drafted_rule_live_under_its_rulebook_identity(self):
        service = self.service([propose(self.right)])
        try:
            self.assertIn("nothing confirmed", regenerate_script.confirm_waiting(service, "R001", self.check))
            regenerate_script.regenerate(service, self.r001, self.admin)
            outcome = regenerate_script.confirm_waiting(service, "R001", self.check)
            self.assertIn("active", outcome)
            self.assertIn("development 400/400 agree, F1 1.0; validation+stress 200/200 agree", outcome)
            row = next(rule for rule in service.list_rules() if rule["rule_id"] == "R001")
            self.assertEqual((row["status"], row["origin"], row["version"]), ("active", "agent", "1.0.0"))
            self.assertTrue(self.gate_entries()[-1].payload["deploy"])
        finally:
            service.close()

    def test_a_draft_below_the_gate_stays_waiting_and_the_rule_keeps_running(self):
        service = self.service([propose(self.wrong)])  # misses the 8 development claims without an invoice number
        try:
            regenerate_script.regenerate(service, self.r001, admin=None)
            outcome = regenerate_script.confirm_waiting(service, "R001", self.check)
            self.assertIn("kept waiting", outcome)
            self.assertIn("issue F1 0.875 is below 0.95", outcome)
            self.assertEqual(service.drafts.open_draft_for("R001").state, AWAITING_CONFIRMATION)
            row = next(rule for rule in service.list_rules() if rule["rule_id"] == "R001")
            self.assertNotEqual(row["origin"], "agent")
            entry = self.gate_entries()[-1].payload
            self.assertEqual((entry["deploy"], entry["development_agree"], entry["development_issue_f1"]),
                             (False, 392, 0.875))
        finally:
            service.close()

    def gate_entries(self):
        entries = AuditStore(self.root / "outputs" / "audit.jsonl").all_entries()
        return [entry for entry in entries if entry.event_type == "official_rule_gate"]

    def test_panel_answers_leave_the_table_to_the_admin(self):
        service = self.service([propose(self.wrong)])
        try:
            result = regenerate_script.regenerate(service, self.r001, admin=None)
            self.assertEqual(result["state"], AWAITING_CONFIRMATION)
            self.assertEqual(result["outcomes_corrected"], 0)
            self.assertEqual(len(self.drafter.calls), 1)
        finally:
            service.close()


if __name__ == "__main__":
    unittest.main()
