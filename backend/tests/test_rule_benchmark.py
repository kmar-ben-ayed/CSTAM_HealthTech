"""The benchmark itself: valid reference specs, and a measurement that catches wrong rules."""

import json
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_authoring.llm import AuthoringModels, ScriptedChatModel
from rule_benchmark.runner import Benchmark, invented_items, reference_items
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import evaluate_rule
from rule_engine.language import parse_spec
from rule_engine.validation import check_spec

REFERENCE_DATA = ReferenceData.load(BACKEND_ROOT / "rules")


def proposing(spec):
    reply = {"action": "propose", "spec": spec.to_json(), "intent": "", "assumptions": []}
    return ScriptedChatModel([reply] * 10, name="scripted-drafter")


def oracle_following(spec):
    def reply(messages):
        payload = json.loads(messages[-1]["content"])
        return {"predictions": [
            {"case_id": case["case_id"], "status": evaluate_rule(spec, case["claim"], REFERENCE_DATA).status, "reason": ""}
            for case in payload["cases"]
        ]}
    return ScriptedChatModel([reply] * 300, name="scripted-oracle")


class BenchmarkTests(unittest.TestCase):
    def test_every_invented_rule_has_a_valid_reference(self):
        fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        items = invented_items()
        self.assertGreaterEqual(len(items), 20)
        for item in items:
            if item.expect_unsupported:
                self.assertIsNone(item.reference)
            else:
                self.assertEqual(check_spec(item.reference, fields), [], item.item_id)

    def test_reference_items_are_the_fifteen_original_rules(self):
        self.assertEqual([item.item_id for item in reference_items(BACKEND_ROOT)], [f"R{n:03d}" for n in range(1, 16)])

    def benchmark(self, drafter_spec, oracle_spec):
        models = AuthoringModels(drafter=proposing(drafter_spec), oracle=oracle_following(oracle_spec))
        return Benchmark(BACKEND_ROOT, models, mutants=50)

    def test_correct_rule_is_classified_correct(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")
        result = self.benchmark(item.reference, item.reference).run_item(item)
        self.assertEqual(result.classification, "correct")
        self.assertEqual(result.agreement, 1.0)
        self.assertEqual(result.oracle_accuracy, 1.0)

    def test_drafter_and_oracle_wrong_in_the_same_way_is_caught_as_wrongly_accepted(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")  # quantity at most 5
        wrong = parse_spec({**item.reference.to_json(), "steps": [{"for_each": {"path": "/lines"}, "as": "line", "steps": [
            {"require": {"op": "less_than", "left": {"path": "$line/quantity"}, "right": {"value": 5}}}]}]})
        result = self.benchmark(wrong, wrong).run_item(item)
        self.assertEqual(result.classification, "wrongly_accepted")
        self.assertLess(result.agreement, 1.0)
        self.assertLess(result.oracle_accuracy, 1.0)

    def test_disagreement_is_settled_by_the_simulated_author(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")
        wrong = parse_spec({**item.reference.to_json(), "steps": [{"for_each": {"path": "/lines"}, "as": "line", "steps": [
            {"require": {"op": "less_than", "left": {"path": "$line/quantity"}, "right": {"value": 5}}}]}]})
        result = self.benchmark(wrong, item.reference).run_item(item)  # the oracle reads it right
        self.assertEqual(result.classification, "rejected")  # the drafter never fixes it, so it never goes live
        self.assertGreater(result.case_questions, 0)

    def test_unsupported_rule(self):
        item = next(i for i in invented_items() if i.expect_unsupported)
        models = AuthoringModels(
            drafter=ScriptedChatModel([{"action": "unsupported", "reason": "no text prefix operator"}]),
            oracle=ScriptedChatModel([]),
        )
        result = Benchmark(BACKEND_ROOT, models, mutants=0).run_item(item)
        self.assertEqual(result.classification, "correctly_unsupported")


if __name__ == "__main__":
    unittest.main()
