"""The rule language: parsing, static checks and evaluation semantics."""

import copy
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import RULE_ERROR_MESSAGE, load_jsonl, pointer, run_rule
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import SpecError, parse_spec
from rule_engine.validation import check_spec

MESSAGES = {"PASS": "passed", "FAIL": "failed", "UNABLE_TO_ASSESS": "unknown"}


def P(path):
    return {"path": path}


def V(value):
    return {"value": value}


def raw_spec(*steps):
    return {"language_version": 2, "steps": list(steps), "messages": MESSAGES}


def spec(*steps):
    return parse_spec(raw_spec(*steps))


def require(condition, **extra):
    return {"require": condition, **extra}


def equals(left, right):
    return {"op": "equals", "left": left, "right": right}


class ParsingTests(unittest.TestCase):
    def assert_rejected(self, raw):
        with self.assertRaises(SpecError):
            parse_spec(raw)

    def test_unknown_operator_and_value_kind_are_rejected(self):
        self.assert_rejected(raw_spec(require({"op": "matches_regex", "left": P("/currency"), "right": V(".*")})))
        self.assert_rejected(raw_spec(require(equals({"python": "1+1"}, V(2)))))
        self.assert_rejected(raw_spec(require(equals({"path": "/currency", "value": "SAR"}, V("SAR")))))

    def test_null_literals_and_array_indexes_are_not_expressible(self):
        self.assert_rejected(raw_spec(require(equals(P("/currency"), V(None)))))
        self.assert_rejected(raw_spec(require(equals(P("/lines/0/quantity"), V(1)))))
        self.assert_rejected(raw_spec(require(equals(P("/currency;import os"), V(1)))))

    def test_extra_fields_and_bad_statuses_are_rejected(self):
        self.assert_rejected({**raw_spec(require(equals(P("/currency"), V("SAR")))), "code": "print(1)"})
        self.assert_rejected(raw_spec(require(equals(P("/currency"), V("SAR")), otherwise="fail")))

    def test_size_and_depth_limits(self):
        deep = equals(P("/currency"), V("SAR"))
        for _ in range(45):
            deep = {"op": "not", "item": deep}
        self.assert_rejected(raw_spec(require(deep)))
        wide = {"op": "any_of", "items": [equals(P("/currency"), V("x" * 200))] * 20}
        self.assert_rejected(raw_spec(*[require(wide)] * 10))  # over the size limit
        self.assert_rejected(raw_spec(*[require(equals(P("/currency"), V("SAR")))] * 31))  # too many steps

    def test_round_trip_keeps_aliases(self):
        original = raw_spec({"for_each": P("/lines"), "as": "line", "steps": [
            require({"op": "within_dates", "value": P("$line/service_date"), "from": P("/coverage/start_date"), "to": P("/coverage/end_date")}),
        ]})
        dumped = parse_spec(original).to_json()
        self.assertEqual(dumped["steps"][0]["as"], "line")
        self.assertEqual(dumped["steps"][0]["steps"][0]["require"]["from"], P("/coverage/start_date"))
        self.assertEqual(parse_spec(dumped), parse_spec(original))


class StaticCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)

    def problems(self, *steps):
        return check_spec(spec(*steps), self.fields)

    def assert_problem(self, fragment, *steps):
        problems = self.problems(*steps)
        self.assertTrue(any(fragment in problem for problem in problems), problems)

    def test_valid_spec_has_no_problems(self):
        self.assertEqual(self.problems(require(equals(P("/currency"), V("SAR")))), [])

    def test_unknown_claim_field(self):
        self.assert_problem('"/diagnosis" is not a claim field', require({"op": "is_present", "value": P("/diagnosis")}))

    def test_names_must_be_defined_first_and_only_once(self):
        self.assert_problem("used before it is defined", require({"op": "is_present", "value": P("$line/service_code")}))
        self.assert_problem("defined twice", {"let": "x", "be": P("/currency")}, {"let": "x", "be": P("/currency")},
                            require({"op": "is_present", "value": P("$x")}))

    def test_fields_can_only_be_read_from_claim_objects(self):
        self.assert_problem("is not a claim object", {"let": "code", "be": P("/currency")},
                            require({"op": "is_present", "value": P("$code/value")}))
        self.assert_problem('"$line/colour" is not a claim field',
                            {"for_each": P("/lines"), "as": "line", "steps": [
                                require({"op": "is_present", "value": P("$line/colour")})]})

    def test_comparing_two_fixed_values_is_rejected(self):
        self.assert_problem("two fixed values", require(equals(V("SAR"), V("SAR"))))
        self.assert_problem("fixed value", require({"op": "is_present", "value": V("x")}))

    def test_operator_types_must_fit(self):
        self.assert_problem("at_most expects number", require({"op": "at_most", "left": P("/currency"), "right": V(3)}))
        self.assert_problem("equals compares", require(equals(P("/total_amount"), V("SAR"))))
        self.assert_problem("YYYY-MM-DD", require({"op": "before", "left": P("/submission_date"), "right": V("01/02/2026")}))
        self.assert_problem("for_each needs a list", {"for_each": P("/currency"), "as": "x", "steps": [
            require({"op": "is_present", "value": P("$x")})]})

    def test_reference_data_fields_must_exist(self):
        self.assert_problem("policy fields are", require(equals(P("/currency"), {"config": "policy", "get": ["money"]})))
        self.assert_problem("service catalogue fields", require({"op": "at_most", "left": P("/total_amount"),
                            "right": {"config": "services", "get": ["SVC-LAB", "price"]}}))

    def test_only_if_must_come_before_checks(self):
        self.assert_problem("only_if must come before", require(equals(P("/currency"), V("SAR"))),
                            {"only_if": {"op": "is_present", "value": P("/currency")}})

    def test_a_rule_must_be_able_to_fail(self):
        self.assert_problem("no require step", {"need": {"op": "is_present", "value": P("/currency")}})


class EvaluationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = ReferenceData.load(BACKEND_ROOT / "rules")
        cls.base = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")[0]

    def setUp(self):
        self.claim = copy.deepcopy(self.base)

    def status(self, *steps, claim=None):
        return evaluate_rule(spec(*steps), claim or self.claim, self.reference).status

    def test_any_of_with_every_item_false_is_false(self):
        never = {"op": "any_of", "items": [equals(P("/currency"), V("USD")), equals(P("/currency"), V("EUR"))]}
        self.assertEqual(self.status(require(never)), "FAIL")

    def test_three_valued_logic(self):
        unknown = equals(P("/member_id"), V("x"))
        self.claim["member_id"] = None
        false = equals(P("/currency"), V("USD"))
        true = equals(P("/currency"), V("SAR"))
        self.assertEqual(self.status(require({"op": "all_of", "items": [unknown, false]})), "FAIL")
        self.assertEqual(self.status(require({"op": "all_of", "items": [unknown, true]})), "UNABLE_TO_ASSESS")
        self.assertEqual(self.status(require({"op": "any_of", "items": [unknown, true]})), "PASS")
        self.assertEqual(self.status(require({"op": "not", "item": unknown})), "UNABLE_TO_ASSESS")

    def test_missing_and_blank_values_are_unknown_not_pass_or_fail(self):
        for missing in (None, "", "   "):
            self.claim["diagnosis_code"] = missing
            self.assertEqual(self.status(require(equals(P("/diagnosis_code"), V("DX-EDU-02")))), "UNABLE_TO_ASSESS")
            self.assertEqual(self.status(require({"op": "is_present", "value": P("/diagnosis_code")})), "FAIL")

    def test_need_and_only_if(self):
        check = require(equals(P("/currency"), V("SAR")))
        self.claim["member_id"] = None
        self.assertEqual(self.status({"need": {"op": "is_present", "value": P("/member_id")}}, check), "UNABLE_TO_ASSESS")
        self.assertEqual(self.status({"only_if": equals(P("/currency"), V("USD"))}, check), "NOT_APPLICABLE")
        self.assertEqual(self.status({"only_if": equals(P("/member_id"), V("x"))}, check), "UNABLE_TO_ASSESS")

    def test_fail_outranks_unknown_and_reports_failing_lines(self):
        self.claim["lines"][0]["quantity"] = None
        self.claim["lines"][1]["quantity"] = 99
        rule = spec({"for_each": P("/lines"), "as": "line", "steps": [
            require({"op": "at_most", "left": P("$line/quantity"), "right": V(5)})]})
        outcome = evaluate_rule(rule, self.claim, self.reference)
        self.assertEqual(outcome.status, "FAIL")
        self.assertEqual(outcome.affected_line_ids, [self.claim["lines"][1]["line_id"]])

    def test_for_each_where_nothing_applies_is_not_applicable(self):
        rule = {"for_each": P("/lines"), "as": "line", "steps": [
            {"only_if": equals(P("$line/service_code"), V("SVC-NONE"))},
            require({"op": "is_present", "value": P("$line/authorization_id")})]}
        self.assertEqual(self.status(rule), "NOT_APPLICABLE")

    def test_otherwise_unable_to_assess(self):
        self.assertEqual(self.status(require(equals(P("/currency"), V("USD")), otherwise="UNABLE_TO_ASSESS")), "UNABLE_TO_ASSESS")

    def test_values_of_different_types_are_not_comparable(self):
        self.claim["currency"] = "100"
        self.assertEqual(self.status(require(equals(P("/currency"), P("/total_amount")))), "UNABLE_TO_ASSESS")
        self.assertEqual(self.status(require({"op": "at_most", "left": P("/currency"), "right": V(5)})), "UNABLE_TO_ASSESS")

    def test_huge_numbers_become_unknown_instead_of_crashing(self):
        self.claim["lines"][0].update(quantity=1e300, unit_price=1e300, net_amount=1.0)
        rule = {"for_each": P("/lines"), "as": "line", "steps": [require({
            "op": "amounts_match",
            "left": {"multiply": [P("$line/quantity"), P("$line/unit_price")]},
            "right": P("$line/net_amount")})]}
        self.assertEqual(self.status(rule), "UNABLE_TO_ASSESS")

    def test_evidence_points_at_real_claim_values(self):
        rule = spec({"for_each": P("/lines"), "as": "line", "steps": [
            require({"op": "in", "value": P("$line/service_code"), "collection": {"config": "policy", "get": ["max_unit_price"]}})]})
        outcome = evaluate_rule(rule, self.claim, self.reference)
        self.assertIn("/policy_id", dict(outcome.evidence))
        for path, value in outcome.evidence:
            self.assertEqual(pointer(self.claim, path), value)

    def test_operation_budget_stops_runaway_rules(self):
        line = self.claim["lines"][0]
        self.claim["lines"] = [{**line, "line_id": f"L{index}"} for index in range(700)]
        quadratic = spec({"for_each": P("/lines"), "as": "line", "steps": [
            require({"op": "exists", "collection": P("/lines"), "as": "other",
                     "where": equals(P("$other/line_id"), V("never"))})]})
        with self.assertRaises(EvaluationLimitExceeded):
            evaluate_rule(quadratic, self.claim, self.reference)
        rule = {"rule_id": "R900", "version": "1.0.0", "severity": "low", "source": "test", "corrective_action": "Review."}
        result = run_rule(self.claim, rule, quadratic, self.reference)
        self.assertEqual(result["status"], "UNABLE_TO_ASSESS")
        self.assertEqual(result["explanation"], RULE_ERROR_MESSAGE)
        self.assertTrue(result["requires_human_review"])


if __name__ == "__main__":
    unittest.main()
