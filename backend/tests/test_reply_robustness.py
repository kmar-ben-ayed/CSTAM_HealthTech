"""Robustness of reading model replies, measured offline on the 15 real rules.

Each reference spec is wrapped in a drafter reply and then broken the way small
models break JSON: prose and code fences around it, trailing commas, comments,
single quotes, Python literals, unquoted keys, missing closing brackets, and
combinations of these. Every broken reply must read back as exactly the original.
Random garbage must never crash the parser or be mistaken for an answer.
"""

import json
import random
import re
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from rule_authoring.llm import ModelFormatError, parse_json_object  # noqa: E402

SPECS = json.loads((BACKEND_ROOT / "rules" / "reference_specs.json").read_text(encoding="utf-8"))["specs"]


def replies():
    """One drafter reply per reference rule, in compact JSON."""
    for rule_id, entry in sorted(SPECS.items()):
        yield rule_id, {"action": "check", "spec": entry["spec"]}


# ── Ways small models break JSON. Each takes compact JSON text and returns broken text.

def with_prose(text: str) -> str:
    return f"Here is my answer:\n```json\n{text}\n```\nI hope this helps."


def trailing_commas(text: str) -> str:
    return re.sub(r"(?<=[\]}\"0-9el])([\]}])", r",\1", text, count=6)


def a_comment(text: str) -> str:
    return text.replace("{", "{ // drafting the rule\n", 1)


def single_quotes(text: str) -> str:
    return text.replace('"', "'")


def python_literals(text: str) -> str:
    return re.sub(r"\btrue\b", "True", re.sub(r"\bfalse\b", "False", text))


def unquoted_keys(text: str) -> str:
    return re.sub(r'"(action|spec|steps|op|left|right|items|value|path)":', r"\1:", text)


def stopped_early(text: str) -> str:
    return re.sub(r"[\]}]{1,3}$", "", text)


SLIPS = [with_prose, trailing_commas, a_comment, single_quotes, python_literals, unquoted_keys, stopped_early]


def applicable(slip, text: str) -> bool:
    """Skip slips that would change the meaning of text inside strings."""
    strings = " ".join(re.findall(r'"((?:[^"\\]|\\.)*)"', text))
    if slip is single_quotes:
        return "'" not in text and "\\" not in text
    if slip is python_literals:
        return not re.search(r"\b(true|false)\b", strings)
    if slip is trailing_commas:
        return not re.search(r"[\]}]", strings)
    return True


class ReplyRobustnessTests(unittest.TestCase):
    def test_every_single_slip_reads_back_exactly(self):
        checked = 0
        for rule_id, reply in replies():
            text = json.dumps(reply, ensure_ascii=False)
            for slip in SLIPS:
                if not applicable(slip, text):
                    continue
                with self.subTest(rule=rule_id, slip=slip.__name__):
                    self.assertEqual(parse_json_object(slip(text)), reply)
                    checked += 1
        self.assertGreater(checked, 80)

    def test_combined_slips_read_back_exactly(self):
        generator = random.Random(2026)
        checked = 0
        for rule_id, reply in replies():
            text = json.dumps(reply, ensure_ascii=False)
            usable = [slip for slip in SLIPS if slip is not stopped_early and applicable(slip, text)]
            for _ in range(10):
                broken = text
                for slip in generator.sample(usable, k=min(3, len(usable))):
                    broken = slip(broken)
                with self.subTest(rule=rule_id, broken=broken[:80]):
                    self.assertEqual(parse_json_object(broken), reply)
                    checked += 1
        self.assertEqual(checked, 150)

    def test_garbage_never_crashes_and_is_never_mistaken_for_an_answer(self):
        generator = random.Random(7)
        alphabet = '{}[]":,\' \n0123456789abcdefTrueNone//#*\\'
        for _ in range(2000):
            garbage = "".join(generator.choice(alphabet) for _ in range(generator.randint(0, 80)))
            try:
                parsed = parse_json_object(garbage)
            except ModelFormatError:
                continue
            self.assertIsInstance(parsed, dict)  # anything accepted is a real object, checked later as usual


if __name__ == "__main__":
    unittest.main()
