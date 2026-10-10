"""The rule-authoring workflow: submit, draft, check, ask, confirm, activate, deactivate.

This service drives the draft state machine (see drafts.py) and is the only
code that activates a drafted rule. Its safety rules:

- A background run never raises. Any unexpected error rejects the draft, so
  nothing half-checked can go live.
- Activation is written to the audit log before it takes effect; if the audit
  write fails, the rule is not activated.
- The spec is re-checked against the current files right before activation.
- Rule ids are assigned by the server and never reused.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from audit.logger import AuditLogger, AuditWriteError
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.interpreter import EvaluationLimitExceeded, evaluate_rule
from rule_engine.language import OUTCOMES, RuleSpec, parse_spec
from rule_engine.readback import describe_spec
from rule_engine.spec_store import (
    RULE_ID_PATTERN,
    SpecStore,
    logic_fingerprint,
    reference_seed_file,
    spec_fingerprint,
)
from rule_engine.validation import check_spec

from .checks import CaseOutcome, DraftChecker
from .drafter import NEEDS_CLARIFICATION, PROPOSED, Drafter, DraftingContext
from .drafts import (
    ACTIVE,
    AWAITING_AUTHOR,
    AWAITING_CONFIRMATION,
    CANCELLED,
    CASE,
    CHECKING,
    CLARIFICATION,
    DRAFTING,
    QUEUED,
    REJECTED,
    Draft,
    DraftStore,
    Question,
)
from .edge_cases import EdgeCaseGenerator, LabelledCase, choose_base_claims
from .llm import AuthoringModels
from .oracle import Oracle
from .prompts import prompt_fingerprint

logger = logging.getLogger(__name__)

RULE_FIELDS = ("title", "severity", "logic", "corrective_action")


class AuthoringError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AuthoringSettings:
    require_author_confirmation: bool = True
    drafts_per_hour: int = 20
    max_rounds: int = 6
    max_case_questions: int = 3  # asked at a time
    max_case_questions_total: int = 6  # per draft; beyond this the rule text is probably ambiguous

    @classmethod
    def from_environment(cls) -> "AuthoringSettings":
        confirmation = (os.getenv("RULE_REQUIRE_AUTHOR_CONFIRMATION") or "true").strip().lower()
        drafts_per_hour = (os.getenv("RULE_DRAFTS_PER_HOUR") or "20").strip()
        return cls(
            require_author_confirmation=confirmation not in ("false", "0", "no"),
            drafts_per_hour=int(drafts_per_hour) if drafts_per_hour.isdigit() else 20,
        )


@dataclass
class _Toolkit:
    drafter: Drafter
    checker: DraftChecker


class RuleAuthoringService:
    def __init__(
        self,
        backend_root: Path,
        rules_db: Path | str,
        drafts: DraftStore,
        audit_logger: AuditLogger,
        models: AuthoringModels | None,
        on_rules_changed: Callable[[], None],
        settings: AuthoringSettings | None = None,
    ):
        self.backend_root = Path(backend_root)
        self.rules_dir = self.backend_root / "rules"
        self.drafts = drafts
        self.audit_logger = audit_logger
        self.models = models
        self.on_rules_changed = on_rules_changed
        self.settings = settings or AuthoringSettings()
        self.specs = SpecStore(rules_db, reference_seed_file(self.backend_root))
        self.fields = FieldCatalogue.from_backend_root(self.backend_root)
        self.claim_schema = json.loads((self.backend_root / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        self._catalogue_lock = threading.Lock()
        self._run_locks: dict[str, threading.Lock] = {}
        self._run_locks_guard = threading.Lock()
        for draft in self.drafts.reject_interrupted():
            self._audit(draft, "rule_draft_rejected", {"reason": draft.outcome_reason}, required=False)

    def close(self) -> None:
        self.specs.close()

    # ------------------------------------------------------------------ reads

    def list_rules(self) -> list[dict[str, Any]]:
        catalogue = self._read_catalogue()
        loaded = self.specs.load_active(catalogue, self.fields)
        rows = []
        for rule in catalogue:
            rule_id = rule["rule_id"]
            stored = loaded.active.get(rule_id)
            open_draft = self.drafts.open_draft_for(rule_id)
            rows.append({
                **{key: rule.get(key) for key in ("rule_id", "title", "severity", "version", "logic")},
                "status": "active" if stored else "inactive",
                "inactive_reason": loaded.inactive.get(rule_id),
                "revision": stored.revision if stored else None,
                "origin": stored.origin if stored else None,
                "open_draft_id": open_draft.draft_id if open_draft else None,
            })
        return rows

    def rule_detail(self, rule_id: str) -> dict[str, Any]:
        rule = next((r for r in self._read_catalogue() if r["rule_id"] == rule_id), None)
        if rule is None:
            raise AuthoringError(404, "rule_not_found", "Unknown rule ID")
        loaded = self.specs.load_active([rule], self.fields)
        stored = loaded.active.get(rule_id)
        return {
            "rule": rule,
            "active": None if stored is None else {**stored.to_json(), "readback": describe_spec(stored.spec)},
            "inactive_reason": loaded.inactive.get(rule_id),
            "history": self.specs.history(rule_id),
        }

    def get_draft(self, draft_id: str) -> Draft:
        draft = self.drafts.get(draft_id)
        if draft is None:
            raise AuthoringError(404, "draft_not_found", "Unknown draft ID")
        return draft

    def list_drafts(self, limit: int = 50) -> list[Draft]:
        return self.drafts.list(limit)

    # ---------------------------------------------------------------- actions

    def submit(self, rule_fields: dict[str, Any], actor: str, rule_id: str | None = None) -> Draft:
        """Start drafting a new rule, or a new revision of an existing one."""
        since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        if self.drafts.count_created_since(since) >= self.settings.drafts_per_hour:
            raise AuthoringError(429, "too_many_drafts", "Too many rule drafts in the last hour; try again later")

        with self._catalogue_lock:
            catalogue = self._read_catalogue()
            if rule_id is None:
                kind, rule_id = "new", self._next_rule_id(catalogue)
            else:
                if not any(rule["rule_id"] == rule_id for rule in catalogue):
                    raise AuthoringError(404, "rule_not_found", "Unknown rule ID")
                kind = "revision"
            if self.drafts.open_draft_for(rule_id) is not None:
                raise AuthoringError(409, "draft_in_progress", f"{rule_id} already has a draft in progress")

            draft = Draft(
                draft_id=uuid4().hex,
                rule_id=rule_id,
                kind=kind,
                rule={key: rule_fields[key] for key in RULE_FIELDS},
                author=actor,
            )
            draft.log("submitted", f"by {actor}")
            self._audit(draft, "rule_draft_submitted", {
                "kind": kind,
                "logic_sha256": logic_fingerprint(draft.rule["logic"]),
            }, actor=actor)
            return self.drafts.save(draft)

    def run(self, draft_id: str) -> None:
        """Advance a queued draft as far as it can go. Safe to call from a background task."""
        lock = self._run_lock(draft_id)
        if not lock.acquire(blocking=False):
            return  # already running
        try:
            draft = self.drafts.get(draft_id)
            if draft is None or draft.state != QUEUED:
                return
            try:
                self._advance(draft)
            except Exception:  # last line of defence: never leave a draft half-checked
                logger.exception("drafting %s stopped by an unexpected error", draft_id)
                self._reject(draft, "an internal error stopped the drafting; nothing was activated")
        finally:
            lock.release()

    def answer(self, draft_id: str, question_id: str, answer: str, actor: str) -> Draft:
        draft = self.get_draft(draft_id)
        if draft.state != AWAITING_AUTHOR:
            raise AuthoringError(409, "not_awaiting_author", "This draft is not waiting for an answer")
        question = next((q for q in draft.open_questions() if q.question_id == question_id), None)
        if question is None:
            raise AuthoringError(404, "question_not_found", "No open question with this ID")

        answer = answer.strip()
        if question.kind == CASE:
            if answer not in OUTCOMES:
                raise AuthoringError(422, "invalid_answer", "Answer with one of: " + ", ".join(OUTCOMES))
            draft.examples.append(LabelledCase(
                description=question.case["description"],
                claim=question.case["claim"],
                expected_status=answer,
            ))
        else:
            draft.author_answers.append({"question": question.text, "answer": answer})
            draft.proposal = None  # new information: draft again
        question.answer = answer
        question.answered_by = actor
        draft.log("answered", f"{question.kind} question {question.question_id} by {actor}")
        self._audit(draft, "rule_draft_answered", {
            "question_id": question.question_id,
            "question_kind": question.kind,
            "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
        }, actor=actor)
        if not draft.open_questions():
            draft.state = QUEUED
        return self.drafts.save(draft)

    def confirm(self, draft_id: str, actor: str) -> Draft:
        draft = self.get_draft(draft_id)
        if draft.state != AWAITING_CONFIRMATION or not (draft.report or {}).get("passed"):
            raise AuthoringError(409, "not_ready", "Only a draft that passed every check can be confirmed")
        return self._activate(draft, actor)

    def cancel(self, draft_id: str, actor: str) -> Draft:
        draft = self.get_draft(draft_id)
        if not draft.is_open:
            raise AuthoringError(409, "draft_closed", f"This draft is already {draft.state}")
        draft.state = CANCELLED
        draft.log("cancelled", f"by {actor}")
        self._audit(draft, "rule_draft_cancelled", {}, actor=actor)
        return self.drafts.save(draft)

    def deactivate(self, rule_id: str, actor: str) -> dict[str, Any]:
        """The kill switch: stop running a rule immediately. Its history is kept."""
        with self._catalogue_lock:
            if not self.specs.is_active(rule_id):  # does not parse the spec: works even if it is corrupted
                raise AuthoringError(409, "rule_not_active", f"{rule_id} is not active")
            self._audit_rule(rule_id, "rule_deactivated", {}, actor)
            self.specs.deactivate(rule_id)
        self.on_rules_changed()
        return {"rule_id": rule_id, "status": "inactive"}

    # ------------------------------------------------------------ the workflow

    def _advance(self, draft: Draft) -> None:
        if self.models is None:
            self._reject(draft, "no language model is configured (OPENAI_API_KEY), so the rule cannot be drafted")
            return
        toolkit = self._toolkit()
        draft.provenance.update(self._model_provenance())

        while draft.rounds < self.settings.max_rounds:
            draft.rounds += 1
            spec = self._usable_proposal(draft)
            if spec is None:
                self._set_state(draft, DRAFTING)
                result = toolkit.drafter.draft(DraftingContext(
                    rule=draft.rule,
                    author_answers=draft.author_answers,
                    author_examples=draft.examples,
                    feedback=draft.feedback,
                ))
                draft.provenance["drafter_turns"] = draft.provenance.get("drafter_turns", 0) + result.turns
                if result.outcome == NEEDS_CLARIFICATION:
                    self._ask(draft, [Question(question_id=uuid4().hex[:8], kind=CLARIFICATION, text=result.question)])
                    return
                if result.outcome != PROPOSED:
                    self._reject(draft, f"the drafter could not produce a rule ({result.outcome}): {result.reason}")
                    return
                spec = result.spec
                draft.proposal = {"spec": spec.to_json(), "intent": result.intent, "assumptions": result.assumptions}

            self._set_state(draft, CHECKING)
            report = toolkit.checker.run(draft.rule, spec, draft.examples)
            draft.report = report.to_json()
            self._audit(draft, "rule_draft_checked", {
                "passed": report.passed,
                "spec_sha256": spec_fingerprint(spec),
                "report_sha256": _fingerprint(draft.report),
                "disagreements": len(report.disagreements),
            })
            if report.cases and all(case.oracle_status is None for case in report.cases):
                self._reject(draft, "the independent reading is unavailable, so the draft cannot be verified")
                return
            if report.passed:
                if self.settings.require_author_confirmation:
                    draft.log("checks passed", "waiting for the author to confirm the readback")
                    self._set_state(draft, AWAITING_CONFIRMATION)
                else:
                    self._activate(draft, actor="automatic")
                return
            if report.only_disagreements_remain():
                asked = sum(question.kind == CASE for question in draft.questions)
                if not report.disagreements:
                    self._reject(draft, "the independent reading was too unstable to verify this rule; "
                                        "try rewording it more explicitly")
                elif asked >= self.settings.max_case_questions_total:
                    self._reject(draft, f"the two readings still disagree after {asked} questions; the rule "
                                        "text is probably ambiguous, so consider rewording it")
                else:
                    room = self.settings.max_case_questions_total - asked
                    self._ask(draft, self._case_questions(report.disagreements)[:room])
                return
            draft.feedback = report.feedback_for_drafter()
            draft.proposal = None
            draft.log("checks failed", "; ".join(draft.feedback)[:500])

        self._reject(draft, f"the checks still failed after {self.settings.max_rounds} rounds")

    def _usable_proposal(self, draft: Draft) -> RuleSpec | None:
        """Keep the last proposal if it still matches every example the author confirmed."""
        if draft.proposal is None:
            return None
        spec = parse_spec(draft.proposal["spec"])
        reference = ReferenceData.load(self.rules_dir)

        def outcome(claim):
            try:
                return evaluate_rule(spec, claim, reference).status
            except EvaluationLimitExceeded:
                return "ERROR"

        mismatches = [
            example.description for example in draft.examples
            if outcome(example.claim) != example.expected_status
        ]
        if mismatches:
            draft.feedback = [f'the author confirmed a different outcome for "{d}"' for d in mismatches]
            draft.proposal = None
            return None
        return spec

    def _case_questions(self, disagreements: list[CaseOutcome]) -> list[Question]:
        chosen: list[CaseOutcome] = []
        for case in sorted(disagreements, key=lambda c: c.oracle_status is None):
            if len(chosen) >= self.settings.max_case_questions:
                break
            chosen.append(case)
        return [
            Question(
                question_id=uuid4().hex[:8],
                kind=CASE,
                text=f"What should this rule decide for a claim where {case.description}?",
                case={
                    "description": case.description,
                    "claim": case.claim,
                    "drafted_rule_says": case.spec_status,
                    "independent_reading_says": case.oracle_status,
                    "independent_reading_reason": case.oracle_reason,
                    "options": list(OUTCOMES),
                },
            )
            for case in chosen
        ]

    def _ask(self, draft: Draft, questions: list[Question]) -> None:
        draft.questions.extend(questions)
        for question in questions:
            draft.log("question", question.text)
            self._audit(draft, "rule_draft_question", {"question_id": question.question_id, "question_kind": question.kind})
        self._set_state(draft, AWAITING_AUTHOR)

    def _activate(self, draft: Draft, actor: str) -> Draft:
        spec = parse_spec(draft.proposal["spec"])
        with self._catalogue_lock:
            problems = check_spec(spec, FieldCatalogue.from_backend_root(self.backend_root))
            if problems:
                return self._reject(draft, "the spec no longer passes the checks: " + "; ".join(problems))
            catalogue = self._read_catalogue()
            entry = self._catalogue_entry(draft, catalogue)
            provenance = {
                "draft_id": draft.draft_id,
                "report_sha256": _fingerprint(draft.report),
                "confirmed_by": actor,
                **draft.provenance,
            }
            # Audit first: a rule never goes live without a record of it.
            self._audit(draft, "rule_activated", {
                "spec_sha256": spec_fingerprint(spec),
                "logic_sha256": logic_fingerprint(entry["logic"]),
                "version": entry["version"],
                **{key: provenance[key] for key in ("drafter_model", "oracle_model") if key in provenance},
            }, actor=actor)
            stored = self.specs.activate(draft.rule_id, spec, entry["logic"], origin="agent", actor=actor,
                                         provenance=provenance)
            self._write_catalogue(_with_entry(catalogue, entry))
        draft.provenance["revision"] = stored.revision
        draft.state = ACTIVE
        draft.log("activated", f"revision {stored.revision} by {actor}")
        self.drafts.save(draft)
        self.on_rules_changed()
        return draft

    def _reject(self, draft: Draft, reason: str) -> Draft:
        draft.state = REJECTED
        draft.outcome_reason = reason
        draft.log("rejected", reason)
        self._audit(draft, "rule_draft_rejected", {"reason": reason[:300]}, required=False)
        return self.drafts.save(draft)

    def _set_state(self, draft: Draft, state: str) -> None:
        draft.state = state
        self.drafts.save(draft)

    # ---------------------------------------------------------------- helpers

    def _toolkit(self) -> _Toolkit:
        reference = ReferenceData.load(self.rules_dir)
        claims = self._development_claims()
        generator = EdgeCaseGenerator(choose_base_claims(claims), self.fields, reference, self.claim_schema)
        oracle = Oracle(self.models.oracle, reference)
        return _Toolkit(
            drafter=Drafter(self.models.drafter, self.fields, reference, generator),
            checker=DraftChecker(self.fields, reference, generator, oracle, claims),
        )

    def _model_provenance(self) -> dict[str, Any]:
        return {
            "drafter_model": self.models.drafter.name,
            "oracle_model": self.models.oracle.name,
            "drafter_prompt_sha256": prompt_fingerprint("drafter"),
            "oracle_prompt_sha256": prompt_fingerprint("oracle"),
        }

    def _development_claims(self) -> list[dict[str, Any]]:
        path = self.backend_root / "data" / "development" / "claims.jsonl"
        with path.open(encoding="utf-8") as stream:
            return [json.loads(line) for line in stream if line.strip()]

    def _read_catalogue(self) -> list[dict[str, Any]]:
        return json.loads((self.rules_dir / "rules.json").read_text(encoding="utf-8"))

    def _write_catalogue(self, catalogue: list[dict[str, Any]]) -> None:
        path = self.rules_dir / "rules.json"
        temporary = path.with_name(".rules.json.tmp")
        temporary.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(path)

    def _catalogue_entry(self, draft: Draft, catalogue: list[dict[str, Any]]) -> dict[str, Any]:
        existing = next((rule for rule in catalogue if rule["rule_id"] == draft.rule_id), None)
        version = "1.0.0" if existing is None else _next_patch(existing.get("version", "1.0.0"))
        return {
            "rule_id": draft.rule_id,
            **{key: draft.rule[key] for key in RULE_FIELDS},
            "version": version,
            "source": f"rule-authoring/{draft.rule_id}@{version}",
        }

    def _next_rule_id(self, catalogue: list[dict[str, Any]]) -> str:
        """The next unused number. Ids of deleted rules or rejected drafts are never reused."""
        used = {rule["rule_id"] for rule in catalogue} | set(self.drafts.rule_ids()) | self.specs.known_rule_ids()
        numbers = [int(rule_id[1:]) for rule_id in used if RULE_ID_PATTERN.fullmatch(rule_id)]
        return f"R{max(numbers, default=0) + 1:03d}"

    def _run_lock(self, draft_id: str) -> threading.Lock:
        with self._run_locks_guard:
            return self._run_locks.setdefault(draft_id, threading.Lock())

    def _audit(self, draft: Draft, event: str, payload: dict[str, Any], *, actor: str = "rule-authoring",
               required: bool = True) -> None:
        self._audit_rule(draft.rule_id, event, {"draft_id": draft.draft_id, **payload}, actor, required=required)

    def _audit_rule(self, rule_id: str, event: str, payload: dict[str, Any], actor: str, *,
                    required: bool = True) -> None:
        try:
            self.audit_logger.log(event, f"rule:{rule_id}", actor, payload)
        except AuditWriteError as error:
            if required:
                raise AuthoringError(503, "audit_unavailable", "Could not safely record this rule change") from error
            logger.error("could not audit %s for %s", event, rule_id)


def _with_entry(catalogue: list[dict[str, Any]], entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Replace the rule in place (a revision) or append it (a new rule)."""
    if any(rule["rule_id"] == entry["rule_id"] for rule in catalogue):
        return [entry if rule["rule_id"] == entry["rule_id"] else rule for rule in catalogue]
    return [*catalogue, entry]


def _fingerprint(data: Any) -> str:
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _next_patch(version: str) -> str:
    parts = version.split(".")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
    return "1.0.1"
