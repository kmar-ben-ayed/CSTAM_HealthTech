"""The drafter agent: turns one English rule into a spec, using read-only tools.

The model replies with one JSON action per turn (see prompts/drafter.md). The
loop runs the action and returns its result as the next message. The tools only
read: they parse, check and evaluate a candidate spec on generated test claims.
The model cannot write files, activate a rule, or see the dataset.

A session ends with a proposal, a question for the author, "this rule cannot be
expressed", or a failure (budget exhausted, model unusable).
"""

from __future__ import annotations

import copy
import json
import re
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec, SpecError, parse_spec
from rule_engine.validation import check_spec

from .edge_cases import EdgeCaseGenerator, LabelledCase, rule_text
from .hints import explain
from .llm import ChatModel, ModelError, ModelFormatError, parse_json_object
from .oracle import redact
from .prompts import load_prompt
from .sheet import SheetError, compile_sheet, is_sheet, outcome_quote_problems

PROPOSED = "proposed"
NEEDS_CLARIFICATION = "needs_clarification"
UNSUPPORTED = "unsupported"
FAILED = "failed"

ACTIONS = ("check", "try", "ask_author", "propose", "unsupported")
MAX_TRY_CASES = 25
MAX_TEXT = 500
MAX_OPTION_TEXT = 160
MAX_KEPT_UNREADABLE = 3  # unreadable replies kept with the draft, to diagnose format slips
MAX_KEPT_REPLY = 4000

QUESTION_FORMAT = (
    'ask_author needs a question and 2 to 4 answer options, each a full answer on its own, e.g. '
    '{"action": "ask_author", "question": "Is a total of exactly 10000 allowed?", '
    '"options": ["Yes: a total of exactly 10000 passes", "No: a total of exactly 10000 fails"]}'
)
NO_MORE_QUESTIONS = (
    "You cannot ask the author anything more. Decide yourself: write the spec and list each "
    "decision in assumptions. The author checks the rule's outcome on boundary and missing-data "
    "claims before it goes live."
)

# Small models often give up before trying, e.g. reading "claims must..." as an
# instruction aimed at them. The first premature "unsupported" is sent back.
TRY_BEFORE_GIVING_UP = (
    "Do not give up yet: rules are written as requirements (\"claims must...\"), and that "
    "is the rule to translate. Write the closest spec you can and send it with check. "
    "Answer unsupported only if the language really cannot express the rule."
)
# Sending the same draft again changes nothing; small models loop on it until the budget ends.
REPEAT_WARN = 3
REPEAT_STOP = 4
REPEATING = (
    "You have sent this same draft 3 times. Sending it again will not change the result: change "
    "what the problems or the try outcomes point at, or propose it if it is right."
)
# ...and when an earlier draft already passed every check (models doubt correct work).
VALID_DRAFT_KEPT = (
    "Do not give up: one of your drafts already passed every check. If its try outcomes match "
    "the rule, propose it and put anything you are unsure about in assumptions; the author "
    "reviews its outcomes before it goes live. Answer unsupported again only if a part of the "
    "rule is missing from that draft."
)
# ...and after the author's corrections, when only some of their examples still differ.
CLOSE_TO_THE_EXAMPLES = (
    "Do not give up: your last spec is close, and the author's examples can be met by "
    "changing it. Fix only what each of these says, then check and propose again:"
)
# ...and when an earlier draft of this rule already passed every check: the rule can be
# written, and "unsupported" usually means a construct was missed (R009 and INV-20 gave up
# on "a sum grouped by a key", which group_by writes in one line).
ALREADY_WRITTEN_SHEET = (
    "Do not give up: an earlier draft of this rule already passed every check, so a sheet can "
    "express it; change that draft rather than giving up. Constructs that are easy to miss: "
    "has_match with \"then\" (look up one record, such as a line's authorization, and check its "
    "fields); sum and count with \"where\" (a filter) or \"group_by\" (only the elements that share "
    "this element's value, e.g. {\"sum\": \"/lines/*/quantity\", \"group_by\": \"authorization_id\"}); "
    "first_present (a default for a missing value); a check's own \"needs\" (tested only where "
    "applies_if holds); \"otherwise\": \"UNABLE_TO_ASSESS\"."
)
ALREADY_WRITTEN_SPEC = (
    "Do not give up: an earlier draft of this rule already passed every check, so the language "
    "can express it; change that draft rather than giving up. Constructs that are easy to miss: "
    "find (look up one record, such as a line's authorization) with let, then requires on its "
    "fields; sum and count with \"where\", which can compare the element counted with the element "
    "being checked ($line); first_present (a default for a missing value); a need step placed "
    "after the only_if step (tested only where the rule applies)."
)


FIELD_GUIDE = Path(__file__).resolve().parent / "field_guide.json"


@lru_cache(maxsize=1)
def field_guide() -> dict[str, Any]:
    """What each claim field means, and a made-up example claim (field_guide.json)."""
    return json.loads(FIELD_GUIDE.read_text(encoding="utf-8"))


@dataclass
class DraftingContext:
    rule: dict[str, Any]
    author_answers: list[dict[str, str]] = field(default_factory=list)
    author_examples: list[LabelledCase] = field(default_factory=list)
    feedback: list[str] = field(default_factory=list)
    # An earlier draft of this rule passed every check: it can be written, so giving up is challenged.
    known_expressible: bool = False
    # The last draft the checks saw, to repair rather than rewrite ({"draft", "passed_checks"}).
    last_draft: dict[str, Any] | None = None
    # Working rules from the catalogue that read most like this one (see examples.py).
    similar_rules: list[dict[str, Any]] = field(default_factory=list)
    questions_left: int = 2  # clarifying questions the drafter may still ask


@dataclass
class DrafterResult:
    outcome: str
    spec: RuleSpec | None = None
    sheet: dict[str, Any] | None = None  # when the model wrote a sheet, as written
    intent: str = ""
    assumptions: list[str] = field(default_factory=list)
    question: str = ""
    options: list[str] = field(default_factory=list)
    reason: str = ""
    turns: int = 0
    transcript: list[dict[str, str]] = field(default_factory=list)
    unreadable: list[str] = field(default_factory=list)  # the last raw replies that could not be read
    # The language model could not be reached: the drafter did not get stuck on the rule.
    model_unavailable: bool = False


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
        max_turns: int = 14,
        max_invalid_replies: int = 5,
        time_budget_seconds: float = 480.0,
        clock: Callable[[], float] = time.monotonic,
        prompt: str = "drafter",
        auto_propose: bool = False,
    ):
        # A draft that passes every check here and gives every outcome the author confirmed is
        # proposed at once: no turn spent re-sending it to "try" and "propose" (a quarter of all
        # model time in collection run 2), and none spent changing it after seeing its own test
        # results (the commonest step before a draft got worse). The author reviews it anyway.
        self.auto_propose = auto_propose
        # "drafter": the model writes full specs; "drafter_sheet": it writes rule sheets
        # (sheet.py), with the full language only for what a sheet cannot express;
        # "drafter_sheet_only": sheets, without the full language's manual.
        self.prompt = prompt
        self.writes_sheets = prompt.startswith("drafter_sheet")
        self.model = model
        self.fields = fields
        self.reference = reference
        self.edge_cases = edge_cases
        self.max_turns = max_turns
        self.max_invalid_replies = max_invalid_replies
        self.time_budget_seconds = time_budget_seconds
        self.clock = clock

    def with_model(self, model: ChatModel) -> "Drafter":
        """The same drafter, drafting with another model (one member of a committee)."""
        variant = copy.copy(self)
        variant.model = model
        return variant

    def draft(self, context: DraftingContext) -> DrafterResult:
        messages = [
            {"role": "system", "content": load_prompt(self.prompt)},
            {"role": "user", "content": json.dumps(self._task(context), ensure_ascii=False)},
        ]
        deadline = self.clock() + self.time_budget_seconds
        invalid_replies = 0
        session = _Session()

        def finish(outcome: str, turns: int, **details) -> DrafterResult:
            # The system prompt is identified by its fingerprint elsewhere; keep the transcript small.
            return DrafterResult(outcome=outcome, turns=turns, transcript=messages[1:],
                                 unreadable=session.unreadable[-MAX_KEPT_UNREADABLE:], **details)

        def stop(turns: int, reason: str, model_unavailable: bool = False) -> DrafterResult:
            """The session ends early. A spec that already passed every check here is
            still worth the author's review; without one, drafting failed."""
            if session.best is None:
                return finish(FAILED, turns, reason=reason, model_unavailable=model_unavailable)
            best = session.best
            note = f"Drafting stopped early ({reason}); this is the last version that passed every check."
            return finish(PROPOSED, turns, spec=best["spec"], intent=best["intent"], sheet=best["sheet"],
                          assumptions=[*best["assumptions"], note][:10])

        for turn in range(1, self.max_turns + 1):
            if self.clock() > deadline:
                return stop(turn - 1, "time budget exhausted")
            reply = None
            try:
                reply = self.model.complete_json(messages)
            except ModelFormatError as error:
                reply = _repair_protocol(error.raw)
                if reply is None:
                    session.unreadable.append(error.raw[:MAX_KEPT_REPLY])
                    # Show the model its own broken answer and ask again: small models
                    # usually fix a format slip on the next turn.
                    messages.append({"role": "assistant", "content": error.raw[:2000]})
                    step = _Step(invalid=f"{error}: reply with exactly one JSON object and nothing else."
                                         f"{_format_hint(error.raw)}")
            except ModelError as error:
                return stop(turn, str(error), model_unavailable=True)
            if reply is not None:
                reply = _lift_misplaced_fields(reply)
                messages.append({"role": "assistant", "content": json.dumps(reply, ensure_ascii=False)})
                step = self._respond(reply, context, session)
                repeats = session.count_repeat(reply)
                if repeats >= REPEAT_STOP and step.outcome is None:
                    return stop(turn, f"the drafter sent the same draft {repeats} times")
                if repeats == REPEAT_WARN and step.tool_result is not None:
                    step.tool_result = {**step.tool_result, "notice": REPEATING}

            if step.outcome is not None:
                return finish(step.outcome, turn, **step.details)
            if step.invalid is not None:
                invalid_replies += 1
                if invalid_replies > self.max_invalid_replies:
                    return stop(turn, f"too many replies that break the protocol (last: {step.invalid})")
                step.tool_result = {"ok": False, "problems": [step.invalid]}
            messages.append({"role": "user", "content": json.dumps({"tool_result": step.tool_result}, ensure_ascii=False)})

        return stop(self.max_turns, "turn budget exhausted without a proposal")

    def _respond(self, reply: dict[str, Any], context: DraftingContext, session: "_Session") -> "_Step":
        """Carry out one action from the model."""
        action = reply.get("action")
        if action == "ask_author":
            if context.questions_left <= 0:
                return _Step(tool_result={"ok": False, "problems": [NO_MORE_QUESTIONS]})
            question = _text(reply.get("question"))
            options = _options(reply.get("options"))
            if not question or options is None:
                return _Step(tool_result={"ok": False, "problems": [QUESTION_FORMAT]})
            return _Step(outcome=NEEDS_CLARIFICATION, details={"question": question, "options": options})
        if action == "unsupported":
            if not session.attempted_spec and not session.pushed_back:
                session.pushed_back = True
                return _Step(tool_result={"ok": False, "problems": [TRY_BEFORE_GIVING_UP]})
            if session.last_mismatches and not session.pushed_back_on_examples:
                # Giving up because a few author examples still differ: show exactly what to change, once.
                session.pushed_back_on_examples = True
                return _Step(tool_result={"ok": False, "problems": [CLOSE_TO_THE_EXAMPLES, *session.last_mismatches]})
            if session.best is not None and not session.pushed_back_on_valid:
                # Giving up while holding a draft that passed every check: models doubt
                # correct work. The author reviews it anyway, so propose it, once asked.
                session.pushed_back_on_valid = True
                return _Step(tool_result={"ok": False, "problems": [VALID_DRAFT_KEPT]})
            if context.known_expressible and not session.pushed_back_on_known:
                # An earlier draft of this rule passed every check: it can be written.
                session.pushed_back_on_known = True
                hint = ALREADY_WRITTEN_SHEET if self.writes_sheets else ALREADY_WRITTEN_SPEC
                return _Step(tool_result={"ok": False, "problems": [hint]})
            return _Step(outcome=UNSUPPORTED, details={"reason": _text(reply.get("reason")) or "no reason given"})
        if action not in ("check", "try", "propose"):
            return _Step(invalid=f"unknown action; use one of: {', '.join(ACTIONS)}")

        session.attempted_spec = True

        spec, problems = self._parse(reply.get("spec"), context.rule.get("title") or "The rule", rule_text(context.rule))
        if problems:
            return _Step(tool_result={"ok": False, "problems": problems})
        mismatches = self._example_mismatches(spec, context)
        session.last_mismatches = mismatches
        proposal = {
            "spec": spec,
            "intent": _text(reply.get("intent")),
            "assumptions": [_text(item) for item in _as_list(reply.get("assumptions")) if _text(item)][:10],
            # The sheet as the model wrote it, kept so a confirmed rule can be shown as an example.
            "sheet": reply["spec"] if is_sheet(reply.get("spec")) else None,
        }
        if not mismatches:
            session.best = proposal
            if self.auto_propose and action in ("check", "try") and not _failed_before(reply.get("spec"), context):
                return _Step(outcome=PROPOSED, details=proposal)
        if action == "check":
            return _Step(tool_result={"ok": True, "problems": []})
        if action == "try":
            return _Step(tool_result={"ok": True, **self._try(spec, context, session)})
        if mismatches:
            return _Step(tool_result={"ok": False, "problems": mismatches})
        return _Step(outcome=PROPOSED, details=proposal)

    # ------------------------------------------------------------------ tools

    def _task(self, context: DraftingContext) -> dict[str, Any]:
        rule = context.rule
        return {
            "rule": {key: rule.get(key, "") for key in ("title", "logic", "severity", "corrective_action")},
            # Names and types come from the claim schema; meanings, links between lists
            # and known values from field_guide.json, with a made-up example claim.
            "claim_fields": [{**item, "meaning": field_guide()["fields"].get(item["path"], "")}
                             for item in self.fields.describe()],
            "example_claim": field_guide()["example_claim"],
            "reference_data": self.reference.summary(),
            # The data files themselves, so the model sees what each value looks like.
            "reference_files": self.reference.files,
            "author_answers": context.author_answers,
            "author_examples": [
                # A claim the author gave is shown (its free text hidden): its description alone
                # says nothing. Generated test claims are described by the change they make.
                {"case": example.description, "expected_status": example.expected_status,
                 **({"claim": redact(example.claim, set())} if example.shown else {})}
                for example in context.author_examples if not example.confirmed
            ],
            # Outcomes an earlier draft already gave and the author confirmed: to keep, not to change.
            "author_confirmed": [
                {"case": example.description, "expected_status": example.expected_status}
                for example in context.author_examples if example.confirmed
            ],
            "feedback_from_previous_attempt": context.feedback,
            **({"your_last_draft": {
                "draft": context.last_draft["draft"],
                "what_happened": (
                    "It passed every check; the author then gave the outcomes in author_examples. "
                    "Start from it and change only what those outcomes require; keep the rest, "
                    "including every outcome in author_confirmed."
                    if context.last_draft.get("passed_checks") else
                    "It failed the checks in feedback_from_previous_attempt. Start from it and fix "
                    "only those problems; keep the rest."),
            }} if context.last_draft else {}),
            "similar_rules": context.similar_rules,
        }

    def _parse(self, raw: Any, title: str = "The rule", text: str | None = None) -> tuple[RuleSpec | None, list[str]]:
        """The spec a draft stands for, or the problems with it. With the rule text, a sheet's
        "outcomes" quotes are checked against it: an outcome the text does not say is the
        drafter's guess, and is not written onto every condition."""
        try:
            if is_sheet(raw):
                spec = parse_spec(compile_sheet(raw, self.fields, title))
            else:
                spec = parse_spec(normalise_values(lift_wildcard_paths(raw)))
        except (SpecError, SheetError) as error:
            return None, error.problems
        quotes = outcome_quote_problems(raw.get("outcomes"), text) if text is not None and is_sheet(raw) else []
        return (None, quotes) if quotes else (spec, check_spec(spec, self.fields))

    def _outcome(self, spec: RuleSpec, claim: dict[str, Any]) -> str:
        try:
            return evaluate_rule(spec, claim, self.reference).status
        except EvaluationLimitExceeded:
            return "ERROR: the rule needs too much work to evaluate"

    def _try(self, spec: RuleSpec, context: DraftingContext, session: "_Session | None" = None) -> dict[str, Any]:
        cases = self.edge_cases.generate(spec, context.rule)[:MAX_TRY_CASES]
        results = [(case.description, self._outcome(spec, case.claim)) for case in cases]
        examples = [(example, self._outcome(spec, example.claim)) for example in context.author_examples]
        changed = self._changes(cases, dict(results), context, session) if session is not None else None
        return {
            "generated_cases": [{"case": description, "outcome": outcome} for description, outcome in results],
            # What the edit did: an outcome that changed is one the drafter should have meant to
            # change. R009 once made 172 not-applicable claims PASS by adding one check, and saw
            # only the new outcomes, not that they had changed. (Says nothing about the right ones.)
            **({"changed_since": changed} if changed is not None else {}),
            "author_examples": [
                {"case": example.description, "expected": example.expected_status, "outcome": outcome}
                for example, outcome in examples if not example.confirmed
            ],
            # Only the confirmed outcomes this spec changes: a long review would drown the rest.
            "author_confirmed_changed": [
                {"case": example.description, "expected": example.expected_status, "outcome": outcome}
                for example, outcome in examples if example.confirmed and outcome != example.expected_status
            ],
        }

    def _changes(self, cases: list[Any], outcomes: dict[str, str], context: DraftingContext,
                 session: "_Session") -> dict[str, Any] | None:
        """The test claims whose outcome differs from the previous try in this session, or, for
        the first try, from the last draft the drafter was told to start from."""
        previous = session.last_try
        if previous is None and context.last_draft:
            last, problems = self._parse(context.last_draft["draft"], context.rule.get("title") or "The rule")
            if last is not None and not problems:
                previous = {case.description: self._outcome(last, case.claim) for case in cases}
                session.compared_with = "your last draft"
        compared_with = session.compared_with
        session.last_try, session.compared_with = outcomes, "your last try"
        if previous is None:
            return None
        return {"compared_with": compared_with, "changes": [
            {"case": description, "before": previous[description], "now": outcome}
            for description, outcome in outcomes.items() if description in previous and previous[description] != outcome
        ]}

    def _example_mismatches(self, spec: RuleSpec, context: DraftingContext) -> list[str]:
        mismatches = []
        for example in context.author_examples:
            outcome = self._outcome(spec, example.claim)
            if outcome != example.expected_status:
                kind = "outcome the author confirmed" if example.confirmed else "author example"
                mismatches.append(
                    f'{kind} "{example.description}": your spec gives {outcome}, '
                    f"the author says {example.expected_status}. "
                    f"{explain(example.expected_status, outcome, spec, sheet=self.writes_sheets)}".rstrip()
                )
        return mismatches


@dataclass
class _Session:
    """What the drafter has done so far in one session."""

    attempted_spec: bool = False  # sent at least one spec to check, try or propose
    pushed_back: bool = False  # already sent one premature "unsupported" back
    last_mismatches: list[str] = field(default_factory=list)  # author examples the latest spec gets wrong
    pushed_back_on_examples: bool = False  # already sent one "unsupported" back with those examples
    pushed_back_on_valid: bool = False  # already sent one "unsupported" back because a valid draft exists
    pushed_back_on_known: bool = False  # already sent one "unsupported" back: an earlier draft passed every check
    # The latest spec that passed every check here and reproduces every author example.
    best: dict[str, Any] | None = None
    unreadable: list[str] = field(default_factory=list)  # raw replies that could not be read
    sent: dict[str, int] = field(default_factory=dict)  # how often each draft was sent
    # The outcomes of the latest try (test claim description -> outcome), to show the next try
    # what an edit changed; before the first try, those of the last draft (when there is one).
    last_try: dict[str, str] | None = None
    compared_with: str = "your last try"

    def count_repeat(self, reply: dict[str, Any]) -> int:
        """How many times this exact draft has now been sent (0 for a reply without one)."""
        if reply.get("action") not in ("check", "try", "propose") or reply.get("spec") is None:
            return 0
        key = json.dumps(reply["spec"], sort_keys=True, default=str)
        self.sent[key] = self.sent.get(key, 0) + 1
        return self.sent[key]


def _as_list(value: Any) -> list[Any]:
    """A list as given, one item as a list of one, anything else as nothing."""
    if isinstance(value, list):
        return value
    return [value] if isinstance(value, str) else []


def _options(value: Any) -> list[str] | None:
    """2 to 4 distinct, non-empty answer options, or None."""
    if not isinstance(value, list):
        return None
    options = [option.strip()[:MAX_OPTION_TEXT] for option in value if isinstance(option, str) and option.strip()]
    if not 2 <= len(options) <= 4 or len({option.lower() for option in options}) != len(options):
        return None
    return options


def _text(value: Any) -> str:
    return value.strip()[:MAX_TEXT] if isinstance(value, str) else ""


_MISSING_SPEC_KEY = re.compile(r'^(\s*\{\s*"action"\s*:\s*"(?:check|try|propose)"\s*,\s*)\{')  # spec or sheet
_LET_NAME = re.compile(r'"let"\s*:\s*"([a-z][a-z0-9_]*)"')


def _repair_protocol(raw: str) -> dict[str, Any] | None:
    """Two slips that make a reply unreadable, each with one clear meaning:
    - the "spec" key forgotten before the spec object:
      {"action": "check", {"language_version": 2, ...}};
    - a value named with let read back as {"total"} or {"value": {"total"}}, which
      the language writes {"path": "$total"}.
    Anything else stays broken."""
    repaired = _MISSING_SPEC_KEY.sub(r'\1"spec": {', _repair_let_references(raw), count=1)
    if repaired == raw:
        return None
    try:
        return parse_json_object(repaired)
    except ModelFormatError:
        return None


def _repair_let_references(raw: str) -> str:
    for name in set(_LET_NAME.findall(raw)):
        reference = '{"path": "$' + name + '"}'
        quoted = re.escape(f'"{name}"')
        raw = re.sub(r'\{\s*"value"\s*:\s*\{\s*' + quoted + r'\s*\}\s*\}', lambda _: reference, raw)
        raw = re.sub(r'\{\s*' + quoted + r'\s*\}', lambda _: reference, raw)
    return raw


def _format_hint(raw: str) -> str:
    """For a reply still unreadable after the repairs: the likely cause, when it is clear."""
    for name in set(_LET_NAME.findall(raw)):
        if re.search(r'\{\s*"' + re.escape(name) + r'"\s*[,}]', raw):
            return (f' To read the value named "{name}" with let, write {{"path": "${name}"}}; '
                    '"value" only holds a fixed number, text or date.')
    return ""


ARITHMETIC = ("multiply", "add", "subtract", "days_between")
_VALUE_KEYS = {"path", "value", "config", "count", "sum", "latest", "earliest", "find", "first_present", *ARITHMETIC}
_OPERAND_KEYS = {"op", "items", "left", "right", "path", "value"}


def normalise_values(raw: Any) -> Any:
    """Rewrite value slips that have one clear meaning into the language's own form:

    - arithmetic written like a condition, {"op": "multiply", "items": [a, b]},
      {"op": "subtract", "left": a, "right": b}, or {"path": a, "op": "multiply",
      "items": [b]}, becomes {"multiply": [a, b]};
    - arithmetic written beside a sum, {"sum": ..., "as": "line", "of": a, "op":
      "multiply", "items": [b]}, applies to what is summed when b reads $line
      (the only place $line exists): "of" becomes {"multiply": [a, b]};
    - a value wrapped in "value", {"value": {"path": "$total"}}, is unwrapped
      ("value" only holds fixed numbers, texts and dates).

    Only value positions change: arithmetic where a condition belongs is left for
    the parser to explain. The result is parsed and checked like any other spec.
    """
    return _normalise(copy.deepcopy(raw), condition=False)


_CONDITION_KEYS = {"require", "need", "only_if", "where", "not"}
_STEP_FIELDS = ("note", "otherwise")  # belong to a step, never to its condition


def _lift_step_fields(node: dict[str, Any]) -> dict[str, Any]:
    """{"require": {"op": ..., "note": "..."}}: the note (or otherwise) moves up to the step."""
    for key in ("require", "need", "only_if"):
        inner = node.get(key)
        if not isinstance(inner, dict):
            continue
        for name in _STEP_FIELDS:
            if name in inner and name not in node:
                node = {**node, name: inner[name], key: {k: v for k, v in inner.items() if k != name}}
                inner = node[key]
    return node


def _normalise(node: Any, condition: bool) -> Any:
    if isinstance(node, list):
        return [_normalise(item, condition) for item in node]
    if not isinstance(node, dict):
        return node
    node = _lift_step_fields(node)
    logical = node.get("op") in ("all_of", "any_of")
    node = {
        key: _normalise(value, key in _CONDITION_KEYS or (key == "items" and logical) or (condition and key == "items"))
        for key, value in node.items()
    }
    op = node.get("op")
    if condition or op not in ARITHMETIC:
        pass
    elif set(node) <= _OPERAND_KEYS:
        operands = [{key: node[key]} for key in ("path", "value") if key in node]
        operands += node["items"] if isinstance(node.get("items"), list) else []
        operands += [node[key] for key in ("left", "right") if key in node]
        if len(operands) >= 2:
            return {op: operands}
    elif "of" in node and isinstance(node.get("as"), str) and isinstance(node.get("items"), list):
        if f'"${node["as"]}' in json.dumps(node["items"]):
            rest = {key: value for key, value in node.items() if key not in ("op", "items")}
            return {**rest, "of": {op: [node["of"], *node["items"]]}}
    if not condition:
        # {"path": a, "multiply": [b]}: the value, then what to do with it.
        arithmetic = [key for key in node if key in ARITHMETIC]
        operand = [key for key in node if key in ("path", "value")]
        if (len(arithmetic) == 1 and len(operand) == 1 and len(node) == 2
                and isinstance(node[arithmetic[0]], list) and len(node[arithmetic[0]]) == 1):
            return {arithmetic[0]: [{operand[0]: node[operand[0]]}, *node[arithmetic[0]]]}
    if set(node) == {"value"} and isinstance(node["value"], dict) and set(node["value"]) & _VALUE_KEYS:
        return node["value"]
    return node


# "Every line's service_date" written as one path: /lines/*/service_date (or [] / [*]),
# sometimes with a stray "$" in front ($/lines/*/..., $lines/*/...).
_WILDCARD_PATH = re.compile(r"^\$?/?(?P<list>[a-z_][a-z0-9_]*)(?:/(?:\*|\[\*?\]))+/(?P<rest>[a-z_][a-z0-9_]*(?:/[a-z_][a-z0-9_]*)*)$")


def lift_wildcard_paths(raw: Any) -> Any:
    """Rewrite steps that use wildcard paths into the for_each the language expects.

    Small models often write "every line" as /lines/*/field. Consecutive steps that
    use wildcards over the same list become one for_each over that list, with the
    paths read from the current element ($line/field). A step mixing two lists, or
    anything else, is left as it is and the parser reports it.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("steps"), list):
        return raw
    raw = copy.deepcopy(raw)
    used = set(re.findall(r'"as":\s*"([a-z][a-z0-9_]*)"', json.dumps(raw)))
    raw["steps"] = _lift_steps(raw["steps"], used)
    return raw


def _lift_steps(steps: list[Any], used: set[str]) -> list[Any]:
    lifted: list[Any] = []
    run: list[Any] = []
    run_list: str | None = None

    def flush() -> None:
        nonlocal run, run_list
        if run:
            name = "line" if run_list == "lines" and "line" not in used else _fresh_name(f"{run_list[:20]}_item", used)
            used.add(name)
            lifted.append({"for_each": {"path": f"/{run_list}"}, "as": name,
                           "steps": [_rename_paths(step, run_list, name) for step in run]})
        run, run_list = [], None

    for step in steps:
        if isinstance(step, dict) and isinstance(step.get("steps"), list):
            step = {**step, "steps": _lift_steps(step["steps"], used)}
        lists = _wildcard_lists(step) if isinstance(step, dict) and "for_each" not in step else set()
        if len(lists) == 1:
            (list_name,) = lists
            if run and run_list != list_name:
                flush()
            run.append(step)
            run_list = list_name
        else:
            flush()
            lifted.append(step)
    flush()
    return lifted


def _wildcard_lists(node: Any) -> set[str]:
    if isinstance(node, dict):
        found = set()
        if isinstance(node.get("path"), str) and (match := _WILDCARD_PATH.match(node["path"])):
            found.add(match["list"])
        for value in node.values():
            found |= _wildcard_lists(value)
        return found
    if isinstance(node, list):
        return set().union(*(_wildcard_lists(item) for item in node)) if node else set()
    return set()


def _rename_paths(node: Any, list_name: str, name: str) -> Any:
    if isinstance(node, dict):
        renamed = {key: _rename_paths(value, list_name, name) for key, value in node.items()}
        path = renamed.get("path")
        if isinstance(path, str) and (match := _WILDCARD_PATH.match(path)) and match["list"] == list_name:
            renamed["path"] = f"${name}/{match['rest']}"
        return renamed
    if isinstance(node, list):
        return [_rename_paths(item, list_name, name) for item in node]
    return node


def _fresh_name(base: str, used: set[str]) -> str:
    name, number = base, 2
    while name in used:
        name, number = f"{base}{number}", number + 1
    return name


def _failed_before(draft: Any, context: DraftingContext) -> bool:
    """The draft the last round failed the full checks with, sent again: not proposed by itself
    (the drafter is told what to fix and decides when to propose)."""
    last = context.last_draft
    return bool(last) and not last.get("passed_checks") and json.dumps(last.get("draft"), sort_keys=True) == \
        json.dumps(draft, sort_keys=True)


def _lift_misplaced_fields(reply: dict[str, Any]) -> dict[str, Any]:
    """Small models often put "intent" and "assumptions" inside the spec. Move them
    next to it, where the protocol expects them; the spec itself is unchanged. An
    "outcomes" table sent beside a sheet goes into it."""
    if "sheet" in reply and "spec" not in reply:
        # A sheet travels as the spec; _parse tells them apart and compiles the sheet.
        reply = {**{key: value for key, value in reply.items() if key != "sheet"}, "spec": reply["sheet"]}
    spec = reply.get("spec")
    if not isinstance(spec, dict):
        return reply
    spec = dict(spec)
    lifted = {key: spec.pop(key) for key in ("intent", "assumptions", "action") if key in spec}
    if is_sheet(spec) and "outcomes" in reply and "outcomes" not in spec:
        # The outcome table is part of the sheet; models also send it beside the sheet.
        spec["outcomes"] = reply["outcomes"]
        reply = {key: value for key, value in reply.items() if key != "outcomes"}
    return {**reply, **{key: value for key, value in lifted.items() if key not in reply}, "spec": spec}
