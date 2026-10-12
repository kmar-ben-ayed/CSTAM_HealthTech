"""The checks a drafted spec must pass before it may run. All plain code.

1. fields_and_types     the spec reads real claim fields, with fitting types
2. author_examples      every outcome the author confirmed is reproduced exactly
3. independent_reading  (only when an oracle is used) on generated edge cases, the spec agrees with the oracle,
                        which read only the English rule. A case the oracle gets
                        "wrong" is asked again on its own: if the oracle then
                        contradicts itself, the case is inconclusive (oracle noise,
                        not a disagreement). Only repeated disagreements count, and
                        at most a quarter of the cases may be inconclusive.
4. not_constant         the outcome varies across the cases; a rule that always
                        gives the same answer is almost certainly misread
5. dataset_dry_run      the spec runs on the development claims without errors

The report also carries the plain-English readback, an impact preview (what
the rule would decide on the development claims), and notes for the author:
values the rule's text names that the spec never uses.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import ConfigValue, LiteralValue, RuleSpec
from rule_engine.readback import describe_spec
from rule_engine.validation import analyse_spec

from .edge_cases import EdgeCaseGenerator, LabelledCase, _walk, rule_text, unused_values, values_mentioned
from .hints import explain
from .oracle import Oracle

ERROR = "ERROR"
UNABLE_TO_ASSESS = "UNABLE_TO_ASSESS"
FAIL = "FAIL"
MAX_INCONCLUSIVE_SHARE = 0.25
MAX_FAIL_SHARE = 0.5  # above this share of failing development claims, the author gets a note
MAX_COMPARED_EXAMPLES = 10  # differing claims listed in a comparison


def _listed(rows: list[dict[str, Any]], shown: int = 3) -> str:
    names = ", ".join(row["claim_id"] for row in rows[:shown])
    return names + (f" and {len(rows) - shown} more" if len(rows) > shown else "")


@dataclass
class CaseOutcome:
    case_id: str
    description: str
    spec_status: str
    oracle_status: str | None
    oracle_reason: str
    claim: dict[str, Any]
    recheck_status: str | None = None  # the oracle's second, single-case reading
    oracle_used: bool = True  # False when no second reading was made (the author reviews the cases)
    field: str = ""  # the claim field the case changes (cases are reviewed one field at a time)

    @property
    def agrees(self) -> bool:
        return self.oracle_status == self.spec_status

    @property
    def inconclusive(self) -> bool:
        """The oracle disagreed, then agreed when asked again: noise, not evidence."""
        return not self.agrees and self.recheck_status == self.spec_status

    @property
    def disagrees(self) -> bool:
        return self.oracle_used and not self.agrees and not self.inconclusive

    def to_json(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "description": self.description,
            "spec_status": self.spec_status,
            "oracle_status": self.oracle_status,
            "oracle_reason": self.oracle_reason,
            "recheck_status": self.recheck_status,
            "oracle_used": self.oracle_used,
            "field": self.field,
        }


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str


@dataclass
class CheckReport:
    checks: list[CheckResult]
    readback: str = ""
    cases: list[CaseOutcome] = field(default_factory=list)
    example_mismatches: list[str] = field(default_factory=list)
    impact: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)  # advice for the author; never blocks
    # A revision measured on the development claims: against the rule running today, and
    # against the known correct outcomes when there are any (see Baseline).
    comparison: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(check.passed for check in self.checks)

    @property
    def disagreements(self) -> list[CaseOutcome]:
        return [case for case in self.cases if case.disagrees]

    @property
    def inconclusive(self) -> list[CaseOutcome]:
        return [case for case in self.cases if case.inconclusive]

    def failed(self, name: str) -> bool:
        return any(check.name == name and not check.passed for check in self.checks)

    def only_disagreements_remain(self) -> bool:
        """True when the spec is sound by every code check and only the two readings differ."""
        return all(check.passed or check.name == "independent_reading" for check in self.checks)

    def feedback_for_drafter(self) -> list[str]:
        """What the drafter must fix (disagreements go to the author instead)."""
        notes = [f"{check.name}: {check.detail}" for check in self.checks
                 if not check.passed and check.name != "independent_reading"]
        return notes + self.example_mismatches

    def to_json(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "code_checks_passed": bool(self.checks) and self.only_disagreements_remain(),
            "checks": [check.__dict__ for check in self.checks],
            "readback": self.readback,
            "cases": [case.to_json() for case in self.cases],
            "disagreements": [case.to_json() for case in self.disagreements],
            "inconclusive": [case.to_json() for case in self.inconclusive],
            "example_mismatches": self.example_mismatches,
            "impact": self.impact,
            "notes": self.notes,
            "comparison": self.comparison,
        }


@dataclass
class Baseline:
    """What a revision can be measured against on the development claims: the rule running
    today, and the known correct outcome of each claim (claim id -> status), when there are
    any (the challenge's expected results for its 15 rules). A new rule has neither."""

    current: RuleSpec | None = None
    expected: dict[str, str] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return self.current is not None or bool(self.expected)


class DraftChecker:
    def __init__(
        self,
        fields: FieldCatalogue,
        reference: ReferenceData,
        edge_cases: EdgeCaseGenerator,
        oracle: Oracle | None,
        dry_run_claims: list[dict[str, Any]],
        sheet: bool = False,  # the drafter writes sheets: hints use the sheet's words
    ):
        self.fields = fields
        self.reference = reference
        self.edge_cases = edge_cases
        self.oracle = oracle
        self.dry_run_claims = dry_run_claims
        self.sheet = sheet

    def run(self, rule: dict[str, Any], spec: RuleSpec, examples: list[LabelledCase],
            baseline: Baseline | None = None) -> CheckReport:
        analysis = analyse_spec(spec, self.fields)
        report = CheckReport(checks=[], readback=describe_spec(spec))
        report.notes = [
            f'The rule text mentions "{value}", which the drafted rule never uses. '
            "Check that this part of the rule is really covered."
            for value in unused_values(rule, spec)
        ]
        copied = copied_policy_values(rule, spec, self.reference)
        if copied:
            report.notes.append(
                f"The drafted rule writes out values from policies.json ({', '.join(map(str, copied[:5]))}) instead "
                "of reading the claim's own policy, so it will not follow another policy or a later change."
            )
        report.checks.append(CheckResult(
            "fields_and_types",
            not analysis.problems,
            "; ".join(analysis.problems) or "every field exists and every comparison has fitting types",
        ))
        if analysis.problems:
            return report

        report.example_mismatches = [
            f'"{example.description}": the spec gives {status}, the author confirmed {example.expected_status}. '
            f"{explain(example.expected_status, status, spec, sheet=self.sheet)}".rstrip()
            for example in examples
            if (status := self._status(spec, example.claim)) != example.expected_status
        ]
        report.checks.append(CheckResult(
            "author_examples",
            not report.example_mismatches,
            f"{len(examples) - len(report.example_mismatches)} of {len(examples)} confirmed examples reproduced",
        ))

        # A claim the author has already answered for needs no second opinion:
        # the author's answer is the ground truth, so it replaces the oracle there.
        confirmed = {claim_key(example.claim): example.expected_status for example in examples}
        cases = self.edge_cases.generate(spec, rule)
        if self.oracle is None:
            # No second reading: the cases are shown to the author, who corrects any outcome.
            for case in cases:
                author_says = confirmed.get(claim_key(case.claim))
                report.cases.append(CaseOutcome(
                    case_id=case.case_id,
                    description=case.description,
                    spec_status=self._status(spec, case.claim),
                    oracle_status=author_says,
                    oracle_reason="confirmed by the author" if author_says else "",
                    claim=case.claim,
                    oracle_used=False,
                    field=case.field,
                ))
            return self._finish(report, spec, examples, baseline)
        to_predict = [case for case in cases if claim_key(case.claim) not in confirmed]
        predictions = self.oracle.predict(rule, to_predict, examples, analysis.fields_read)
        for case in cases:
            if claim_key(case.claim) in confirmed:
                report.cases.append(CaseOutcome(
                    case_id=case.case_id,
                    description=case.description,
                    spec_status=self._status(spec, case.claim),
                    oracle_status=confirmed[claim_key(case.claim)],
                    oracle_reason="confirmed by the author",
                    claim=case.claim,
                    field=case.field,
                ))
                continue
            prediction = predictions.get(case.case_id)
            outcome = CaseOutcome(
                case_id=case.case_id,
                description=case.description,
                spec_status=self._status(spec, case.claim),
                oracle_status=prediction.status if prediction else None,
                oracle_reason=prediction.reason if prediction else "no prediction was returned",
                claim=case.claim,
                field=case.field,
            )
            if not outcome.agrees:
                recheck = self.oracle.predict(rule, [case], examples, analysis.fields_read).get(case.case_id)
                outcome.recheck_status = recheck.status if recheck else None
            report.cases.append(outcome)

        total = len(report.cases)
        agreeing = sum(case.agrees for case in report.cases)
        inconclusive = len(report.inconclusive)
        report.checks.append(CheckResult(
            "independent_reading",
            total > 0 and not report.disagreements and inconclusive <= MAX_INCONCLUSIVE_SHARE * total,
            f"{agreeing} of {total} generated cases agree with the independent reading; "
            f"{inconclusive} inconclusive (the reading changed when asked again); "
            f"{len(report.disagreements)} disagree",
        ))
        return self._finish(report, spec, examples, baseline)

    def _finish(self, report: CheckReport, spec: RuleSpec, examples: list[LabelledCase],
                baseline: Baseline | None = None) -> CheckReport:
        """The checks that need no second reading: varied outcomes, and a clean dry run."""
        outcomes = {case.spec_status for case in report.cases} | {example.expected_status for example in examples}
        varied = len(outcomes - {ERROR}) >= 2
        report.checks.append(CheckResult(
            "not_constant",
            varied,
            "outcomes seen: " + ", ".join(sorted(outcomes))
            + (self._usually_missing(spec) if not varied and outcomes == {UNABLE_TO_ASSESS} else ""),
        ))

        report.impact = self._dry_run(spec)
        failing = report.impact["statuses"].get("FAIL", 0)
        if report.impact["claims"] and failing / report.impact["claims"] > MAX_FAIL_SHARE:
            # Development claims are mostly sound; a rule failing most of them is usually
            # stricter than intended (e.g. "member id equals MEM-" for "starts with MEM-").
            report.notes.append(
                f"The drafted rule fails {failing} of {report.impact['claims']} development claims. "
                "Check that it is not stricter than the rule intends."
            )
        report.checks.append(CheckResult(
            "dataset_dry_run",
            report.impact["claims"] > 0 and report.impact["errors"] == 0,
            f"{report.impact['claims']} development claims evaluated, {report.impact['errors']} errors",
        ))
        if baseline:
            self._compare(report, spec, baseline)
        return report

    def _compare(self, report: CheckReport, spec: RuleSpec, baseline: Baseline) -> None:
        """Where a revision decides differently, said in the notes the author reads before
        confirming (a warning, never a block)."""
        drafted = {claim["claim_id"]: self._status(spec, claim) for claim in self.dry_run_claims}
        if baseline.current is not None:
            differs = [{"claim_id": claim["claim_id"], "current": current, "draft": drafted[claim["claim_id"]]}
                       for claim in self.dry_run_claims
                       if (current := self._status(baseline.current, claim)) != drafted[claim["claim_id"]]]
            report.comparison["current_rule"] = {"claims": len(drafted), "different": len(differs),
                                                 "examples": differs[:MAX_COMPARED_EXAMPLES]}
            if differs:
                report.notes.append(
                    f"This draft decides {len(differs)} of {len(drafted)} development claims differently from "
                    f"the rule running today (for example {_listed(differs)}). Check that this change is intended.")
        known = {claim_id: status for claim_id, status in baseline.expected.items() if claim_id in drafted}
        if known:
            wrong = [{"claim_id": claim_id, "expected": status, "draft": drafted[claim_id]}
                     for claim_id, status in known.items() if drafted[claim_id] != status]
            # The official scorer's issue F1: a FAIL is an issue.
            tp = sum(status == FAIL and drafted[claim_id] == FAIL for claim_id, status in known.items())
            fp = sum(status != FAIL and drafted[claim_id] == FAIL for claim_id, status in known.items())
            fn = sum(status == FAIL and drafted[claim_id] != FAIL for claim_id, status in known.items())
            f1 = round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else None
            report.comparison["expected_results"] = {"claims": len(known), "agree": len(known) - len(wrong),
                                                     "issue_f1": f1, "examples": wrong[:MAX_COMPARED_EXAMPLES]}
            if wrong:
                score = f", issue F1 {f1}" if f1 is not None else ""
                report.notes.append(
                    f"This draft gives the known correct outcome on {len(known) - len(wrong)} of {len(known)} "
                    f"development claims{score} (it differs on {_listed(wrong)}). Confirm only if the expected "
                    "outcomes are wrong.")

    def _status(self, spec: RuleSpec, claim: dict[str, Any]) -> str:
        try:
            return evaluate_rule(spec, claim, self.reference).status
        except EvaluationLimitExceeded:
            return ERROR

    def _usually_missing(self, spec: RuleSpec) -> str:
        """Why every test claim is UNABLE_TO_ASSESS, when the rule reads values most development
        claims lack. R006 (collect3) drafted a rule right but for a modifier that is null on most
        lines, and spent 34 minutes told only "outcomes seen: UNABLE_TO_ASSESS"."""
        lacking = []
        for path in sorted(analyse_spec(spec, self.fields).fields_read):
            missing, total = _missing_share(path, self.dry_run_claims)
            if total and missing * 2 > total:
                lacking.append(f"{path} (missing on {missing} of {total} {'claims' if path.count('/') == 1 else 'elements'})")
        if not lacking:
            return ""
        where = ("in a check, or a check's own needs, not in the sheet's needs" if self.sheet else
                 "after the only_if steps, not in a need before them")
        return (". Every test claim is UNABLE_TO_ASSESS, and the rule reads values most development claims lack: "
                + ", ".join(lacking[:3]) + f". Require such a value only where the rule applies ({where}); if the "
                "rule treats a missing value as blank, zero or none, give it that default with first_present")

    def _dry_run(self, spec: RuleSpec) -> dict[str, Any]:
        counts = Counter(self._status(spec, claim) for claim in self.dry_run_claims)
        return {
            "claims": len(self.dry_run_claims),
            "errors": counts.pop(ERROR, 0),
            "statuses": dict(counts),
        }


def _missing_share(path: str, claims: list[dict[str, Any]]) -> tuple[int, int]:
    """How many of the values at a field path ("/policy_id", "/lines/*/modifier") are missing
    (absent, null or blank text), and how many there are, over the claims."""
    values: list[Any] = []
    for claim in claims:
        nodes = [claim]
        for part in path.strip("/").split("/"):
            if part == "*":
                nodes = [item for node in nodes if isinstance(node, list) for item in node]
            else:
                nodes = [node.get(part) if isinstance(node, dict) else None for node in nodes]
        values += nodes
    missing = sum(value is None or (isinstance(value, str) and not value.strip()) for value in values)
    return missing, len(values)


def copied_policy_values(rule: dict[str, Any], spec: RuleSpec, reference: ReferenceData) -> list[Any]:
    """Values a spec writes out that come from policies.json, when the rule refers to
    the policy but the spec never reads it (the drafter can read the files, and may
    copy what it read instead of referring to it). Values the rule text names itself,
    and the everyday numbers 0 and 1, are never counted."""
    if "polic" not in rule_text(rule).lower():
        return []
    if any(isinstance(node, ConfigValue) and node.config == "policy" for node in _walk(spec)):
        return []
    in_policies = set()
    for policy in reference.policies.values():
        for value in policy.values():
            items = value.values() if isinstance(value, dict) else value if isinstance(value, list) else [value]
            in_policies.update(item for item in items if isinstance(item, (str, int, float)) and not isinstance(item, bool))
    named = set(values_mentioned(rule_text(rule)))
    copied = []
    for node in _walk(spec):
        literal = getattr(node, "value", None) if isinstance(node, LiteralValue) else None
        if literal is None or isinstance(literal, bool) or literal in (0, 1) or str(literal) in named:
            continue
        if literal in in_policies and literal not in copied:
            copied.append(literal)
    return sorted(copied, key=str)


def claim_key(claim: dict[str, Any]) -> str:
    """Identify a test claim by its full content."""
    return json.dumps(claim, sort_keys=True, ensure_ascii=False)
