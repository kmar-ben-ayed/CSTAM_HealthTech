"""Several independent drafts of one rule, and the claims they disagree on.

A small model drafting the same rule twice can give two different rules, and
nothing in one draft shows that it is the wrong one. Drafting it several times
turns that variance into information:

- every draft is run on the same test claims;
- drafts that decide every claim the same way are one candidate rule;
- where candidates disagree, the admin is asked about those exact claims
  ("for this claim, PASS, FAIL, UNABLE_TO_ASSESS or NOT_APPLICABLE?");
- each answer becomes a permanent example, and candidates that contradict it
  are dropped.

This is "query by committee" from active learning: the questions go where the
model is uncertain, so few answers settle the rule. All plain code; the drafts
come from the model, the decision from the admin.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from rule_engine.catalogue import ReferenceData
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec, parse_spec

from .edge_cases import EdgeCase, EdgeCaseGenerator, LabelledCase


@dataclass
class Candidate:
    """One drafted rule, as the drafter proposed it."""

    spec: RuleSpec
    intent: str = ""
    assumptions: list[str] = field(default_factory=list)
    sheet: dict[str, Any] | None = None  # the sheet the model wrote, if it wrote one

    def to_json(self) -> dict[str, Any]:
        return {"spec": self.spec.to_json(), "intent": self.intent, "assumptions": self.assumptions, "sheet": self.sheet}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Candidate":
        return cls(parse_spec(data["spec"]), data.get("intent", ""), list(data.get("assumptions", [])), data.get("sheet"))


@dataclass
class Split:
    """A test claim the candidates decide differently."""

    case: EdgeCase
    outcomes: Counter  # outcome -> number of candidates giving it


class Committee:
    def __init__(self, edge_cases: EdgeCaseGenerator, reference: ReferenceData):
        self.edge_cases = edge_cases
        self.reference = reference

    def probes(self, candidates: list[Candidate], rule: dict[str, Any]) -> list[EdgeCase]:
        """The test claims of every candidate, without repeats, in a fixed order."""
        seen: set[str] = set()
        probes: list[EdgeCase] = []
        for candidate in candidates:
            for case in self.edge_cases.generate(candidate.spec, rule):
                key = json.dumps(case.claim, sort_keys=True)
                if key not in seen:
                    seen.add(key)
                    probes.append(case)
        return probes

    def outcome(self, spec: RuleSpec, claim: dict[str, Any]) -> str:
        try:
            return evaluate_rule(spec, claim, self.reference).status
        except EvaluationLimitExceeded:
            return "ERROR"

    def groups(self, candidates: list[Candidate], probes: list[EdgeCase]) -> list[list[Candidate]]:
        """Candidates that decide every test claim the same way, largest group first."""
        by_behaviour: dict[tuple[str, ...], list[Candidate]] = {}
        for candidate in candidates:
            behaviour = tuple(self.outcome(candidate.spec, case.claim) for case in probes)
            by_behaviour.setdefault(behaviour, []).append(candidate)
        return sorted(by_behaviour.values(), key=len, reverse=True)

    def splits(self, groups: list[list[Candidate]], probes: list[EdgeCase], limit: int) -> list[Split]:
        """The claims that tell the groups apart, most informative first: a claim the
        groups split on evenly says more than one only a single group disagrees on, and
        each question asked should separate the groups in a new way."""
        representatives = [group[0] for group in groups]
        sizes = [len(group) for group in groups]
        found: list[tuple[float, tuple[str, ...], Split]] = []
        for case in probes:
            outcomes = tuple(self.outcome(spec.spec, case.claim) for spec in representatives)
            if len(set(outcomes)) < 2:
                continue
            counts: Counter = Counter()
            for outcome, size in zip(outcomes, sizes):
                counts[outcome] += size
            evenness = 1 - max(counts.values()) / sum(counts.values())
            found.append((evenness, outcomes, Split(case, counts)))
        found.sort(key=lambda item: item[0], reverse=True)
        chosen: list[Split] = []
        patterns: set[tuple[str, ...]] = set()
        for _, outcomes, split in found:
            if outcomes in patterns:
                continue  # separates the groups exactly like a question already chosen
            patterns.add(outcomes)
            chosen.append(split)
            if len(chosen) == limit:
                break
        return chosen

    def survivors(self, candidates: list[Candidate], examples: list[LabelledCase]) -> list[Candidate]:
        """The candidates that reproduce every outcome the admin confirmed."""
        return [
            candidate for candidate in candidates
            if all(self.outcome(candidate.spec, example.claim) == example.expected_status for example in examples)
        ]
