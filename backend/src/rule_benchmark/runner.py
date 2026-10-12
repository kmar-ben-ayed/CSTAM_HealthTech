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

import hashlib
import json
import shutil
import tempfile
import threading
import time
from collections import Counter
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

from audit.logger import AuditLogger
from audit.store import AuditStore
from rule_authoring.drafts import (
    AWAITING_AUTHOR,
    AWAITING_CONFIRMATION,
    CASE,
    CHOICE,
    EXAMPLE,
    SITUATION,
    Draft,
    DraftStore,
    Question,
)
from rule_authoring.checks import claim_key
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims
from rule_authoring.llm import AuthoringModels, ChatModel, ModelError, ModelFormatError, last_call
from rule_authoring.missing_data import IT_DEPENDS
from rule_authoring.service import AuthoringSettings, RuleAuthoringService
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import RuleSpec, parse_spec
from rule_engine.spec_store import reference_seed_file

from .mutations import mutated_claims
from .official import Gate, expected_outcomes, official_claims
from .official import metrics as official_metrics
from .official import score as official_score

INVENTED_RULES = Path(__file__).resolve().parent / "invented_rules.json"
# Ten rules covering every kind of check, past failures and one rule the language cannot
# express: a quick measurement (about ten minutes) before running the whole set.
QUICK_SET = ("R001", "R003", "R011", "R012", "R014", "INV-03", "INV-07", "INV-14", "INV-17", "INV-20")
NO_INFORMATION = "No further information is available: follow the rule text as written."
# The author corrects one field at a time, so a rule wrong on many fields needs many rounds.
MAX_AUTHOR_ROUNDS = 20
EXAMPLES_PER_REQUEST = 4  # example claims the simulated author gives when the drafter is stuck


@dataclass
class BenchmarkItem:
    item_id: str
    rule: dict[str, Any]
    reference: RuleSpec | None
    expect_unsupported: bool = False
    # An official rule's expected results, (split, claim id) -> status: it is judged on those only.
    expected: dict[tuple[str, str], str] = field(default_factory=dict)


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
    situation_questions: int = 0  # missing-data situations asked before the table (missing_data.py)
    oracle_accuracy: float | None = None  # share of generated cases the oracle predicted correctly
    corrections: int = 0  # test claim outcomes the simulated author corrected
    confirmations: int = 0  # outcomes it checked on the way and confirmed, kept as tests later drafts must pass
    drafter_turns: int = 0
    seconds: float = 0.0
    proposal: dict[str, Any] | None = None  # the final drafted spec, to diagnose a wrong one
    unreadable_replies: list[str] = field(default_factory=list)  # raw replies the repairs could not read
    # An official rule on the official data, as evaluate.py counts it: claims, agree, tp, fp, fn,
    # issue_f1, status_accuracy, mismatches (a rule not produced is NOT_IMPLEMENTED everywhere).
    official: dict[str, Any] | None = None
    # Whether the official rule's draft would replace the rule running today (official.Gate):
    # deploy, why_not, and the development (decided on) and held-out scores.
    gate: dict[str, Any] | None = None
    # Seconds until the first draft that passed every check would clear the gate: how long the
    # admin waits for a deployable rule (an official rule; None if no draft ever did).
    first_deployable_seconds: float | None = None


def reference_items(backend_root: Path) -> list[BenchmarkItem]:
    """R001-R015: the English text from rules.json, judged on the official expected results.

    The reference seed answers for the generated test claims (which have no official outcome);
    the rule's score comes from the official data only."""
    catalogue = {rule["rule_id"]: rule for rule in json.loads((backend_root / "rules" / "rules.json").read_text(encoding="utf-8"))}
    seed = json.loads(reference_seed_file(backend_root).read_text(encoding="utf-8"))
    expected = expected_outcomes(backend_root)
    return [
        BenchmarkItem(rule_id, _rule_text(catalogue[rule_id]), parse_spec(entry["spec"]), expected=expected.get(rule_id, {}))
        for rule_id, entry in seed["specs"].items()
    ]


def invented_items(path: Path = INVENTED_RULES) -> list[BenchmarkItem]:
    items = []
    for entry in json.loads(path.read_text(encoding="utf-8")):
        reference = parse_spec(entry["reference_spec"]) if entry.get("reference_spec") else None
        items.append(BenchmarkItem(entry["id"], entry["rule"], reference, entry.get("expect_unsupported", False)))
    return items


@dataclass
class Review:
    """An author's verdicts on a draft's test claims: (case id, the right outcome) pairs."""

    corrections: list[tuple[str, str]] = field(default_factory=list)  # outcomes the draft gets wrong
    confirmations: list[tuple[str, str]] = field(default_factory=list)  # outcomes checked and right

    @property
    def verdicts(self) -> list[tuple[str, str]]:
        return self.corrections + self.confirmations


class SimulatedAuthor:
    """Answers like an author who knows exactly what the rule should do."""

    def __init__(self, reference: RuleSpec | None, reference_data: ReferenceData):
        self.reference = reference
        self.reference_data = reference_data

    def answer(self, question: Question, draft: Draft | None = None) -> str:
        if question.kind == CHOICE:
            # Like an admin who does not want to wait: the best draft that passed every check if
            # there is one, else example claims (twice at most), else cancel.
            actions = [item["action"] for item in question.choice or []]
            if "use" in actions:
                return question.options[actions.index("use")]
            asked = sum(q.kind == EXAMPLE for q in draft.questions) if draft is not None else 0
            if self.reference is not None and asked < 2 and "examples" in actions:
                return question.options[actions.index("examples")]
            return question.options[actions.index("cancel")]
        if question.kind == CASE and self.reference is not None:
            return _status(self.reference, question.case["claim"], self.reference_data)
        if question.kind == SITUATION:
            # One outcome only when the rule decides every claim of the situation alike.
            outcomes = {_status(self.reference, case["claim"], self.reference_data)
                        for case in question.situation["cases"]} if self.reference is not None else set()
            return outcomes.pop() if len(outcomes) == 1 and "ERROR" not in outcomes else IT_DEPENDS
        return NO_INFORMATION

    def review(self, draft: Draft, edge_cases: EdgeCaseGenerator) -> Review:
        """The author's review of a draft's test claims, one field at a time.

        The fields are reviewed in the table's order. At the first field with a wrong outcome
        the review stops: its wrong outcomes are corrected, and the drafter fixes them before
        the next field is looked at (one clear thing to fix at a time). Every outcome checked
        up to there and found right is confirmed, so the next draft must keep it: a draft
        once fixed one corrected outcome and broke 15 right ones that nothing protected.
        Nothing is sent when every outcome is right: the draft is ready.
        """
        if draft.state != AWAITING_CONFIRMATION or not draft.proposal or self.reference is None:
            return Review()
        shown = {case["case_id"]: case["spec_status"] for case in (draft.report or {}).get("cases", [])}
        # Outcomes the author dropped by choosing a draft are not raised again.
        waived = {item["claim_key"] for item in draft.waived}
        by_field: dict[str, list[tuple[str, str, bool]]] = {}
        for case in edge_cases.generate(parse_spec(draft.proposal["spec"]), draft.rule):
            if case.case_id in shown and claim_key(case.claim) not in waived:
                expected = _status(self.reference, case.claim, self.reference_data)
                by_field.setdefault(case.field, []).append((case.case_id, expected, shown[case.case_id] == expected))
        confirmations: list[tuple[str, str]] = []
        for rows in by_field.values():
            confirmations += [(case_id, expected) for case_id, expected, right in rows if right]
            wrong = [(case_id, expected) for case_id, expected, right in rows if not right]
            if wrong:
                return Review(wrong, confirmations)
        return Review()

    def examples(self, draft: Draft, pool: list[dict[str, Any]], count: int = EXAMPLES_PER_REQUEST) -> list[tuple[dict, str]]:
        """Example claims for a stuck drafter: claims from the pool (development claims only, so
        the official scoring stays on claims the drafter never saw) with the outcome the rule gives.

        Outcomes the draft has no example of come first, one claim per outcome in turn; within
        an outcome, claims with more missing values first, as those show the edge cases.
        """
        if self.reference is None:
            return []
        have = Counter(example.expected_status for example in draft.examples)
        given = {json.dumps(example.claim, sort_keys=True) for example in draft.examples}
        by_outcome: dict[str, list[dict]] = {}
        for claim in pool:
            outcome = _status(self.reference, claim, self.reference_data)
            if outcome != "ERROR" and json.dumps(claim, sort_keys=True) not in given:
                by_outcome.setdefault(outcome, []).append(claim)
        for claims in by_outcome.values():
            claims.sort(key=_missing_values, reverse=True)  # stable: dataset order among equals
        order = sorted(by_outcome, key=lambda outcome: (have[outcome], len(by_outcome[outcome])))
        chosen: list[tuple[dict, str]] = []
        while len(chosen) < count and any(by_outcome[outcome] for outcome in order):
            for outcome in order:
                if by_outcome[outcome] and len(chosen) < count:
                    chosen.append((by_outcome[outcome].pop(0), outcome))
        return chosen


class Benchmark:
    def __init__(
        self,
        backend_root: Path,
        models: AuthoringModels,
        mutants: int = 1000,
        settings: AuthoringSettings | None = None,
        author_corrects: bool = True,
        record: Path | None = None,
        gate: Gate | None = None,
    ):
        self.backend_root = Path(backend_root)
        self.models = models
        # Every model reply of every item, one JSON line each, to study failures offline.
        self.sink = ReplySink(Path(record)) if record else None
        # The benchmark always needs the confirmation step (it classifies the proposal
        # waiting there) and must not be rate-limited; the drafter limits are tunable.
        self.settings = replace(settings or AuthoringSettings(), require_author_confirmation=True, drafts_per_hour=10_000)
        # The simulated author checks the case table of each draft awaiting confirmation
        # and corrects every outcome that differs from the reference, like a real author.
        self.author_corrects = author_corrects
        self.reference_data = ReferenceData.load(self.backend_root / "rules")
        self.gate = gate or Gate()
        self.official_claims = official_claims(self.backend_root)
        dataset = [claim for _, claim in self.official_claims]
        # Invented rules have no official data: their proposals are compared with the reference
        # on the dataset and mutated claims. Official rules are judged on the official data only.
        self.evaluation_claims = dataset + list(mutated_claims(dataset, count=mutants, seed=2026))
        schema = json.loads((self.backend_root / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        # Example claims a stuck drafter gets come from the development split only.
        self.example_pool = load_jsonl(self.backend_root / "data" / "development" / "claims.jsonl")
        self.edge_cases = EdgeCaseGenerator(
            choose_base_claims(self.example_pool),
            FieldCatalogue.from_backend_root(self.backend_root),
            self.reference_data,
            schema,
        )

    def run(self, items: list[BenchmarkItem], on_result: Callable[[int, ItemResult], None] | None = None,
            workers: int = 1) -> dict[str, Any]:
        """Run every item, `workers` at a time. on_result(position, result) is called as
        each one finishes; the report keeps the items' order. Each item drafts in its own
        temporary copy of the backend, so items never share state."""
        results: list[ItemResult | None] = [None] * len(items)
        lock = threading.Lock()
        finished = 0

        def run_one(index: int) -> None:
            nonlocal finished
            result = self.run_item(items[index])
            with lock:
                results[index] = result
                finished += 1
                if on_result is not None:
                    on_result(finished, result)

        if workers <= 1:
            for index in range(len(items)):
                run_one(index)
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for future in [pool.submit(run_one, index) for index in range(len(items))]:
                    future.result()
        done = [result for result in results if result is not None]
        return {"summary": summarise(done), "results": [asdict(result) for result in done]}

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
                models=self._models_for(item),
                on_rules_changed=lambda: None,
                settings=self.settings,
            )
            author = SimulatedAuthor(item.reference, self.reference_data)
            log = DraftLog(self.sink, item.item_id)
            corrections = 0
            first_deployable, judged = None, 0
            try:
                draft = service.submit(item.rule, actor="benchmark")
                for _ in range(MAX_AUTHOR_ROUNDS):
                    service.run(draft.draft_id)
                    draft = service.get_draft(draft.draft_id)
                    log.update(draft)
                    if first_deployable is None and item.expected:
                        # How long the admin waits for a draft good enough to deploy: the first
                        # draft that passed every check and clears the gate on the official data.
                        for good in draft.good_drafts[judged:]:
                            verdict = self.gate.judge(parse_spec(good["proposal"]["spec"]), item.expected,
                                                      self.official_claims, self.reference_data)
                            if verdict["deploy"]:
                                first_deployable = round(time.monotonic() - started, 1)
                                break
                        judged = len(draft.good_drafts)
                    if draft.state == AWAITING_AUTHOR:
                        asked = {question.question_id for question in draft.open_questions()}
                        answer_open_questions(service, draft, author, self.example_pool, "simulated-author")
                        log.answers(service.get_draft(draft.draft_id), asked)
                        continue
                    if draft.chosen:
                        break  # it chose this draft over drafting more: it confirms it, as an admin would
                    review = author.review(draft, self.edge_cases) if self.author_corrects else Review()
                    if not review.corrections:
                        break
                    log.review(draft, review)
                    corrections += len(review.corrections)
                    draft = service.correct(draft.draft_id, review.verdicts, "simulated-author")
                final = service.get_draft(draft.draft_id)
                log.update(final)
                log.write("finished", state=final.state, reason=final.outcome_reason)
            finally:
                service.close()

        result = ItemResult(
            item_id=item.item_id,
            title=item.rule["title"],
            classification="",
            final_state=draft.state,
            reason=draft.outcome_reason,
            clarification_questions=sum(q.kind not in (CASE, SITUATION) for q in draft.questions),
            case_questions=sum(q.kind == CASE for q in draft.questions),
            situation_questions=sum(q.kind == SITUATION for q in draft.questions),
            drafter_turns=draft.provenance.get("drafter_turns", 0),
            corrections=corrections,
            confirmations=sum(example.confirmed for example in draft.examples),
            first_deployable_seconds=first_deployable,
            proposal=draft.proposal["spec"] if draft.proposal else None,
            unreadable_replies=draft.provenance.get("unreadable_replies", []),
        )
        proposal = parse_spec(draft.proposal["spec"]) if draft.proposal else None
        if item.expected:
            # An official rule: its score is the official data's, never the reference's opinion.
            result.official = official_score(proposal, item.expected, self.official_claims, self.reference_data)
            result.gate = self.gate.judge(proposal, item.expected, self.official_claims, self.reference_data)
            if proposal is not None:
                result.agreement = result.official["status_accuracy"]
                result.mismatches = result.official["mismatches"]
        elif proposal is not None and item.reference is not None:
            result.agreement, result.mismatches = self._compare(proposal, item.reference)
        if proposal is not None and item.reference is not None:
            result.oracle_accuracy = self._oracle_accuracy(draft, proposal, item.reference)
        result.classification = _classify(item, draft.state, result.agreement)
        result.seconds = round(time.monotonic() - started, 1)
        return result

    def _models_for(self, item: BenchmarkItem) -> AuthoringModels:
        if self.sink is None or self.models is None:
            return self.models
        return AuthoringModels(
            drafter=RecordingModel(self.models.drafter, f"{item.item_id}/drafter", self.sink),
            oracle=RecordingModel(self.models.oracle, f"{item.item_id}/oracle", self.sink),
        )

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

    def _oracle_accuracy(self, draft: Draft, proposal: RuleSpec, reference: RuleSpec) -> float | None:
        """Regenerate the (deterministic) edge cases of the final report and score the oracle on them."""
        report = draft.report
        if not report or not report.get("cases"):
            return None
        by_id = {case.case_id: case.claim for case in self.edge_cases.generate(proposal, draft.rule)}
        scored = [case for case in report["cases"] if case["case_id"] in by_id and case["oracle_status"]]
        if not scored:
            return None
        correct = sum(case["oracle_status"] == _status(reference, by_id[case["case_id"]], self.reference_data)
                      for case in scored)
        return round(correct / len(scored), 4)


class ReplySink:
    """Appends one JSON line per model call to a file, safely from several threads."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("", encoding="utf-8")
        self._lock = threading.Lock()
        self._written: set[str] = set()

    def write_once(self, key: str, record: dict[str, Any]) -> None:
        """A record written only the first time its key is seen (inputs that never change)."""
        with self._lock:
            if key in self._written:
                return
            self._written.add(key)
        self.write(record)

    def write(self, record: dict[str, Any]) -> None:
        # Milliseconds: the pipeline's events and the model calls are put back in order by time.
        line = json.dumps({"time": round(time.time(), 3), **record}, ensure_ascii=False)
        with self._lock, self.path.open("a", encoding="utf-8") as file:
            file.write(line + "\n")


class DraftLog:
    """Writes what happens to a draft into the drafting log, next to the model calls, so one
    file tells the whole story (check_drafting_log.py reads it): the pipeline's own events with
    their time (checks passed or failed and why, questions, state changes), each question with
    the answer given, each correction (the draft's outcome and the right one) and the outcomes
    confirmed. Without it these lived only in the run's temporary database."""

    def __init__(self, sink: ReplySink | None, rule_id: str):
        self.sink = sink
        self.label = f"{rule_id}/pipeline"
        self.events_seen = 0
        self.questions_seen: set[str] = set()
        self.reports_seen: set[str] = set()

    def write(self, event: str, when: float | None = None, **details: Any) -> None:
        if self.sink is not None:
            self.sink.write({**({"time": round(when, 3)} if when else {}), "call": self.label, "event": event, **details})

    def update(self, draft: Draft) -> None:
        """The draft's new events since the last update, and the questions it now asks."""
        for event in draft.events[self.events_seen:]:
            self.write(event["event"], datetime.fromisoformat(event["at"]).timestamp(), detail=event["detail"],
                       state=draft.state)
        self.events_seen = len(draft.events)
        report = draft.report
        if draft.state == AWAITING_CONFIRMATION and report and json.dumps(report, sort_keys=True) not in self.reports_seen:
            self.reports_seen.add(json.dumps(report, sort_keys=True))
            self.write("ready for review", checks=[check["name"] for check in report.get("checks", []) if check["passed"]],
                       outcomes=dict(Counter(case["spec_status"] for case in report.get("cases", []))))
        for question in draft.open_questions():
            if question.question_id in self.questions_seen:
                continue
            self.questions_seen.add(question.question_id)
            self.write("asked", kind=question.kind, text=question.text, options=question.options[:6],
                       claims=[{"description": case["description"], "drafted": case["drafted_rule_says"]}
                               for case in (question.situation or {}).get("cases", [])])

    def answers(self, draft: Draft, before: set[str]) -> None:
        for question in draft.questions:
            if question.question_id in before and question.answer is not None:
                self.write("admin answered", kind=question.kind, question=question.text[:300], answer=question.answer)

    def review(self, draft: Draft, review: Review) -> None:
        shown = {case["case_id"]: case for case in (draft.report or {}).get("cases", [])}
        self.write("admin review", corrections=[{"description": shown[case_id]["description"], "drafted": shown[case_id]["spec_status"],
                                           "right": right} for case_id, right in review.corrections if case_id in shown],
                   confirmed=len(review.confirmations))


# The parts of the drafter's task that are the same in every session: left out of the record.
STATIC_TASK_KEYS = ("claim_fields", "example_claim", "reference_data", "reference_files")


def what_was_sent(messages: list[dict[str, str]]) -> Any:
    """The message our code sent just before a model call (the task, or a tool's result), so
    a log shows both sides: what the model was told, and what it did with it."""
    content = messages[-1]["content"] if messages else ""
    try:
        data = json.loads(content)
    except ValueError:
        return content
    if isinstance(data, dict):
        return {key: value for key, value in data.items() if key not in STATIC_TASK_KEYS}
    return data


def fixed_inputs(messages: list[dict[str, str]]) -> dict[str, Any] | None:
    """At the start of a session: the system prompt and the parts of the task left out of
    "sent" (the same in every session), or None for any other call."""
    if len(messages) < 2 or messages[0].get("role") != "system":
        return None
    try:
        task = json.loads(messages[1]["content"])
    except ValueError:
        task = {}
    static = {key: task[key] for key in STATIC_TASK_KEYS if isinstance(task, dict) and key in task}
    return {"system_prompt": messages[0]["content"], "task_unchanging_parts": static}


class RecordingModel:
    """A chat model that records every reply it returns (or could not read), with the
    message our code sent before it."""

    def __init__(self, inner: ChatModel, label: str, sink: ReplySink):
        self.inner = inner
        self.label = label
        self.sink = sink
        self.name = inner.name

    def with_temperature(self, temperature: float) -> "RecordingModel":
        inner = getattr(self.inner, "with_temperature", lambda _: self.inner)(temperature)
        return RecordingModel(inner, f"{self.label}@{temperature}", self.sink)

    def complete_json(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        record = {"call": self.label, "turn": len(messages), "sent": what_was_sent(messages)}
        fixed = fixed_inputs(messages)
        if fixed is not None:
            # The model's instructions and the task's unchanging parts, written once per log:
            # with "sent" on every call, the log holds everything the model received.
            key = hashlib.sha256(json.dumps(fixed, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
            self.sink.write_once(key, {"call": self.label, "inputs": key, **fixed})
            record["inputs"] = key
        started = time.monotonic()
        try:
            reply = self.inner.complete_json(messages)
        except ModelFormatError as error:
            self.sink.write({**record, "seconds": round(time.monotonic() - started, 1), "error": str(error), "raw": error.raw})
            raise
        except ModelError as error:
            self.sink.write({**record, "seconds": round(time.monotonic() - started, 1), "error": str(error)})
            raise
        # How long the call took, retries and timeouts included: a stalled provider shows here;
        # "requests" says whether it thought long or was repeated with a bigger budget.
        requests = last_call(self.inner)
        self.sink.write({**record, "seconds": round(time.monotonic() - started, 1), "reply": reply,
                         **({"requests": requests} if requests else {})})
        return reply


def summarise(results: list[ItemResult]) -> dict[str, Any]:
    counts = Counter(result.classification for result in results)
    accuracies = [result.oracle_accuracy for result in results if result.oracle_accuracy is not None]
    official = [result for result in results if result.official]
    combined = Counter()
    for result in official:
        combined.update({key: result.official[key] for key in ("claims", "agree", "tp", "fp", "fn")})
    deployable = [result for result in official if result.gate and result.gate["deploy"]]
    held_out = Counter()
    for result in deployable:
        held_out.update({key: result.gate["held_out"][key] for key in ("claims", "agree", "tp", "fp", "fn")})
    return {
        # The official rules in this run, on the official data, as evaluate.py would score them.
        "official": {"rules": len(official), "produced": sum(r.proposal is not None for r in official),
                     **official_metrics(combined)} if official else None,
        # The drafts that clear the gate (decided on development claims) and would replace the
        # rule running today, with their score on the validation and stress claims.
        "deployable": {"rules": [r.item_id for r in deployable],
                       "held_out": official_metrics(held_out)} if official else None,
        "rules": len(results),
        "classifications": dict(counts),
        "wrongly_accepted": counts.get("wrongly_accepted", 0),
        "questions_asked": sum(r.clarification_questions + r.case_questions + r.situation_questions for r in results),
        "corrections_made": sum(r.corrections for r in results),
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


def _missing_values(node: Any) -> int:
    """How many null values a claim holds (nested)."""
    if node is None:
        return 1
    if isinstance(node, dict):
        return sum(_missing_values(value) for value in node.values())
    if isinstance(node, list):
        return sum(_missing_values(value) for value in node)
    return 0


def answer_open_questions(service: RuleAuthoringService, draft: Draft, author: SimulatedAuthor,
                          example_pool: list[dict[str, Any]], actor: str) -> None:
    """The simulated author answers every open question of a draft waiting for it. A request
    for examples it cannot answer (no reference) cancels the draft, as an author would."""
    for question in draft.open_questions():
        if question.kind == EXAMPLE:
            examples = author.examples(service.get_draft(draft.draft_id), example_pool)
            if not examples:
                service.cancel(draft.draft_id, actor)
                return
            service.add_examples(draft.draft_id, examples, actor)
        else:
            draft = service.get_draft(draft.draft_id)
            if draft.state != AWAITING_AUTHOR or question.question_id not in {q.question_id for q in draft.open_questions()}:
                return  # an earlier answer (cancelling, choosing examples) changed the draft
            service.answer(draft.draft_id, question.question_id, author.answer(question, draft), actor)


def _status(spec: RuleSpec, claim: dict[str, Any], reference: ReferenceData) -> str:
    try:
        return evaluate_rule(spec, claim, reference).status
    except EvaluationLimitExceeded:
        return "ERROR"


def _rule_text(rule: dict[str, Any]) -> dict[str, Any]:
    return {key: rule[key] for key in ("title", "severity", "logic", "corrective_action")}
