"""Render a RuleSpec as plain English, with a fixed template (no AI involved).

The readback is what an author reviews before a drafted rule goes live, so it
must say exactly what the spec does, including what happens on missing data.
"""

from __future__ import annotations

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

COMPARISONS = {
    "equals": "equals",
    "not_equals": "does not equal",
    "less_than": "is less than",
    "at_most": "is at most",
    "greater_than": "is greater than",
    "at_least": "is at least",
    "before": "is before",
    "on_or_before": "is on or before",
    "after": "is after",
    "on_or_after": "is on or after",
    "same_day": "is the same day as",
}

OUTCOME_RULES = (
    "Outcome: FAIL if any required check fails; otherwise UNABLE_TO_ASSESS if any input "
    "was missing or invalid; otherwise PASS if something was checked; otherwise NOT_APPLICABLE."
)


def describe_spec(spec: RuleSpec) -> str:
    lines: list[str] = []
    _steps(spec.steps, lines, indent="")
    lines.append(OUTCOME_RULES)
    lines.append(
        "Messages: "
        + "; ".join(f"{status} = \"{getattr(spec.messages, status)}\"" for status in
                    ("PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE"))
    )
    return "\n".join(lines)


def _steps(steps: list[Node], lines: list[str], indent: str) -> None:
    for number, step in enumerate(steps, start=1):
        prefix = f"{indent}{number}. "
        if isinstance(step, NeedStep):
            lines.append(f"{prefix}Needs {condition(step.need)}; otherwise UNABLE_TO_ASSESS and stop.")
        elif isinstance(step, OnlyIfStep):
            lines.append(f"{prefix}Applies only if {condition(step.only_if)}; otherwise NOT_APPLICABLE.")
        elif isinstance(step, RequireStep):
            otherwise = "FAIL" if step.otherwise == "FAIL" else "UNABLE_TO_ASSESS"
            lines.append(
                f"{prefix}Requires {condition(step.require)}; otherwise {otherwise} "
                "(UNABLE_TO_ASSESS if it cannot be decided)."
            )
        elif isinstance(step, LetStep):
            lines.append(f"{prefix}Let {step.let} be {value(step.be)}.")
        elif isinstance(step, ForEachStep):
            lines.append(f"{prefix}For each {step.as_} in {value(step.for_each)}:")
            _steps(step.steps, lines, indent + "   ")


def condition(node: Node) -> str:
    if isinstance(node, AllOf):
        return "all of (" + "; ".join(condition(item) for item in node.items) + ")"
    if isinstance(node, AnyOf):
        return "any of (" + "; ".join(condition(item) for item in node.items) + ")"
    if isinstance(node, Not):
        return f"not ({condition(node.item)})"
    if isinstance(node, IsPresent):
        return f"{value(node.value)} is present"
    if isinstance(node, IsMissing):
        return f"{value(node.value)} is missing"
    if isinstance(node, (Compare, CompareDates)):
        return f"{value(node.left)} {COMPARISONS[node.op]} {value(node.right)}"
    if isinstance(node, WithinDates):
        return f"{value(node.value)} is between {value(node.from_)} and {value(node.to)} (inclusive)"
    if isinstance(node, In):
        return f"{value(node.value)} is in {value(node.collection)}"
    if isinstance(node, Exists):
        return f"some {node.as_} in {value(node.collection)} has {condition(node.where)}"
    if isinstance(node, Unique):
        parts = ", ".join(value(part) for part in node.by)
        return f"no two {node.as_} in {value(node.collection)} share ({parts})"
    if isinstance(node, AmountsMatch):
        return (
            f"{value(node.left)} matches {value(node.right)} "
            f"(both rounded to cents, difference at most {node.tolerance:g})"
        )
    if isinstance(node, IsWholeNumber):
        return f"{value(node.value)} is a whole number"
    return type(node).__name__


def value(node: Node) -> str:
    if isinstance(node, PathValue):
        path = node.path
        if path.startswith("$"):
            return path[1:].replace("/", ".")
        return "claim." + path.strip("/").replace("/", ".")
    if isinstance(node, LiteralValue):
        return _literal(node.value)
    if isinstance(node, ConfigValue):
        name = {"policy": "policy", "services": "service catalogue", "providers": "known provider ids",
                "diagnoses": "known diagnosis codes"}[node.config]
        for segment in node.get:
            name += f".{segment}" if isinstance(segment, str) else f"[{value(segment)}]"
        return name
    if isinstance(node, CountValue):
        where = f" where {condition(node.where)}" if node.where is not None else ""
        return f"the number of {node.as_ or 'entries'} in {value(node.count)}{where}"
    if isinstance(node, SumValue):
        where = f" where {condition(node.where)}" if node.where is not None else ""
        return f"the sum of {value(node.of)} for each {node.as_} in {value(node.sum)}{where}"
    if isinstance(node, LatestValue):
        return f"the latest {value(node.of)} for each {node.as_} in {value(node.latest)}"
    if isinstance(node, EarliestValue):
        return f"the earliest {value(node.of)} for each {node.as_} in {value(node.earliest)}"
    if isinstance(node, FindValue):
        return f"the first {node.as_} in {value(node.find)} where {condition(node.where)}"
    if isinstance(node, MultiplyValue):
        return f"({value(node.multiply[0])} × {value(node.multiply[1])})"
    if isinstance(node, AddValue):
        return "(" + " + ".join(value(part) for part in node.add) + ")"
    if isinstance(node, SubtractValue):
        return f"({value(node.subtract[0])} − {value(node.subtract[1])})"
    if isinstance(node, DaysBetweenValue):
        return f"the days from {value(node.days_between[0])} to {value(node.days_between[1])}"
    if isinstance(node, FirstPresentValue):
        return " or else ".join(value(part) for part in node.first_present)
    return type(node).__name__


def _literal(literal) -> str:
    if isinstance(literal, str):
        return f'"{literal}"'
    if isinstance(literal, bool):
        return "true" if literal else "false"
    if isinstance(literal, float):
        return f"{literal:g}"
    return str(literal)
