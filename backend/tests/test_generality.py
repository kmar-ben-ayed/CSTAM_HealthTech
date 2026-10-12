"""The fixes stay general: nothing in the drafting pipeline is about one rule.

A fix for a failure seen on one rule must work as a better message, check or question for
every rule. These tests hold that line:

1. the drafting code never names a rule (comments and docstrings may cite one as evidence);
2. the drafter's prompts hold no official rule's text and no official rule's answer;
3. for every rule with a known answer (the 15 official and the invented ones), the correct
   rule goes through the whole pipeline untouched: no correction, nothing asked that pushes
   it elsewhere, one drafting session. A fix that steers a right rule away fails here.
"""

import ast
import json
import re
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_authoring.llm import AuthoringModels, ScriptedChatModel  # noqa: E402
from rule_authoring.prompts import PROMPTS_DIR  # noqa: E402
from rule_authoring.sheet import reference_sheets  # noqa: E402
from rule_benchmark.runner import Benchmark, invented_items, reference_items  # noqa: E402

SRC = BACKEND_ROOT / "src"
# The code that drafts and checks a client's rule. (The benchmark and the scripts around it pick
# rules by id on purpose: they measure the pipeline, they are not part of it. legacy_rules.py is
# the challenge's original hand-written rules, kept only as the tests' yardstick: nothing imports it.)
DRAFTING_CODE = [path for path in [*sorted((SRC / "rule_authoring").glob("*.py")), *sorted((SRC / "rule_engine").glob("*.py"))]
                 if path.name != "legacy_rules.py"]
RULE_ID = re.compile(r"\b(R\d{3}|INV-\d{2})\b")
INVENTED_SHEETS = SRC / "rule_benchmark" / "invented_sheets.json"


def code_strings_and_names(path: Path):
    """(line, text) of every string and name in the code, docstrings left out."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docstrings.add(id(first.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            yield node.lineno, node.value
        elif isinstance(node, ast.Name):
            yield node.lineno, node.id


class GeneralityTests(unittest.TestCase):
    def test_the_drafting_code_names_no_rule(self):
        found = [f"{path.relative_to(BACKEND_ROOT)}:{line}: {text[:80]!r}"
                 for path in DRAFTING_CODE for line, text in code_strings_and_names(path) if RULE_ID.search(text)]
        self.assertEqual(found, [], "rule ids in the drafting code: a fix for one rule, not for every rule")

    def test_the_prompts_hold_no_official_rule_text_or_answer(self):
        rules = json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8"))
        sentences = [sentence.strip() for rule in rules for sentence in re.split(r"(?<=\.)\s+", rule["logic"])
                     if len(sentence.split()) >= 6]
        answers = [json.dumps(sheet, sort_keys=True) for rule_id, sheet in reference_sheets().items()
                   if rule_id.startswith("R")]
        for path in sorted(PROMPTS_DIR.glob("*.md")):
            text = " ".join(path.read_text(encoding="utf-8").split())
            with self.subTest(prompt=path.name):
                self.assertIsNone(RULE_ID.search(text))
                self.assertEqual([sentence for sentence in sentences if " ".join(sentence.split()) in text], [])
                examples = [json.loads(block) for block in re.findall(r"```json\n(\{.*?\})\n```",
                                                                      path.read_text(encoding="utf-8"), re.S)
                            if "..." not in block]
                for example in examples:
                    self.assertNotIn(json.dumps(example.get("sheet", example), sort_keys=True), answers)

    def test_the_correct_rule_goes_through_untouched_for_every_rule(self):
        sheets = {**reference_sheets(), **json.loads(INVENTED_SHEETS.read_text(encoding="utf-8"))["sheets"]}
        items = [item for item in reference_items(BACKEND_ROOT) + invented_items() if item.item_id in sheets]
        self.assertGreaterEqual(len(items), 34)  # every rule we have an answer for, except the inexpressible one
        for item in items:
            with self.subTest(rule=item.item_id):
                sessions = []

                def drafter_reply(messages, sheet=sheets[item.item_id]):
                    sessions.append(len(messages) == 2)
                    return {"action": "propose", "sheet": sheet, "intent": "", "assumptions": []}

                models = AuthoringModels(drafter=ScriptedChatModel([drafter_reply] * 30), oracle=ScriptedChatModel([]))
                result = Benchmark(BACKEND_ROOT, models, mutants=0).run_item(item)
                self.assertEqual((result.classification, result.corrections, sum(sessions)), ("correct", 0, 1))
                if result.official:
                    self.assertEqual(result.official["agree"], result.official["claims"])


if __name__ == "__main__":
    unittest.main()
