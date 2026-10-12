"""Missing-data questions: grouped by situation, and asked before the test-claim table."""

import copy
import json
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from rule_authoring.checks import CaseOutcome
from rule_authoring.drafts import SITUATION
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims
from rule_authoring.llm import AuthoringModels, ScriptedChatModel
from rule_authoring.missing_data import IT_DEPENDS, MAX_SITUATIONS, decided_by_text, situations
from rule_authoring.service import AuthoringSettings
from rule_authoring.sheet import compile_sheet, quoted_outcomes, reference_sheets
from rule_authoring.edge_cases import rule_text
from test_rule_sheet import OFFICIAL_TABLES, RULES, comparisons_only, with_the_texts_table
from rule_benchmark.runner import Benchmark, SimulatedAuthor, reference_items
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl
from rule_engine.interpreter import evaluate_rule
from rule_engine.language import parse_spec
from rule_engine.validation import analyse_spec

REFERENCE_DATA = ReferenceData.load(BACKEND_ROOT / "rules")
FIELDS = FieldCatalogue.from_backend_root(BACKEND_ROOT)
ITEMS = {item.item_id: item for item in reference_items(BACKEND_ROOT)}


def status(spec, claim):
    return evaluate_rule(spec, claim, REFERENCE_DATA).status


def situations_of(sheet, rule_id):
    """The situations the author would be asked about for this drafted sheet."""
    spec = parse_spec(compile_sheet(sheet, FIELDS, rule_id))
    claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")
    schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
    generator = EdgeCaseGenerator(choose_base_claims(claims), FIELDS, REFERENCE_DATA, schema)
    cases = [CaseOutcome(case_id=case.case_id, description=case.description, spec_status=status(spec, case.claim),
                         oracle_status=None, oracle_reason="", claim=case.claim, oracle_used=False, field=case.field)
             for case in generator.generate(spec, ITEMS[rule_id].rule)]
    return situations(cases, analyse_spec(spec, FIELDS).applicability_fields, REFERENCE_DATA)


def the_rules_answer(situation, rule_id):
    outcomes = {status(ITEMS[rule_id].reference, case.claim) for case in situation.cases}
    return outcomes.pop() if len(outcomes) == 1 else IT_DEPENDS


class SituationTests(unittest.TestCase):
    def test_an_unknown_service_code_is_asked_with_the_values_that_decide_applicability(self):
        # R009 as run B drafted it (2026-10-11): right except that an unknown service code gave
        # NOT_APPLICABLE; the sentence "unknown service ... leaves UNABLE_TO_ASSESS" was missed.
        drafted = copy.deepcopy(reference_sheets()["R009"])
        del drafted["needs"]
        found = situations_of(drafted, "R009")
        first = found[0]
        self.assertEqual(first.text, "a value that decides whether the rule applies is missing or unknown (service_code)")
        self.assertIn("NOT_APPLICABLE", {case.spec_status for case in first.cases})  # the draft's mistake
        self.assertEqual(the_rules_answer(first, "R009"), "UNABLE_TO_ASSESS")  # one answer fixes it

    def test_a_value_required_before_applicability_is_asked_where_the_rule_does_not_apply(self):
        # R010 as drafted on 2026-10-11: the service date required before deciding whether the
        # line needs a document, so a lab line without a date was UNABLE_TO_ASSESS.
        drafted = copy.deepcopy(reference_sheets()["R010"])
        drafted["needs"] = drafted["needs"] + ["/lines/*/service_date"]
        found = {situation.text: situation for situation in situations_of(drafted, "R010")}
        asked = found["a claim the drafted rule does not otherwise apply to has a line missing a value the rule "
                      "checks (service_date)"]
        self.assertEqual({case.spec_status for case in asked.cases}, {"UNABLE_TO_ASSESS"})
        self.assertEqual(the_rules_answer(asked, "R010"), "NOT_APPLICABLE")

    def test_every_situation_of_a_right_rule_matches_it(self):
        # On the hand-written rules, the draft's outcome is the right one wherever the author
        # gives a single answer: the questions never push a right rule anywhere.
        for rule_id in ("R001", "R006", "R008", "R009", "R010", "R013"):
            for situation in situations_of(reference_sheets()[rule_id], rule_id):
                answer = the_rules_answer(situation, rule_id)
                if answer != IT_DEPENDS:
                    self.assertEqual({case.spec_status for case in situation.cases}, {answer}, situation.text)

    def test_a_missing_value_with_an_independent_violation_is_one_question(self):
        # collect2_R003: right on every official claim at minute 0.1, then 15 minutes of corrections
        # on such claims, one round at a time. Now one question, with one answer: the violation wins.
        found = situations_of(reference_sheets()["R003"], "R003")
        combined = [s for s in found if "breaks the rule on one value" in s.text]
        self.assertEqual(len(combined), 1)
        self.assertEqual(the_rules_answer(combined[0], "R003"), "FAIL")
        # "Service date missing, and the end date one day before it" breaks nothing known: left out.
        self.assertFalse(any("lines[0].service_date = null" in case.description for case in combined[0].cases))

    def test_questions_are_few(self):
        for rule_id in ("R001", "R006", "R008", "R009", "R010", "R013"):
            self.assertLessEqual(len(situations_of(reference_sheets()[rule_id], rule_id)), MAX_SITUATIONS, rule_id)


class AskedBeforeTheTableTests(unittest.TestCase):
    def test_one_answer_fixes_what_a_correction_per_round_would(self):
        # R008 without its needs: an unknown service code gives NOT_APPLICABLE instead of
        # UNABLE_TO_ASSESS. The situation question settles it before the table: no correction.
        right = reference_sheets()["R008"]
        wrong = {key: value for key, value in right.items() if key != "needs"}
        seen = []

        def drafter_reply(messages):
            task = json.loads(messages[1]["content"])
            answered = [answer for answer in task["author_answers"] if "decides whether the rule applies" in answer["question"]]
            seen.append(answered)
            return {"action": "propose", "sheet": right if answered else wrong, "intent": "", "assumptions": []}

        models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 10), oracle=ScriptedChatModel([]))
        result = Benchmark(BACKEND_ROOT, models, mutants=0).run_item(ITEMS["R008"])
        self.assertEqual(result.classification, "correct")
        self.assertEqual(result.corrections, 0)
        self.assertEqual(seen[-1][0]["answer"], "UNABLE_TO_ASSESS")

    def test_the_simulated_author_says_it_depends_when_the_claims_differ(self):
        author = SimulatedAuthor(ITEMS["R006"].reference, REFERENCE_DATA)
        for situation in situations_of(reference_sheets()["R006"], "R006"):
            question = type("Q", (), {"kind": SITUATION, "situation": {
                "cases": [{"claim": case.claim} for case in situation.cases]}})()
            self.assertEqual(author.answer(question), the_rules_answer(situation, "R006"))

    def test_switched_off_nothing_is_asked(self):
        right = reference_sheets()["R008"]
        models = AuthoringModels(drafter=ScriptedChatModel([{"action": "propose", "sheet": right, "intent": "",
                                                             "assumptions": []}] * 5),
                                 oracle=ScriptedChatModel([]))
        result = Benchmark(BACKEND_ROOT, models, mutants=0,
                           settings=AuthoringSettings(missing_data_questions=False)).run_item(ITEMS["R008"])
        self.assertEqual((result.classification, result.case_questions, result.clarification_questions),
                         ("correct", 0, 0))



class DecidedByTheTextTests(unittest.TestCase):
    """A situation the rule text's "outcomes" table already decides, and the draft follows, is
    not asked (the text has answered it)."""

    def test_the_text_decides_only_what_it_says_and_never_wrongly(self):
        # Each official rule written as its comparisons plus its own sentences: wherever the table
        # decides a situation, the hand-written rule gives that outcome on every test claim.
        decided = {}
        for rule_id in OFFICIAL_TABLES:
            table = quoted_outcomes(OFFICIAL_TABLES[rule_id], rule_text(RULES[rule_id]))
            for situation in situations_of(with_the_texts_table(rule_id), rule_id):
                if decided_by_text(situation, table):
                    decided[rule_id] = decided.get(rule_id, 0) + 1
                    for case in situation.cases:
                        self.assertEqual(status(ITEMS[rule_id].reference, case.claim), case.spec_status,
                                         f"{rule_id}: {case.description}")
        self.assertIn("R009", decided)  # its unknown service code: what the hard drafts got wrong

    def test_a_draft_that_does_not_follow_its_table_is_still_asked(self):
        # R009 drafted without applying "unknown service ... leaves UNABLE_TO_ASSESS": an unknown
        # code gives NOT_APPLICABLE, so the question is asked, whatever the table says.
        first = situations_of(comparisons_only("R009"), "R009")[0]
        self.assertEqual(first.group, 1)
        self.assertEqual(decided_by_text(first, {"unknown_code": "UNABLE_TO_ASSESS"}), [])
        self.assertEqual(decided_by_text(first, {}), [])

    def test_records_of_other_lists_and_claims_the_rule_does_not_apply_to_are_still_asked(self):
        table = quoted_outcomes(OFFICIAL_TABLES["R010"], rule_text(RULES["R010"]))
        for situation in situations_of(with_the_texts_table("R010"), "R010"):
            if situation.group not in (1, 2) or any(case.field.startswith("/attachments") for case in situation.cases):
                self.assertEqual(decided_by_text(situation, table), [], situation.text)


if __name__ == "__main__":
    unittest.main()
