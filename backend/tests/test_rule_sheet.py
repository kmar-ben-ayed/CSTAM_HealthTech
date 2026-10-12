"""The rule sheet: every proven sheet equals its verified reference rule, and the drafter can write one."""

import json
import re
import sys
import unittest
from collections import Counter
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_reference_specs import has_disagreeing_authorization_copies  # noqa: E402

from rule_authoring.checks import copied_policy_values  # noqa: E402
from normalisation.schema_subset import validate as validate_claim_schema  # noqa: E402
from rule_authoring.drafter import PROPOSED, Drafter, DraftingContext, field_guide  # noqa: E402
from rule_engine.engine_core import validate_transport  # noqa: E402
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims  # noqa: E402
from rule_authoring.llm import ScriptedChatModel  # noqa: E402
from rule_authoring.prompts import FALLBACK_SECTION, PROMPTS_DIR, load_prompt  # noqa: E402
from rule_authoring.sheet import (  # noqa: E402
    SheetError, compile_sheet, outcome_quote_problems, quoted_outcomes, read_outcomes, reference_sheets)
from rule_authoring.edge_cases import rule_text  # noqa: E402
from rule_benchmark.runner import Benchmark, invented_items, reference_items  # noqa: E402
from rule_engine.catalogue import FieldCatalogue, ReferenceData  # noqa: E402
from rule_engine.engine_core import load_jsonl  # noqa: E402
from rule_engine.interpreter import evaluate_rule  # noqa: E402
from rule_engine.language import parse_spec  # noqa: E402
from rule_engine.validation import check_spec  # noqa: E402

REFERENCE_DATA = ReferenceData.load(BACKEND_ROOT / "rules")
INVENTED_SHEETS = BACKEND_ROOT / "src" / "rule_benchmark" / "invented_sheets.json"


def against_reference(benchmark, spec, item):
    """The differences between a sheet and its reference rule, on the claims Benchmark._compare
    uses. R009's reference gives UNABLE_TO_ASSESS where two copies of an authorization
    disagree; a sheet cannot say "the copies agree" and uses the first one. Such claims are
    in no official data and no drafter's test claims (only in mutations): left out here."""
    claims = (benchmark.evaluation_claims + [case.claim for case in benchmark.edge_cases.generate(item.reference)]
              + [case.claim for case in benchmark.edge_cases.generate(spec)])
    mismatches = Counter()
    for claim in claims:
        if item.item_id == "R009" and has_disagreeing_authorization_copies(claim):
            continue
        expected = evaluate_rule(item.reference, claim, REFERENCE_DATA).status
        actual = evaluate_rule(spec, claim, REFERENCE_DATA).status
        if actual != expected:
            mismatches[f"{expected}->{actual}"] += 1
    return dict(mismatches)


RULES = {rule["rule_id"]: rule for rule in json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8"))}


def _said(outcome, quote):
    return {"outcome": outcome, "quote": quote}


# Each official rule's "outcomes" table, every quote copied from its own text.
_U, _F = "UNABLE_TO_ASSESS", "FAIL"
OFFICIAL_TABLES = {
    "R001": {"missing_in_checks": _said(_F, "A known absence is FAIL, not UNABLE_TO_ASSESS")},
    "R002": {"missing_in_checks": _said(_U, "Missing or invalid date inputs produce UNABLE_TO_ASSESS unless another line proves a violation")},
    "R003": {"missing_in_checks": _said(_U, "Missing status, dates or service date leaves UNABLE_TO_ASSESS unless a known violation exists")},
    "R004": {"missing_in_checks": _said(_U, "missing comparison inputs leave UNABLE_TO_ASSESS")},
    "R005": {"missing_in_checks": _said(_U, "A missing provider or unavailable policy is UNABLE_TO_ASSESS"),
             "unknown_policy": _said(_U, "A missing provider or unavailable policy is UNABLE_TO_ASSESS")},
    "R006": {"missing_in_checks": _said(_U, "Missing service code/date leaves UNABLE_TO_ASSESS unless another complete pair proves a duplicate")},
    "R007": {"missing_in_checks": _said(_U, "Missing numeric input leaves UNABLE_TO_ASSESS unless another line fails")},
    "R008": {entry: _said(_U, "Unknown service codes or an unavailable policy leave UNABLE_TO_ASSESS")
             for entry in ("unknown_code", "unknown_policy")},
    "R009": {entry: _said(_U, "Unknown service/policy or missing comparison input leaves UNABLE_TO_ASSESS")
             for entry in ("missing_in_checks", "unknown_code", "unknown_policy")},
    "R010": {entry: _said(_U, "Unknown service/policy/date leaves UNABLE_TO_ASSESS")
             for entry in ("missing_in_checks", "unknown_code", "unknown_policy")},
    "R011": {"unknown_code": _said(_F, "An unknown code fails"),
             "missing_in_checks": _said(_U, "a missing code leaves UNABLE_TO_ASSESS")},
    "R012": {"missing_in_checks": _said(_U, "Missing amount inputs leave UNABLE_TO_ASSESS")},
    "R013": {entry: _said(_U, "Missing values, unknown code or unavailable policy leave UNABLE_TO_ASSESS unless another "
                              "line proves a violation") for entry in ("missing_in_checks", "unknown_code", "unknown_policy")},
    "R014": {entry: _said(_U, "Missing dates/policy leave UNABLE_TO_ASSESS") for entry in ("missing_in_checks", "unknown_policy")},
    "R015": {entry: _said(_U, "Missing currency or unavailable policy leaves UNABLE_TO_ASSESS")
             for entry in ("missing_in_checks", "unknown_policy")},
}


def comparisons_only(rule_id):
    """The rule's proven sheet as only its comparisons: no needs, no if_missing / if_unknown."""
    sheet = json.loads(json.dumps(reference_sheets()[rule_id]))
    sheet.pop("needs", None)
    for kind in ("applies_if", "checks"):
        for check in sheet.get(kind, []):
            for key in ("needs", "if_missing", "if_unknown"):
                check.pop(key, None)
    return sheet


def with_the_texts_table(rule_id):
    """The comparisons plus the "outcomes" table quoting the rule's own text."""
    return {**comparisons_only(rule_id), "outcomes": OFFICIAL_TABLES[rule_id]}


class SheetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)

    def compile(self, sheet, title="Test rule"):
        return parse_spec(compile_sheet(sheet, self.fields, title))

    def test_every_proven_sheet_equals_its_reference_rule(self):
        sheets = {**reference_sheets(), **json.loads(INVENTED_SHEETS.read_text(encoding="utf-8"))["sheets"]}
        benchmark = Benchmark(BACKEND_ROOT, None, mutants=300)
        items = {item.item_id: item for item in reference_items(BACKEND_ROOT) + invented_items()}
        self.assertGreaterEqual(len(sheets), 34)  # every benchmark rule except INV-07, which nothing can express
        for rule_id, sheet in sheets.items():
            with self.subTest(rule=rule_id):
                spec = self.compile(sheet, items[rule_id].rule["title"])
                self.assertEqual(check_spec(spec, self.fields), [])
                self.assertEqual(against_reference(benchmark, spec, items[rule_id]), {})

    def test_every_example_in_the_sheet_prompt_compiles(self):
        prompt = (PROMPTS_DIR / "drafter_sheet.md").read_text(encoding="utf-8")
        # Blocks with "..." are illustrations of the format; every other block is a real example.
        blocks = [block for block in re.findall(r"```json\n(\{.*?\})\n```", prompt, re.S) if "..." not in block]
        examples = [json.loads(block) for block in blocks]
        sheets = [example.get("sheet", example) for example in examples]
        self.assertEqual(len(sheets), 9)  # the complete reply and the eight examples
        for sheet in sheets:
            self.assertEqual(check_spec(self.compile(sheet), self.fields), [])

    def test_group_by_totals_the_elements_that_share_this_ones_value(self):
        # R009 written with group_by ("the lines of this line's authorization") instead of the
        # trick of comparing with the matched record: the same outcome on every claim.
        item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R009")
        sheet = json.loads(json.dumps(reference_sheets()["R009"]))
        sheet["checks"][0]["then"][-1]["value"] = {"sum": "/lines/*/quantity", "group_by": "authorization_id"}
        benchmark = Benchmark(BACKEND_ROOT, None, mutants=300)
        self.assertEqual(against_reference(benchmark, self.compile(sheet, item.rule["title"]), item), {})

        # A total per service day, on its own.
        spec = self.compile({"checks": [
            {"value": {"sum": "/lines/*/net_amount", "group_by": "service_date"}, "is": "at_most", "to": 1000}]})
        reference = ReferenceData.load(BACKEND_ROOT / "rules")
        base = next(c for c in load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl") if len(c["lines"]) >= 2)
        claim = json.loads(json.dumps(base))
        claim["lines"] = [dict(claim["lines"][0], line_id=f"L{n}", service_date="2026-05-01", net_amount=600) for n in (1, 2)]
        outcome = lambda c: evaluate_rule(spec, c, reference).status  # noqa: E731
        self.assertEqual(outcome(claim), "FAIL")  # 1200 on one day
        claim["lines"][1]["service_date"] = "2026-05-02"
        self.assertEqual(outcome(claim), "PASS")  # 600 a day
        claim["lines"][0]["service_date"] = None
        self.assertEqual(outcome(claim), "UNABLE_TO_ASSESS")  # that line's day, so its group, is unknown

        # A filtered count comparing with this line's field is a check about each line (R009's
        # drafter wrote it this way and the compiler once refused it, wrongly).
        unambiguous = self.compile({"checks": [{"value": {"count": "/authorizations", "where": [
            {"value": "/authorizations/*/authorization_id", "is": "equals", "to": "/lines/*/authorization_id"}]},
            "is": "at_most", "to": 1}]})
        self.assertIn("for_each", unambiguous.to_json()["steps"][0])

        # A grouped total compared with a field of another list's record: the message says to use then.
        with self.assertRaises(SheetError) as raised:
            self.compile({"checks": [{"value": {"sum": "/lines/*/quantity", "group_by": "authorization_id"},
                                      "is": "at_most", "to": "/authorizations/*/max_quantity"}]})
        self.assertIn('put the check in "then"', raised.exception.problems[0])
        self.assertIn('"in": "/authorizations"', raised.exception.problems[0])

        for wrong in ({"applies_if": [{"value": {"count": "/lines", "group_by": "service_date"}, "is": "at_least", "to": 2}],
                       "checks": [{"value": "/total_amount", "is": "present"}]},
                      {"checks": [{"value": {"sum": "/lines/*/quantity", "group_by": "no_such_field"}, "is": "at_most", "to": 3}]},
                      {"checks": [{"value": {"latest": "/lines/*/service_date", "group_by": "service_code"},
                                   "is": "on_or_before", "to": "/submission_date"}]}):
            with self.assertRaises(SheetError):
                self.compile(wrong)

    def test_the_sheet_only_prompt_leaves_out_the_full_language(self):
        full, only = load_prompt("drafter_sheet"), load_prompt("drafter_sheet_only")
        self.assertIn("for_each", full)  # the full language's manual, for what a sheet cannot say
        self.assertNotIn("for_each", only)
        self.assertNotIn('"spec": {...}', only)
        self.assertTrue(only.startswith(full.split(FALLBACK_SECTION)[0]))  # everything else is identical
        self.assertIn("group_by", only.split(FALLBACK_SECTION)[1])
        self.assertLess(len(only), 0.7 * len(full))
        drafter = Drafter(ScriptedChatModel([]), self.fields, ReferenceData.load(BACKEND_ROOT / "rules"), None,
                          prompt="drafter_sheet_only")
        self.assertTrue(drafter.writes_sheets)  # hints and pushbacks use the sheet's words

    def test_a_known_violation_wins_over_missing_data(self):
        # Each check is its own step: R003's lesson is built in, whatever the model writes.
        spec = self.compile({"checks": [
            {"value": "/lines/*/service_date", "is": "between", "to": ["/coverage/start_date", "/coverage/end_date"]}]})
        loop = spec.to_json()["steps"][0]
        self.assertEqual([step["require"]["op"] for step in loop["steps"]], ["on_or_after", "on_or_before"])

    def test_mistakes_get_plain_explanations(self):
        cases = [
            ({"checks": [{"value": "/total", "is": "at_most", "to": 1}]}, '"/total" is not a claim field'),
            ({"checks": [{"value": "/total_amount", "is": "below", "to": 1}]}, '"is" must be one of'),
            ({"checks": [{"value": "/total_amount", "is": "at_most"}]}, '"at_most" needs "to"'),
            ({"checks": [{"value": "/submission_date", "is": "at_most", "to": 30}]}, "days_between"),
            ({"checks": [{"value": "/total_amount", "is": "equals", "to": {"sum": "/lines/*/net_amount"}},
                         {"value": "/lines/*/quantity", "is": "at_most", "to": "/attachments/*/text"}]},
             "cannot read the elements of two lists"),
            ({"checks": []}, "checks must be a non-empty list"),
        ]
        for sheet, expected in cases:
            with self.subTest(expected=expected):
                with self.assertRaises(SheetError) as caught:
                    compile_sheet(sheet, self.fields)
                self.assertIn(expected, " ".join(caught.exception.problems))

    def test_r008_counting_a_field_gets_a_message_it_can_act_on(self):
        # outputs/hard_v9_R008.replies.jsonl: 9 sheets in a row counted "/lines/*/service_code",
        # and were told to put the field "inside count", where it already was.
        written = {"applies_if": [{"value": {"count": "/lines/*/service_code", "where": [
            {"value": "/lines/*/service_code", "is": "one_of", "to": {"policy": "auth_required_services"}}]},
            "is": "greater_than", "to": 0}], "checks": [{"value": "/lines/*/authorization_id", "is": "present"}]}
        with self.assertRaises(SheetError) as caught:
            compile_sheet(written, self.fields)
        message = caught.exception.problems[0]
        self.assertIn('"count" takes a list, not a field of its elements: {"count": "/lines"}', message)
        self.assertNotIn("inside sum, latest, earliest or count", message)
        fixed = json.loads(json.dumps(written).replace('"count": "/lines/*/service_code"', '"count": "/lines"'))
        self.assertEqual(check_spec(self.compile(fixed), self.fields), [])  # the fix it names compiles

    def test_otherwise_outside_checks_points_to_the_part_that_gives_that_outcome(self):
        # R009, 2026-10-12: "otherwise" on a right need was told only "for checks" and the need
        # was dropped (hard_v10); "otherwise": "UNABLE_TO_ASSESS" in applies_if was told to keep
        # the condition and drop otherwise, which makes an unknown code NOT_APPLICABLE (hard_v11).
        known = {"value": "/lines/*/service_code", "is": "one_of", "to": {"catalogue": "services"}}
        checks = [{"value": "/lines/*/authorization_id", "is": "present"}]

        def message(part, otherwise):
            with self.assertRaises(SheetError) as caught:
                compile_sheet({part: [{**known, "otherwise": otherwise}], "checks": checks}, self.fields)
            return caught.exception.problems[0]

        self.assertIn('keep the need and remove "otherwise"', message("needs", "UNABLE_TO_ASSESS"))
        self.assertIn('move it to "needs"', message("applies_if", "UNABLE_TO_ASSESS"))
        self.assertIn('move it to "checks"', message("applies_if", "FAIL"))
        self.assertIn('move it to "checks"', message("needs", "FAIL"))
        # Following the advice gives what the drafter asked for: an unknown code, UNABLE_TO_ASSESS.
        followed = self.compile({"needs": [known], "checks": checks})
        claim = next(c for c in load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl") if c["lines"])
        claim = {**claim, "lines": [{**claim["lines"][0], "service_code": "SVC-NOT-IN-THE-CATALOGUE"}]}
        self.assertEqual(evaluate_rule(followed, claim, REFERENCE_DATA).status, "UNABLE_TO_ASSESS")

    def test_a_field_that_does_not_exist_is_told_the_ones_that_do(self):
        # R009, 2026-10-12 (hard_v11): "/lines/*/patient_id" got a bare "is not a claim field" and the
        # drafter rewrote a sheet that was right apart from that path (10 wrong became 13).
        with self.assertRaises(SheetError) as caught:
            compile_sheet({"checks": [{"value": "/lines/*/patient_id", "is": "equals", "to": "/patient_id"}]}, self.fields)
        self.assertIn('"/patient_id"', caught.exception.problems[0])
        with self.assertRaises(SheetError) as caught:
            compile_sheet({"checks": [{"value": "/totl_amount", "is": "at_most", "to": 10}]}, self.fields)
        self.assertIn('"/total_amount"', caught.exception.problems[0])  # a typo: the closest spelling

    def test_searching_the_list_being_checked_points_to_unique(self):
        # collect2_R006: told only that it could not, the drafter gave up on a duplicate rule.
        with self.assertRaises(SheetError) as caught:
            compile_sheet({"checks": [{"value": "/lines/*", "is": "has_match", "in": "/lines", "where": [
                {"value": "/lines/*/service_code", "is": "equals", "to": "/lines/*/service_code"}]}]}, self.fields)
        self.assertIn('"is": "unique"', caught.exception.problems[0])
        unique = {"checks": [{"value": ["/lines/*/service_code", "/lines/*/service_date",
                                        {"first_present": ["/lines/*/modifier", ""]}], "is": "unique"}]}
        self.assertEqual(check_spec(self.compile(unique), self.fields), [])  # the construct it names compiles

    def test_counting_elements_whose_field_equals_itself_points_to_unique(self):
        # speed1_R006: lines counted where service_code equals service_code (the same line on both
        # sides), so the count was always 0 and every claim passed.
        with self.assertRaises(SheetError) as caught:
            compile_sheet({"checks": [{"value": {"count": "/lines", "where": [
                {"value": "/lines/*/service_code", "is": "equals", "to": "/lines/*/service_code"}]}, "is": "equals", "to": 0}]},
                self.fields)
        self.assertIn("the element being counted", caught.exception.problems[0])
        self.assertIn('"is": "unique"', caught.exception.problems[0])
        # Two different fields of the element are a real filter.
        self.compile({"checks": [{"value": {"count": "/lines", "where": [
            {"value": "/lines/*/net_amount", "is": "equals", "to": "/lines/*/unit_price"}]}, "is": "equals", "to": 0}]})

    def test_r003_as_the_model_wrote_it_gets_a_message_it_can_act_on(self):
        # outputs/quick_sheet.replies.jsonl: 14 turns of a day count compared "between" two dates.
        with self.assertRaises(SheetError) as caught:
            compile_sheet({"checks": [{"value": {"days_between": ["/coverage/start_date", "/lines/*/service_date"]},
                                       "is": "between", "to": ["/coverage/start_date", "/coverage/end_date"]}]}, self.fields)
        message = caught.exception.problems[0]
        self.assertIn("is a number of days", message)
        self.assertIn('{"value": "/lines/*/service_date", "is": "between"', message)  # its own field, the fix
        # Its other spellings of a field are read as that field.
        written = {"needs": ["coverage.start_date"], "checks": [{"value": {"path": "/coverage/status"}, "is": "equals", "to": "active"}]}
        plain = {"needs": ["/coverage/start_date"], "checks": [{"value": "/coverage/status", "is": "equals", "to": "active"}]}
        self.assertEqual(_without_notes(self.compile(written).to_json()), _without_notes(self.compile(plain).to_json()))
        self.assertEqual(self.compile({"checks": [{"value": "/currency", "is": "equals", "to": "eur.usd"}]})
                         .to_json()["steps"][0]["require"]["right"], {"value": "eur.usd"})  # not a field: stays text

    def test_the_drafter_reads_the_data_files_but_not_the_answers(self):
        reference = ReferenceData.load(BACKEND_ROOT / "rules")
        self.assertEqual(sorted(reference.files), ["diagnoses.json", "policies.json", "providers.json", "services.json"])
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        drafter = Drafter(ScriptedChatModel([]), self.fields, reference,
                          EdgeCaseGenerator(choose_base_claims(claims), self.fields, reference, schema))
        task = drafter._task(DraftingContext(rule={"title": "t", "logic": "l"}))
        self.assertEqual(task["reference_files"]["policies.json"]["EDU-BASIC"]["max_unit_price"]["SVC-CONSULT"], 350)
        self.assertNotIn("reference_specs", json.dumps(task))  # the hand-written answers never reach the model

    def test_every_claim_field_is_explained_and_the_example_claim_is_valid(self):
        guide = field_guide()
        paths = {item["path"] for item in self.fields.describe()}
        self.assertEqual(set(guide["fields"]), paths)  # every field explained, nothing invented
        self.assertTrue(all(len(meaning) > 10 for meaning in guide["fields"].values()))
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        validate_claim_schema(guide["example_claim"], schema)
        validate_transport(guide["example_claim"])
        reference = ReferenceData.load(BACKEND_ROOT / "rules")
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        drafter = Drafter(ScriptedChatModel([]), self.fields, reference,
                          EdgeCaseGenerator(choose_base_claims(claims), self.fields, reference, schema))
        task = drafter._task(DraftingContext(rule={"title": "t", "logic": "l"}))
        meanings = {item["path"]: item["meaning"] for item in task["claim_fields"]}
        self.assertIn("/authorizations", meanings["/lines/*/authorization_id"])  # the link between lists
        self.assertEqual(task["example_claim"]["claim_id"], "CG-EXAMPLE00001")

    def test_a_rule_that_copies_policy_values_is_flagged(self):
        reference = ReferenceData.load(BACKEND_ROOT / "rules")
        rule = {"title": "Allowed provider", "logic": "provider_id must be listed in policy.allowed_providers."}
        copied = self.compile({"checks": [{"value": "/provider_id", "is": "one_of", "to": ["EDU-PROV-01", "EDU-PROV-02"]}]})
        referred = self.compile({"checks": [{"value": "/provider_id", "is": "one_of", "to": {"policy": "allowed_providers"}}]})
        self.assertEqual(copied_policy_values(rule, copied, reference), ["EDU-PROV-01", "EDU-PROV-02"])
        self.assertEqual(copied_policy_values(rule, referred, reference), [])
        named = {"title": "Provider", "logic": "The provider must be EDU-PROV-01 or EDU-PROV-02 per the policy."}
        self.assertEqual(copied_policy_values(named, copied, reference), [])  # the text names them itself

    def test_spec_style_sums_are_read_only_when_their_meaning_is_clear(self):
        plain = self.compile({"checks": [{"value": "/total_amount", "is": "same_amount", "to": {"sum": "/lines/*/net_amount"}}]})
        for written in (
            {"sum": "/lines/*/net_amount", "as": "x", "of": "/lines"},  # R012 as the model wrote it
            {"sum": "/lines", "as": "x", "of": "$x/net_amount"},  # the full language's own form
        ):
            with self.subTest(written=written):
                spec = self.compile({"checks": [{"value": "/total_amount", "is": "same_amount", "to": written}]})
                self.assertEqual(_without_notes(spec.to_json()), _without_notes(plain.to_json()))
        for refused in ({"sum": "/lines/*/net_amount", "where": {"op": "equals"}}, {"count": "/lines", "where": {}}):
            with self.subTest(refused=refused), self.assertRaises(SheetError):
                compile_sheet({"checks": [{"value": "/total_amount", "is": "at_most", "to": refused}]}, self.fields)

    def test_the_drafter_writes_a_sheet_and_proposes_the_compiled_rule(self):
        reference = ReferenceData.load(BACKEND_ROOT / "rules")
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(claims), self.fields, reference, schema)
        sheet = {"checks": [{"value": "/total_amount", "is": "at_most", "to": 10000}]}
        model = ScriptedChatModel([
            {"action": "try", "sheet": sheet},
            {"action": "propose", "sheet": sheet, "intent": "total at most 10000", "assumptions": []},
        ])
        drafter = Drafter(model, self.fields, reference, generator, prompt="drafter_sheet")
        result = drafter.draft(DraftingContext(rule={"title": "Total limit", "logic": "The total must not exceed 10000."}))
        self.assertEqual(result.outcome, PROPOSED)
        self.assertEqual(result.spec.to_json()["steps"][0]["require"]["op"], "at_most")
        self.assertIn("sheet", model.calls[0][0]["content"])  # the sheet prompt was used
        self.assertIn("generated_cases", json.loads(model.calls[1][-1]["content"])["tool_result"])


class OutcomeKeysTests(unittest.TestCase):
    """"if_missing" and "if_unknown": what missing data and an unknown code give, written next to
    the condition instead of depending on where it sits (needs, applies_if, where, then)."""

    @classmethod
    def setUpClass(cls):
        cls.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        cls.items = {item.item_id: item for item in reference_items(BACKEND_ROOT)}

    def with_keys(self, rule_id):
        """The rule written with the keys and no "needs" at all."""
        sheet = json.loads(json.dumps(reference_sheets()[rule_id]))
        sheet.pop("needs", None)
        sheet["applies_if"][0]["if_unknown"] = "UNABLE_TO_ASSESS"
        for check in sheet["checks"]:
            if check.get("is") == "has_match":
                check.pop("needs", None)
                check["if_missing"] = "UNABLE_TO_ASSESS"
        return sheet

    def test_the_hard_rules_written_with_the_keys_equal_the_hand_written_ones(self):
        benchmark = Benchmark(BACKEND_ROOT, None, mutants=300)
        for rule_id in ("R008", "R009", "R010"):
            with self.subTest(rule=rule_id):
                sheet = self.with_keys(rule_id)
                self.assertNotIn("needs", json.dumps(sheet))
                spec = parse_spec(compile_sheet(sheet, self.fields, rule_id))
                self.assertEqual(check_spec(spec, self.fields), [])
                self.assertEqual(against_reference(benchmark, spec, self.items[rule_id]), {})

    def test_each_key_gives_the_outcome_it_names(self):
        claim = next(c for c in load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl") if c["lines"])
        line = claim["lines"][0]

        def status(check, kind="checks", **changes):
            sheet = ({"applies_if": [check], "checks": [{"value": "/lines/*/quantity", "is": "at_least", "to": 0}]}
                     if kind == "applies_if" else {"checks": [check]})
            spec = parse_spec(compile_sheet(sheet, self.fields))
            return evaluate_rule(spec, {**claim, "lines": [{**line, **changes}]}, REFERENCE_DATA).status

        price = {"value": "/lines/*/unit_price", "is": "at_least", "to": 0}
        self.assertEqual(status(price, unit_price=None), "UNABLE_TO_ASSESS")  # the default
        self.assertEqual(status({**price, "if_missing": "FAIL"}, unit_price=None), "FAIL")
        known = {"value": "/lines/*/service_code", "is": "not_equals", "to": "SVC-NONE"}
        self.assertEqual(status(known, service_code="SVC-NOT-LISTED"), "PASS")  # the default: just another value
        self.assertEqual(status({**known, "if_unknown": "UNABLE_TO_ASSESS"}, service_code="SVC-NOT-LISTED"), "UNABLE_TO_ASSESS")
        self.assertEqual(status({**known, "if_unknown": "FAIL"}, service_code="SVC-NOT-LISTED"), "FAIL")
        self.assertEqual(status({**known, "if_unknown": "NOT_APPLICABLE"}, "applies_if", service_code="SVC-NOT-LISTED"),
                         "NOT_APPLICABLE")
        self.assertEqual(status({**known, "if_missing": "NOT_APPLICABLE"}, "applies_if", service_code=None), "NOT_APPLICABLE")
        self.assertEqual(status({**known, "if_missing": "UNABLE_TO_ASSESS"}, "applies_if", service_code=None),
                         "UNABLE_TO_ASSESS")
        # An unknown value is also a missing one: rule texts say "unknown service/policy/date"
        # (R010, collect2, put if_unknown on a date and was refused).
        dated = {"value": "/lines/*/service_date", "is": "on_or_after", "to": "2000-01-01"}
        self.assertEqual(status({**dated, "if_unknown": "FAIL"}, service_date=None), "FAIL")
        self.assertEqual(status({**dated, "if_unknown": "NOT_APPLICABLE"}, "applies_if", service_date=None), "NOT_APPLICABLE")
        self.assertEqual(status({**known, "if_unknown": "FAIL", "if_missing": "UNABLE_TO_ASSESS"}, service_code=None),
                         "UNABLE_TO_ASSESS")  # both given: if_missing says what missing data gives

    def test_a_check_unable_to_assess_does_not_hide_a_known_violation(self):
        # "A known violation fails": an unknown code on one check must not stop another check that
        # is broken (the first version compiled the key into a need, which stops the whole line).
        claim = next(c for c in load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl") if c["lines"])
        line = {**claim["lines"][0], "service_code": "SVC-NOT-LISTED", "quantity": 0}
        sheet = {"checks": [{"value": "/lines/*/unit_price", "is": "at_most",
                             "to": {"policy": "max_unit_price", "for": "/lines/*/service_code"}, "if_unknown": "UNABLE_TO_ASSESS"},
                            {"value": "/lines/*/quantity", "is": "greater_than", "to": 0}]}
        spec = parse_spec(compile_sheet(sheet, self.fields))
        self.assertEqual(evaluate_rule(spec, {**claim, "lines": [line]}, REFERENCE_DATA).status, "FAIL")
        valid = {**line, "quantity": 1}
        self.assertEqual(evaluate_rule(spec, {**claim, "lines": [valid]}, REFERENCE_DATA).status, "UNABLE_TO_ASSESS")

    def test_a_need_may_say_what_an_unknown_code_gives(self):
        # collect2: drafters wrote the keys on needs 6 times, meaning UNABLE_TO_ASSESS; now accepted.
        claim = next(c for c in load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl") if c["lines"])
        sheet = {"needs": [{"value": "/lines/*/service_code", "is": "present", "if_unknown": "UNABLE_TO_ASSESS"}],
                 "checks": [{"value": "/lines/*/quantity", "is": "at_least", "to": 0}]}
        spec = parse_spec(compile_sheet(sheet, self.fields))
        unknown = {**claim, "lines": [{**claim["lines"][0], "service_code": "SVC-NOT-LISTED"}]}
        self.assertEqual(evaluate_rule(spec, unknown, REFERENCE_DATA).status, "UNABLE_TO_ASSESS")

    def test_a_key_in_the_wrong_place_says_where_it_goes(self):
        def problem(sheet):
            with self.assertRaises(SheetError) as caught:
                compile_sheet(sheet, self.fields)
            return caught.exception.problems[0]

        code = {"value": "/lines/*/service_code", "is": "not_equals", "to": "SVC-NONE"}
        checks = [{"value": "/lines/*/quantity", "is": "at_least", "to": 0}]
        self.assertIn("to FAIL, use a check", problem({"applies_if": [{**code, "if_unknown": "FAIL"}], "checks": checks}))
        self.assertIn("put the condition in applies_if", problem({"checks": [{**code, "if_missing": "NOT_APPLICABLE"}]}))
        self.assertIn("for FAIL make it a check", problem({"needs": [{**code, "if_missing": "FAIL"}],
                                                                      "checks": checks}))
        self.assertIn("reads none directly", problem({"checks": [{"value": {"count": "/lines"}, "is": "at_least", "to": 1,
                                                                  "if_unknown": "UNABLE_TO_ASSESS"}]}))
        # R010 (collect2): "otherwise": "NOT_APPLICABLE" in applies_if was told the values otherwise takes.
        message = problem({"applies_if": [{**code, "otherwise": "NOT_APPLICABLE"}], "checks": checks})
        self.assertIn('applies_if already gives NOT_APPLICABLE when a condition does not hold: remove "otherwise"', message)
        self.assertIn('"if_unknown"', message)
        self.assertIn('check that field in "then"', problem({"checks": [{"is": "has_match", "in": "/authorizations", "where": [
            {"value": "/authorizations/*/status", "is": "equals", "to": "approved", "if_missing": "UNABLE_TO_ASSESS"}]}]}))


class OutcomeTableTests(unittest.TestCase):
    """"outcomes": the rule text's own sentences on missing data and unknown codes, quoted once
    and written by code onto every condition that reads such a value."""

    @classmethod
    def setUpClass(cls):
        cls.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        cls.items = {item.item_id: item for item in reference_items(BACKEND_ROOT)}

    def test_every_official_rule_is_its_comparisons_and_its_own_sentences(self):
        # Without the table the hard rules are wrong on many claims (R008 39, R009 73, R010 89 of
        # the benchmark's claims, 2026-10-12): the outcomes their texts give missing and unknown
        # data. With it, and no needs or keys at all, each equals its hand-written rule.
        benchmark = Benchmark(BACKEND_ROOT, None, mutants=300)
        for rule_id, table in OFFICIAL_TABLES.items():
            with self.subTest(rule=rule_id):
                self.assertEqual(outcome_quote_problems(table, rule_text(RULES[rule_id])), [])
                sheet = with_the_texts_table(rule_id)
                self.assertNotIn('"needs"', json.dumps(sheet))
                spec = parse_spec(compile_sheet(sheet, self.fields, rule_id))
                self.assertEqual(check_spec(spec, self.fields), [])
                self.assertEqual(against_reference(benchmark, spec, self.items[rule_id]), {})
        hard = parse_spec(compile_sheet(comparisons_only("R009"), self.fields, "R009"))
        self.assertNotEqual(against_reference(benchmark, hard, self.items["R009"]), {})

    def test_a_quote_is_the_rule_texts_words_about_its_entry_and_outcome(self):
        text = ("Each line's price must not exceed the base price. A line without a price fails; an unknown "
                "service code cannot be assessed. An unavailable policy leaves UNABLE_TO_ASSESS.")

        def problems(entry, outcome, quote):
            return outcome_quote_problems({entry: _said(outcome, quote)}, text)

        self.assertEqual(problems("missing_in_checks", "FAIL", "A line without a price fails"), [])
        self.assertEqual(problems("unknown_code", "UNABLE_TO_ASSESS", "an unknown service code cannot be assessed."), [])
        self.assertEqual(problems("unknown_policy", "UNABLE_TO_ASSESS", "An unavailable policy ... UNABLE_TO_ASSESS"), [])
        self.assertIn("copied from the rule text", problems("missing_in_checks", "FAIL", "A line without a total fails")[0])
        self.assertIn("at least three", problems("missing_in_checks", "FAIL", "fails")[0])
        # Filed under the wrong entry: an unavailable policy is not an unknown code.
        self.assertIn("does not speak of an unknown service, provider or diagnosis code",
                      problems("unknown_code", "UNABLE_TO_ASSESS", "An unavailable policy leaves UNABLE_TO_ASSESS")[0])
        self.assertIn("does not say FAIL", problems("unknown_code", "FAIL", "an unknown service code cannot be assessed")[0])
        self.assertEqual(quoted_outcomes({"unknown_code": _said("FAIL", "an unknown service code cannot be assessed"),
                                          "missing_in_checks": _said("FAIL", "A line without a price fails")}, text),
                         {"missing_in_checks": "FAIL"})

    def test_a_malformed_table_says_how_to_write_it(self):
        def problem(table):
            with self.assertRaises(SheetError) as caught:
                read_outcomes(table)
            return caught.exception.problems[0]

        self.assertIn("the entries are missing_in_checks", problem({"missing": _said("FAIL", "a b c")}))
        self.assertIn('{"outcome": ..., "quote"', problem({"missing_in_checks": "FAIL"}))
        self.assertIn("that is missing_in_applies_if", problem({"missing_in_checks": _said("NOT_APPLICABLE", "a b c")}))
        self.assertIn("that is missing_in_checks", problem({"missing_in_applies_if": _said("FAIL", "a b c")}))
        self.assertEqual(read_outcomes({"unknown_policy": _said("FAIL", "a b c")}), {"unknown_policy": "FAIL"})

    def test_an_entry_that_applies_to_nothing_says_how_to_make_it_apply(self):
        # speed2_R008: the codes read only inside a count, so "unknown service codes ... leave
        # UNABLE_TO_ASSESS" applied nowhere, and exactly those claims were wrong.
        required = {"value": "/lines/*/service_code", "is": "one_of", "to": {"policy": "auth_required_services"}}
        counted = {"outcomes": {"unknown_code": _said("UNABLE_TO_ASSESS", "unknown codes leave UNABLE_TO_ASSESS")},
                   "applies_if": [{"value": {"count": "/lines", "where": [required]}, "is": "greater_than", "to": 0}],
                   "checks": [{"value": {"count": "/lines", "where": [required]}, "is": "at_most", "to": 3}]}
        with self.assertRaises(SheetError) as caught:
            compile_sheet(counted, self.fields)
        self.assertIn("outcomes.unknown_code applies to nothing", caught.exception.problems[0])
        self.assertIn('"/lines/*/service_code"', caught.exception.problems[0])
        per_line = {**counted, "applies_if": [required], "checks": [{"value": "/lines/*/authorization_id", "is": "present"}]}
        compile_sheet(per_line, self.fields)  # read for each line, the entry applies

    def test_a_conditions_own_keys_replace_the_table(self):
        claim = next(c for c in load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl") if c["lines"])
        line = claim["lines"][0]
        table = {"unknown_code": _said("UNABLE_TO_ASSESS", "unknown codes leave UNABLE_TO_ASSESS")}
        check = {"value": "/lines/*/service_code", "is": "not_equals", "to": "SVC-NONE"}

        def status(check, **changes):
            spec = parse_spec(compile_sheet({"outcomes": table, "checks": [check]}, self.fields))
            return evaluate_rule(spec, {**claim, "lines": [{**line, **changes}]}, REFERENCE_DATA).status

        self.assertEqual(status(check, service_code="SVC-NOT-LISTED"), "UNABLE_TO_ASSESS")  # the table
        self.assertEqual(status({**check, "if_unknown": "FAIL"}, service_code="SVC-NOT-LISTED"), "FAIL")  # its own key
        # "present" decides what a missing value gives itself: a known absence still fails.
        present = {"value": "/lines/*/service_code", "is": "present"}
        self.assertEqual(status(present, service_code=None), "FAIL")
        self.assertEqual(status(present, service_code="SVC-NOT-LISTED"), "UNABLE_TO_ASSESS")

    def test_the_drafter_checks_the_quotes_and_takes_a_table_sent_beside_the_sheet(self):
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(claims), self.fields, REFERENCE_DATA, schema)
        rule = {"title": "Known prices", "logic": "Each line's unit price must be positive. A line whose service code is "
                                                  "unknown cannot be assessed."}
        sheet = {"checks": [{"value": "/lines/*/unit_price", "is": "greater_than", "to": 0},
                            {"value": "/lines/*/service_code", "is": "not_equals", "to": "SVC-NONE"}]}
        guessed = {"unknown_code": _said("UNABLE_TO_ASSESS", "unknown codes are not assessable")}
        quoted = {"unknown_code": _said("UNABLE_TO_ASSESS", "A line whose service code is unknown cannot be assessed")}
        model = ScriptedChatModel([{"action": "check", "sheet": sheet, "outcomes": guessed},
                                   {"action": "check", "sheet": sheet, "outcomes": quoted}])
        result = Drafter(model, self.fields, REFERENCE_DATA, generator, prompt="drafter_sheet",
                         auto_propose=True).draft(DraftingContext(rule=rule))
        self.assertEqual(result.outcome, PROPOSED)
        self.assertIn("copied from the rule text", json.dumps(model.calls[1]))
        self.assertEqual(result.sheet["outcomes"], quoted)
        line = {**claims[0]["lines"][0], "service_code": "SVC-NOT-LISTED", "unit_price": 10}
        self.assertEqual(evaluate_rule(result.spec, {**claims[0], "lines": [line]}, REFERENCE_DATA).status,
                         "UNABLE_TO_ASSESS")


class AlwaysUnableTests(unittest.TestCase):
    def test_a_rule_unable_to_assess_everywhere_is_told_which_value_most_claims_lack(self):
        # R006 (collect3): right but for a modifier null on most lines, and told only
        # "outcomes seen: UNABLE_TO_ASSESS" for 34 minutes.
        from rule_authoring.checks import DraftChecker
        fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        checker = DraftChecker(fields, REFERENCE_DATA, EdgeCaseGenerator(choose_base_claims(claims), fields, REFERENCE_DATA,
                                                                          schema), None, claims, sheet=True)
        sheet = {"checks": [{"value": ["/lines/*/service_code", "/lines/*/service_date", "/lines/*/modifier"], "is": "unique"}]}
        report = checker.run(RULES["R006"], parse_spec(compile_sheet(sheet, fields)), [])
        [constant] = [check for check in report.checks if check.name == "not_constant"]
        self.assertFalse(constant.passed)
        self.assertIn("/lines/*/modifier (missing on", constant.detail)
        self.assertNotIn("/lines/*/service_code (missing", constant.detail)
        self.assertIn("first_present", constant.detail)


class AutoProposeTests(unittest.TestCase):
    """A sheet that passes the checks goes to the author at once (collection run 2: a quarter of the
    model time re-sent a good sheet to try and propose)."""

    def setUp(self):
        self.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        self.generator = EdgeCaseGenerator(choose_base_claims(claims), self.fields, REFERENCE_DATA, schema)
        self.sheet = {"checks": [{"value": "/total_amount", "is": "at_most", "to": 10000}]}
        self.rule = {"title": "Total limit", "logic": "The total must not exceed 10000."}

    def draft(self, replies, **context):
        model = ScriptedChatModel(replies)
        result = Drafter(model, self.fields, REFERENCE_DATA, self.generator, prompt="drafter_sheet",
                         auto_propose=True).draft(DraftingContext(rule=self.rule, **context))
        return result, model

    def test_a_good_sheet_is_proposed_on_its_first_check(self):
        result, model = self.draft([{"action": "check", "sheet": self.sheet}, {"action": "try", "sheet": self.sheet}])
        self.assertEqual((result.outcome, len(model.calls)), (PROPOSED, 1))

    def test_a_sheet_that_failed_the_full_checks_is_not_proposed_again_by_itself(self):
        replies = [{"action": "check", "sheet": self.sheet},
                   {"action": "propose", "sheet": self.sheet, "intent": "", "assumptions": []}]
        result, model = self.draft(replies, last_draft={"draft": self.sheet, "passed_checks": False})
        self.assertEqual((result.outcome, len(model.calls)), (PROPOSED, 2))  # the drafter chose to


class TryShowsWhatAnEditChangedTests(unittest.TestCase):
    """R009, 2026-10-12 (hard_v12): one added check ("the policy's currency must be present")
    made 172 claims the rule does not apply to PASS; the next try showed only the new outcomes."""

    def setUp(self):
        self.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        self.generator = EdgeCaseGenerator(choose_base_claims(claims), self.fields, REFERENCE_DATA, schema)
        self.rule = next(item.rule for item in reference_items(BACKEND_ROOT) if item.item_id == "R009")
        self.right = reference_sheets()["R009"]
        self.edited = {**self.right, "checks": [{"value": {"policy": "currency"}, "is": "present",
                                                 "otherwise": "UNABLE_TO_ASSESS"}, *self.right["checks"]]}

    def results(self, replies, **context):
        model = ScriptedChatModel(replies)
        Drafter(model, self.fields, REFERENCE_DATA, self.generator, prompt="drafter_sheet").draft(
            DraftingContext(rule=self.rule, **context))
        return [json.loads(call[-1]["content"])["tool_result"] for call in model.calls[1:]]

    def test_a_try_lists_the_outcomes_the_edit_changed(self):
        first, second = self.results([{"action": "try", "sheet": self.right}, {"action": "try", "sheet": self.edited},
                                      {"action": "propose", "sheet": self.right, "intent": "", "assumptions": []}])
        self.assertNotIn("changed_since", first)  # nothing to compare with yet
        changes = {change["case"]: (change["before"], change["now"]) for change in second["changed_since"]["changes"]}
        self.assertEqual(second["changed_since"]["compared_with"], "your last try")
        self.assertEqual(changes["claim B unchanged"], ("NOT_APPLICABLE", "PASS"))
        self.assertEqual({before for before, _ in changes.values()}, {"NOT_APPLICABLE"})  # only what it changed

    def test_the_first_try_of_a_session_compares_with_the_last_draft(self):
        [result] = self.results([{"action": "try", "sheet": self.edited},
                                 {"action": "propose", "sheet": self.right, "intent": "", "assumptions": []}],
                                last_draft={"draft": self.right, "passed_checks": True})
        self.assertEqual(result["changed_since"]["compared_with"], "your last draft")
        self.assertIn(("claim C unchanged", "NOT_APPLICABLE", "PASS"),
                      {(change["case"], change["before"], change["now"]) for change in result["changed_since"]["changes"]})


def _without_notes(node):
    """The logic of a spec: notes only describe steps for people."""
    if isinstance(node, dict):
        return {key: _without_notes(value) for key, value in node.items() if key != "note"}
    if isinstance(node, list):
        return [_without_notes(item) for item in node]
    return node


if __name__ == "__main__":
    unittest.main()
