"""The gate an official rule's draft must clear to replace the rule running today."""

import copy
import json
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_authoring.sheet import compile_sheet, reference_sheets
from rule_benchmark.official import Gate, describe, expected_outcomes, official_claims
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import evaluate_rule
from rule_engine.language import parse_spec
from rule_engine.spec_store import reference_seed_file

REFERENCE_DATA = ReferenceData.load(BACKEND_ROOT / "rules")
CLAIMS = official_claims(BACKEND_ROOT)
EXPECTED = expected_outcomes(BACKEND_ROOT)
SEED = json.loads(reference_seed_file(BACKEND_ROOT).read_text(encoding="utf-8"))["specs"]


def running_today(rule_id):
    return parse_spec(SEED[rule_id]["spec"])


def r001_without_the_invoice_number():
    sheet = copy.deepcopy(reference_sheets()["R001"])
    sheet["checks"] = sheet["checks"][1:]
    return parse_spec(compile_sheet(sheet, FieldCatalogue.from_backend_root(BACKEND_ROOT)))


class OfficialGateTests(unittest.TestCase):
    def test_the_rule_running_today_clears_the_gate(self):
        verdict = Gate().judge(running_today("R001"), EXPECTED["R001"], CLAIMS, REFERENCE_DATA)
        self.assertTrue(verdict["deploy"])
        self.assertEqual((verdict["development"]["claims"], verdict["development"]["agree"]), (400, 400))
        # Validation and stress: 200 claims with an official outcome (claims added for local
        # testing have none and are left out).
        self.assertEqual((verdict["held_out"]["claims"], verdict["held_out"]["issue_f1"]), (200, 1.0))
        self.assertEqual(describe(verdict),
                         "development 400/400 agree, F1 1.0; validation+stress 200/200 agree, F1 1.0")

    def test_missed_violations_are_refused_even_with_high_agreement(self):
        # 392 of 400 is exactly the agreement bar, but 8 claims without an invoice number pass.
        verdict = Gate().judge(r001_without_the_invoice_number(), EXPECTED["R001"], CLAIMS, REFERENCE_DATA)
        self.assertFalse(verdict["deploy"])
        self.assertEqual(verdict["development"]["mismatches"], {"FAIL->PASS": 8})
        self.assertEqual(verdict["why_not"], ["issue F1 0.875 is below 0.95"])

    def test_wrong_outcomes_other_than_fail_are_refused_even_with_f1_one(self):
        # F1 only counts FAIL: a draft deciding 9 claims UNABLE_TO_ASSESS -> PASS keeps F1 1.0.
        expected = dict(EXPECTED["R015"])
        passing = [key for key, status in expected.items() if key[0] == "development" and status == "PASS"]
        for key in passing[:9]:
            expected[key] = "UNABLE_TO_ASSESS"
        verdict = Gate().judge(running_today("R015"), expected, CLAIMS, REFERENCE_DATA)
        self.assertFalse(verdict["deploy"])
        self.assertEqual(verdict["development"]["issue_f1"], 1.0)
        self.assertEqual(verdict["why_not"], ["agreement 0.9775 is below 0.98"])

    def test_a_rule_failing_no_development_claim_is_decided_on_agreement(self):
        expected = {key: status for key, status in EXPECTED["R015"].items() if status != "FAIL"}
        verdict = Gate().judge(running_today("R015"), expected, CLAIMS, REFERENCE_DATA)
        self.assertIsNone(verdict["development"]["issue_f1"])
        self.assertTrue(verdict["deploy"])
        self.assertIn("F1 n/a", describe(verdict))

    def test_the_held_out_claims_never_decide(self):
        spec = running_today("R015")
        expected = dict(EXPECTED["R015"])
        for split, claim in CLAIMS:  # every validation outcome made wrong
            if split == "validation":
                actual = evaluate_rule(spec, claim, REFERENCE_DATA).status
                expected[(split, claim["claim_id"])] = "PASS" if actual != "PASS" else "UNABLE_TO_ASSESS"
        verdict = Gate().judge(spec, expected, CLAIMS, REFERENCE_DATA)
        self.assertTrue(verdict["deploy"])
        self.assertLess(verdict["held_out"]["status_accuracy"], 0.5)

    def test_no_rule_produced_is_never_deployed(self):
        verdict = Gate().judge(None, EXPECTED["R001"], CLAIMS, REFERENCE_DATA)
        self.assertFalse(verdict["deploy"])
        self.assertEqual(verdict["why_not"], ["no rule was produced"])
        self.assertEqual(verdict["development"]["mismatches"], {"PASS->NOT_IMPLEMENTED": 364, "FAIL->NOT_IMPLEMENTED": 36})

    def test_the_bars_can_be_set(self):
        verdict = Gate(min_f1=0.85, min_agreement=0.95).judge(
            r001_without_the_invoice_number(), EXPECTED["R001"], CLAIMS, REFERENCE_DATA)
        self.assertTrue(verdict["deploy"])


if __name__ == "__main__":
    unittest.main()
