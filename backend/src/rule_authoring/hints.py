"""Why a spec disagrees with an outcome the author confirmed, in words a small model can act on.

"Your spec gives UNABLE_TO_ASSESS, the author says FAIL" tells the drafter that
it is wrong but not what to change, and small models then rewrite at random or
give up. The outcome pair, together with what the spec is built from, usually
points at one concrete fix. Plain code; the hint only advises: the example
itself remains the test the spec must pass.

The hint speaks the language the drafter writes. A drafter writing sheets that is
told about "only_if steps" and "need steps" switches to the full language to follow
the advice, and does worse there (R009 and R010 did, after every correction).
"""

from __future__ import annotations

from rule_engine.language import ForEachStep, NeedStep, Node, OnlyIfStep, RuleSpec, WithinDates

FAIL = "FAIL"
PASS = "PASS"
UNABLE = "UNABLE_TO_ASSESS"
NA = "NOT_APPLICABLE"

# The same advice in the words of each drafting format.
SPEC_WORDS = {
    "check": "require step",
    "a_need": "a need step",
    "applies": "only_if step",
    "an_applies": "an only_if step",
    "present": "is_present and is_missing",
    "move_need": "Put that need step after the only_if step, so it is only tested where the rule applies.",
}
SHEET_WORDS = {
    "check": "check",
    "a_need": 'an entry in the sheet\'s "needs"',
    "applies": '"applies_if" condition',
    "an_applies": 'an "applies_if" condition',
    "present": '"present" and "missing"',
    "move_need": ('Remove it from the sheet\'s "needs" and write "if_missing": "UNABLE_TO_ASSESS" on the check '
                  'that reads it: checks are only tested where "applies_if" holds.'),
}


def explain(expected: str, actual: str, spec: RuleSpec, sheet: bool = False) -> str:
    """One or two sentences on what to change so the spec gives `expected` instead of `actual`."""
    words = SHEET_WORDS if sheet else SPEC_WORDS
    kinds = {type(node) for node in _walk(spec)}
    if expected == FAIL and actual == UNABLE:
        hint = ("This claim lacks some data but also breaks the rule, and the author wants the "
                f"violation to win. A {words['check']} whose condition cannot be decided gives "
                f"UNABLE_TO_ASSESS, so check each part in its own {words['check']}: then the part "
                "that is known to be broken still gives FAIL.")
        if WithinDates in kinds:
            hint += (" within_dates is unknown as soon as one of its three dates is missing: "
                     "replace it with two requires, on_or_after the start and on_or_before the end.")
        if NeedStep in kinds:
            hint += (f" {words['a_need'][0].upper()}{words['a_need'][1:]} stops the rule at the first missing "
                     f"value: use a {words['check']} instead.")
        return hint
    if expected == UNABLE and actual == FAIL:
        return (f"Here missing data must give UNABLE_TO_ASSESS, not FAIL. {words['present']} "
                "turn a missing value into a definite answer; compare the value itself instead "
                "(a comparison on a missing value is unknown), unless the rule says the field is required.")
    if expected == UNABLE and actual == PASS:
        return ("The spec ignores the data this claim lacks. Read the field the case changes, so "
                "that a missing value gives UNABLE_TO_ASSESS.")
    if expected == PASS and actual == UNABLE:
        hint = ("The author says the rule can decide this claim. The spec needs a value the rule "
                "does not need here, or treats it as required.")
        if NeedStep in kinds:
            hint += (f" {words['a_need'][0].upper()}{words['a_need'][1:]} makes every missing value "
                     "UNABLE_TO_ASSESS: keep needs for data the rule cannot do without.")
        return hint
    if expected == FAIL and actual == PASS:
        return ("The spec is too lenient: it must fail this claim. Check the field the case changes, "
                "and whether the boundary should be included (at_most, on_or_before) or excluded "
                "(less_than, before).")
    if expected == PASS and actual == FAIL:
        return ("The spec is too strict: it must pass this claim. Check the boundary on the field "
                "the case changes (at_most includes the limit, less_than excludes it) and exact text values.")
    if expected == NA and actual == UNABLE and _need_before_applies(spec):
        # The applicability test is there, but a need comes first: a value missing where the
        # rule does not apply still stops it (R010: a lab line without a date).
        return (f"The rule does not concern this claim, but {words['a_need']} is tested before the "
                f"{words['applies']}, so a value missing where the rule does not apply still gives "
                f"UNABLE_TO_ASSESS. {words['move_need']}")
    if expected == NA:
        return (f"The rule does not concern this claim: add {words['an_applies']} that is false "
                "for it, so the result is NOT_APPLICABLE.")
    if actual == NA:
        hint = f"The rule concerns this claim, but {words['an_applies']} excludes it: narrow or remove that condition."
        if OnlyIfStep not in kinds:
            hint = f"The rule concerns this claim, but nothing in the spec is checked for it (no {words['check']} applies)."
        return hint
    return ""


def _need_before_applies(spec: RuleSpec) -> bool:
    """A need step that comes before an only_if step of the same block (the rule's or a for_each's)."""
    blocks = [spec.steps] + [node.steps for node in _walk(spec) if isinstance(node, ForEachStep)]
    for steps in blocks:
        kinds = [type(step) for step in steps]
        if NeedStep in kinds and OnlyIfStep in kinds and kinds.index(NeedStep) < kinds.index(OnlyIfStep):
            return True
    return False


def _walk(node: Node):
    pending = [node]
    while pending:
        current = pending.pop()
        yield current
        for name in type(current).model_fields:
            child = getattr(current, name)
            children = child if isinstance(child, list) else [child]
            pending.extend(item for item in children if isinstance(item, Node))
