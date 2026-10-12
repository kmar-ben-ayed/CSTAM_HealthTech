"""Questions to the author about missing and unknown data, one per situation.

Drafts that pass every check are most often wrong on what missing or unknown data gives:
every error R009 made on 2026-10-12 was one (an unknown service code gave NOT_APPLICABLE
instead of UNABLE_TO_ASSESS, a line without its authorization_id FAIL), and R010's last draft
required a date on lines it did not apply to. The test-claim table shows those claims, but
corrected one field at a time they take a drafting round each, and a sentence such as
"unknown service codes leave UNABLE_TO_ASSESS" was never implemented in five drafts.

So once a draft passes the checks, its test claims that make a value missing or unknown are
grouped into a few situations, and the author is asked once per situation:

1. a value that decides whether the rule applies (an applies_if / only_if condition reads it)
   is missing or unknown: whether the claim would otherwise apply cannot matter;
2. a value the rule checks is missing, or is a code the reference files do not know, on a
   claim the draft applies to, per list (a claim field, a line, a record of another list such
   as an authorization). Missing and unknown are asked apart here: for a checked value an
   unknown code is often just a mismatch (R006 passes it, R010 fails an attachment with it);
3. the same on a claim the draft does not otherwise apply to;
4. a whole list is empty (no authorizations, no attachments);
5. a value is missing (or a code unknown) while another value breaks the rule: does the
   violation win (FAIL) or the missing data (UNABLE_TO_ASSESS)? In collection run 2 these
   combined test claims, corrected one round at a time, took most of the 47 minutes spent
   after a deployable draft existed (R003: 15 minutes, right on every official claim at 0.1).

"Unknown" is a code the reference files do not have: an unknown service code, policy,
provider or diagnosis. One answer becomes a test for every claim of the situation. "It
depends" adds no test: those claims stay in the table, one by one.

On the drafts the hard rules failed with (2026-10-12), these questions cover R009's unknown
service code and its line without an authorization_id, and R010's date required on a line
it does not apply to. A record of another list missing a field is usually "it depends" (the
record's id missing means no record, FAIL; another field missing, UNABLE_TO_ASSESS).
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from rule_engine.catalogue import ReferenceData

from .edge_cases import change_kind
from .sheet import CODE_SOURCES, OUTCOMES_FOR

IT_DEPENDS = "IT_DEPENDS"
MAX_SITUATIONS = 8
_MISSING = {"missing", "blank"}
_LISTS = {"lines", "authorizations", "attachments"}
_NEW_VALUE = re.compile(r' = ("(?:[^"\\]|\\.)*"|null|-?\d[\d.]*) \(')


@dataclass
class Situation:
    text: str  # the situation in plain words, completing "What should the rule decide when ...?"
    cases: list[Any]  # the draft's test claims in it (CaseOutcome: case_id, description, spec_status, claim, field)
    group: int = 0  # 1 to 5, as above
    changes: dict[str, str] = field(default_factory=dict)  # case_id -> "missing", "unknown", ...
    bases: dict[str, str] = field(default_factory=dict)  # case_id -> the drafted outcome of the claim unchanged


def situations(cases: list[Any], applicability_fields: set[str], reference: ReferenceData,
               limit: int = MAX_SITUATIONS) -> list[Situation]:
    """The missing- and unknown-data situations of a draft's test claims, in the order above."""
    known = {
        "service_code": set(reference.services), "policy_id": set(reference.policies),
        "provider_id": set(reference.provider_ids), "diagnosis_code": set(reference.diagnosis_codes),
    }
    unchanged = {case.description.removesuffix(" unchanged"): case.spec_status
                 for case in cases if case.description.endswith(" unchanged")}
    applies = {base: status != "NOT_APPLICABLE" for base, status in unchanged.items()}
    groups: dict[tuple, list[Any]] = {}
    changes: dict[str, str] = {}
    for case in cases:
        change = _change(case, known)
        base = case.description.split(":", 1)[0]
        if change is None or base not in applies:
            continue  # a combined case, an unchanged claim or another kind of change
        changes[case.case_id] = change
        scope = _scope(case.field)
        if change == "combined":
            missing_field = _independent_missing_part(case)
            if missing_field is None:
                continue  # the violation depends on the missing value: no violation is known
            key = (5, applies[base], _scope(missing_field))
        elif change == "emptied":
            key = (4, scope, applies[base])
        elif case.field in applicability_fields:
            key = (1,)
        else:
            key = (2 if applies[base] else 3, scope, change)
        groups.setdefault(key, []).append(case)
    ordered = sorted(groups.items(), key=lambda item: (item[0][0], -len(item[1])))  # stable within a size
    return [Situation(_describe(key, cases), cases, key[0], {case.case_id: changes[case.case_id] for case in cases},
                      {case.case_id: unchanged[case.description.split(":", 1)[0]] for case in cases})
            for key, cases in ordered[:limit]]


# The situations the rule text's "outcomes" table can decide, and the kind of condition that
# reads the changed value there: a value deciding whether the rule applies (1), a value checked
# on a claim it applies to (2).
_TABLE_DECIDES = {1: "applies_if", 2: "checks"}


def decided_by_text(situation: Situation, table: dict[str, str]) -> list[str]:
    """The entries of the rule text's "outcomes" table (sheet.py; entry -> outcome, quotes
    already checked) that decide every test claim of this situation, when the draft gives
    each the outcome its entry says: the text has already answered the question, so it is not
    asked. Empty when they do not.

    Only a single value missing or unknown, on the claim or a line, of a claim the draft does not
    otherwise fail: with a violation elsewhere the outcome depends on more than the sentence. (A
    claim already unable to be assessed stays so, or fails, but is not made not applicable by
    one line.) Records of other lists, emptied lists, claims the rule does not apply to (for a
    checked value) and combined changes are still asked."""
    kind = _TABLE_DECIDES.get(situation.group)
    if kind is None or not table or not situation.cases:
        return []
    bases = ("PASS", "NOT_APPLICABLE", "UNABLE_TO_ASSESS") if kind == "applies_if" else ("PASS", "UNABLE_TO_ASSESS")
    used: list[str] = []
    for case in situation.cases:
        name = case.field.rsplit("/", 1)[-1]
        base = situation.bases.get(case.case_id)
        if _scope(case.field) not in ("claim", "lines") or base not in bases:
            return []
        entry = _table_entry(kind, situation.changes.get(case.case_id), name, table)
        if entry is None or table[entry] not in OUTCOMES_FOR[kind] or case.spec_status != table[entry]                 or (base == "UNABLE_TO_ASSESS" and table[entry] == "NOT_APPLICABLE"):
            return []
        used.append(entry)
    return list(dict.fromkeys(used))


def _table_entry(kind: str, change: str | None, name: str, table: dict[str, str]) -> str | None:
    """The table entry that says what this change gives (as the sheet compiler applies it)."""
    unknown = "unknown_policy" if name == "policy_id" else "unknown_code" if name in CODE_SOURCES else None
    if change == "unknown":
        return unknown if unknown in table else None
    if change == "missing":
        own = f"missing_in_{kind}"
        return own if own in table else unknown if unknown in table else None
    return None


def _change(case: Any, known: dict[str, set[str]]) -> str | None:
    if " + " in case.field:
        # The generator pairs a change that leaves the draft unable to assess with one that
        # breaks it: a missing value and a violation in the same claim.
        return "combined"
    if not case.field:
        return None
    kind = change_kind(case.description)
    if kind.endswith(" emptied"):
        return "emptied"
    if kind in _MISSING:
        return "missing"
    if kind.startswith("unknown "):
        return "unknown"
    name = case.field.rsplit("/", 1)[-1]
    value = _new_value(case.description)
    if name in known and isinstance(value, str) and value and value not in known[name]:
        return "unknown"  # "SVC-LAB-OTHER (a different value)" is a code services.json does not have
    return None


def _independent_missing_part(case: Any) -> str | None:
    """The field a combined test claim leaves missing (or unknown), when the other change breaks
    the rule on its own. None when the violation is measured against the missing value ("end
    date one day before the service date" with the service date missing breaks nothing known)."""
    fields = case.field.split(" + ")
    changes = case.description.split(": ", 1)[-1].split(", and ")
    if len(fields) != 2 or len(changes) != 2:
        return None
    kinds = [change_kind(change) for change in changes]
    missing = [index for index, kind in enumerate(kinds)
               if kind in _MISSING or kind.startswith("unknown ") or kind.endswith(" emptied")]
    if len(missing) != 1:
        return None
    gone, other = fields[missing[0]], changes[1 - missing[0]]
    return None if f"relative to {gone}" in other else gone


def _new_value(description: str) -> Any:
    match = _NEW_VALUE.search(description)
    if match is None:
        return None
    try:
        return json.loads(match.group(1))
    except ValueError:
        return None


def _scope(path: str) -> str:
    """The claim, or the list whose elements the field belongs to ("lines", "authorizations")."""
    first = path.strip("/").split("/")[0]
    return first if first in _LISTS else "claim"


def _describe(key: tuple, cases: list[Any]) -> str:
    if key[0] == 5:
        missing = _join(sorted({_independent_missing_part(case).rsplit("/", 1)[-1] for case in cases}))
        context = "the drafted rule applies to" if key[1] else "the drafted rule does not otherwise apply to"
        where = {"claim": "the claim", "lines": "a line"}.get(key[2], f"a record in {key[2]}")
        return (f"a claim {context} breaks the rule on one value while {where} lacks another ({missing}: "
                f"missing, or a code the reference files do not know): does the violation win (FAIL) or the "
                f"missing data (UNABLE_TO_ASSESS)")
    names = _join(sorted({case.field.rsplit("/", 1)[-1] for case in cases}))
    if key[0] == 1:
        return f"a value that decides whether the rule applies is missing or unknown ({names})"
    if key[0] == 4:
        _, scope, applies = key
        context = "the drafted rule applies to" if applies else "the drafted rule does not otherwise apply to"
        return f"a claim {context} has no {scope} at all"
    _, scope, change = key
    context = "the drafted rule applies to" if key[0] == 2 else "the drafted rule does not otherwise apply to"
    if scope == "claim":
        what = ("is missing a value the rule checks" if change == "missing"
                else "has a code the reference files do not know")
    else:
        holder = "a line" if scope == "lines" else f"a record in {scope}"
        what = (f"has {holder} missing a value the rule checks" if change == "missing"
                else f"has {holder} with a code the reference files do not know")
    return f"a claim {context} {what} ({names})"


def _join(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " or " + names[-1]


IT_DEPENDS_OPTION = "It depends: these claims need different outcomes"


def question_text(situation: Situation) -> str:
    drafted = Counter(case.spec_status for case in situation.cases)
    count = len(situation.cases)
    if len(drafted) == 1:
        says = f"{next(iter(drafted))} for {'it' if count == 1 else f'all {count}'}"
    else:
        says = ", ".join(f"{outcome} for {number}" for outcome, number in drafted.most_common())
    return (f"What should the rule decide when {situation.text}? For example: "
            f"\"{situation.cases[0].description}\". The drafted rule gives {says}. "
            f"Your answer becomes a test for {'this test claim' if count == 1 else f'all {count} such test claims'}.")


def read_answer(answer: str, outcomes: tuple[str, ...]) -> str | None:
    """An outcome, IT_DEPENDS, or None for an answer that is neither."""
    text = answer.strip()
    if text.upper() in outcomes:
        return text.upper()
    if text.upper().replace(" ", "_").startswith(IT_DEPENDS) or text == IT_DEPENDS_OPTION:
        return IT_DEPENDS
    return None
