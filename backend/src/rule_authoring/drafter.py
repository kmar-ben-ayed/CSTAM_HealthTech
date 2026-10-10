"""The drafter agent: turns one English rule into a spec, using read-only tools.

The model replies with one JSON action per turn (see prompts/drafter.md). The
loop runs the action and returns its result as the next message. The tools only
read: they parse, check and evaluate a candidate spec on generated test claims.
The model cannot write files, activate a rule, or see the dataset.

A session ends with a proposal, a question for the author, "this rule cannot be
expressed", or a failure (budget exhausted, model unusable).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec, SpecError, parse_spec
from rule_engine.validation import check_spec

from .edge_cases import EdgeCaseGenerator, LabelledCase
from .llm import ChatModel, ModelError, ModelFormatError
from .prompts import load_prompt

PROPOSED = "proposed"
NEEDS_CLARIFICATION = "needs_clarification"
UNSUPPORTED = "unsupported"
FAILED = "failed"

ACTIONS = ("check", "try", "ask_author", "propose", "unsupported")
MAX_TRY_CASES = 25
MAX_TEXT = 500


@dataclass
class DraftingContext:
    rule: dict[str, Any]
    author_answers: list[dict[str, str]] = field(default_factory=list)
    author_examples: list[LabelledCase] = field(default_factory=list)
    feedback: list[str] = field(default_factory=list)


@dataclass
class DrafterResult:
    outcome: str
    spec: RuleSpec | None = None
    intent: str = ""
    assumptions: list[str] = field(default_factory=list)
    question: str = ""
    reason: str = ""
    turns: int = 0
    transcript: list[dict[str, str]] = field(default_factory=list)


@dataclass
class _Step:
    """What one model reply leads to: the end of the session, or a result to send back."""

    outcome: str | None = None  # set when the session ends
    details: dict[str, Any] = field(default_factory=dict)
    tool_result: dict[str, Any] | None = None
    invalid: str | None = None  # the reply broke the protocol; counts against the budget


class Drafter:
    def __init__(
        self,
        model: ChatModel,
        fields: FieldCatalogue,
        reference: ReferenceData,
        edge_cases: EdgeCaseGenerator,
        *,
        max_turns: int = 10,
        max_invalid_replies: int = 3,
        time_budget_seconds: float = 300.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.model = model
        self.fields = fields
        self.reference = reference
        self.edge_cases = edge_cases
        self.max_turns = max_turns
        self.max_invalid_replies = max_invalid_replies
        self.time_budget_seconds = time_budget_seconds
        self.clock = clock

    def draft(self, context: DraftingContext) -> DrafterResult:
        messages = [
            {"role": "system", "content": load_prompt("drafter")},
            {"role": "user", "content": json.dumps(self._task(context), ensure_ascii=False)},
        ]
        deadline = self.clock() + self.time_budget_seconds
        invalid_replies = 0

        def finish(outcome: str, turns: int, **details) -> DrafterResult:
            # The system prompt is identified by its fingerprint elsewhere; keep the transcript small.
            return DrafterResult(outcome=outcome, turns=turns, transcript=messages[1:], **details)

        for turn in range(1, self.max_turns + 1):
            if self.clock() > deadline:
                return finish(FAILED, turn - 1, reason="time budget exhausted")
            try:
                reply = self.model.complete_json(messages)
            except ModelFormatError as error:
                # Show the model its own broken answer and ask again: small models
                # usually fix a format slip on the next turn.
                messages.append({"role": "assistant", "content": error.raw})
                step = _Step(invalid=f"{error}: reply with exactly one JSON object and nothing else")
            except ModelError as error:
                return finish(FAILED, turn, reason=str(error))
            else:
                reply = _lift_misplaced_fields(reply)
                messages.append({"role": "assistant", "content": json.dumps(reply, ensure_ascii=False)})
                step = self._respond(reply, context)

            if step.outcome is not None:
                return finish(step.outcome, turn, **step.details)
            if step.invalid is not None:
                invalid_replies += 1
                if invalid_replies > self.max_invalid_replies:
                    return finish(FAILED, turn, reason=f"too many replies that break the protocol (last: {step.invalid})")
                step.tool_result = {"ok": False, "problems": [step.invalid]}
            messages.append({"role": "user", "content": json.dumps({"tool_result": step.tool_result}, ensure_ascii=False)})

        return finish(FAILED, self.max_turns, reason="turn budget exhausted without a proposal")

    def _respond(self, reply: dict[str, Any], context: DraftingContext) -> "_Step":
        """Carry out one action from the model."""
        action = reply.get("action")
        if action == "ask_author":
            question = _text(reply.get("question"))
            if question:
                return _Step(outcome=NEEDS_CLARIFICATION, details={"question": question})
            return _Step(tool_result={"ok": False, "problems": ["ask_author needs a non-empty question"]})
        if action == "unsupported":
            return _Step(outcome=UNSUPPORTED, details={"reason": _text(reply.get("reason")) or "no reason given"})
        if action not in ("check", "try", "propose"):
            return _Step(invalid=f"unknown action; use one of: {', '.join(ACTIONS)}")

        spec, problems = self._parse(reply.get("spec"))
        if problems:
            return _Step(tool_result={"ok": False, "problems": problems})
        if action == "check":
            return _Step(tool_result={"ok": True, "problems": []})
        if action == "try":
            return _Step(tool_result={"ok": True, **self._try(spec, context)})
        mismatches = self._example_mismatches(spec, context)
        if mismatches:
            return _Step(tool_result={"ok": False, "problems": mismatches})
        return _Step(outcome=PROPOSED, details={
            "spec": spec,
            "intent": _text(reply.get("intent")),
            "assumptions": [_text(item) for item in reply.get("assumptions", []) if _text(item)][:10],
        })

    # ------------------------------------------------------------------ tools

    def _task(self, context: DraftingContext) -> dict[str, Any]:
        rule = context.rule
        return {
            "rule": {key: rule.get(key, "") for key in ("title", "logic", "severity", "corrective_action")},
            "claim_fields": self.fields.describe(),
            "reference_data": self.reference.summary(),
            "author_answers": context.author_answers,
            "author_examples": [
                {"case": example.description, "expected_status": example.expected_status}
                for example in context.author_examples
            ],
            "feedback_from_previous_attempt": context.feedback,
        }

    def _parse(self, raw: Any) -> tuple[RuleSpec | None, list[str]]:
        try:
            spec = parse_spec(raw)
        except SpecError as error:
            return None, error.problems
        return spec, check_spec(spec, self.fields)

    def _outcome(self, spec: RuleSpec, claim: dict[str, Any]) -> str:
        try:
            return evaluate_rule(spec, claim, self.reference).status
        except EvaluationLimitExceeded:
            return "ERROR: the rule needs too much work to evaluate"

    def _try(self, spec: RuleSpec, context: DraftingContext) -> dict[str, Any]:
        cases = self.edge_cases.generate(spec)[:MAX_TRY_CASES]
        return {
            "generated_cases": [
                {"case": case.description, "outcome": self._outcome(spec, case.claim)} for case in cases
            ],
            "author_examples": [
                {
                    "case": example.description,
                    "expected": example.expected_status,
                    "outcome": self._outcome(spec, example.claim),
                }
                for example in context.author_examples
            ],
        }

    def _example_mismatches(self, spec: RuleSpec, context: DraftingContext) -> list[str]:
        mismatches = []
        for example in context.author_examples:
            outcome = self._outcome(spec, example.claim)
            if outcome != example.expected_status:
                mismatches.append(
                    f'author example "{example.description}": your spec gives {outcome}, '
                    f"the author says {example.expected_status}"
                )
        return mismatches


def _text(value: Any) -> str:
    return value.strip()[:MAX_TEXT] if isinstance(value, str) else ""


def _lift_misplaced_fields(reply: dict[str, Any]) -> dict[str, Any]:
    """Small models often put "intent" and "assumptions" inside the spec. Move them
    next to it, where the protocol expects them; the spec itself is unchanged."""
    spec = reply.get("spec")
    if not isinstance(spec, dict):
        return reply
    spec = dict(spec)
    lifted = {key: spec.pop(key) for key in ("intent", "assumptions", "action") if key in spec}
    return {**reply, **{key: value for key, value in lifted.items() if key not in reply}, "spec": spec}
