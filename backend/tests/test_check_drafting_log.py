"""The drafting log records both sides and the pipeline's events; check_drafting_log.py reads it."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

import check_drafting_log as check  # noqa: E402
from rule_authoring.llm import AuthoringModels, ScriptedChatModel  # noqa: E402
from rule_authoring.sheet import reference_sheets  # noqa: E402
from rule_benchmark.runner import Benchmark, RecordingModel, ReplySink, reference_items, what_was_sent  # noqa: E402

R009 = reference_sheets()["R009"]
WITHOUT_APPLIES = {key: value for key, value in R009.items() if key != "applies_if"}
COUNT_PROBLEM = '"count" takes a list, not a field of its elements: {"count": "/lines"}.'


def task(**dynamic):
    return {"rule": {"title": "R009"}, "claim_fields": ["..."], "reference_files": {"policies.json": {}}, **dynamic}


class RecorderTests(unittest.TestCase):
    def test_what_our_code_sent_is_recorded_without_what_never_changes(self):
        sent = what_was_sent([{"role": "system", "content": "prompt"},
                              {"role": "user", "content": json.dumps(task(author_examples=[{"case": "x"}]))}])
        self.assertEqual(sent, {"rule": {"title": "R009"}, "author_examples": [{"case": "x"}]})
        result = {"tool_result": {"ok": False, "problems": [COUNT_PROBLEM]}}
        self.assertEqual(what_was_sent([{"role": "user", "content": json.dumps(result)}]), result)

    def test_each_reply_is_recorded_with_the_message_before_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "log.jsonl"

            class Model:
                name = "scripted"

                def complete_json(self, messages):
                    return {"action": "check", "sheet": R009}

            RecordingModel(Model(), "R009/drafter", ReplySink(path)).complete_json(
                [{"role": "system", "content": "prompt"}, {"role": "user", "content": json.dumps(task())}])
            fixed, row = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual((fixed["system_prompt"], fixed["task_unchanging_parts"]["claim_fields"]), ("prompt", ["..."]))
            self.assertEqual((row["call"], row["sent"]["rule"], row["reply"]["action"], row["inputs"]),
                             ("R009/drafter", {"title": "R009"}, "check", fixed["inputs"]))


class CheckTests(unittest.TestCase):
    def log(self, rows):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "log.jsonl"
        path.write_text("\n".join(json.dumps({"time": 1000 + 60 * index, **row}) for index, row in enumerate(rows)),
                        encoding="utf-8")
        items = check.read_log(path)
        check.score_calls([item for item in items if isinstance(item, check.Call)])
        return items

    def test_a_message_the_model_keeps_getting_is_flagged(self):
        problem = {"tool_result": {"ok": False, "problems": [COUNT_PROBLEM]}}
        unreadable = {"action": "check", "sheet": {"checks": "?"}}
        items = self.log([{"call": "R009/drafter", "turn": 2, "sent": task(), "reply": unreadable}]
                         + [{"call": "R009/drafter", "turn": 2 + 2 * n, "sent": problem, "reply": unreadable} for n in range(1, 5)])
        self.assertEqual(check.repeated_problems(items), [(COUNT_PROBLEM, 4)])

    def test_a_draft_that_got_worse_is_flagged_with_what_happened_before_it(self):
        items = self.log([
            {"call": "R009/drafter", "turn": 2, "sent": task(), "reply": {"action": "propose", "sheet": R009}},
            {"call": "R009/pipeline", "event": "admin review", "confirmed": 3, "corrections": [
                {"description": "claim A: first entry of authorizations duplicated", "drafted": "PASS",
                 "right": "UNABLE_TO_ASSESS"}]},
            {"call": "R009/drafter", "turn": 2, "sent": task(author_examples=[{"case": "x"}]),
             "reply": {"action": "propose", "sheet": WITHOUT_APPLIES}},
        ])
        first, review, second = items
        self.assertEqual(first.wrong, 0)
        self.assertGreater(second.wrong, 0)
        [(before, after, between)] = check.regressions(items)
        self.assertEqual((before, after), (first, second))
        self.assertIn("first entry of authorizations duplicated", check.describe_item(between[0]))
        story = "\n".join(check.report(items))
        self.assertIn("drafting session at minute 2.0: after the admin's corrections", story)

    def test_patterns_across_rules_rank_the_messages_before_worse_drafts(self):
        misleading = {"tool_result": {"ok": False, "problems": ['applies_if: keep the condition "/lines/*/service_code"']}}
        logs = {}
        for rule in ("R009", "R008"):
            sheet = reference_sheets()[rule]
            logs[rule] = self.log([
                {"call": f"{rule}/drafter", "turn": 2, "sent": task(), "reply": {"action": "check", "sheet": sheet}},
                {"call": f"{rule}/drafter", "turn": 4, "sent": misleading, "reply": {"action": "check", "sheet": {
                    **sheet, "applies_if": [{"value": "/lines/*/service_code", "is": "present"}]}}},
            ])
        text = "\n".join(check.patterns(logs))
        self.assertIn('sent   2x in 2 rule(s), repeated 0, before a worse draft 2: applies_if: keep the condition "..."', text)
        self.assertIn("2  after a problem message", text)
        self.assertIn("2  changed applies_if", text)

    def test_edits_are_named(self):
        sheet = reference_sheets()["R009"]
        moved = json.loads(json.dumps(sheet))
        check_ = moved["checks"][0]
        check_["where"] = check_["where"] + check_["then"][:1]
        check_["then"] = check_["then"][1:]
        self.assertEqual(check.edit_kinds(sheet, moved), ["changed a check", "moved conditions between then and where"])
        self.assertEqual(check.edit_kinds(sheet, {**sheet, "needs": []}), ["changed needs"])

    def test_a_log_without_our_side_still_reads(self):
        [call] = self.log([{"call": "R009/drafter", "turn": 2, "reply": {"action": "propose", "sheet": R009}}])
        self.assertEqual((check.describe_sent(call.sent), call.wrong), ("(not recorded)", 0))

    def test_a_benchmark_run_logs_the_whole_story(self):
        # R008 without its needs: a missing-data question, an answer, a redraft, the review.
        right = reference_sheets()["R008"]
        wrong = {key: value for key, value in right.items() if key != "needs"}

        def drafter_reply(messages):
            answered = json.loads(messages[1]["content"])["author_answers"]
            return {"action": "propose", "sheet": right if answered else wrong, "intent": "", "assumptions": []}

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "log.jsonl"
            models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 10), oracle=ScriptedChatModel([]))
            item = next(i for i in reference_items(BACKEND_ROOT) if i.item_id == "R008")
            Benchmark(BACKEND_ROOT, models, mutants=0, record=path).run_item(item)
            items = check.read_log(path)
            inputs = check.read_inputs(path)
        # Everything the model received: its instructions and the task's unchanging parts once
        # (two sessions, one record), then what we sent and what it replied on every call.
        [fixed] = inputs
        self.assertIn("rule drafter", fixed["system_prompt"])
        self.assertEqual(sorted(fixed["task_unchanging_parts"]),
                         ["claim_fields", "example_claim", "reference_data", "reference_files"])
        calls = [item for item in items if isinstance(item, check.Call)]
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(call.sent is not None and call.reply is not None for call in calls))
        self.assertIn("rule", calls[0].sent)  # the task's rule text, every session
        full = "\n".join(check.report(items, inputs, full=True))
        self.assertIn(fixed["system_prompt"].splitlines()[0], full)
        self.assertIn('"action": "propose"', full)
        names = [item.name for item in items if isinstance(item, check.Event)]
        for expected in ("submitted", "asked", "admin answered", "ready for review", "finished"):
            self.assertIn(expected, names)
        check.score_calls([item for item in items if isinstance(item, check.Call)])
        story = "\n".join(check.report(items))
        self.assertIn("ADMIN ASKED (situation)", story)
        self.assertIn("drafting session at minute", story)
        self.assertIn("after the admin's answers", story)
        self.assertIn("best draft: 0/400 wrong", story)


if __name__ == "__main__":
    unittest.main()
