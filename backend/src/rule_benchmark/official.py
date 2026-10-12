"""An official rule's drafted version on the official data, and the gate for deploying it.

The challenge's 15 rules have known outcomes (data/*/expected_results.jsonl). A drafted
version replaces the rule running today only when it is nearly as good: on the development
split, both its issue F1 (a FAIL is an issue, as evaluate.py counts it) and its status
agreement clear a bar. F1 alone is not enough: it counts FAIL only, and a draft can have F1
1.0 and still decide other claims wrongly (an R010 draft once had F1 1.0 and 98.3% agreement).

The gate decides on the development claims; the score is reported on validation and stress,
which the decision never saw. A rule that does not clear the gate keeps its current version.
A new rule has no known outcomes, so this gate never applies to it.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from rule_engine.catalogue import ReferenceData
from rule_engine.engine_core import load_jsonl
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec

SPLITS = ("development", "validation", "stress")
DECIDE_ON = ("development",)
REPORT_ON = ("validation", "stress")
MIN_F1 = 0.95
MIN_AGREEMENT = 0.98

OfficialClaims = list[tuple[str, dict[str, Any]]]
Expected = dict[tuple[str, str], str]  # (split, claim id) -> status


def official_claims(backend_root: Path) -> OfficialClaims:
    """The claims of every split, each with its split's name."""
    return [(split, claim) for split in SPLITS
            for claim in load_jsonl(Path(backend_root) / "data" / split / "claims.jsonl")]


def expected_outcomes(backend_root: Path) -> dict[str, Expected]:
    """Each official rule's expected outcomes, by rule id."""
    expected: dict[str, Expected] = {}
    for split in SPLITS:
        path = Path(backend_root) / "data" / split / "expected_results.jsonl"
        if path.exists():
            for row in load_jsonl(path):
                expected.setdefault(row["rule_id"], {})[(split, row["claim_id"])] = row["status"]
    return expected


def metrics(counts: Counter) -> dict[str, Any]:
    tp, fp, fn, total = counts["tp"], counts["fp"], counts["fn"], counts["claims"]
    return {
        "claims": total, "agree": counts["agree"], "tp": tp, "fp": fp, "fn": fn,
        "issue_f1": round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else None,
        "status_accuracy": round(counts["agree"] / total, 4) if total else None,
    }


def score(spec: RuleSpec | None, expected: Expected, claims: OfficialClaims, reference: ReferenceData,
          splits: tuple[str, ...] = SPLITS) -> dict[str, Any]:
    """The spec on the official claims of these splits, counted as evaluate.py counts it.
    Without a spec every claim is NOT_IMPLEMENTED, which the scorer counts wrong."""
    counts, mismatches = Counter(), Counter()
    for split, claim in claims:
        want = expected.get((split, claim["claim_id"]))
        if split not in splits or want is None:
            continue  # another split, or a claim without an official outcome (added for local testing)
        got = _status(spec, claim, reference) if spec is not None else "NOT_IMPLEMENTED"
        counts["claims"] += 1
        counts["agree"] += got == want
        counts["tp"] += want == "FAIL" and got == "FAIL"
        counts["fp"] += want != "FAIL" and got == "FAIL"
        counts["fn"] += want == "FAIL" and got != "FAIL"
        if got != want:
            mismatches[f"{want}->{got}"] += 1
    return {**metrics(counts), "mismatches": dict(mismatches)}


@dataclass(frozen=True)
class Gate:
    min_f1: float = MIN_F1
    min_agreement: float = MIN_AGREEMENT

    def judge(self, spec: RuleSpec | None, expected: Expected, claims: OfficialClaims,
              reference: ReferenceData) -> dict[str, Any]:
        """Deploy or not, decided on the development claims; the held-out score beside it."""
        decided = score(spec, expected, claims, reference, DECIDE_ON)
        f1, agreement = decided["issue_f1"], decided["status_accuracy"]
        problems = []
        if spec is None:
            problems.append("no rule was produced")
        else:
            if agreement is None or agreement < self.min_agreement:
                problems.append(f"agreement {agreement} is below {self.min_agreement}")
            if f1 is not None and f1 < self.min_f1:  # no FAIL to find on these claims: F1 says nothing
                problems.append(f"issue F1 {f1} is below {self.min_f1}")
        return {"deploy": not problems, "why_not": problems, "development": decided,
                "held_out": score(spec, expected, claims, reference, REPORT_ON)}


def describe(verdict: dict[str, Any]) -> str:
    """One line: the development score the decision used, then the held-out score."""
    def part(name: str, result: dict[str, Any]) -> str:
        return (f"{name} {result['agree']}/{result['claims']} agree, "
                f"F1 {'n/a' if result['issue_f1'] is None else result['issue_f1']}")
    return f"{part('development', verdict['development'])}; {part('validation+stress', verdict['held_out'])}"


def _status(spec: RuleSpec, claim: dict[str, Any], reference: ReferenceData) -> str:
    try:
        return evaluate_rule(spec, claim, reference).status
    except EvaluationLimitExceeded:
        return "ERROR"
