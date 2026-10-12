"""Mistakes the free model really made (outputs/diag_drafter.log), and the code that absorbs them.

Each case below is taken from a real drafter reply that used to end the session.
The repaired rule must behave exactly like the reference rule.
"""

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx
from openai import RateLimitError

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_authoring.drafter import _format_hint, _repair_protocol, lift_wildcard_paths, normalise_values  # noqa: E402
from rule_authoring.hints import explain  # noqa: E402
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims, fields_mentioned  # noqa: E402
from rule_authoring.llm import ModelError, ModelFormatError, OpenAIChatModel, last_call, parse_json_object  # noqa: E402
from rule_engine.catalogue import FieldCatalogue, ReferenceData  # noqa: E402
from rule_engine.engine_core import load_jsonl  # noqa: E402
from rule_engine.interpreter import evaluate_rule  # noqa: E402
from rule_engine.language import SpecError, parse_spec  # noqa: E402
from rule_engine.validation import check_spec  # noqa: E402

SEED = json.loads((BACKEND_ROOT / "rules" / "reference_specs.json").read_text(encoding="utf-8"))["specs"]
CATALOGUE = {rule["rule_id"]: rule for rule in json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8"))}
MESSAGES = {"PASS": "ok", "FAIL": "broken", "UNABLE_TO_ASSESS": "missing"}

# R001 as the model wrote it: correct, but the outer "steps" list is never closed.
R001_UNCLOSED = (
    '{"action": "check", "spec": {"language_version": 2, "steps": ['
    '{"require": {"op": "is_present", "value": {"path": "/invoice_number"}}}, '
    '{"require": {"op": "is_present", "value": {"path": "/member_id"}}}, '
    '{"require": {"op": "is_present", "value": {"path": "/diagnosis_code"}}}, '
    '{"for_each": {"path": "/lines"}, "as": "line", "steps": ['
    '{"require": {"op": "is_present", "value": {"path": "$line/service_date"}}}, '
    '{"require": {"op": "is_present", "value": {"path": "$line/service_code"}}}, '
    '{"require": {"op": "is_present", "value": {"path": "$line/quantity"}}}, '
    '{"require": {"op": "is_present", "value": {"path": "$line/unit_price"}}}, '
    '{"require": {"op": "is_present", "value": {"path": "$line/net_amount"}}}]}, '
    '"messages": {"PASS": "ok", "FAIL": "missing", "UNABLE_TO_ASSESS": "unknown"}}}'
)


def r002_with(path):
    """R002 as the model wrote it: one require over a wildcard path."""
    return {"language_version": 2, "messages": MESSAGES, "steps": [
        {"require": {"op": "on_or_before", "left": {"path": path}, "right": {"path": "/submission_date"}},
         "otherwise": "FAIL"}]}


class ModelSlipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
        cls.reference = ReferenceData.load(BACKEND_ROOT / "rules")
        cls.claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")

    def assert_same_rule(self, spec, rule_id):
        spec = parse_spec(spec)
        self.assertEqual(check_spec(spec, self.fields), [])
        reference = parse_spec(SEED[rule_id]["spec"])
        for claim in self.claims:
            self.assertEqual(evaluate_rule(spec, claim, self.reference).status,
                             evaluate_rule(reference, claim, self.reference).status, claim["claim_id"])

    def test_a_list_left_open_before_the_next_key_is_closed(self):
        reply = parse_json_object(R001_UNCLOSED)
        self.assertEqual(reply["action"], "check")
        self.assert_same_rule(reply["spec"], "R001")

    def test_a_list_left_open_before_a_closing_brace_is_closed(self):
        self.assertEqual(parse_json_object('{"a": [1, 2}'), {"a": [1, 2]})
        self.assertEqual(parse_json_object('{"a": [{"b": 1], "c": 2}'), {"a": [{"b": 1}], "c": 2})

    def test_a_missing_spec_key_is_put_back(self):
        broken = R001_UNCLOSED.replace('"action": "check", "spec": {', '"action": "check", {', 1)
        with self.assertRaises(ModelFormatError):
            parse_json_object(broken)
        reply = _repair_protocol(broken)
        self.assertEqual(reply["action"], "check")
        self.assert_same_rule(reply["spec"], "R001")
        self.assertIsNone(_repair_protocol('{"action": "ask_author", {"x": 1}}'))  # only before a spec

    def test_every_line_written_as_a_wildcard_becomes_for_each(self):
        for path in ("/lines/*/service_date", "/lines/*/*/service_date", "/lines/[]/service_date",
                     "$/lines/*/service_date", "$lines/*/service_date"):
            with self.subTest(path=path):
                self.assert_same_rule(lift_wildcard_paths(r002_with(path)), "R002")

    def test_consecutive_wildcard_steps_share_one_for_each(self):
        spec = {"language_version": 2, "messages": MESSAGES, "steps": [
            {"only_if": {"op": "equals", "left": {"path": "/lines/*/service_code"}, "right": {"value": "SVC-CONSULT"}}},
            {"require": {"op": "is_present", "value": {"path": "/lines/*/modifier"}}},
        ]}
        lifted = lift_wildcard_paths(spec)
        self.assertEqual(len(lifted["steps"]), 1)
        loop = lifted["steps"][0]
        self.assertEqual((loop["for_each"], loop["as"]), ({"path": "/lines"}, "line"))
        self.assertEqual(loop["steps"][1]["require"]["value"]["path"], "$line/modifier")
        self.assertEqual(check_spec(parse_spec(lifted), self.fields), [])
        self.assertEqual(spec["steps"][0]["only_if"]["left"]["path"], "/lines/*/service_code")  # input untouched

    def test_what_cannot_be_lifted_is_explained_in_plain_words(self):
        index = r002_with("/lines/0/service_date")  # one line, not every line: never guessed
        self.assertEqual(lift_wildcard_paths(index), index)
        with self.assertRaises(SpecError) as caught:
            parse_spec(index)
        self.assertIn("to check every line, use", caught.exception.problems[0])
        self.assertNotIn("should match pattern", caught.exception.problems[0])

    def test_a_field_the_rule_names_but_the_draft_drops_shows_up_in_the_case_table(self):
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(self.claims), self.fields, self.reference, schema)
        reference = parse_spec(SEED["R003"]["spec"])
        dropped = json.loads(json.dumps(SEED["R003"]["spec"]))
        dropped["steps"][1]["steps"].pop()  # the coverage end date is never checked
        dropped = parse_spec(dropped)

        def wrong_rows(cases):
            return [case.description for case in cases
                    if evaluate_rule(dropped, case.claim, self.reference).status
                    != evaluate_rule(reference, case.claim, self.reference).status]

        self.assertEqual(wrong_rows(generator.generate(dropped)), [])  # what the draft reads looks fine
        shown = wrong_rows(generator.generate(dropped, CATALOGUE["R003"]))
        self.assertTrue(shown)  # the author sees a wrong outcome and corrects it
        self.assertTrue(all("coverage.end_date" in row for row in shown), shown)

    def test_a_missing_value_and_a_violation_together_show_which_one_wins(self):
        # R003 as the model drafted it: within_dates is unknown when either bound is missing,
        # even if the other bound is already violated. The rule says a known violation wins.
        draft = parse_spec({"language_version": 2, "messages": MESSAGES, "steps": [
            {"require": {"op": "equals", "left": {"path": "/coverage/status"}, "right": {"value": "active"}}},
            {"for_each": {"path": "/lines"}, "as": "line", "steps": [
                {"require": {"op": "within_dates", "value": {"path": "$line/service_date"},
                             "from": {"path": "/coverage/start_date"}, "to": {"path": "/coverage/end_date"}}}]}]})
        reference = parse_spec(SEED["R003"]["spec"])
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(self.claims), self.fields, self.reference, schema)
        cases = generator.generate(draft, CATALOGUE["R003"])
        wrong = [case.description for case in cases
                 if evaluate_rule(draft, case.claim, self.reference).status
                 != evaluate_rule(reference, case.claim, self.reference).status]
        self.assertTrue(wrong)  # the author sees it in the case table and corrects it
        self.assertTrue(all(", and " in row for row in wrong), wrong)  # only a combined claim shows it
        self.assertEqual([case.case_id for case in cases], [case.case_id for case in generator.generate(draft, CATALOGUE["R003"])])

    def test_a_value_named_with_let_is_read_back_as_a_path(self):
        # INV-20 as the model wrote it (outputs/diag_slips.log): {"sum"} is not JSON at all.
        raw = ('{"action": "propose", {"language_version": 2, "steps": ['
               '{"let": "sum", "be": {"sum": {"path": "/lines"}, "as": "line", "of": {"path": "$line/quantity"}}}, '
               '{"require": {"op": "at_most", "left": {"path": "/total_amount"}, "right": {"value": {"sum"}}}, "otherwise": "FAIL"}], '
               '"messages": {"PASS": "ok", "FAIL": "broken", "UNABLE_TO_ASSESS": "missing"}}}')
        with self.assertRaises(ModelFormatError):
            parse_json_object(raw)
        reply = _repair_protocol(raw)
        self.assertEqual(reply["spec"]["steps"][1]["require"]["right"], {"path": "$sum"})
        self.assertEqual(check_spec(parse_spec(normalise_values(reply["spec"])), self.fields), [])
        # With anything else beside it, the reply stays unreadable, but the model is told what to write.
        unreadable = raw.replace('{"value": {"sum"}}', '{"value": {"sum", "tolerance": 1}}')
        self.assertIsNone(_repair_protocol(unreadable))
        self.assertIn('write {"path": "$sum"}', _format_hint(unreadable))

    def test_arithmetic_written_like_a_condition_becomes_a_value(self):
        quantity, price = {"path": "$line/quantity"}, {"path": "$line/unit_price"}
        product = {"multiply": [quantity, price]}
        sums = {"sum": {"path": "/lines"}, "as": "line", "of": product}
        written = [
            {**sums, "of": {"path": "$line/quantity", "op": "multiply", "items": [price]}},  # the model's first try
            {**sums, "of": quantity, "op": "multiply", "items": [price]},  # its second: beside the sum
            {**sums, "of": {"op": "multiply", "left": quantity, "right": price}},
            {**sums, "of": {"op": "multiply", "items": [quantity, price]}},
        ]
        for value in written:
            with self.subTest(value=value):
                self.assertEqual(normalise_values(value), sums)
        self.assertEqual(normalise_values({"value": {"path": "$total"}}), {"path": "$total"})
        self.assertEqual(normalise_values({"value": 5}), {"value": 5})  # a real fixed value stays

    def test_the_second_inv20_session_reads_and_checks(self):
        # INV-20's later replies (outputs/smoke5.json): an object written without braces
        # inside a list, "multiply" written beside the value it multiplies, a note inside
        # the condition, and once the "spec" key forgotten.
        raw = ('{"action": "check", {"language_version": 2, "steps": [{"require": {"op": "at_most", '
               '"left": {"path": "/total_amount"}, "right": {"sum": {"path": "/lines"}, "as": "line", '
               '"of": {"path": "$line/quantity", "multiply": ["path": "$line/unit_price"]}}, '
               '"note": "total amount is at most the line sum"}, "otherwise": "FAIL"}], '
               '"messages": {"PASS": "ok", "FAIL": "broken", "UNABLE_TO_ASSESS": "missing"}}}')
        reply = _repair_protocol(raw)
        spec = normalise_values(reply["spec"])
        step = spec["steps"][0]
        self.assertEqual(step["note"], "total amount is at most the line sum")
        self.assertEqual(step["require"]["right"]["of"],
                         {"multiply": [{"path": "$line/quantity"}, {"path": "$line/unit_price"}]})
        self.assertEqual(check_spec(parse_spec(spec), self.fields), [])

    def test_an_object_without_braces_in_a_list_is_not_mistaken_for_a_list_left_open(self):
        self.assertEqual(parse_json_object('{"a": ["path": "$x"]}'), {"a": [{"path": "$x"}]})
        self.assertEqual(parse_json_object('{"a": [1, 2], "b": 3}'), {"a": [1, 2], "b": 3})
        self.assertEqual(parse_json_object('{"a": [1, 2, "b": 3}'), {"a": [1, 2], "b": 3})  # R001: still closed

    def test_arithmetic_where_a_condition_belongs_is_explained_not_rewritten(self):
        # R014 as the model wrote it: days_between is a number of days, not a yes/no.
        step = {"require": {"op": "days_between", "left": {"path": "/submission_date"}, "right": {"value": 30}}}
        spec = {"language_version": 2, "messages": MESSAGES, "steps": [step]}
        self.assertEqual(normalise_values(spec), spec)
        with self.assertRaises(SpecError) as caught:
            parse_spec(spec)
        self.assertIn('"days_between" is a value, not a condition', caught.exception.problems[0])
        dates = {**spec, "steps": [{"require": {"op": "at_most", "left": {"path": "/submission_date"}, "right": {"value": 30}}}]}
        self.assertIn('{"days_between": [earlier date, later date]}', check_spec(parse_spec(dates), self.fields)[0])

    def test_a_disagreement_with_the_author_says_what_to_change(self):
        draft = parse_spec({"language_version": 2, "messages": MESSAGES, "steps": [
            {"require": {"op": "within_dates", "value": {"path": "/submission_date"},
                         "from": {"path": "/coverage/start_date"}, "to": {"path": "/coverage/end_date"}}}]})
        hint = explain("FAIL", "UNABLE_TO_ASSESS", draft)
        self.assertIn("within_dates is unknown as soon as one of its three dates is missing", hint)
        self.assertIn("on_or_after the start and on_or_before the end", hint)
        self.assertIn("compare the value itself", explain("UNABLE_TO_ASSESS", "FAIL", draft))
        self.assertIn("only_if", explain("NOT_APPLICABLE", "PASS", draft))

    def test_days_counted_the_wrong_way_round_show_up_in_the_case_table(self):
        # INV-17 as the model drafted it (outputs/quick_sheet.replies.jsonl): the dates in
        # days_between swapped, so the count is negative and the rule (almost) always passes.
        rule = {"title": "Service within 90 days", "logic": "Each line's service date must be at most 90 days "
                "before the submission date. A missing service date cannot be assessed."}
        steps = lambda first, second: [{"for_each": {"path": "/lines"}, "as": "line", "steps": [{"require": {
            "op": "at_most", "left": {"days_between": [{"path": first}, {"path": second}]}, "right": {"value": 90}},
            "otherwise": "FAIL"}]}]
        right = parse_spec({"language_version": 2, "messages": MESSAGES, "steps": steps("$line/service_date", "/submission_date")})
        swapped = parse_spec({"language_version": 2, "messages": MESSAGES, "steps": steps("/submission_date", "$line/service_date")})
        schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        generator = EdgeCaseGenerator(choose_base_claims(self.claims), self.fields, self.reference, schema)
        wrong = [case.description for case in generator.generate(swapped, rule)
                 if evaluate_rule(swapped, case.claim, self.reference).status
                 != evaluate_rule(right, case.claim, self.reference).status]
        self.assertTrue(any("90 days before" in row for row in wrong), wrong)

    def provider(self, *outcomes):
        """An OpenAIChatModel whose provider replies with the given outcomes, in order."""
        budgets, waits = [], []

        def create(**kwargs):
            budgets.append(kwargs["max_tokens"])
            outcome = outcomes[len(budgets) - 1]
            if isinstance(outcome, Exception):
                raise outcome
            content, finish_reason = outcome
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content),
                                                            finish_reason=finish_reason)])

        model = OpenAIChatModel("test-model", api_key="test-key", sleep=waits.append)
        model._client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        return model, budgets, waits

    def test_an_answer_cut_off_by_thinking_is_asked_again_with_more_room(self):
        # Nemotron 3 Super (outputs/honest_single.replies.jsonl): 23 empty replies, the
        # reasoning had used the whole output budget before the answer began.
        model, budgets, _ = self.provider(("", "length"), ('{"action": "check"}', "stop"))
        self.assertEqual(model.complete_json([{"role": "user", "content": "x"}]), {"action": "check"})
        self.assertEqual(budgets, [16000, 32000])
        # The drafting log records each request, so a slow call shows whether it was repeated.
        self.assertEqual([(request["max_tokens"], request["finish_reason"]) for request in last_call(model)],
                         [(16000, "length"), (32000, "stop")])
        model, _, _ = self.provider(*[("", "length")] * 2)
        with self.assertRaises(ModelFormatError) as caught:
            model.complete_json([{"role": "user", "content": "x"}])
        self.assertIn("whole output budget", str(caught.exception))

    def test_a_rate_limit_is_waited_out_before_giving_up(self):
        limited = RateLimitError("slow down", response=httpx.Response(429, request=httpx.Request("POST", "https://x")), body=None)
        model, _, waits = self.provider(limited, limited, ('{"ok": true}', "stop"))
        self.assertEqual(model.complete_json([{"role": "user", "content": "x"}]), {"ok": True})
        self.assertEqual(waits, [15, 30])
        model, _, waits = self.provider(*[limited] * 4)
        with self.assertRaises(ModelError):
            model.complete_json([{"role": "user", "content": "x"}])
        self.assertEqual(waits, [15, 30, 60])

    def test_fields_are_found_by_name_in_the_rule_text(self):
        def named(text):
            return sorted(sorted(group) for group in fields_mentioned(text, self.fields))

        self.assertEqual(named("coverage.status must equal active"), [["/coverage/status"]])
        self.assertEqual(named("every line service_date"), [["/lines/*/service_date"]])
        self.assertEqual(named("the service date"), [["/attachments/*/service_date", "/lines/*/service_date"]])
        self.assertEqual(named("The invoice number must be present"), [["/invoice_number"]])
        self.assertEqual(named("every attachment must have document status final"), [["/attachments/*/document_status"]])
        self.assertEqual(named("quantity at most policy.max_quantity_per_line"), [["/lines/*/quantity"]])


if __name__ == "__main__":
    unittest.main()
