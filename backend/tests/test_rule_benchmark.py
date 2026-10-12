"""The benchmark itself: valid reference specs, and a measurement that catches wrong rules."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from audit.logger import AuditLogger
from audit.store import AuditStore
from rule_authoring.checks import DraftChecker
from rule_authoring.drafts import DraftStore
from rule_authoring.drafter import lift_wildcard_paths, normalise_values
from rule_authoring.edge_cases import EdgeCaseGenerator, LabelledCase, choose_base_claims
from rule_authoring.llm import AuthoringModels, ScriptedChatModel
from rule_authoring.service import AuthoringSettings, RuleAuthoringService
from rule_authoring.sheet import compile_sheet, reference_sheets
from rule_benchmark.runner import Benchmark, SimulatedAuthor, invented_items, reference_items, summarise
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl
from rule_engine.interpreter import evaluate_rule
from rule_engine.language import parse_spec
from rule_engine.validation import check_spec

REFERENCE_DATA = ReferenceData.load(BACKEND_ROOT / "rules")


def proposing(spec):
    reply = {"action": "propose", "spec": spec.to_json(), "intent": "", "assumptions": []}
    return ScriptedChatModel([reply] * 10, name="scripted-drafter")


def propose_sheet(sheet):
    return {"action": "propose", "sheet": sheet, "intent": "", "assumptions": []}


def drafted(test, benchmark, item):
    """A service with the item drafted once, as the benchmark sets it up (the caller closes it)."""
    workdir = tempfile.mkdtemp()
    test.addCleanup(shutil.rmtree, workdir, True)
    root = Path(workdir) / "backend"
    for part in ("rules", "schemas", "data/development"):
        shutil.copytree(BACKEND_ROOT / part, root / part)
    rules_db = root / "outputs" / "rules.sqlite3"
    service = RuleAuthoringService(
        backend_root=root, rules_db=rules_db, drafts=DraftStore(rules_db),
        audit_logger=AuditLogger(AuditStore(root / "outputs" / "audit.jsonl")),
        models=benchmark.models, on_rules_changed=lambda: None, settings=benchmark.settings)
    draft = service.submit(item.rule, actor="test")
    service.run(draft.draft_id)
    return service, service.get_draft(draft.draft_id)


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

    def test_every_correct_rule_passes_every_check(self):
        # If a correct spec can fail a check, that kind of rule can never be activated
        # (the "at most 5 lines" rule once failed not_constant: no test claim had 6 lines).
        fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        checker = DraftChecker(fields, REFERENCE_DATA,
                               EdgeCaseGenerator(choose_base_claims(claims), fields, REFERENCE_DATA, schema), None, claims)
        for item in reference_items(BACKEND_ROOT) + invented_items():
            if item.reference is None:
                continue
            report = checker.run(item.rule, item.reference, [])
            self.assertEqual([check.name for check in report.checks if not check.passed], [], item.item_id)
            self.assertEqual(report.notes, [], item.item_id)
            # The repairs for model slips never touch a spec that is already right.
            written = item.reference.to_json()
            self.assertEqual(normalise_values(lift_wildcard_paths(written)), written, item.item_id)

    def test_reference_items_are_the_fifteen_original_rules(self):
        items = reference_items(BACKEND_ROOT)
        self.assertEqual([item.item_id for item in items], [f"R{n:03d}" for n in range(1, 16)])
        for item in items:  # each judged on the official expected results of all three splits
            self.assertEqual(len(item.expected), 600, item.item_id)

    def test_an_official_rule_is_judged_on_the_official_data_only(self):
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R015")  # currency matches policy
        result = self.benchmark(item.reference, item.reference, independent_reading="advice").run_item(item)
        self.assertEqual(result.classification, "correct")
        self.assertEqual((result.official["claims"], result.official["agree"], result.official["issue_f1"]), (600, 600, 1.0))

        always_usd = parse_spec({**item.reference.to_json(), "steps": [
            {"require": {"op": "equals", "left": {"path": "/currency"}, "right": {"value": "USD"}}}]})
        models = AuthoringModels(drafter=proposing(always_usd), oracle=ScriptedChatModel([]))
        wrong = Benchmark(BACKEND_ROOT, models, mutants=0, author_corrects=False).run_item(item)
        self.assertEqual(wrong.classification, "wrongly_accepted")
        self.assertLess(wrong.official["issue_f1"], 1.0)  # what evaluate.py would report for it
        summary = summarise([result, wrong])
        self.assertEqual((summary["official"]["rules"], summary["official"]["claims"]), (2, 1200))
        # Only the right draft clears the gate; its held-out score is the validation and stress claims'.
        self.assertEqual((result.gate["deploy"], wrong.gate["deploy"]), (True, False))
        self.assertEqual(summary["deployable"]["rules"], ["R015"])
        self.assertEqual((summary["deployable"]["held_out"]["claims"], summary["deployable"]["held_out"]["agree"]), (200, 200))

    def benchmark(self, drafter_spec, oracle_spec, author_corrects=True, **settings):
        models = AuthoringModels(drafter=proposing(drafter_spec), oracle=oracle_following(oracle_spec))
        return Benchmark(BACKEND_ROOT, models, mutants=50, settings=AuthoringSettings(**settings),
                         author_corrects=author_corrects)

    def test_correct_rule_is_classified_correct(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")
        result = self.benchmark(item.reference, item.reference, independent_reading="advice").run_item(item)
        self.assertEqual(result.classification, "correct")
        self.assertEqual(result.agreement, 1.0)
        self.assertEqual(result.oracle_accuracy, 1.0)
        self.assertEqual(result.corrections, 0)

    def test_drafter_and_oracle_wrong_in_the_same_way_is_caught_as_wrongly_accepted(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")  # quantity at most 5
        wrong = parse_spec({**item.reference.to_json(), "steps": [{"for_each": {"path": "/lines"}, "as": "line", "steps": [
            {"require": {"op": "less_than", "left": {"path": "$line/quantity"}, "right": {"value": 5}}}]}]})
        # Without the author checking the cases, a wrong rule reaches the confirmation screen.
        result = self.benchmark(wrong, wrong, author_corrects=False, independent_reading="advice").run_item(item)
        self.assertEqual(result.classification, "wrongly_accepted")
        self.assertLess(result.agreement, 1.0)
        self.assertLess(result.oracle_accuracy, 1.0)

    def test_disagreement_is_settled_by_the_simulated_author(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")
        wrong = parse_spec({**item.reference.to_json(), "steps": [{"for_each": {"path": "/lines"}, "as": "line", "steps": [
            {"require": {"op": "less_than", "left": {"path": "$line/quantity"}, "right": {"value": 5}}}]}]})
        result = self.benchmark(wrong, item.reference, independent_reading="block").run_item(item)  # the oracle reads it right
        self.assertEqual(result.classification, "rejected")  # the drafter never fixes it, so it never goes live
        self.assertGreater(result.case_questions, 0)

    def test_the_author_corrects_a_wrong_draft_into_the_right_rule(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")  # quantity at most 5
        wrong = {**item.reference.to_json(), "steps": [{"for_each": {"path": "/lines"}, "as": "line", "steps": [
            {"require": {"op": "less_than", "left": {"path": "$line/quantity"}, "right": {"value": 5}}}]}]}

        def drafter_reply(messages):
            """Proposes the wrong boundary until the author has corrected a case, then the right one."""
            task = json.loads(messages[1]["content"])
            spec = item.reference.to_json() if task["author_examples"] else wrong
            return {"action": "propose", "spec": spec, "intent": "", "assumptions": []}

        models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 20), oracle=ScriptedChatModel([]))
        result = Benchmark(BACKEND_ROOT, models, mutants=50).run_item(item)
        self.assertEqual(result.classification, "correct")
        self.assertEqual(result.agreement, 1.0)
        self.assertGreater(result.corrections, 0)

    def test_each_field_is_probed_on_every_base_claim_before_any_second_probe(self):
        # A missing date on claim A's imaging line and on claim B's lab line are different
        # tests for a document rule; the case limit once ran out before claim B's.
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R010")
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(claims), FieldCatalogue.from_backend_root(BACKEND_ROOT),
                                      REFERENCE_DATA, schema)
        dates = [case for case in generator.generate(item.reference, item.rule) if case.field == "/lines/*/service_date"]
        self.assertEqual([case.description.split(":")[0] for case in dates[:3]], ["claim A", "claim B", "claim C"])

    def test_test_claims_are_diverse_not_numerous(self):
        # R009 as run B drafted it (2026-10-11): right except that an unknown service code gave
        # NOT_APPLICABLE instead of UNABLE_TO_ASSESS. Its 40 test claims once probed the service
        # code twice, both times "missing", and the unknown code never came up.
        r009 = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R009")
        drafted = parse_spec(compile_sheet({
            "applies_if": [{"value": "/lines/*/service_code", "is": "one_of", "to": {"policy": "auth_required_services"}}],
            "checks": [{"needs": ["/lines/*/authorization_id"], "value": "/lines/*", "is": "has_match", "in": "/authorizations",
                        "where": [{"value": "/authorizations/*/authorization_id", "is": "equals", "to": "/lines/*/authorization_id"},
                                  {"value": "/authorizations/*/patient_id", "is": "equals", "to": "/patient_id"},
                                  {"value": "/authorizations/*/status", "is": "equals", "to": "approved"}],
                        "then": [{"value": {"sum": "/lines/*/quantity", "group_by": "authorization_id"},
                                  "is": "at_most", "to": "/authorizations/*/max_quantity"}]}]},
            FieldCatalogue.from_backend_root(BACKEND_ROOT), "R009"))
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(claims), FieldCatalogue.from_backend_root(BACKEND_ROOT),
                                      REFERENCE_DATA, schema)
        cases = generator.generate(drafted, r009.rule)
        self.assertLessEqual(len(cases), 46)  # not more claims: better ones
        self.assertFalse(any("(blank;" in case.description and case.field == "/lines/*/service_code" for case in cases))
        status = lambda spec, claim: evaluate_rule(spec, claim, REFERENCE_DATA).status  # noqa: E731
        self.assertTrue(any(status(drafted, c.claim) != status(r009.reference, c.claim) for c in cases))

    def test_the_author_corrects_one_field_at_a_time_and_each_correction_is_a_new_task(self):
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R001")
        right = reference_sheets()["R001"]
        corrected_fields = []

        def without(*paths):
            return {**right, "checks": [check for check in right["checks"] if check["value"] not in paths]}

        def drafter_reply(messages):
            """Forgets the invoice number and the member id until each has been corrected."""
            corrected = " ".join(example["case"] for example in json.loads(messages[1]["content"])["author_examples"])
            corrected_fields.append([name for name in ("invoice_number", "member_id") if f": {name} " in corrected])
            missing = [path for path in ("/invoice_number", "/member_id") if f": {path[1:]} " not in corrected]
            return {"action": "propose", "spec": without(*missing), "intent": "", "assumptions": []}

        models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 20), oracle=ScriptedChatModel([]))
        # One round per task: a correction is new information, not another failed try.
        result = Benchmark(BACKEND_ROOT, models, mutants=0, settings=AuthoringSettings(max_rounds=1)).run_item(item)
        self.assertEqual(result.classification, "correct")
        self.assertEqual(corrected_fields, [[], ["invoice_number"], ["invoice_number", "member_id"]])

    def test_the_author_confirms_the_right_outcomes_it_checked_on_the_way(self):
        # R001 without the member id: wrong only on /member_id, the table's last field.
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R001")
        right = reference_sheets()["R001"]
        wrong = {**right, "checks": [check for check in right["checks"] if check["value"] != "/member_id"]}
        models = AuthoringModels(drafter=ScriptedChatModel([propose_sheet(wrong)]), oracle=ScriptedChatModel([]))
        benchmark = Benchmark(BACKEND_ROOT, models, mutants=0, settings=AuthoringSettings(missing_data_questions=False))
        service, draft = drafted(self, benchmark, item)
        try:
            review = SimulatedAuthor(item.reference, REFERENCE_DATA).review(draft, benchmark.edge_cases)
            shown = {case["case_id"]: case for case in draft.report["cases"]}
            self.assertTrue(review.corrections)
            self.assertEqual({shown[case_id]["field"] for case_id, _ in review.corrections}, {"/member_id"})
            confirmed = {shown[case_id]["field"] for case_id, _ in review.confirmations}
            self.assertIn("/invoice_number", confirmed)  # reviewed before /member_id and right
            for case_id, outcome in review.confirmations:
                self.assertEqual(shown[case_id]["spec_status"], outcome)
            self.assertEqual(len({case_id for case_id, _ in review.verdicts}), len(review.verdicts))

            draft = service.correct(draft.draft_id, review.verdicts, "simulated-author")
            kinds = {example.confirmed for example in draft.examples}
            self.assertEqual(kinds, {True, False})
            self.assertEqual(sum(not example.confirmed for example in draft.examples), len(review.corrections))
        finally:
            service.close()

    def test_a_draft_that_breaks_a_confirmed_outcome_is_refused(self):
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R001")
        right = reference_sheets()["R001"]

        def without(path):
            return {**right, "checks": [check for check in right["checks"] if check["value"] != path]}

        seen = []

        def drafter_reply(messages):
            """Forgets the member id; once corrected, adds it but drops the invoice number (whose
            outcomes were confirmed), and only writes the right sheet when told it broke them."""
            task = json.loads(messages[1]["content"])
            if not any(": member_id " in example["case"] for example in task["author_examples"]):
                return {"action": "propose", "sheet": without("/member_id"), "intent": "", "assumptions": []}
            refused = [m["content"] for m in messages[2:] if m["role"] == "user" and "outcome the author confirmed" in m["content"]]
            seen.append((len(task["author_confirmed"]), bool(refused)))
            sheet = right if refused else without("/invoice_number")
            return {"action": "propose", "sheet": sheet, "intent": "", "assumptions": []}

        models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 20), oracle=ScriptedChatModel([]))
        result = Benchmark(BACKEND_ROOT, models, mutants=0).run_item(item)
        self.assertEqual(result.classification, "correct")
        self.assertGreater(result.confirmations, 0)
        confirmed_shown, _ = seen[0]
        self.assertGreater(confirmed_shown, 0)  # the drafter is told which outcomes to keep
        self.assertEqual([refused for _, refused in seen], [False, True])  # refused once, then right

    def test_a_stuck_drafter_gets_development_claims_covering_each_outcome(self):
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R010")
        author = SimulatedAuthor(item.reference, REFERENCE_DATA)
        pool = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        outcomes = {evaluate_rule(item.reference, claim, REFERENCE_DATA).status for claim in pool}
        chosen = author.examples(SimpleNamespace(examples=[]), pool, count=len(outcomes))
        self.assertEqual({outcome for _, outcome in chosen}, outcomes)  # one claim of each outcome
        self.assertTrue({claim["claim_id"] for claim, _ in chosen} <= {claim["claim_id"] for claim in pool})
        first_claim, first_outcome = chosen[0]
        again = author.examples(SimpleNamespace(examples=[LabelledCase("given", first_claim, first_outcome)]), pool,
                                count=len(outcomes) - 1)
        self.assertNotIn(first_outcome, [outcome for _, outcome in again])  # outcomes not yet shown come first

    def test_a_stuck_drafter_recovers_with_the_authors_example_claims(self):
        item = next(i for i in invented_items() if i.item_id == "INV-02")

        def drafter_reply(messages):
            """Cannot write the rule until it is shown example claims."""
            examples = json.loads(messages[1]["content"])["author_examples"]
            if any("claim" in example for example in examples):
                return {"action": "propose", "spec": item.reference.to_json(), "intent": "", "assumptions": []}
            return {"action": "check", "spec": {"steps": "not a list"}}

        models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 20), oracle=ScriptedChatModel([]))
        result = Benchmark(BACKEND_ROOT, models, mutants=0,
                           settings=AuthoringSettings(drafter_max_turns=2, offer_example_claims=True)).run_item(item)
        self.assertEqual(result.classification, "correct")

    def test_unsupported_rule(self):
        item = next(i for i in invented_items() if i.expect_unsupported)
        models = AuthoringModels(
            drafter=ScriptedChatModel([{"action": "unsupported", "reason": "no text prefix operator"}] * 2),
            oracle=ScriptedChatModel([]),
        )
        result = Benchmark(BACKEND_ROOT, models, mutants=0).run_item(item)
        self.assertEqual(result.classification, "correctly_unsupported")


if __name__ == "__main__":
    unittest.main()
