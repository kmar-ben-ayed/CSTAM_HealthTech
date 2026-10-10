"""Static checks for a parsed RuleSpec: does it make sense for our claims?

``parse_spec`` only guarantees the shape. ``check_spec`` catches specs that are
well-formed but wrong or unsafe to activate:

- every claim path exists in claim.schema.json
- every $name is defined before use and never redefined while visible
- "$name/field" is only used on names bound to a claim object (e.g. a line)
- operators get values of a fitting type (numbers for at_most, dates for before)
- comparisons are not between two fixed values
- reference-data lookups use known fields
- only_if comes before any require or for_each in its block
- the rule has at least one require step
- size limits on the number of nodes and the nesting depth
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .catalogue import (
    BOOLEAN,
    DATE,
    LIST,
    MAP,
    NUMBER,
    OBJECT,
    POLICY_FIELDS,
    SERVICE_FIELDS,
    TEXT,
    FieldCatalogue,
)
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

MAX_NODES = 400
MAX_DEPTH = 14


@dataclass(frozen=True)
class Shape:
    """What the checker knows about a value.

    types: the possible value types, or None when unknown.
    object_path: for claim objects, their catalogue path ("/lines/*").
    item: for lists and maps, the shape of one entry.
    """

    types: frozenset[str] | None = None
    object_path: str | None = None
    item: "Shape | None" = None


UNKNOWN = Shape()


def shape_of(*types: str, object_path: str | None = None, item: Shape | None = None) -> Shape:
    return Shape(types=frozenset(types), object_path=object_path, item=item)


@dataclass
class _Scope:
    names: dict[str, Shape] = field(default_factory=dict)

    def child(self) -> "_Scope":
        return _Scope(dict(self.names))


@dataclass
class SpecAnalysis:
    problems: list[str]
    fields_read: set[str]  # catalogue paths such as "/currency" or "/lines/*/quantity"


def check_spec(spec: RuleSpec, catalogue: FieldCatalogue) -> list[str]:
    """Return a list of problems; an empty list means the spec passed every check."""
    return analyse_spec(spec, catalogue).problems


def analyse_spec(spec: RuleSpec, catalogue: FieldCatalogue) -> SpecAnalysis:
    checker = _Checker(catalogue)
    problems = checker.run(spec)
    return SpecAnalysis(problems=problems, fields_read=checker.fields_read)


class _Checker:
    def __init__(self, catalogue: FieldCatalogue):
        self.catalogue = catalogue
        self.problems: list[str] = []
        self.require_count = 0
        self.fields_read: set[str] = set()

    def problem(self, message: str) -> None:
        if message not in self.problems:
            self.problems.append(message)

    def run(self, spec: RuleSpec) -> list[str]:
        nodes, depth = _measure(spec)
        if nodes > MAX_NODES:
            self.problem(f"the rule has {nodes} parts; the limit is {MAX_NODES}")
        if depth > MAX_DEPTH:
            self.problem(f"the rule is nested {depth} levels deep; the limit is {MAX_DEPTH}")
        self.steps(spec.steps, _Scope())
        if self.require_count == 0:
            self.problem("the rule has no require step, so it can never fail")
        return self.problems

    # ---------------------------------------------------------------- steps

    def steps(self, steps: list, scope: _Scope) -> None:
        checks_started = False
        for step in steps:
            if isinstance(step, NeedStep):
                self.condition(step.need, scope)
            elif isinstance(step, OnlyIfStep):
                if checks_started:
                    self.problem("only_if must come before any require or for_each in its block")
                self.condition(step.only_if, scope)
            elif isinstance(step, RequireStep):
                checks_started = True
                self.require_count += 1
                self.condition(step.require, scope)
            elif isinstance(step, LetStep):
                shape = self.value(step.be, scope)
                self.define(step.let, shape, scope)
            elif isinstance(step, ForEachStep):
                checks_started = True
                element = self.collection(step.for_each, scope, "for_each")
                inner = scope.child()
                self.define(step.as_, element, inner)
                self.steps(step.steps, inner)

    def define(self, name: str, shape: Shape, scope: _Scope) -> None:
        if name in scope.names:
            self.problem(f'the name "{name}" is defined twice; use a different name')
        scope.names[name] = shape

    # ----------------------------------------------------------- conditions

    def condition(self, node: Node, scope: _Scope) -> None:
        if isinstance(node, (AllOf, AnyOf)):
            for item in node.items:
                self.condition(item, scope)
        elif isinstance(node, Not):
            self.condition(node.item, scope)
        elif isinstance(node, (IsPresent, IsMissing)):
            if isinstance(node.value, LiteralValue):
                self.problem(f"{node.op} on a fixed value is always the same; check a field instead")
            self.value(node.value, scope)
        elif isinstance(node, Compare):
            self.comparison(node, scope)
        elif isinstance(node, CompareDates):
            self.no_fixed_pair(node.op, node.left, node.right)
            for side in (node.left, node.right):
                self.expect_date(self.value(side, scope), side, node.op)
        elif isinstance(node, WithinDates):
            if all(isinstance(side, LiteralValue) for side in (node.value, node.from_, node.to)):
                self.problem("within_dates compares three fixed values; use a field")
            for side in (node.value, node.from_, node.to):
                self.expect_date(self.value(side, scope), side, node.op)
        elif isinstance(node, In):
            self.value(node.value, scope)
            container = self.value(node.collection, scope)
            if container.types is not None and not container.types & {LIST, MAP}:
                self.problem('"in" needs a list or a map as its collection')
        elif isinstance(node, Exists):
            element = self.collection(node.collection, scope, "exists")
            inner = scope.child()
            self.define(node.as_, element, inner)
            self.condition(node.where, inner)
        elif isinstance(node, Unique):
            element = self.collection(node.collection, scope, "unique")
            inner = scope.child()
            self.define(node.as_, element, inner)
            for part in node.by:
                self.value(part, inner)
        elif isinstance(node, AmountsMatch):
            self.no_fixed_pair(node.op, node.left, node.right)
            for side in (node.left, node.right):
                self.expect(self.value(side, scope), {NUMBER}, node.op)
        elif isinstance(node, IsWholeNumber):
            self.expect(self.value(node.value, scope), {NUMBER}, node.op)

    def comparison(self, node: Compare, scope: _Scope) -> None:
        self.no_fixed_pair(node.op, node.left, node.right)
        left = self.value(node.left, scope)
        right = self.value(node.right, scope)
        if node.op in ("equals", "not_equals"):
            if left.types is not None and right.types is not None:
                if not _comparable(left.types) & _comparable(right.types):
                    self.problem(
                        f"{node.op} compares {_describe(left.types)} with {_describe(right.types)}"
                    )
        else:
            self.expect(left, {NUMBER}, node.op)
            self.expect(right, {NUMBER}, node.op)

    def no_fixed_pair(self, op: str, left: Node, right: Node) -> None:
        if isinstance(left, LiteralValue) and isinstance(right, LiteralValue):
            self.problem(f"{op} compares two fixed values; one side must read the claim")

    def expect(self, shape: Shape, allowed: set[str], op: str) -> None:
        if shape.types is not None and not shape.types & allowed:
            self.problem(f"{op} expects {_describe(allowed)}, got {_describe(shape.types)}")

    def expect_date(self, shape: Shape, node: Node, op: str) -> None:
        if isinstance(node, LiteralValue):
            if not isinstance(node.value, str) or not _is_iso_date(node.value):
                self.problem(f'{op} needs dates written as YYYY-MM-DD, got "{node.value}"')
            return
        self.expect(shape, {DATE, TEXT}, op)

    # --------------------------------------------------------------- values

    def collection(self, node: Node, scope: _Scope, used_by: str) -> Shape:
        """Check a value used as a list and return the shape of one element."""
        shape = self.value(node, scope)
        if shape.types is not None and LIST not in shape.types:
            self.problem(f"{used_by} needs a list, got {_describe(shape.types)}")
            return UNKNOWN
        return shape.item or UNKNOWN

    def value(self, node: Node, scope: _Scope) -> Shape:
        if isinstance(node, PathValue):
            return self.path(node.path, scope)
        if isinstance(node, LiteralValue):
            return _literal_shape(node.value)
        if isinstance(node, ConfigValue):
            return self.config(node, scope)
        if isinstance(node, CountValue):
            element = self.collection(node.count, scope, "count")
            if node.where is not None:
                inner = scope.child()
                self.define(node.as_, element, inner)
                self.condition(node.where, inner)
            return shape_of(NUMBER)
        if isinstance(node, SumValue):
            inner = self.element_scope(node.sum, node.as_, scope, "sum")
            if node.where is not None:
                self.condition(node.where, inner)
            self.expect(self.value(node.of, inner), {NUMBER}, "sum")
            return shape_of(NUMBER)
        if isinstance(node, (LatestValue, EarliestValue)):
            collection = node.latest if isinstance(node, LatestValue) else node.earliest
            inner = self.element_scope(collection, node.as_, scope, node.kind)
            self.expect(self.value(node.of, inner), {DATE, TEXT}, node.kind)
            return shape_of(DATE)
        if isinstance(node, FindValue):
            element = self.collection(node.find, scope, "find")
            inner = scope.child()
            self.define(node.as_, element, inner)
            self.condition(node.where, inner)
            return element
        if isinstance(node, (MultiplyValue, AddValue, SubtractValue)):
            for part in getattr(node, node.kind):
                self.expect(self.value(part, scope), {NUMBER}, node.kind)
            return shape_of(NUMBER)
        if isinstance(node, DaysBetweenValue):
            for part in node.days_between:
                self.expect_date(self.value(part, scope), part, "days_between")
            return shape_of(NUMBER)
        if isinstance(node, FirstPresentValue):
            shapes = [self.value(part, scope) for part in node.first_present]
            if any(shape.types is None for shape in shapes):
                return UNKNOWN
            return Shape(types=frozenset().union(*(shape.types for shape in shapes)))
        return UNKNOWN

    def element_scope(self, collection: Node, name: str, scope: _Scope, used_by: str) -> _Scope:
        element = self.collection(collection, scope, used_by)
        inner = scope.child()
        self.define(name, element, inner)
        return inner

    def path(self, path: str, scope: _Scope) -> Shape:
        if path.startswith("$"):
            name, _, rest = path[1:].partition("/")
            if name not in scope.names:
                self.problem(f'"${name}" is used before it is defined')
                return UNKNOWN
            bound = scope.names[name]
            if not rest:
                return bound
            if bound.object_path is None:
                self.problem(f'"${name}" is not a claim object, so "{path}" cannot read a field from it')
                return UNKNOWN
            return self.claim_field(f"{bound.object_path}/{rest}", shown_as=path)
        return self.claim_field(path, shown_as=path)

    def claim_field(self, catalogue_path: str, shown_as: str) -> Shape:
        info = self.catalogue.get(catalogue_path)
        if info is None:
            self.problem(f'"{shown_as}" is not a claim field')
            return UNKNOWN
        self.fields_read.add(catalogue_path)
        if info.is_list:
            item_info = self.catalogue.get(f"{catalogue_path}/*")
            item = UNKNOWN
            if item_info is not None:
                item = Shape(
                    types=item_info.types,
                    object_path=item_info.path if OBJECT in item_info.types else None,
                )
            return shape_of(LIST, item=item)
        return Shape(
            types=info.types,
            object_path=catalogue_path if OBJECT in info.types else None,
        )

    def config(self, node: ConfigValue, scope: _Scope) -> Shape:
        segments = list(node.get)
        for segment in segments:
            if not isinstance(segment, str):
                self.value(segment, scope)

        if node.config in ("providers", "diagnoses"):
            if segments:
                self.problem(f'"{node.config}" is a list of ids and takes no "get"')
            return shape_of(LIST, item=shape_of(TEXT))

        if node.config == "services":
            if not segments:
                return shape_of(MAP, item=shape_of(OBJECT))
            if len(segments) == 1:
                return shape_of(OBJECT)
            field_name = segments[1]
            if not isinstance(field_name, str) or field_name not in SERVICE_FIELDS:
                self.problem(f"service catalogue fields are: {', '.join(SERVICE_FIELDS)}")
                return UNKNOWN
            if len(segments) > 2:
                self.problem("a service field has no sub-fields")
            return shape_of(SERVICE_FIELDS[field_name][0])

        # policy: always the one named by the claim's /policy_id
        self.fields_read.add("/policy_id")
        if not segments:
            return shape_of(OBJECT)
        field_name = segments[0]
        if not isinstance(field_name, str) or field_name not in POLICY_FIELDS:
            self.problem(f"policy fields are: {', '.join(POLICY_FIELDS)}")
            return UNKNOWN
        field_type, entry_type, _ = POLICY_FIELDS[field_name]
        if len(segments) == 1:
            item = shape_of(entry_type) if entry_type else None
            return shape_of(field_type, item=item)
        if field_type != MAP:
            self.problem(f'policy field "{field_name}" is not a map, so it takes no key')
            return UNKNOWN
        if len(segments) > 2:
            self.problem(f'policy field "{field_name}" takes a single key')
        return shape_of(entry_type)


# ---------------------------------------------------------------- helpers


def _literal_shape(value) -> Shape:
    if isinstance(value, bool):
        return shape_of(BOOLEAN)
    if isinstance(value, (int, float)):
        return shape_of(NUMBER)
    return shape_of(TEXT)


def _comparable(types: frozenset[str]) -> set[str]:
    """Dates are written as text, so the two are comparable with each other."""
    expanded = set(types)
    if DATE in expanded or TEXT in expanded:
        expanded |= {DATE, TEXT}
    return expanded


def _describe(types) -> str:
    return " or ".join(sorted(types)) if types else "nothing"


def _is_iso_date(text: str) -> bool:
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return len(text) == 10


def _measure(node: Node) -> tuple[int, int]:
    """Count the nodes in a spec and return (count, maximum depth)."""
    count = 0
    deepest = 0
    pending = [(node, 1)]
    while pending:
        current, depth = pending.pop()
        count += 1
        deepest = max(deepest, depth)
        for name in type(current).model_fields:
            child = getattr(current, name)
            children = child if isinstance(child, list) else [child]
            pending.extend((item, depth + 1) for item in children if isinstance(item, Node))
    return count, deepest
