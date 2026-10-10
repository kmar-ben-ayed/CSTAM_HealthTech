"""The rule language: a small declarative format for claim validation rules.

A rule is plain data (JSON). The server evaluates it with ``interpreter.py``;
nothing in a rule is ever turned into code. The Pydantic models below define
the exact shape of that data, so one definition is used both to check a rule
(``parse_spec``) and to evaluate it.

A spec is an ordered list of steps plus one message per outcome::

    {
      "language_version": 2,
      "steps": [
        {"need": <condition>},          # input must be known, else UNABLE_TO_ASSESS
        {"only_if": <condition>},       # the rule applies only when true, else NOT_APPLICABLE
        {"let": "name", "be": <value>}, # name a value; read it later as {"path": "$name"}
        {"require": <condition>},       # the actual check; false gives FAIL
        {"for_each": <collection>, "as": "line", "steps": [...]}  # repeat steps per element
      ],
      "messages": {"PASS": "...", "FAIL": "...", "UNABLE_TO_ASSESS": "..."}
    }

Values are objects with one key naming their kind ({"path": ...},
{"value": ...}, {"sum": ...}). Conditions are objects with an "op" field.
docs/RULE_LANGUAGE.md is the full reference.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, ClassVar, Literal, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    Tag,
    ValidationError,
    model_validator,
)

LANGUAGE_VERSION = 2

OUTCOMES = ("PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE")

# A claim field ("/coverage/status") or a named value ("$line/service_code").
# Segments are lowercase identifiers, so array indexes like "/lines/0" are not
# expressible: rules reach array elements through for_each, find, exists, ...
PATH_PATTERN = r"^(/[a-z_][a-z0-9_]*)+$|^\$[a-z][a-z0-9_]*(/[a-z_][a-z0-9_]*)*$"

Name = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=300)]
KeyName = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.-]{1,64}$")]
Status = Literal["PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE"]

LiteralScalar = Union[
    StrictBool,
    Annotated[StrictInt, Field(ge=-(10**15), le=10**15)],
    Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-1e15, le=1e15)],
    Annotated[str, StringConstraints(max_length=200)],
]


class SpecError(ValueError):
    """Raised when a spec does not have the shape this language defines."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


class Node(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )


# --------------------------------------------------------------------------
# Values: anything a condition can compare. Each kind is keyed by its name.
# --------------------------------------------------------------------------


class PathValue(Node):
    """Read a claim field ("/currency") or a named value ("$line/quantity")."""

    kind: ClassVar[str] = "path"
    path: Annotated[str, StringConstraints(pattern=PATH_PATTERN, max_length=120)]


class LiteralValue(Node):
    """A fixed value written in the rule: a number, text or true/false."""

    kind: ClassVar[str] = "value"
    value: LiteralScalar


class ConfigValue(Node):
    """Read reference data.

    - "policy": the policy named by the claim's /policy_id, e.g.
      {"config": "policy", "get": ["max_unit_price", {"path": "$line/service_code"}]}
    - "services": the service catalogue, keyed by service code
    - "providers": the list of known provider ids
    - "diagnoses": the list of known diagnosis codes
    """

    kind: ClassVar[str] = "config"
    config: Literal["policy", "services", "providers", "diagnoses"]
    get: list[Union[KeyName, "Value"]] = Field(default_factory=list, max_length=3)


class CountValue(Node):
    """Number of elements in a collection, optionally only those matching "where"."""

    kind: ClassVar[str] = "count"
    count: "Value"
    as_: Name | None = Field(default=None, alias="as")
    where: "Condition | None" = None

    @model_validator(mode="after")
    def _where_needs_name(self):
        if self.where is not None and self.as_ is None:
            raise ValueError('"where" needs "as" to name the element')
        return self


class SumValue(Node):
    """Sum of one number per element; unknown if any of those numbers is missing."""

    kind: ClassVar[str] = "sum"
    sum: "Value"
    as_: Name = Field(alias="as")
    of: "Value"
    where: "Condition | None" = None


class LatestValue(Node):
    """Latest date among the elements; unknown if any date is missing or invalid."""

    kind: ClassVar[str] = "latest"
    latest: "Value"
    as_: Name = Field(alias="as")
    of: "Value"


class EarliestValue(Node):
    """Earliest date among the elements; unknown if any date is missing or invalid."""

    kind: ClassVar[str] = "earliest"
    earliest: "Value"
    as_: Name = Field(alias="as")
    of: "Value"


class FindValue(Node):
    """The first element whose "where" condition is true (missing if none)."""

    kind: ClassVar[str] = "find"
    find: "Value"
    as_: Name = Field(alias="as")
    where: "Condition"


class MultiplyValue(Node):
    kind: ClassVar[str] = "multiply"
    multiply: list["Value"] = Field(min_length=2, max_length=2)


class AddValue(Node):
    kind: ClassVar[str] = "add"
    add: list["Value"] = Field(min_length=2, max_length=10)


class SubtractValue(Node):
    """First value minus the second."""

    kind: ClassVar[str] = "subtract"
    subtract: list["Value"] = Field(min_length=2, max_length=2)


class DaysBetweenValue(Node):
    """Whole days from the first date to the second (negative if the second is earlier)."""

    kind: ClassVar[str] = "days_between"
    days_between: list["Value"] = Field(min_length=2, max_length=2)


class FirstPresentValue(Node):
    """The first value that is present, e.g. a default for an optional field."""

    kind: ClassVar[str] = "first_present"
    first_present: list["Value"] = Field(min_length=2, max_length=5)


VALUE_TYPES: tuple[type[Node], ...] = (
    PathValue,
    LiteralValue,
    ConfigValue,
    CountValue,
    SumValue,
    LatestValue,
    EarliestValue,
    FindValue,
    MultiplyValue,
    AddValue,
    SubtractValue,
    DaysBetweenValue,
    FirstPresentValue,
)
VALUE_KINDS = {model.kind: model for model in VALUE_TYPES}


def _value_kind(data: Any) -> str | None:
    """Pick the value model from the single key that names its kind."""
    if isinstance(data, Node):
        return getattr(data, "kind", None)
    if isinstance(data, dict):
        kinds = [key for key in data if key in VALUE_KINDS]
        if len(kinds) == 1:
            return kinds[0]
    return None


Value = Annotated[
    Union[tuple(Annotated[model, Tag(model.kind)] for model in VALUE_TYPES)],
    Discriminator(
        _value_kind,
        custom_error_type="unknown_value",
        custom_error_message=(
            "a value must have exactly one of the keys: " + ", ".join(sorted(VALUE_KINDS))
        ),
    ),
]


# --------------------------------------------------------------------------
# Conditions: true, false or unknown. Each kind is selected by "op".
# --------------------------------------------------------------------------


class AllOf(Node):
    """True when every item is true; false when any is false; otherwise unknown."""

    op: Literal["all_of"]
    items: list["Condition"] = Field(min_length=1, max_length=20)


class AnyOf(Node):
    """True when any item is true; false when every item is false; otherwise unknown."""

    op: Literal["any_of"]
    items: list["Condition"] = Field(min_length=1, max_length=20)


class Not(Node):
    op: Literal["not"]
    item: "Condition"


class IsPresent(Node):
    """True when the value exists and is not empty text. Never unknown."""

    op: Literal["is_present"]
    value: Value


class IsMissing(Node):
    """The opposite of is_present. Never unknown."""

    op: Literal["is_missing"]
    value: Value


class Compare(Node):
    """equals / not_equals compare any two values exactly (text is case-sensitive).

    The other operators compare numbers. Unknown if either side is missing or
    the two sides are not comparable.
    """

    op: Literal["equals", "not_equals", "less_than", "at_most", "greater_than", "at_least"]
    left: Value
    right: Value


class CompareDates(Node):
    """Compare two ISO dates (YYYY-MM-DD). Unknown if either is missing or invalid."""

    op: Literal["before", "on_or_before", "after", "on_or_after", "same_day"]
    left: Value
    right: Value


class WithinDates(Node):
    """True when from <= value <= to. Unknown if any of the three dates is missing."""

    op: Literal["within_dates"]
    value: Value
    from_: Value = Field(alias="from")
    to: Value


class In(Node):
    """True when the value is in the collection (a list, or the keys of a map)."""

    op: Literal["in"]
    value: Value
    collection: Value


class Exists(Node):
    """True when at least one element matches "where".

    An element whose "where" is unknown does not match (like SQL WHERE), so
    exists is never unknown unless the collection itself is missing.
    """

    op: Literal["exists"]
    collection: Value
    as_: Name = Field(alias="as")
    where: "Condition"


class Unique(Node):
    """True when no two elements share the same "by" key.

    Elements with a missing key part are skipped; if any were skipped and no
    duplicate was found among the rest, the result is unknown.
    """

    op: Literal["unique"]
    collection: Value
    as_: Name = Field(alias="as")
    by: list[Value] = Field(min_length=1, max_length=5)


class AmountsMatch(Node):
    """Round both amounts to 2 decimals (half up) and compare within a tolerance."""

    op: Literal["amounts_match"]
    left: Value
    right: Value
    tolerance: Annotated[float, Field(ge=0, le=1000, allow_inf_nan=False)] = 0.01


class IsWholeNumber(Node):
    op: Literal["is_whole_number"]
    value: Value


Condition = Annotated[
    Union[
        AllOf,
        AnyOf,
        Not,
        IsPresent,
        IsMissing,
        Compare,
        CompareDates,
        WithinDates,
        In,
        Exists,
        Unique,
        AmountsMatch,
        IsWholeNumber,
    ],
    Field(discriminator="op"),
]


# --------------------------------------------------------------------------
# Steps and the spec itself.
# --------------------------------------------------------------------------

Note = Annotated[str, StringConstraints(max_length=200)]


class NeedStep(Node):
    """The rule needs this to be true to be assessed; otherwise UNABLE_TO_ASSESS (stop)."""

    kind: ClassVar[str] = "need"
    need: Condition
    note: Note | None = None


class OnlyIfStep(Node):
    """The rule applies only when this is true; otherwise NOT_APPLICABLE (stop).

    Must come before any require or for_each in the same block.
    """

    kind: ClassVar[str] = "only_if"
    only_if: Condition
    note: Note | None = None


class RequireStep(Node):
    """The check itself. False gives FAIL (or "otherwise"); unknown gives UNABLE_TO_ASSESS.

    A failed or unknown require does not stop the block: later steps still run,
    and FAIL always outranks UNABLE_TO_ASSESS in the final status.
    """

    kind: ClassVar[str] = "require"
    require: Condition
    otherwise: Literal["FAIL", "UNABLE_TO_ASSESS"] = "FAIL"
    note: Note | None = None


class LetStep(Node):
    """Name a value so later steps can read it as {"path": "$name"}."""

    kind: ClassVar[str] = "let"
    let: Name
    be: Value


class ForEachStep(Node):
    """Run the nested steps once per element of a collection.

    Element outcomes combine as FAIL > UNABLE_TO_ASSESS > PASS; elements that
    are NOT_APPLICABLE are ignored. Failing elements with a line_id are
    reported as affected lines.
    """

    kind: ClassVar[str] = "for_each"
    for_each: Value
    as_: Name = Field(alias="as")
    steps: list["Step"] = Field(min_length=1, max_length=20)


STEP_TYPES: tuple[type[Node], ...] = (NeedStep, OnlyIfStep, RequireStep, LetStep, ForEachStep)
STEP_KINDS = {model.kind: model for model in STEP_TYPES}


def _step_kind(data: Any) -> str | None:
    if isinstance(data, Node):
        return getattr(data, "kind", None)
    if isinstance(data, dict):
        kinds = [key for key in data if key in STEP_KINDS]
        if len(kinds) == 1:
            return kinds[0]
    return None


Step = Annotated[
    Union[tuple(Annotated[model, Tag(model.kind)] for model in STEP_TYPES)],
    Discriminator(
        _step_kind,
        custom_error_type="unknown_step",
        custom_error_message=(
            "a step must have exactly one of the keys: " + ", ".join(sorted(STEP_KINDS))
        ),
    ),
]


class Messages(Node):
    PASS: ShortText
    FAIL: ShortText
    UNABLE_TO_ASSESS: ShortText
    NOT_APPLICABLE: ShortText = "This rule does not apply to the claim."


class RuleSpec(Node):
    language_version: Literal[2]
    steps: list[Step] = Field(min_length=1, max_length=30)
    messages: Messages

    def to_json(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)


for _model in (*VALUE_TYPES, AllOf, AnyOf, Not, Exists, *STEP_TYPES):
    _model.model_rebuild()


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

MAX_JSON_DEPTH = 40
MAX_SPEC_BYTES = 30_000


def parse_spec(raw: Any) -> RuleSpec:
    """Turn untrusted JSON into a RuleSpec, or raise SpecError with readable problems.

    Only the shape is checked here. ``validation.check_spec`` checks the
    meaning (fields exist, names are defined, types fit).
    """
    if isinstance(raw, RuleSpec):
        return raw
    if not isinstance(raw, dict):
        raise SpecError(["a spec must be a JSON object"])
    if len(json.dumps(raw, ensure_ascii=False)) > MAX_SPEC_BYTES:
        raise SpecError([f"the spec is larger than {MAX_SPEC_BYTES} characters"])
    if _json_depth(raw) > MAX_JSON_DEPTH:
        raise SpecError([f"the spec is nested deeper than {MAX_JSON_DEPTH} levels"])
    try:
        return RuleSpec.model_validate(raw)
    except ValidationError as error:
        raise SpecError(_readable_errors(error)) from None


def _json_depth(data: Any) -> int:
    deepest = 0
    pending = [(data, 1)]
    while pending:
        item, depth = pending.pop()
        deepest = max(deepest, depth)
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
    return deepest


def _readable_errors(error: ValidationError, limit: int = 8) -> list[str]:
    problems = []
    for item in error.errors(include_url=False)[:limit]:
        location = ".".join(str(part) for part in item["loc"]) or "spec"
        problems.append(f"{location}: {item['msg']}")
    if error.error_count() > limit:
        problems.append(f"... and {error.error_count() - limit} more problems")
    return problems
