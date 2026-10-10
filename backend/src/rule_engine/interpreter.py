"""Evaluate a RuleSpec against one claim.

Conditions use three-valued logic: True, False or None ("unknown"). Unknown
means the claim does not hold enough valid information to decide, for example
a missing field or a date that does not parse. Unknown never silently becomes
PASS: it surfaces as UNABLE_TO_ASSESS, which sends the result to a human.

Steps run in order inside a block and leave a tally:

- need     not true  -> UNABLE_TO_ASSESS, stop the block
- only_if  false     -> NOT_APPLICABLE, stop the block (unknown -> UNABLE_TO_ASSESS)
- require  true      -> checked; false -> FAIL (or "otherwise"); unknown -> UNABLE_TO_ASSESS
- for_each           -> each element runs the nested steps; element results add to the tally

The block result is FAIL if anything failed, else UNABLE_TO_ASSESS if anything
was unknown, else PASS if anything was checked, else NOT_APPLICABLE.

Every evaluation has an operation budget, so a rule can never run for long,
and arithmetic errors become unknown instead of exceptions.
"""

from __future__ import annotations

import decimal
import math
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from .catalogue import ReferenceData
from .language import (
    AddValue,
    AllOf,
    AmountsMatch,
    AnyOf,
    Compare,
    CompareDates,
    ConfigValue,
    CountValue,
    DaysBetweenValue,
    EarliestValue,
    Exists,
    FindValue,
    FirstPresentValue,
    ForEachStep,
    In,
    IsMissing,
    IsPresent,
    IsWholeNumber,
    LatestValue,
    LetStep,
    LiteralValue,
    MultiplyValue,
    NeedStep,
    Node,
    Not,
    OnlyIfStep,
    PathValue,
    RequireStep,
    RuleSpec,
    SubtractValue,
    SumValue,
    Unique,
    WithinDates,
)

PASS = "PASS"
FAIL = "FAIL"
UNABLE = "UNABLE_TO_ASSESS"
NOT_APPLICABLE = "NOT_APPLICABLE"

MAX_OPERATIONS = 200_000
MAX_EVIDENCE = 40
CENT = Decimal("0.01")


class EvaluationLimitExceeded(RuntimeError):
    """The rule needed more work than the budget allows for one claim."""


@dataclass
class Outcome:
    status: str
    message: str
    affected_line_ids: list[str] = field(default_factory=list)
    evidence: list[tuple[str, Any]] = field(default_factory=list)


def evaluate_rule(spec: RuleSpec, claim: dict[str, Any], reference: ReferenceData) -> Outcome:
    """Evaluate one rule on one claim. Raises EvaluationLimitExceeded if over budget."""
    run = _Run(claim, reference)
    with decimal.localcontext() as context:
        context.prec = 34
        tally = run.block(spec.steps, {})
    status = tally.status()
    return Outcome(
        status=status,
        message=getattr(spec.messages, status),
        affected_line_ids=list(dict.fromkeys(run.failed_line_ids)),
        evidence=list(run.evidence.items()),
    )


# --------------------------------------------------------------------------


@dataclass(frozen=True)
class _Bound:
    """A value with the JSON pointer it was read from (None when not from the claim)."""

    value: Any
    pointer: str | None = None


_MISSING = _Bound(None)


@dataclass
class _Tally:
    failed: bool = False
    unknown: bool = False
    checked: bool = False

    def status(self) -> str:
        if self.failed:
            return FAIL
        if self.unknown:
            return UNABLE
        if self.checked:
            return PASS
        return NOT_APPLICABLE

    def add(self, status: str) -> None:
        if status == FAIL:
            self.failed = True
        elif status == UNABLE:
            self.unknown = True
        elif status == PASS:
            self.checked = True


Scope = dict[str, _Bound]


class _Run:
    def __init__(self, claim: dict[str, Any], reference: ReferenceData):
        self.claim = claim
        self.reference = reference
        self.operations = 0
        self.evidence: dict[str, Any] = {}
        self.failed_line_ids: list[str] = []

    def tick(self) -> None:
        self.operations += 1
        if self.operations > MAX_OPERATIONS:
            raise EvaluationLimitExceeded("rule evaluation exceeded its operation budget")

    # ---------------------------------------------------------------- steps

    def block(self, steps: list[Node], parent: Scope) -> _Tally:
        scope = dict(parent)
        tally = _Tally()
        for step in steps:
            self.tick()
            if isinstance(step, NeedStep):
                if self.condition(step.need, scope) is not True:
                    tally.unknown = True
                    break
            elif isinstance(step, OnlyIfStep):
                applies = self.condition(step.only_if, scope)
                if applies is None:
                    tally.unknown = True
                    break
                if applies is False:
                    break
            elif isinstance(step, RequireStep):
                result = self.condition(step.require, scope)
                if result is True:
                    tally.checked = True
                elif result is False and step.otherwise == FAIL:
                    tally.failed = True
                else:
                    tally.unknown = True
            elif isinstance(step, LetStep):
                scope[step.let] = self.resolve(step.be, scope)
            elif isinstance(step, ForEachStep):
                self.for_each(step, scope, tally)
        return tally

    def for_each(self, step: ForEachStep, scope: Scope, tally: _Tally) -> None:
        collection = self.resolve(step.for_each, scope)
        if not isinstance(collection.value, list):
            tally.unknown = True
            return
        for element in _elements(collection):
            status = self.block(step.steps, {**scope, step.as_: element}).status()
            tally.add(status)
            if status == FAIL and isinstance(element.value, dict):
                line_id = element.value.get("line_id")
                if isinstance(line_id, str):
                    self.failed_line_ids.append(line_id)

    # ----------------------------------------------------------- conditions

    def condition(self, node: Node, scope: Scope) -> bool | None:
        self.tick()
        if isinstance(node, AllOf):
            return _all_of([self.condition(item, scope) for item in node.items])
        if isinstance(node, AnyOf):
            return _any_of([self.condition(item, scope) for item in node.items])
        if isinstance(node, Not):
            result = self.condition(node.item, scope)
            return None if result is None else not result
        if isinstance(node, IsPresent):
            return not _missing(self.resolve(node.value, scope).value)
        if isinstance(node, IsMissing):
            return _missing(self.resolve(node.value, scope).value)
        if isinstance(node, Compare):
            return _compare(node.op, self.value(node.left, scope), self.value(node.right, scope))
        if isinstance(node, CompareDates):
            return _compare_dates(node.op, self.value(node.left, scope), self.value(node.right, scope))
        if isinstance(node, WithinDates):
            value, start, end = (
                _date(self.value(part, scope)) for part in (node.value, node.from_, node.to)
            )
            if value is None or start is None or end is None:
                return None
            return start <= value <= end
        if isinstance(node, In):
            return _contains(self.value(node.collection, scope), self.value(node.value, scope))
        if isinstance(node, Exists):
            return self.exists(node, scope)
        if isinstance(node, Unique):
            return self.unique(node, scope)
        if isinstance(node, AmountsMatch):
            left = _number(self.value(node.left, scope))
            right = _number(self.value(node.right, scope))
            if left is None or right is None:
                return None
            difference = _safe(lambda: abs(_round_cents(left) - _round_cents(right)))
            return None if difference is None else difference <= Decimal(str(node.tolerance))
        if isinstance(node, IsWholeNumber):
            number = _number(self.value(node.value, scope))
            return None if number is None else number == number.to_integral_value()
        raise TypeError(f"unsupported condition {type(node).__name__}")

    def exists(self, node: Exists, scope: Scope) -> bool | None:
        collection = self.resolve(node.collection, scope)
        if not isinstance(collection.value, list):
            return None
        return any(
            self.condition(node.where, {**scope, node.as_: element}) is True
            for element in _elements(collection)
        )

    def unique(self, node: Unique, scope: Scope) -> bool | None:
        collection = self.resolve(node.collection, scope)
        if not isinstance(collection.value, list):
            return None
        seen = set()
        skipped = False
        for element in _elements(collection):
            inner = {**scope, node.as_: element}
            parts = [self.value(part, inner) for part in node.by]
            if any(_missing(part) for part in parts):
                skipped = True
                continue
            key = tuple(_hashable(part) for part in parts)
            if key in seen:
                return False
            seen.add(key)
        return None if skipped else True

    # --------------------------------------------------------------- values

    def value(self, node: Node, scope: Scope) -> Any:
        return self.resolve(node, scope).value

    def resolve(self, node: Node, scope: Scope) -> _Bound:
        self.tick()
        if isinstance(node, PathValue):
            return self.path(node.path, scope)
        if isinstance(node, LiteralValue):
            return _Bound(node.value)
        if isinstance(node, ConfigValue):
            return _Bound(self.config(node, scope))
        if isinstance(node, CountValue):
            elements = self.matching(node.count, node.as_, node.where, scope)
            return _MISSING if elements is None else _Bound(len(elements))
        if isinstance(node, SumValue):
            elements = self.matching(node.sum, node.as_, node.where, scope)
            if elements is None:
                return _MISSING
            numbers = [_number(self.value(node.of, {**scope, node.as_: e})) for e in elements]
            if any(number is None for number in numbers):
                return _MISSING
            return _Bound(_safe(lambda: sum(numbers, Decimal(0))))
        if isinstance(node, (LatestValue, EarliestValue)):
            collection = node.latest if isinstance(node, LatestValue) else node.earliest
            elements = self.matching(collection, node.as_, None, scope)
            if not elements:
                return _MISSING
            dates = [_date(self.value(node.of, {**scope, node.as_: e})) for e in elements]
            if any(day is None for day in dates):
                return _MISSING
            return _Bound(max(dates) if isinstance(node, LatestValue) else min(dates))
        if isinstance(node, FindValue):
            elements = self.matching(node.find, node.as_, node.where, scope)
            return elements[0] if elements else _MISSING
        if isinstance(node, (MultiplyValue, AddValue, SubtractValue)):
            numbers = [_number(self.value(part, scope)) for part in getattr(node, node.kind)]
            if any(number is None for number in numbers):
                return _MISSING
            return _Bound(_arithmetic(node.kind, numbers))
        if isinstance(node, DaysBetweenValue):
            start, end = (_date(self.value(part, scope)) for part in node.days_between)
            if start is None or end is None:
                return _MISSING
            return _Bound((end - start).days)
        if isinstance(node, FirstPresentValue):
            for part in node.first_present:
                bound = self.resolve(part, scope)
                if not _missing(bound.value):
                    return bound
            return _MISSING
        raise TypeError(f"unsupported value {type(node).__name__}")

    def matching(self, collection_node, name, where, scope) -> list[_Bound] | None:
        """Elements of a collection, keeping only those whose "where" is true."""
        collection = self.resolve(collection_node, scope)
        if not isinstance(collection.value, list):
            return None
        elements = _elements(collection)
        if where is None:
            return elements
        return [e for e in elements if self.condition(where, {**scope, name: e}) is True]

    def path(self, path: str, scope: Scope) -> _Bound:
        if path.startswith("$"):
            name, _, rest = path[1:].partition("/")
            bound = scope.get(name, _MISSING)
        else:
            rest = path.strip("/")
            bound = _Bound(self.claim, "")
        for key in rest.split("/") if rest else []:
            container = bound.value
            if not isinstance(container, dict) or key not in container:
                return _MISSING
            pointer = None if bound.pointer is None else f"{bound.pointer}/{key}"
            bound = _Bound(container[key], pointer)
        self.note_evidence(bound)
        return bound

    def note_evidence(self, bound: _Bound) -> None:
        if bound.pointer and not isinstance(bound.value, (dict, list)):
            if bound.pointer in self.evidence or len(self.evidence) < MAX_EVIDENCE:
                self.evidence[bound.pointer] = bound.value

    def config(self, node: ConfigValue, scope: Scope) -> Any:
        if node.config == "providers":
            return self.reference.provider_ids
        if node.config == "diagnoses":
            return self.reference.diagnosis_codes
        if node.config == "services":
            current: Any = self.reference.services
        else:
            policy_id = self.path("/policy_id", scope).value
            current = self.reference.policies.get(policy_id) if isinstance(policy_id, str) else None
        for segment in node.get:
            key = segment if isinstance(segment, str) else self.value(segment, scope)
            if not isinstance(current, dict) or not isinstance(key, str):
                return None
            current = current.get(key)
        return current


# --------------------------------------------------------------- helpers


def _elements(collection: _Bound) -> list[_Bound]:
    pointer = collection.pointer
    return [
        _Bound(item, None if pointer is None else f"{pointer}/{index}")
        for index, item in enumerate(collection.value)
    ]


def _all_of(results: list[bool | None]) -> bool | None:
    if False in results:
        return False
    if None in results:
        return None
    return True


def _any_of(results: list[bool | None]) -> bool | None:
    if True in results:
        return True
    if None in results:
        return None
    return False


def _missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _number(value: Any) -> Decimal | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(str(value)) if math.isfinite(value) else None
    return None


def _date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _same(left: Any, right: Any) -> bool | None:
    """Exact equality, or None when the two values cannot be compared."""
    if _missing(left) or _missing(right):
        return None
    if isinstance(left, date) or isinstance(right, date):
        left_day, right_day = _date(left), _date(right)
        return None if left_day is None or right_day is None else left_day == right_day
    left_number, right_number = _number(left), _number(right)
    if left_number is not None and right_number is not None:
        return left_number == right_number
    if isinstance(left, bool) and isinstance(right, bool):
        return left == right
    if isinstance(left, str) and isinstance(right, str):
        return left == right
    return None


def _compare(op: str, left: Any, right: Any) -> bool | None:
    if op in ("equals", "not_equals"):
        same = _same(left, right)
        if same is None:
            return None
        return same if op == "equals" else not same
    left_number, right_number = _number(left), _number(right)
    if left_number is None or right_number is None:
        return None
    return {
        "less_than": left_number < right_number,
        "at_most": left_number <= right_number,
        "greater_than": left_number > right_number,
        "at_least": left_number >= right_number,
    }[op]


def _compare_dates(op: str, left: Any, right: Any) -> bool | None:
    left_day, right_day = _date(left), _date(right)
    if left_day is None or right_day is None:
        return None
    return {
        "before": left_day < right_day,
        "on_or_before": left_day <= right_day,
        "after": left_day > right_day,
        "on_or_after": left_day >= right_day,
        "same_day": left_day == right_day,
    }[op]


def _contains(container: Any, value: Any) -> bool | None:
    if _missing(value):
        return None
    if isinstance(container, dict):
        return isinstance(value, str) and value in container
    if isinstance(container, list):
        return any(_same(value, item) is True for item in container)
    return None


def _hashable(value: Any) -> Any:
    number = _number(value)
    if number is not None:
        return ("number", number)
    return (type(value).__name__, value if not isinstance(value, (dict, list)) else repr(value))


def _round_cents(number: Decimal) -> Decimal:
    return number.quantize(CENT, rounding=ROUND_HALF_UP)


def _safe(compute):
    try:
        return compute()
    except ArithmeticError:
        return None


def _arithmetic(kind: str, numbers: list[Decimal]) -> Decimal | None:
    def compute():
        if kind == "multiply":
            return numbers[0] * numbers[1]
        if kind == "subtract":
            return numbers[0] - numbers[1]
        return sum(numbers, Decimal(0))

    return _safe(compute)
