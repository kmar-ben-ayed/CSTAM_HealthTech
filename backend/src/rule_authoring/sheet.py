"""The rule sheet: a short, flat way to write most payer rules, compiled into a spec by code.

A small model writes a nested spec badly: brackets, loop names, where each
value goes. A sheet asks for much less. It lists flat checks over the claim's
fields, written as the field list shows them, and code does the rest:

    {"applies_if": [{"value": "/lines/*/service_code", "is": "equals", "to": "SVC-PHARM"}],
     "checks": [{"value": "/lines/*/quantity", "is": "between", "to": [1, 10]}]}

- A field of a list element (/lines/*/quantity) makes the check run for every
  element of that list; the compiler writes the for_each and names its variables.
- Every check is its own require step, so a check that is known to be broken
  fails the rule even when another check lacks data.
- A check whose data is missing gives UNABLE_TO_ASSESS, except "present", which
  fails when the value is missing.
- applies_if conditions that do not hold give NOT_APPLICABLE.

What a sheet cannot say (matching records against each other, ...) is written
in the full rule language instead. A compiled sheet is parsed and checked like
any other spec.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from rule_engine.catalogue import DATE, FieldCatalogue

LISTS = {"lines": "line", "attachments": "doc", "authorizations": "auth"}
NUMBER_COMPARISONS = ("at_most", "at_least", "less_than", "greater_than")
DATE_COMPARISONS = ("on_or_before", "on_or_after", "before", "after", "same_day")
COMPARISONS = (
    "present", "missing", "equals", "not_equals", *NUMBER_COMPARISONS, *DATE_COMPARISONS,
    "between", "one_of", "not_one_of", "same_amount", "whole_number", "unique", "has_match",
)
NEEDS_NO_TARGET = ("present", "missing", "whole_number", "unique", "has_match")
OUTCOMES_WHEN_UNMET = ("FAIL", "UNABLE_TO_ASSESS")  # "otherwise" of a check
# What a condition gives when a value it reads is missing ("if_missing") or a code it reads is
# not in the reference files ("if_unknown"), written next to the condition, as rule texts say it
# ("unknown service codes leave UNABLE_TO_ASSESS"). Without them the outcome depended on where a
# condition sat (needs before or after applies_if, where or then), and nearly every error the
# hard rules made on 2026-10-12 was a condition in the wrong place.
OUTCOME_KEYS = ("if_missing", "if_unknown")
OUTCOMES_FOR = {"applies_if": ("UNABLE_TO_ASSESS", "NOT_APPLICABLE"), "checks": ("UNABLE_TO_ASSESS", "FAIL"),
                # A need gives UNABLE_TO_ASSESS: the keys only say it for missing values and unknown
                # codes too (drafters wrote them on needs 6 times in collection run 2, meaning just that).
                "needs": ("UNABLE_TO_ASSESS",)}
# Coded fields and the reference file that lists their known values.
CODE_SOURCES = {"service_code": "services", "provider_id": "providers", "diagnosis_code": "diagnoses"}
# The sheet's "outcomes" table: what the rule text itself says missing data and unknown codes
# give, each entry quoting the sentence that says it. Code writes each outcome onto every
# condition that reads such a value and says nothing itself (a condition's own if_missing /
# if_unknown replace the table for it), so the drafter writes only the comparisons, and one
# sentence is implemented wherever it applies. R009 (2026-10-12) left "unknown service/policy
# ... leaves UNABLE_TO_ASSESS" out of five drafts in a row, and every error it made was missing
# or unknown data; written per condition, such sentences took the admin a round each.
OUTCOME_TABLE = {
    "missing_in_checks": ("UNABLE_TO_ASSESS", "FAIL"),  # a value a check reads is missing
    "missing_in_applies_if": ("UNABLE_TO_ASSESS", "NOT_APPLICABLE"),  # a value applies_if reads is missing
    "unknown_code": ("UNABLE_TO_ASSESS", "FAIL", "NOT_APPLICABLE"),  # a service, provider or diagnosis code the files lack
    "unknown_policy": ("UNABLE_TO_ASSESS", "FAIL", "NOT_APPLICABLE"),  # the claim's policy is not in policies.json
}
OUTCOMES_FORMAT = ('"outcomes" is {"<entry>": {"outcome": ..., "quote": "the rule text\'s words that say it"}}, with '
                   f'entries {", ".join(OUTCOME_TABLE)}')
# What a quote must speak of, beyond being the rule text's own words: a quote that does not is
# filed under the wrong entry (an unavailable policy is not an unknown provider code).
_MISSING_WORDS = ("missing", "absent", "absence", "null", "empty", "blank", "unknown", "unavailable", "invalid",
                  "without", "lack", "not present", "not supplied", "not provided", "not given")
_SPEAKS_OF = {
    "missing_in_checks": (_MISSING_WORDS,),
    "missing_in_applies_if": (_MISSING_WORDS,),
    "unknown_code": (("unknown", "unlisted", "not listed", "not in ", "unrecognised", "unrecognized", "invalid"),
                     ("code", "service", "provider", "diagnos")),
    "unknown_policy": (("polic",), ("unknown", "unavailable", "missing", "absent", "not found", "not in ", "invalid",
                                    "no polic")),
}
_OUTCOME_WORDS = {"UNABLE_TO_ASSESS": ("unable", "assess"), "FAIL": ("fail",),
                  "NOT_APPLICABLE": ("not_applicable", "not applicable", "does not apply")}
_SPEAKS_OF_TEXT = {"missing_in_checks": "a missing value", "missing_in_applies_if": "a missing value",
                   "unknown_code": "an unknown service, provider or diagnosis code",
                   "unknown_policy": "an unknown or unavailable policy"}
CONFIG_SOURCES = ("services", "providers", "diagnoses")
AGGREGATES = ("sum", "latest", "earliest")
ARITHMETIC = ("multiply", "add", "subtract", "days_between")
MAX_CHECKS = 12
MONEY_TOLERANCE = 0.01  # same_amount: equal to the cent, as money is rounded to 2 decimals

_DATE_TEXT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LIST_PATH = re.compile(r"^/(?P<list>lines|attachments|authorizations)(?:/(?:\*|\[\*?\]))?/(?P<rest>[a-z_][a-z0-9_/]*)$")
_LIST_ITSELF = re.compile(r"^/(?P<list>lines|attachments|authorizations)(?:/\*|/\[\*?\])?$")

SHEET_FORMAT = (
    'A sheet is {"outcomes": {...} (optional), "needs": [V, ...] (optional), "applies_if": [check, ...] (optional), '
    '"checks": [check, ...]}, where a check is {"value": V, "is": comparison, "to": V} and a value V '
    'is a field path ("/total_amount", "/lines/*/quantity"), a fixed number, text or date, or one of '
    '{"policy": name, "for": V}, {"catalogue": "services", "for": V, "get": name}, {"count": "/lines"}, '
    '{"sum": V}, {"latest": V}, {"earliest": V}, {"days_between": [V, V]}, {"multiply": [V, V]}, '
    '{"add": [V, V]}, {"subtract": [V, V]}, {"first_present": [V, V]}; sum and count also take '
    '"where" (a filter) and "group_by" (only the elements sharing this element\'s value of a field). '
    f"Comparisons: {', '.join(COMPARISONS)}."
)
GROUP_EXAMPLE = '{"value": {"sum": "/lines/*/quantity", "group_by": "authorization_id"}, "is": "at_most", "to": 10}'


class SheetError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _same_list(name: str, inside: str = "has_match") -> str:
    """A check searching the list it goes through. In collection run 2, R006 (duplicate lines)
    was only told it could not, asked twice how to compare lines, and gave up as "unsupported"
    with a draft right on every official claim behind it."""
    where = ('"has_match" searches another list for a record: inside it, both sides of /{name}/*/... mean the element '
             'being tried' if inside == "has_match" else
             'inside the "where" of a count or sum over /{name}, both sides of /{name}/*/... mean the element being '
             'counted (a field always equals itself)').format(name=name)
    return (f'{where}, so it cannot compare one of the {name} with another. To find {name} that repeat (two with '
            f'the same values in some fields), use {{"value": ["/{name}/*/<field>", "/{name}/*/<other field>"], '
            f'"is": "unique"}}; write a field {{"first_present": ["/{name}/*/<field>", ""]}} to count a missing value '
            f'as blank')


def _compares_itself(where: Any, name: str) -> bool:
    """A "where" condition comparing a field of the filtered list with that same field: both sides
    are the element being counted, so it always holds (R006, speed1: counted lines whose service
    code equals their service code, and every claim passed)."""
    def reads(raw: Any) -> bool:
        return name in json.dumps(raw)
    return isinstance(where, list) and any(
        isinstance(condition, dict) and condition.get("is") in ("equals", "not_equals", "same_day", "same_amount")
        and reads(condition.get("value")) and json.dumps(condition.get("value"), sort_keys=True)
        == json.dumps(condition.get("to"), sort_keys=True) for condition in where)


def _compares_within(where: Any, name: str) -> bool:
    """A "where" condition comparing a field of the searched list with a field of the same list."""
    def reads(raw: Any) -> bool:
        return isinstance(raw, str) and bool(match := _LIST_PATH.match(raw)) and match["list"] == name
    return isinstance(where, list) and any(
        isinstance(condition, dict) and reads(condition.get("value")) and reads(condition.get("to")) for condition in where)


def _misplaced_otherwise(kind: str, otherwise: str) -> str:
    """Where a condition goes for the outcome its "otherwise" asks for."""
    if otherwise not in OUTCOMES_WHEN_UNMET:
        if kind == "applies_if":
            return ('applies_if already gives NOT_APPLICABLE when a condition does not hold: remove "otherwise". For '
                    'missing data or an unknown code, add "if_missing" or "if_unknown" to the condition')
        return ('a need gives UNABLE_TO_ASSESS when it does not hold; for NOT_APPLICABLE, make it an applies_if '
                'condition (without "otherwise")')
    if kind == "needs" and otherwise == "UNABLE_TO_ASSESS":
        return 'a need already gives UNABLE_TO_ASSESS when it does not hold: keep the need and remove "otherwise"'
    if otherwise == "UNABLE_TO_ASSESS":
        return ('applies_if gives NOT_APPLICABLE when a condition does not hold. For UNABLE_TO_ASSESS when a value it '
                'reads is missing or a code unknown, add "if_missing" or "if_unknown": "UNABLE_TO_ASSESS" to the '
                'condition; for UNABLE_TO_ASSESS whenever this one does not hold, move it to "needs" (without "otherwise")')
    where = "applies_if" if kind == "applies_if" else "needs"
    gives = "NOT_APPLICABLE" if kind == "applies_if" else "UNABLE_TO_ASSESS"
    return (f'{where} gives {gives} when a condition does not hold. To FAIL when this one does not hold, move it '
            'to "checks" (a check FAILS when it does not hold)')


# Why an "outcomes" entry applies to no condition, and how to make it apply. R008 (speed2) quoted
# "unknown service codes ... leave UNABLE_TO_ASSESS" but read the codes only inside a count, so
# the entry applied nowhere, silently, and exactly those claims were wrong.
_UNUSED_OUTCOME = {
    "missing_in_checks": "no check reads a value directly",
    "missing_in_applies_if": "no applies_if condition reads a value directly",
    "unknown_code": "no condition reads a service, provider or diagnosis code directly",
    "unknown_policy": "no condition reads the claim's policy",
}


def _unused_outcome(entry: str) -> str:
    return (f'outcomes.{entry} applies to nothing: {_UNUSED_OUTCOME[entry]} (values read only inside count, sum, '
            f'latest or earliest are not covered). Write the condition about each element, e.g. '
            f'{{"value": "/lines/*/service_code", ...}} in applies_if or checks rather than a count of lines, so the '
            f'outcome applies to it; or leave the entry out')


def is_sheet(raw: Any) -> bool:
    return isinstance(raw, dict) and "checks" in raw and "steps" not in raw


def read_outcomes(raw: Any) -> dict[str, str]:
    """A sheet's "outcomes" table (entry -> outcome). Raises SheetError when it is malformed."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SheetError([OUTCOMES_FORMAT])
    table: dict[str, str] = {}
    problems: list[str] = []
    for name, entry in raw.items():
        if name not in OUTCOME_TABLE:
            problems.append(f'unknown "outcomes" entry "{name}": the entries are {", ".join(OUTCOME_TABLE)}')
        elif not isinstance(entry, dict) or set(entry) - {"outcome", "quote"} or not isinstance(entry.get("quote"), str) \
                or not entry["quote"].strip():
            problems.append(f'outcomes.{name} is {{"outcome": ..., "quote": "the rule text\'s words that say it"}}')
        elif entry.get("outcome") not in OUTCOME_TABLE[name]:
            problems.append(f'outcomes.{name}: "outcome" is one of {", ".join(OUTCOME_TABLE[name])}' + (
                " (a check cannot make the rule not applicable: that is missing_in_applies_if)"
                if name == "missing_in_checks" else
                " (applies_if decides whether the rule applies: to FAIL, that is missing_in_checks)"
                if name == "missing_in_applies_if" else ""))
        else:
            table[name] = entry["outcome"]
    if problems:
        raise SheetError(problems)
    return table


def _plain(text: str) -> str:
    return " ".join(text.lower().replace("’", "'").replace("‘", "'").split())


def outcome_quote_problems(raw: Any, text: str) -> list[str]:
    """The entries of an "outcomes" table whose quote is not the rule text's own words, or does
    not speak of what its entry is about or of its outcome. (Its form is read_outcomes'.)"""
    if not isinstance(raw, dict):
        return []
    plain = _plain(text)
    problems = []
    for name, entry in raw.items():
        if name not in OUTCOME_TABLE or not isinstance(entry, dict) or not isinstance(entry.get("quote"), str):
            continue
        # "..." leaves words out: each piece must be in the text, in order.
        pieces = [piece for piece in (_plain(part).strip(" .,;:\"'") for part in re.split(r"\.\.\.|…", entry["quote"]))
                  if piece]
        position, found = 0, bool(pieces)
        for piece in pieces:
            at = plain.find(piece, position)
            if at < 0:
                found = False
                break
            position = at + len(piece)
        if not found or sum(len(piece.split()) for piece in pieces) < 3:
            # R009 (speed1) quoted the admin's questions twice: their answers are tests already.
            problems.append(f'outcomes.{name}: "quote" must be words copied from the rule text (rule.logic), at least '
                            f'three (not found: "{entry["quote"][:120]}"). The author\'s answers and examples are not '
                            f'quotes: the sheet must already reproduce them. Leave the entry out when the rule text '
                            f'says nothing about {_SPEAKS_OF_TEXT[name]}')
            continue
        said = " ".join(pieces)
        outcome = entry.get("outcome")
        if not all(any(word in said for word in words) for words in _SPEAKS_OF[name]):
            problems.append(f'outcomes.{name}: the quote "{entry["quote"][:120]}" does not speak of '
                            f'{_SPEAKS_OF_TEXT[name]}; quote the sentence that does, or leave the entry out')
        elif outcome in _OUTCOME_WORDS and not any(word in said for word in _OUTCOME_WORDS[outcome]):
            problems.append(f'outcomes.{name}: the quote "{entry["quote"][:120]}" does not say {outcome}; quote the '
                            f'words that say what {_SPEAKS_OF_TEXT[name]} gives')
    return problems


def quoted_outcomes(raw: Any, text: str) -> dict[str, str]:
    """The entries of an "outcomes" table that are well formed and quote the rule text."""
    if not isinstance(raw, dict):
        return {}
    table = {}
    for name, entry in raw.items():
        try:
            outcome = read_outcomes({name: entry}).get(name)
        except SheetError:
            continue
        if outcome is not None and not outcome_quote_problems({name: entry}, text):
            table[name] = outcome
    return table


REFERENCE_SHEETS = Path(__file__).resolve().parent / "reference_sheets.json"


@lru_cache(maxsize=1)
def reference_sheets() -> dict[str, dict[str, Any]]:
    """Proven sheets of catalogue rules (rule id -> sheet), shown to the drafter as examples."""
    return json.loads(REFERENCE_SHEETS.read_text(encoding="utf-8"))["sheets"]


def compile_sheet(sheet: Any, fields: FieldCatalogue, title: str = "the rule") -> dict[str, Any]:
    """The spec (as JSON) a sheet stands for. Raises SheetError with readable problems."""
    if not isinstance(sheet, dict):
        raise SheetError([f"the sheet must be an object. {SHEET_FORMAT}"])
    unknown = set(sheet) - {"needs", "applies_if", "checks", "messages", "outcomes"}
    if unknown:
        raise SheetError([f"unknown sheet keys {sorted(unknown)}. {SHEET_FORMAT}"])
    checks = sheet.get("checks")
    applies = sheet.get("applies_if", [])
    needs = sheet.get("needs", [])
    if not isinstance(checks, list) or not checks:
        raise SheetError([f"checks must be a non-empty list. {SHEET_FORMAT}"])
    if not isinstance(applies, list) or not isinstance(needs, list):
        raise SheetError(["applies_if and needs must be lists"])
    if len(checks) + len(applies) + len(needs) > MAX_CHECKS:
        raise SheetError([f"at most {MAX_CHECKS} needs, conditions and checks in one sheet"])
    compiler = _Compiler(fields, read_outcomes(sheet.get("outcomes")))

    problems: list[str] = []
    claim_level: list[dict[str, Any]] = []
    per_list: dict[str, list[dict[str, Any]]] = {}
    # A sheet's need is a value that must be present, or a condition that must hold.
    entries = [("needs", need if isinstance(need, dict) and "is" in need else {"value": need, "is": "present"})
               for need in needs]
    entries += [("applies_if", check) for check in applies] + [("checks", check) for check in checks]
    for position, (kind, check) in enumerate(entries):
        try:
            scope = compiler.scope_of(check)
            steps = compiler.steps(check, kind, {scope: LISTS[scope]} if scope else {})
        except SheetError as error:
            problems += [f"{kind}: {problem}" for problem in error.problems]
            continue
        (per_list.setdefault(scope, []) if scope else claim_level).extend(steps)
    if problems:
        raise SheetError(problems)
    unused = [entry for entry in compiler.table if entry not in compiler.table_used]
    if unused:
        raise SheetError([_unused_outcome(entry) for entry in unused])
    for name, steps in per_list.items():
        if not any("require" in step for step in steps):
            raise SheetError([f"needs or applies_if read every {LISTS[name]}, so checks must test each "
                              f"{LISTS[name]} too: read a field of each {LISTS[name]} in a check, or for has_match "
                              f'add "value": "/{name}/*"'])

    # Each level (the claim, then each list's elements) runs its needs (missing data:
    # UNABLE_TO_ASSESS), then its applies_if (NOT_APPLICABLE), then its checks.
    ordered = _in_order(claim_level)
    for name, steps in per_list.items():
        ordered.append({"for_each": {"path": f"/{name}"}, "as": LISTS[name], "steps": _in_order(steps)})
    return {"language_version": 2, "steps": ordered, "messages": _messages(sheet.get("messages"), title)}


def _in_order(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The sheet's needs, then applies_if, then the checks' own needs and the records they
    look up, then the checks."""
    early = [step for step in steps if "need" in step and not step.get(_LATE)]
    late = [{key: value for key, value in step.items() if key != _LATE}
            for step in steps if step.get(_LATE) and ("need" in step or "let" in step)]
    return early + [step for step in steps if "only_if" in step] + late + [step for step in steps if "require" in step]


_LATE = "_after_applies_if"  # marks a check's own needs while the steps are ordered


class _Compiler:
    def __init__(self, fields: FieldCatalogue, table: dict[str, str] | None = None):
        self.fields = fields
        self.table = table or {}  # the sheet's "outcomes" (entry -> outcome)
        self.in_lookup = False  # compiling the checks on a record found ("then")
        self.table_used: set[str] = set()  # the table's entries some condition reads a value for
        self.counter = 0
        # The keys of grouped totals in the check being compiled: (this element's key, its field).
        self.group_keys: list[tuple[str, str]] = []

    # ---------------------------------------------------------------- scope

    def scope_of(self, check: Any) -> str | None:
        """The list whose elements the check reads one by one, if any."""
        if not isinstance(check, dict):
            raise SheetError([f"a check must be an object like {{\"value\": ..., \"is\": ..., \"to\": ...}}"])
        lists = self._elements_read(check.get("value")) | self._elements_read(check.get("to"))
        lists |= self._elements_read(check.get("needs"))
        if check.get("is") == "unique":
            lists = set()  # unique compares the elements with each other: a claim-level check
        if check.get("is") == "has_match":
            # The elements of the searched list are matched inside; the check runs for
            # each element of the other list its conditions read (e.g. each line).
            searched = self._searched_list(check)
            value = check.get("value")
            lists = {match["list"]} if isinstance(value, str) and (match := _LIST_ITSELF.match(value)) else set()
            for condition in (check.get("where") or []) + (check.get("then") or []):
                if isinstance(condition, dict):
                    lists |= self._elements_read(condition.get("value")) | self._elements_read(condition.get("to"))
            lists |= self._elements_read(check.get("needs"))
            lists -= {searched}
        if len(lists) > 1:
            # Comparing an element with its record in another list is a lookup: say how to write it.
            each, other = sorted(lists, key=lambda name: name != "lines")
            raise SheetError([
                f"one check cannot read the elements of two lists ({', '.join(sorted(lists))}). To compare each "
                f"{LISTS[each]} with its record in /{other}, look that record up and put the check in \"then\": "
                f'{{"is": "has_match", "in": "/{other}", "where": [<how a {LISTS[each]} names its {LISTS[other]}>], '
                f'"then": [<this check>]}}; inside "then", /{other}/*/... is the record found'])
        return next(iter(lists), None)

    def _elements_read(self, operand: Any) -> set[str]:
        if isinstance(operand, str) and (match := _LIST_PATH.match(operand)):
            return {match["list"]}
        if isinstance(operand, list):
            return set().union(*(self._elements_read(item) for item in operand)) if operand else set()
        if isinstance(operand, dict):
            if set(operand) & set(AGGREGATES) or "count" in operand:
                inner = operand.get("sum", operand.get("latest", operand.get("earliest", operand.get("count"))))
                own = self._lists_named(inner)
                read = self._elements_read(inner) - own
                # A filter that compares with another list's element ("the authorizations whose id
                # is this line's authorization_id") makes the check run for each such element.
                for condition in operand.get("where") or []:
                    if isinstance(condition, dict):
                        read |= (self._elements_read(condition.get("value")) | self._elements_read(condition.get("to"))) - own
                if operand.get("group_by") is not None:
                    # A total per group is taken for each element (its group): the check runs per element.
                    read |= own
                return read
            return set().union(*(self._elements_read(value) for value in operand.values())) if operand else set()
        return set()

    def _lists_named(self, operand: Any) -> set[str]:
        found = set()
        if isinstance(operand, str):
            for pattern in (_LIST_PATH, _LIST_ITSELF):
                if match := pattern.match(operand):
                    found.add(match["list"])
        elif isinstance(operand, (list, dict)):
            for item in operand.values() if isinstance(operand, dict) else operand:
                found |= self._lists_named(item)
        return found

    # ---------------------------------------------------------------- checks

    def steps(self, check: dict[str, Any], kind: str, scope: dict[str, str]) -> list[dict[str, Any]]:
        comparison = check.get("is")
        if comparison not in COMPARISONS:
            raise SheetError([f'"is" must be one of: {", ".join(COMPARISONS)}'])
        allowed = {"value", "is", "to", "note", "otherwise", "needs", *OUTCOME_KEYS} | (
            {"in", "where", "then"} if comparison == "has_match" else set())
        extra = set(check) - allowed
        if extra:
            raise SheetError([f"unknown keys {sorted(extra)} in a check: use value, is and to"
                              + (' (and "in", "where" for has_match)' if comparison == "has_match" else "")])
        if "value" not in check and comparison != "has_match":
            raise SheetError(['a check needs "value"'])
        if comparison not in NEEDS_NO_TARGET and "to" not in check:
            raise SheetError([f'"{comparison}" needs "to"'])
        otherwise = check.get("otherwise", "FAIL")
        if kind != "checks" and "otherwise" in check:
            # "otherwise" outside checks says what the drafter wants when the condition does not
            # hold: point to the part that does that. R009 (2026-10-12) wrote "otherwise":
            # "UNABLE_TO_ASSESS" in applies_if, was told to keep the condition and drop otherwise,
            # and lost 299 claims; on a need it was told only "for checks", and dropped a right need.
            # (Checked before the value: R010 wrote "otherwise": "NOT_APPLICABLE" in applies_if and
            # was told the values otherwise takes, as if it belonged there.)
            raise SheetError([_misplaced_otherwise(kind, otherwise)])
        if otherwise not in OUTCOMES_WHEN_UNMET:
            raise SheetError([f'"otherwise" is one of {", ".join(OUTCOMES_WHEN_UNMET)}'])
        own_needs = check.get("needs", [])
        if not isinstance(own_needs, list) or (kind != "checks" and own_needs):
            raise SheetError(['a check\'s "needs" is a list of values, for checks only'])
        # A check's own needs: tested after applies_if, so only for the claims or lines the
        # rule concerns (if one is missing there, UNABLE_TO_ASSESS).
        late_needs = [{"need": self.need_condition(value, scope), "note": f"needs {_short(value)}"[:200], _LATE: True}
                      for value in own_needs]
        guards = self.outcome_guards(check, kind, scope)
        if comparison == "present" and "if_missing" in check:
            return late_needs + guards  # "present, and if it is missing: X" is the guard itself
        if comparison == "has_match" and "then" in check:
            if kind != "checks":
                raise SheetError(['"then" is for checks only'])
            return late_needs + guards + self.lookup(check, scope, otherwise)
        outer_keys, self.group_keys = self.group_keys, []
        try:
            conditions = self.conditions(check, scope)
            grouped = self.group_keys
        finally:
            self.group_keys = outer_keys
        if grouped and kind != "checks":
            raise SheetError(['"group_by" is for checks (a total per authorization, per day...), not applies_if or needs'])
        # Without this element's key its group is unknown (not an empty group with a total of 0).
        late_needs += [{"need": {"op": "is_present", "value": {"path": mine}}, "note": f"needs {field} to group by"[:200],
                        _LATE: True} for mine, field in dict.fromkeys(grouped)]
        note = check.get("note") if isinstance(check.get("note"), str) else (
            f"has a matching record in {check.get('in')}" if comparison == "has_match" else _describe(check))
        if kind == "needs":
            condition = conditions[0] if len(conditions) == 1 else {"op": "all_of", "items": conditions}
            needed = _short(check["value"]) if comparison == "present" else _describe(check)
            return guards + [{"need": condition, "note": f"needs {needed}"[:200]}]
        if kind == "applies_if":
            condition = conditions[0] if len(conditions) == 1 else {"op": "all_of", "items": conditions}
            return guards + [{"only_if": condition, "note": note[:200]}]
        return late_needs + guards + [{"require": condition, "otherwise": otherwise, "note": note[:200]}
                                      for condition in conditions]

    def outcome_guards(self, check: dict[str, Any], kind: str, scope: dict[str, str]) -> list[dict[str, Any]]:
        """The steps that give a condition's "if_missing" and "if_unknown" outcomes (or, when it has
        neither, the sheet's "outcomes" table's), tested before the condition itself: a need
        (UNABLE_TO_ASSESS), an only_if (NOT_APPLICABLE) or a require (FAIL) that the value is
        present, or that the code is a known one."""
        asked = {key: check[key] for key in OUTCOME_KEYS if key in check}
        if not asked and not self.table:
            return []
        for key, outcome in asked.items():
            if outcome not in OUTCOMES_FOR[kind]:
                raise SheetError([
                    f'in applies_if, "{key}" is UNABLE_TO_ASSESS or NOT_APPLICABLE (applies_if decides whether the '
                    f'rule applies); to FAIL, use a check' if kind == "applies_if" else
                    f'a need gives UNABLE_TO_ASSESS, so its "{key}" can only be UNABLE_TO_ASSESS: for FAIL make it a '
                    f'check, for NOT_APPLICABLE an applies_if condition' if kind == "needs" else
                    f'in a check, "{key}" is UNABLE_TO_ASSESS or FAIL; a check cannot make the rule not applicable: '
                    f'put the condition in applies_if with "{key}": "NOT_APPLICABLE"'])
        searched = self._searched_list(check) if check.get("is") == "has_match" else None
        parts = [check.get("value"), check.get("to")]
        if searched:
            parts += [item.get(side) for item in check.get("where") or [] if isinstance(item, dict)
                      for side in ("value", "to")]
        lookup = bool(searched)
        guards: list[dict[str, Any]] = []
        paths = list(dict.fromkeys(path for part in parts for path in self._direct_paths(part, searched)))
        codes = list(dict.fromkeys(code for part in parts for code in self._codes_read(part, searched)))
        self.mark_used(kind, paths, codes)
        if not asked:
            if self.in_lookup:
                return []  # the checks on a record found compare its values: missing ones are unknown
            # The rule text's table. Not for "present" and "missing": a missing value is what they test;
            # nor for a list's fields read all at once ("unique" over the lines decides missing values itself).
            if check.get("is") not in ("present", "missing"):
                for path in paths:
                    match = _LIST_PATH.match(path)
                    if match and match["list"] not in scope:
                        continue
                    outcome = self.table_outcome_if_missing(kind, path)
                    if outcome == "UNABLE_TO_ASSESS" and kind == "checks" and not lookup:
                        continue  # what a check already gives when a value it compares is missing
                    if outcome is not None:
                        guards.append(self.guard({"op": "is_present", "value": self.operand(path, scope)}, outcome,
                                                 kind, f"{path} is present", lookup=lookup))
            for code in codes:
                match = _LIST_PATH.match(code)
                outcome = self.table.get("unknown_policy" if code == "policy" else "unknown_code")
                if outcome in OUTCOMES_FOR[kind] and not (match and match["list"] not in scope):
                    known, note = self.known_code(code, scope)
                    guards.append(self.guard(known, outcome, kind, note, lookup=lookup))
            return guards
        if not paths and not codes:
            raise SheetError([f'"{next(iter(asked))}" is for a condition that reads a field: this one reads none directly'
                              + (' (a record searched with a missing field does not match; check that field '
                                 'in "then" for UNABLE_TO_ASSESS)' if searched else '')])
        # An unknown value is a missing one, or a code the reference files do not list: rule texts
        # say "unknown service/policy/date" for both (R010 put if_unknown on a date and was refused).
        missing_outcome = asked.get("if_missing", asked.get("if_unknown"))
        if missing_outcome is not None:
            guards += [self.guard({"op": "is_present", "value": self.operand(path, scope)}, missing_outcome, kind,
                                  f"{path} is present", lookup=lookup) for path in paths]
        if "if_unknown" in asked:
            for code in codes:
                known, note = self.known_code(code, scope)
                guards.append(self.guard(known, asked["if_unknown"], kind, note, lookup=lookup))
        return guards

    def mark_used(self, kind: str, paths: list[str], codes: list[str]) -> None:
        """The table entries this condition is about (whether or not it says its own outcome)."""
        entry = {"checks": "missing_in_checks", "applies_if": "missing_in_applies_if"}.get(kind)
        if paths and entry:
            self.table_used.add(entry)
        for path in paths:
            if path.rsplit("/", 1)[-1] in CODE_SOURCES:
                self.table_used.add("unknown_code")
            if path == "/policy_id":
                self.table_used.add("unknown_policy")
        for code in codes:
            self.table_used.add("unknown_policy" if code == "policy" else "unknown_code")

    def table_outcome_if_missing(self, kind: str, path: str) -> str | None:
        """What the "outcomes" table says a missing value read by this kind of condition gives."""
        entry = {"checks": "missing_in_checks", "applies_if": "missing_in_applies_if"}.get(kind)
        outcome = self.table.get(entry) if entry else None
        if outcome is None:
            # "Unknown service codes leave UNABLE_TO_ASSESS": a missing code is not a known one either.
            name = path.rsplit("/", 1)[-1]
            outcome = (self.table.get("unknown_code") if name in CODE_SOURCES else
                       self.table.get("unknown_policy") if path == "/policy_id" else None)
        return outcome if outcome in OUTCOMES_FOR[kind] else None

    def known_code(self, code: str, scope: dict[str, str]) -> tuple[dict[str, Any], str]:
        """The condition that a coded value (or the claim's policy) is one the reference files know."""
        if code == "policy":
            return {"op": "is_present", "value": {"config": "policy", "get": []}}, "the policy is known"
        return ({"op": "in", "value": self.operand(code, scope),
                 "collection": {"config": CODE_SOURCES[code.rsplit("/", 1)[-1]], "get": []}}, f"{code} is a known code")

    @staticmethod
    def guard(condition: dict[str, Any], outcome: str, kind: str, note: str, lookup: bool = False) -> dict[str, Any]:
        if outcome == "NOT_APPLICABLE":
            return {"only_if": condition, "note": f"applies only if {note}"[:200]}
        if outcome == "FAIL":
            return {"require": condition, "otherwise": "FAIL", "note": f"fails unless {note}"[:200]}
        if kind == "checks" and not lookup:
            # UNABLE_TO_ASSESS for this check only, like a check whose data is missing: a known
            # violation on another check still fails ("a known violation fails" in rule texts).
            return {"require": condition, "otherwise": "UNABLE_TO_ASSESS", "note": f"unknown unless {note}"[:200]}
        # A record lookup without the values it searches by, or applies_if: the line (or claim)
        # cannot be assessed, so a need (before applies_if for applies_if, after it otherwise).
        return {"need": condition, "note": f"needs: {note}"[:200], **({_LATE: True} if kind == "checks" else {})}

    def _direct_paths(self, raw: Any, searched: str | None = None) -> list[str]:
        """The fields a value reads itself (not inside a total, and not the records searched)."""
        raw = self.as_field_path(raw)
        if isinstance(raw, str):
            if not raw.startswith("/") or _LIST_ITSELF.match(raw):
                return []
            match = _LIST_PATH.match(raw)
            return [] if searched and match and match["list"] == searched else [raw]
        if isinstance(raw, list):
            return [path for item in raw for path in self._direct_paths(item, searched)]
        if isinstance(raw, dict) and not set(raw) & {"sum", "latest", "earliest", "count", "first_present"}:
            items = [raw.get("for"), raw.get("value") if len(raw) == 1 else None]
            items += [raw.get(name) for name in ARITHMETIC]
            return [path for item in items if item is not None for path in self._direct_paths(item, searched)]
        return []

    def _codes_read(self, raw: Any, searched: str | None = None) -> list[str]:
        """The coded fields a value reads ("/lines/*/service_code"), and "policy" when it reads
        the claim's policy."""
        codes = [path for path in self._direct_paths(raw, searched) if path.rsplit("/", 1)[-1] in CODE_SOURCES]
        if any(path == "/policy_id" for path in self._direct_paths(raw, searched)) or _reads_policy(raw):
            codes.append("policy")
        return codes

    def conditions(self, check: dict[str, Any], scope: dict[str, str]) -> list[dict[str, Any]]:
        comparison, raw_value, target = check["is"], check.get("value"), check.get("to")
        if comparison == "has_match":
            return [self.has_match(check, scope)]
        if comparison == "unique":
            return [self.unique(raw_value, scope)]
        value = self.operand(raw_value, scope)
        if comparison == "present":
            return [{"op": "is_present", "value": value}]
        if comparison == "missing":
            return [{"op": "is_missing", "value": value}]
        if comparison == "whole_number":
            return [{"op": "is_whole_number", "value": value}]
        self.refuse_day_count_as_date(raw_value, comparison, target)
        if comparison == "between":
            if not isinstance(target, list) or len(target) != 2:
                raise SheetError(['"between" needs "to": [lowest, highest] (both included)'])
            low, high = (self.operand(bound, scope) for bound in target)
            if self.is_date(raw_value) or any(self.is_date(bound) for bound in target):
                return [{"op": "on_or_after", "left": value, "right": low}, {"op": "on_or_before", "left": value, "right": high}]
            return [{"op": "at_least", "left": value, "right": low}, {"op": "at_most", "left": value, "right": high}]
        if comparison in ("one_of", "not_one_of"):
            if isinstance(target, list):
                if not target:
                    raise SheetError([f'"{comparison}" needs at least one value in "to"'])
                options = [{"op": "equals", "left": value, "right": self.operand(option, scope)} for option in target]
                condition = options[0] if len(options) == 1 else {"op": "any_of", "items": options}
            else:
                condition = {"op": "in", "value": value, "collection": self.operand(target, scope)}
            return [condition if comparison == "one_of" else {"op": "not", "item": condition}]
        right = self.operand(target, scope)
        if comparison == "same_amount":
            return [{"op": "amounts_match", "left": value, "right": right, "tolerance": MONEY_TOLERANCE}]
        if comparison in NUMBER_COMPARISONS and (self.is_date(raw_value) or self.is_date(target)):
            raise SheetError([f'"{comparison}" compares numbers; for dates use on_or_before, on_or_after, '
                              'before or after, and for a number of days {"days_between": [earlier, later]}'])
        return [{"op": comparison, "left": value, "right": right}]

    def need_condition(self, need: Any, scope: dict[str, str]) -> dict[str, Any]:
        """A need is a value that must be present, or a condition that must hold
        ({"value": ..., "is": ..., "to": ...}); otherwise the result is UNABLE_TO_ASSESS."""
        if isinstance(need, dict) and "is" in need:
            conditions = self.conditions(need, scope)
            return conditions[0] if len(conditions) == 1 else {"op": "all_of", "items": conditions}
        return {"op": "is_present", "value": self.operand(need, scope)}

    def _searched_list(self, check: dict[str, Any]) -> str:
        searched = check.get("in")
        match = _LIST_ITSELF.match(searched) if isinstance(searched, str) else None
        if match is None:
            raise SheetError(['"has_match" needs "in": the list to search, e.g. "/authorizations" or "/attachments"'])
        return match["list"]

    def has_match(self, check: dict[str, Any], scope: dict[str, str]) -> dict[str, Any]:
        """At least one element of another list meets every "where" condition.

        Inside "where", fields of the searched list (/attachments/*/type) are read from the
        element being tried; other fields keep their meaning (/lines/*/service_code is the
        current line, /patient_id the claim's patient)."""
        searched = self._searched_list(check)
        where = check.get("where")
        if _compares_within(where, searched):
            raise SheetError([_same_list(searched)])
        if not isinstance(where, list) or not where:
            raise SheetError(['"has_match" needs "where": the conditions a matching element meets, e.g. '
                              '[{"value": "/attachments/*/patient_id", "is": "equals", "to": "/patient_id"}]'])
        if searched in scope:
            raise SheetError([_same_list(searched)])
        variable = self.fresh(LISTS[searched])
        return {"op": "exists", "collection": {"path": f"/{searched}"}, "as": variable,
                "where": self.where_condition(where, {**scope, searched: variable})}

    def refuse_day_count_as_date(self, raw_value: Any, comparison: str, target: Any) -> None:
        """{"days_between": ...} is a number of days; compared with dates it means nothing.
        Say what to write instead, with the rule's own fields."""
        if not (isinstance(raw_value, dict) and isinstance(raw_value.get("days_between"), list)):
            return
        bounds = target if isinstance(target, list) else [target]
        if comparison not in DATE_COMPARISONS and not (comparison == "between" and any(self.is_date(b) for b in bounds)):
            return
        dates = [self.as_field_path(item) for item in raw_value["days_between"]]
        date = next((item for item in dates if isinstance(item, str) and item not in map(self.as_field_path, bounds)),
                    dates[-1] if dates else "/lines/*/service_date")
        raise SheetError([
            f'{{"days_between": ...}} is a number of days, so it cannot be "{comparison}" dates. '
            f'To check that a date lies in a period, compare the date itself: {{"value": "{date}", "is": "{comparison}", '
            f'"to": {_short(target)}}}. To limit a number of days, compare it with a number: '
            f'{{"value": {_short(raw_value)}, "is": "at_most", "to": 30}}.'
        ])

    def unique(self, raw_value: Any, scope: dict[str, str]) -> dict[str, Any]:
        keys = raw_value if isinstance(raw_value, list) else [raw_value]
        lists = set().union(*(self._lists_named(key) for key in keys)) if keys else set()
        if len(lists) != 1:
            raise SheetError(['"unique" needs the fields that must not repeat, all from one list, e.g. '
                              '{"value": ["/lines/*/service_code", "/lines/*/service_date"], "is": "unique"}'])
        name = lists.pop()
        variable = self.fresh(LISTS[name])
        inner = {**scope, name: variable}
        return {"op": "unique", "collection": {"path": f"/{name}"}, "as": variable,
                "by": [self.operand(key, inner) for key in keys]}

    # ---------------------------------------------------------------- values

    def operand(self, raw: Any, scope: dict[str, str]) -> dict[str, Any]:
        raw = self.as_field_path(raw)
        if isinstance(raw, str) and raw.startswith("/"):
            return self.path(raw, scope)
        if isinstance(raw, (int, float, str)) and not isinstance(raw, bool):
            return {"value": raw}
        if isinstance(raw, bool) or raw is None:
            return {"value": raw}
        if not isinstance(raw, dict) or len(raw) == 0:
            raise SheetError([f"{_short(raw)} is not a value. {SHEET_FORMAT}"])
        if "policy" in raw:
            return self.config("policy", [raw["policy"]], raw, scope)
        if "catalogue" in raw:
            if raw["catalogue"] not in CONFIG_SOURCES:
                raise SheetError([f'"catalogue" is one of {", ".join(CONFIG_SOURCES)}'])
            return self.config(raw["catalogue"], [], raw, scope)
        if "count" in raw:
            if set(raw) - {"count", "where", "group_by"}:
                raise SheetError(['count takes the list and an optional filter, e.g. {"count": "/lines", '
                                  '"where": [{"value": "/lines/*/service_code", "is": "equals", "to": "SVC-LAB"}]}'])
            target = raw["count"]
            match = _LIST_ITSELF.match(target) if isinstance(target, str) else None
            field_of_each = _LIST_PATH.match(target) if isinstance(target, str) and match is None else None
            if field_of_each and field_of_each["list"] in LISTS:
                # The path reader's "use it inside count" would send the drafter in a circle
                # (R008 sent this 9 times in a row on 2026-10-12): it is inside count already.
                name = field_of_each["list"]
                raise SheetError([
                    f'"count" takes a list, not a field of its elements: {{"count": "/{name}"}}. To count only '
                    f'some {name}, filter them: {{"count": "/{name}", "where": [{{"value": "{target}", '
                    f'"is": ..., "to": ...}}]}}'])
            if match is None:
                if "group_by" in raw:
                    raise SheetError([f'"group_by" counts the elements of a list, e.g. {{"count": "/lines", "group_by": "service_date"}}'])
                return {"count": self.operand(target, scope)}
            if "where" not in raw and "group_by" not in raw:
                return {"count": {"path": f"/{match['list']}"}}
            variable = self.fresh(LISTS[match["list"]])
            return {"count": {"path": f"/{match['list']}"}, "as": variable,
                    "where": self.filter(match["list"], variable, scope, raw.get("where"), raw.get("group_by"))}
        for name in AGGREGATES:
            if name in raw:
                return self.aggregate(name, _aggregated_value(name, raw), scope, raw.get("where"), raw.get("group_by"))
        for name in (*ARITHMETIC, "first_present"):
            if name in raw:
                items = raw[name]
                if not isinstance(items, list) or len(items) < 2:
                    raise SheetError([f'"{name}" needs a list of values, e.g. {{"{name}": [V, V]}}'])
                return {name: [self.operand(item, scope) for item in items]}
        if "value" in raw and len(raw) == 1:
            return self.operand(raw["value"], scope)
        raise SheetError([f"{_short(raw)} is not a value. {SHEET_FORMAT}"])

    def as_field_path(self, raw: Any) -> Any:
        """Two other spellings of a field, each with one meaning: the full language's
        {"path": "/coverage/status"}, and a dotted name that is a claim field
        ("coverage.start_date", "lines.quantity"). Anything else is left as it is."""
        if isinstance(raw, dict) and set(raw) == {"path"} and isinstance(raw["path"], str) and raw["path"].startswith("/"):
            return raw["path"]
        if isinstance(raw, str) and "." in raw and not raw.startswith("/") and re.fullmatch(r"[a-z_]+(\.[a-z_]+)+", raw):
            first, *rest = raw.split(".")
            path = f"/{first}/*/{'/'.join(rest)}" if first in LISTS else "/" + "/".join([first, *rest])
            if self.fields.get(path) is not None:
                return path
        return raw

    def path(self, raw: str, scope: dict[str, str]) -> dict[str, Any]:
        if match := _LIST_PATH.match(raw):
            name, rest = match["list"], match["rest"]
            if name not in scope:
                raise SheetError([f'"{raw}" reads each {LISTS[name]}: use it in a check about each {LISTS[name]}, '
                                  'or inside sum, latest, earliest or count'])
            if self.fields.get(f"/{name}/*/{rest}") is None:
                raise SheetError([self.fields.unknown_field(f"/{name}/*/{rest}", shown_as=raw)])
            return {"path": f"${scope[name]}/{rest}"}
        if _LIST_ITSELF.match(raw):
            raise SheetError([f'"{raw}" is a whole list: use {{"count": "{raw}"}}, or one of its fields'])
        if self.fields.get(raw) is None:
            raise SheetError([self.fields.unknown_field(raw)])
        return {"path": raw}

    def config(self, source: str, keys: list[Any], raw: dict[str, Any], scope: dict[str, str]) -> dict[str, Any]:
        extra = set(raw) - {source if source != "policy" else "policy", "catalogue", "for", "get"}
        if extra:
            raise SheetError([f"unknown keys {sorted(extra)} in a {source} value"])
        get: list[Any] = list(keys)
        if "for" in raw:
            get.append(self.operand(raw["for"], scope))
        if "get" in raw:
            get.append(raw["get"])
        return {"config": source, "get": get}

    def aggregate(self, name: str, inner: Any, scope: dict[str, str], where: Any = None,
                  group_by: Any = None) -> dict[str, Any]:
        """sum / latest / earliest over a list. Inside it, that list's fields mean the element
        being aggregated (a sum over lines inside a check about each line reads every line)."""
        lists = self._lists_named(inner)
        if len(lists) > 1:
            lists -= set(scope)  # the other lists named are the elements already being checked
        if len(lists) != 1:
            raise SheetError([f'"{name}" needs a value read from the elements of one list, e.g. '
                              f'{{"{name}": "/lines/*/net_amount"}}'])
        list_name = lists.pop()
        variable = self.fresh(LISTS[list_name])
        inner_scope = {**scope, list_name: variable}
        result = {name: {"path": f"/{list_name}"}, "as": variable, "of": self.operand(inner, inner_scope)}
        if where is not None or group_by is not None:
            if name != "sum" and group_by is not None:
                raise SheetError(['"group_by" is for sum and count'])
            result["where"] = self.filter(list_name, variable, scope, where, group_by)
        return result

    def filter(self, list_name: str, variable: str, scope: dict[str, str], where: Any, group_by: Any) -> dict[str, Any]:
        """The elements an aggregate keeps: its own "where", and with "group_by" only those
        sharing this element's value of each key (the lines of the same authorization, say)."""
        if _compares_itself(where, list_name):
            raise SheetError([_same_list(list_name, inside="where")])
        conditions = [self.where_condition(where, {**scope, list_name: variable})] if where is not None else []
        if group_by is not None:
            element = LISTS[list_name]
            if list_name not in scope:
                raise SheetError([f'"group_by" keeps the {list_name} that share this {element}\'s value, so it '
                                  f'is used in a check about each {element}, e.g. {GROUP_EXAMPLE}'])
            for key in group_by if isinstance(group_by, list) and group_by else [group_by]:
                field = self.group_key(list_name, key)
                mine = f"${scope[list_name]}/{field}"
                conditions.append({"op": "equals", "left": {"path": f"${variable}/{field}"}, "right": {"path": mine}})
                self.group_keys.append((mine, f"/{list_name}/*/{field}"))
        return conditions[0] if len(conditions) == 1 else {"op": "all_of", "items": conditions}

    def group_key(self, list_name: str, key: Any) -> str:
        """A group_by key: a field of the list being totalled ("authorization_id")."""
        key = self.as_field_path(key)
        if isinstance(key, str) and (match := _LIST_PATH.match(key)):
            key = match["rest"] if match["list"] == list_name else None
        if not isinstance(key, str) or self.fields.get(f"/{list_name}/*/{key}") is None:
            raise SheetError([f'"group_by" names a field of the {list_name} being totalled, e.g. "authorization_id" '
                              f"({_short(key)} is not one)"])
        return key

    def lookup(self, check: dict[str, Any], scope: dict[str, str], otherwise: str) -> list[dict[str, Any]]:
        """has_match with "then": find the record "where" identifies (a line's authorization,
        say), fail if there is none, then check each of its fields as its own check, so a
        missing field gives UNABLE_TO_ASSESS while a known mismatch fails."""
        searched = self._searched_list(check)
        if _compares_within(check.get("where"), searched):
            raise SheetError([_same_list(searched)])
        then = check.get("then")
        if not isinstance(then, list) or not then:
            raise SheetError(['"then" is a non-empty list of checks on the record found, e.g. '
                              '[{"value": "/authorizations/*/status", "is": "equals", "to": "approved"}]'])
        if searched in scope:
            raise SheetError([_same_list(searched)])
        candidate = self.fresh(LISTS[searched])
        found = self.fresh(LISTS[searched])
        steps: list[dict[str, Any]] = [
            {"let": found, "be": {"find": {"path": f"/{searched}"}, "as": candidate,
                                  "where": self.where_condition(check.get("where"), {**scope, searched: candidate})},
             _LATE: "let"},
            {"require": {"op": "is_present", "value": {"path": f"${found}"}}, "otherwise": otherwise,
             "note": f"a matching record exists in {check.get('in')}"},
        ]
        record_scope = {**scope, searched: found}
        self.in_lookup = True
        try:
            for item in then:
                if not isinstance(item, dict) or item.get("is") in ("has_match", "unique"):
                    raise SheetError(['each "then" entry is a check on the record found (no has_match or unique)'])
                steps += self.steps(item, "checks", record_scope)
        finally:
            self.in_lookup = False
        return steps

    def where_condition(self, where: Any, scope: dict[str, str]) -> dict[str, Any]:
        """A filter: every condition must hold for an element to count."""
        if not isinstance(where, list) or not where:
            raise SheetError(['"where" is a non-empty list of checks like {"value": ..., "is": ..., "to": ...}'])
        conditions = []
        for condition in where:
            if isinstance(condition, dict) and set(condition) & set(OUTCOME_KEYS):
                raise SheetError(['in "where", a record with a missing field simply does not match. For '
                                  'UNABLE_TO_ASSESS when the record found lacks a field, check that field in "then"; '
                                  'for this line\'s (or claim\'s) own missing values, put "if_missing" on the has_match'])
            if (not isinstance(condition, dict) or condition.get("is") not in COMPARISONS
                    or condition.get("is") in ("has_match", "unique") or "value" not in condition
                    or set(condition) - {"value", "is", "to", "note"}
                    or (condition["is"] not in NEEDS_NO_TARGET and "to" not in condition)):
                raise SheetError(['each "where" condition is a check like {"value": ..., "is": ..., "to": ...} '
                                  '(any comparison except has_match and unique, no "otherwise")'])
            conditions += self.conditions(condition, scope)
        return conditions[0] if len(conditions) == 1 else {"op": "all_of", "items": conditions}

    def fresh(self, base: str) -> str:
        self.counter += 1
        return f"{base}_{self.counter}"

    def is_date(self, raw: Any) -> bool:
        if isinstance(raw, str) and _DATE_TEXT.match(raw):
            return True
        if isinstance(raw, str) and raw.startswith("/"):
            path = raw
            if match := _LIST_PATH.match(raw):
                path = f"/{match['list']}/*/{match['rest']}"
            info = self.fields.get(path)
            return bool(info and DATE in info.types)
        if isinstance(raw, dict) and (set(raw) & {"latest", "earliest"}):
            return True
        return False


def _reads_policy(raw: Any) -> bool:
    if isinstance(raw, dict):
        return "policy" in raw or any(_reads_policy(value) for value in raw.values())
    if isinstance(raw, list):
        return any(_reads_policy(item) for item in raw)
    return False


def _aggregated_value(name: str, raw: dict[str, Any]) -> Any:
    """What a sum (latest, earliest) is taken of. Besides {"sum": "/lines/*/net_amount"},
    two spec-style spellings with one meaning are read the same way:
    {"sum": "/lines", "as": "x", "of": "$x/net_amount"}, and the sheet form with a
    redundant {"as": ..., "of": "/lines"} naming the same list. Anything else
    (a filter, another list) is refused rather than silently dropped."""
    extra = set(raw) - {name, "as", "of", "where", "group_by"}
    target, of, alias = raw[name], raw.get("of"), raw.get("as")
    if extra:
        raise SheetError([f'"{name}" takes only the value to {name}, e.g. {{"{name}": "/lines/*/net_amount"}}; '
                          f"{sorted(extra)} cannot be used here"])
    if of is None:
        return target
    if isinstance(target, str) and (match := _LIST_PATH.match(target)) and isinstance(of, str) \
            and (same := _LIST_ITSELF.match(of)) and same["list"] == match["list"]:
        return target
    if isinstance(target, str) and (whole := _LIST_ITSELF.match(target)) and isinstance(alias, str) \
            and isinstance(of, str) and of.startswith(f"${alias}/"):
        return f"/{whole['list']}/*/{of[len(alias) + 2:]}"
    raise SheetError([f'write {name} as {{"{name}": "/lines/*/field"}} (the field of every line to {name})'])


def _messages(given: Any, title: str) -> dict[str, str]:
    defaults = {
        "PASS": f"{title}: satisfied.",
        "FAIL": f"{title}: not satisfied.",
        "UNABLE_TO_ASSESS": f"{title}: information needed to check it is missing.",
        "NOT_APPLICABLE": f"{title}: does not apply to this claim.",
    }
    if isinstance(given, dict):
        defaults.update({key: value[:300] for key, value in given.items()
                         if key in defaults and isinstance(value, str) and value.strip()})
    return defaults


def _describe(check: dict[str, Any]) -> str:
    target = f" {_short(check['to'])}" if "to" in check else ""
    return f"{_short(check.get('value'))} {str(check.get('is', '')).replace('_', ' ')}{target}"


def _short(raw: Any) -> str:
    text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    return text if len(text) <= 80 else text[:77] + "..."
