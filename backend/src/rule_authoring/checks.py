"""The checks a drafted spec must pass before it may run. All plain code.

1. fields_and_types     the spec reads real claim fields, with fitting types
2. author_examples      every outcome the author confirmed is reproduced exactly
3. independent_reading  on generated edge cases, the spec agrees with the oracle,
                        which read only the English rule. A case the oracle gets
                        "wrong" is asked again on its own: if the oracle then
                        contradicts itself, the case is inconclusive (oracle noise,
                        not a disagreement). Only repeated disagreements count, and
                        at most a quarter of the cases may be inconclusive.
4. not_constant         the outcome varies across the cases; a rule that always
                        gives the same answer is almost certainly misread
5. dataset_dry_run      the spec runs on the development claims without errors

The report also carries the plain-English readback and an impact preview
(what the rule would decide on the development claims).
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec
from rule_engine.readback import describe_spec
from rule_engine.validation import analyse_spec

from .edge_cases import EdgeCaseGenerator, LabelledCase
from .oracle import Oracle

ERROR = "ERROR"
MAX_INCONCLUSIVE_SHARE = 0.25


@dataclass
class CaseOutcome:
    case_id: str
    description: str
    spec_status: str
    oracle_status: str | None
    oracle_reason: str
    claim: dict[str, Any]
    recheck_status: str | None = None  # the oracle's second, single-case reading

    @property
    def agrees(self) -> bool:
        return self.oracle_status == self.spec_status

    @property
    def inconclusive(self) -> bool:
        """The oracle disagreed, then agreed when asked again: noise, not evidence."""
        return not self.agrees and self.recheck_status == self.spec_status

    @property
    def disagrees(self) -> bool:
        return not self.agrees and not self.inconclusive

    def to_json(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "description": self.description,
            "spec_status": self.spec_status,
            "oracle_status": self.oracle_status,
            "oracle_reason": self.oracle_reason,
            "recheck_status": self.recheck_status,
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
            "checks": [check.__dict__ for check in self.checks],
            "readback": self.readback,
            "cases": [case.to_json() for case in self.cases],
            "disagreements": [case.to_json() for case in self.disagreements],
            "inconclusive": [case.to_json() for case in self.inconclusive],
            "example_mismatches": self.example_mismatches,
            "impact": self.impact,
        }


class DraftChecker:
    def __init__(
        self,
        fields: FieldCatalogue,
        reference: ReferenceData,
        edge_cases: EdgeCaseGenerator,
        oracle: Oracle,
        dry_run_claims: list[dict[str, Any]],
    ):
        self.fields = fields
        self.reference = reference
        self.edge_cases = edge_cases
        self.oracle = oracle
        self.dry_run_claims = dry_run_claims

    def run(self, rule: dict[str, Any], spec: RuleSpec, examples: list[LabelledCase]) -> CheckReport:
        analysis = analyse_spec(spec, self.fields)
        report = CheckReport(checks=[], readback=describe_spec(spec))
        report.checks.append(CheckResult(
            "fields_and_types",
            not analysis.problems,
            "; ".join(analysis.problems) or "every field exists and every comparison has fitting types",
        ))
        if analysis.problems:
            return report

        report.example_mismatches = [
            f'"{example.description}": the spec gives {status}, the author confirmed {example.expected_status}'
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
        confirmed = {_claim_key(example.claim): example.expected_status for example in examples}
        cases = self.edge_cases.generate(spec)
        to_predict = [case for case in cases if _claim_key(case.claim) not in confirmed]
        predictions = self.oracle.predict(rule, to_predict, examples, analysis.fields_read)
        for case in cases:
            if _claim_key(case.claim) in confirmed:
                report.cases.append(CaseOutcome(
                    case_id=case.case_id,
                    description=case.description,
                    spec_status=self._status(spec, case.claim),
                    oracle_status=confirmed[_claim_key(case.claim)],
                    oracle_reason="confirmed by the author",
                    claim=case.claim,
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

        outcomes = {case.spec_status for case in report.cases} | {example.expected_status for example in examples}
        report.checks.append(CheckResult(
            "not_constant",
            len(outcomes - {ERROR}) >= 2,
            "outcomes seen: " + ", ".join(sorted(outcomes)),
        ))

        report.impact = self._dry_run(spec)
        report.checks.append(CheckResult(
            "dataset_dry_run",
            report.impact["claims"] > 0 and report.impact["errors"] == 0,
            f"{report.impact['claims']} development claims evaluated, {report.impact['errors']} errors",
        ))
        return report

    def _status(self, spec: RuleSpec, claim: dict[str, Any]) -> str:
        try:
            return evaluate_rule(spec, claim, self.reference).status
        except EvaluationLimitExceeded:
            return ERROR

    def _dry_run(self, spec: RuleSpec) -> dict[str, Any]:
        counts = Counter(self._status(spec, claim) for claim in self.dry_run_claims)
        return {
            "claims": len(self.dry_run_claims),
            "errors": counts.pop(ERROR, 0),
            "statuses": dict(counts),
        }


def _claim_key(claim: dict[str, Any]) -> str:
    """Identify a test claim by its full content."""
    return json.dumps(claim, sort_keys=True, ensure_ascii=False)
