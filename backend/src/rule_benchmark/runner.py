"""Run the rule-authoring benchmark.

Benchmark rules:
- the 15 reference rules R001-R015 (ground truth: their verified reference specs,
  which match all 9,000 expected results). The drafter only ever sees their
  English text, never the reference spec.
- invented rules (invented_rules.json), each with a hand-written reference spec,
  including one rule the language cannot express.

For each rule, the outcome is classified as:
- correct          the checks passed and the proposal matches the reference everywhere
- wrongly_accepted the checks passed but the proposal disagrees with the reference
                   (the dangerous case: this is what the checks exist to prevent)
- rejected         the checks did not pass (safe; "rejected_but_correct" when the
                   last proposal was in fact right)
- correctly_unsupported / unsupported_but_expressible for "cannot express" outcomes
"""

from __future__ import annotations

import json
import shutil
import tempfile
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from audit.logger import AuditLogger
from audit.store import AuditStore
from rule_authoring.drafts import AWAITING_AUTHOR, AWAITING_CONFIRMATION, CASE, DraftStore, Question
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims
from rule_authoring.llm import AuthoringModels
from rule_authoring.service import AuthoringSettings, RuleAuthoringService
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec, parse_spec
from rule_engine.spec_store import reference_seed_file

from .mutations import mutated_claims

INVENTED_RULES = Path(__file__).resolve().parent / "invented_rules.json"
SPLITS = ("development", "validation", "stress")
NO_INFORMATION = "No further information is available: follow the rule text as written."
MAX_AUTHOR_ROUNDS = 6


@dataclass
class BenchmarkItem:
    item_id: str
    rule: dict[str, Any]
    reference: RuleSpec | None
    expect_unsupported: bool = False


@dataclass
class ItemResult:
    item_id: str
    title: str
    classification: str
    final_state: str
    reason: str = ""
    agreement: float | None = None  # share of evaluation claims where the proposal matches the reference
    mismatches: dict[str, int] = field(default_factory=dict)  # "reference->proposal" counts
    clarification_questions: int = 0
    case_questions: int = 0
    oracle_accuracy: float | None = None  # share of generated cases the oracle predicted correctly
    drafter_turns: int = 0
    seconds: float = 0.0


def reference_items(backend_root: Path) -> list[BenchmarkItem]:
    """R001-R015: the English text from rules.json, the truth from the reference seed."""
    catalogue = {rule["rule_id"]: rule for rule in json.loads((backend_root / "rules" / "rules.json").read_text(encoding="utf-8"))}
    seed = json.loads(reference_seed_file(backend_root).read_text(encoding="utf-8"))
    return [
        BenchmarkItem(rule_id, _rule_text(catalogue[rule_id]), parse_spec(entry["spec"]))
        for rule_id, entry in seed["specs"].items()
    ]


def invented_items(path: Path = INVENTED_RULES) -> list[BenchmarkItem]:
    items = []
    for entry in json.loads(path.read_text(encoding="utf-8")):
        reference = parse_spec(entry["reference_spec"]) if entry.get("reference_spec") else None
        items.append(BenchmarkItem(entry["id"], entry["rule"], reference, entry.get("expect_unsupported", False)))
    return items


class SimulatedAuthor:
    """Answers like an author who knows exactly what the rule should do."""

    def __init__(self, reference: RuleSpec | None, reference_data: ReferenceData):
        self.reference = reference
        self.reference_data = reference_data

    def answer(self, question: Question) -> str:
        if question.kind == CASE and self.reference is not None:
            return _status(self.reference, question.case["claim"], self.reference_data)
        return NO_INFORMATION


class Benchmark:
    def __init__(self, backend_root: Path, models: AuthoringModels, mutants: int = 1000):
        self.backend_root = Path(backend_root)
        self.models = models
        self.reference_data = ReferenceData.load(self.backend_root / "rules")
        dataset = [claim for split in SPLITS for claim in load_jsonl(self.backend_root / "data" / split / "claims.jsonl")]
        self.evaluation_claims = dataset + list(mutated_claims(dataset, count=mutants, seed=2026))
        schema = json.loads((self.backend_root / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        self.edge_cases = EdgeCaseGenerator(
            choose_base_claims(load_jsonl(self.backend_root / "data" / "development" / "claims.jsonl")),
            FieldCatalogue.from_backend_root(self.backend_root),
            self.reference_data,
            schema,
        )

    def run(self, items: list[BenchmarkItem], on_result: Callable[[int, ItemResult], None] | None = None) -> dict[str, Any]:
        """Run every item. on_result(position, result) is called as each one finishes."""
        results = []
        for position, item in enumerate(items, start=1):
            results.append(self.run_item(item))
            if on_result is not None:
                on_result(position, results[-1])
        return {"summary": summarise(results), "results": [asdict(result) for result in results]}

    def run_item(self, item: BenchmarkItem) -> ItemResult:
        started = time.monotonic()
        with tempfile.TemporaryDirectory() as workdir:
            root = Path(workdir) / "backend"
            for part in ("rules", "schemas", "data/development"):
                shutil.copytree(self.backend_root / part, root / part)
            rules_db = root / "outputs" / "rules.sqlite3"
            service = RuleAuthoringService(
                backend_root=root,
                rules_db=rules_db,
                drafts=DraftStore(rules_db),
                audit_logger=AuditLogger(AuditStore(root / "outputs" / "audit.jsonl")),
                models=self.models,
                on_rules_changed=lambda: None,
                settings=AuthoringSettings(require_author_confirmation=True, drafts_per_hour=10_000),
            )
            author = SimulatedAuthor(item.reference, self.reference_data)
            try:
                draft = service.submit(item.rule, actor="benchmark")
                for _ in range(MAX_AUTHOR_ROUNDS):
                    service.run(draft.draft_id)
                    draft = service.get_draft(draft.draft_id)
                    if draft.state != AWAITING_AUTHOR:
                        break
                    for question in draft.open_questions():
                        service.answer(draft.draft_id, question.question_id, author.answer(question), "simulated-author")
            finally:
                service.close()

        result = ItemResult(
            item_id=item.item_id,
            title=item.rule["title"],
            classification="",
            final_state=draft.state,
            reason=draft.outcome_reason,
            clarification_questions=sum(q.kind != CASE for q in draft.questions),
            case_questions=sum(q.kind == CASE for q in draft.questions),
            drafter_turns=draft.provenance.get("drafter_turns", 0),
        )
        proposal = parse_spec(draft.proposal["spec"]) if draft.proposal else None
        if proposal is not None and item.reference is not None:
            result.agreement, result.mismatches = self._compare(proposal, item.reference)
            result.oracle_accuracy = self._oracle_accuracy(draft.report, proposal, item.reference)
        result.classification = _classify(item, draft.state, result.agreement)
        result.seconds = round(time.monotonic() - started, 1)
        return result

    def _compare(self, proposal: RuleSpec, reference: RuleSpec) -> tuple[float, dict[str, int]]:
        """Compare on the dataset, mutants, and the boundary cases of both specs.

        Dataset claims alone can miss boundaries entirely (no line may have a
        quantity of exactly 5), so the edge cases of each spec are always added.
        """
        claims = (
            self.evaluation_claims
            + [case.claim for case in self.edge_cases.generate(reference)]
            + [case.claim for case in self.edge_cases.generate(proposal)]
        )
        mismatches: Counter = Counter()
        for claim in claims:
            expected = _status(reference, claim, self.reference_data)
            actual = _status(proposal, claim, self.reference_data)
            if actual != expected:
                mismatches[f"{expected}->{actual}"] += 1
        agreement = 1 - sum(mismatches.values()) / len(claims)
        return round(agreement, 4), dict(mismatches)

    def _oracle_accuracy(self, report: dict | None, proposal: RuleSpec, reference: RuleSpec) -> float | None:
        """Regenerate the (deterministic) edge cases of the final report and score the oracle on them."""
        if not report or not report.get("cases"):
            return None
        by_id = {case.case_id: case.claim for case in self.edge_cases.generate(proposal)}
        scored = [case for case in report["cases"] if case["case_id"] in by_id and case["oracle_status"]]
        if not scored:
            return None
        correct = sum(case["oracle_status"] == _status(reference, by_id[case["case_id"]], self.reference_data)
                      for case in scored)
        return round(correct / len(scored), 4)


def summarise(results: list[ItemResult]) -> dict[str, Any]:
    counts = Counter(result.classification for result in results)
    accuracies = [result.oracle_accuracy for result in results if result.oracle_accuracy is not None]
    return {
        "rules": len(results),
        "classifications": dict(counts),
        "wrongly_accepted": counts.get("wrongly_accepted", 0),
        "questions_asked": sum(r.clarification_questions + r.case_questions for r in results),
        "mean_oracle_accuracy": round(sum(accuracies) / len(accuracies), 4) if accuracies else None,
        "total_seconds": round(sum(result.seconds for result in results), 1),
    }


def _classify(item: BenchmarkItem, state: str, agreement: float | None) -> str:
    accepted = state == AWAITING_CONFIRMATION
    if item.expect_unsupported:
        return "wrongly_accepted" if accepted else "correctly_unsupported"
    if accepted:
        return "correct" if agreement == 1.0 else "wrongly_accepted"
    if agreement == 1.0:
        return "rejected_but_correct"
    return "rejected"


def _status(spec: RuleSpec, claim: dict[str, Any], reference: ReferenceData) -> str:
    try:
        return evaluate_rule(spec, claim, reference).status
    except EvaluationLimitExceeded:
        return "ERROR"


def _rule_text(rule: dict[str, Any]) -> dict[str, Any]:
    return {key: rule[key] for key in ("title", "severity", "logic", "corrective_action")}
