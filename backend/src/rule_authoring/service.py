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
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from uuid import uuid4

from audit.logger import AuditLogger, AuditWriteError
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import validate_transport
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
from rule_engine.validation import analyse_spec, check_spec

from .checks import Baseline, CaseOutcome, CheckReport, DraftChecker, claim_key
from .committee import Candidate, Committee
from .drafter import FAILED, NEEDS_CLARIFICATION, PROPOSED, UNSUPPORTED, Drafter, DrafterResult, DraftingContext
from .drafts import (
    ACTIVE,
    AWAITING_AUTHOR,
    AWAITING_CONFIRMATION,
    CANCELLED,
    CASE,
    CHECKING,
    CHOICE,
    CLARIFICATION,
    DRAFTING,
    EXAMPLE,
    QUEUED,
    REJECTED,
    SITUATION,
    Draft,
    DraftStore,
    Question,
    now,
)
from .edge_cases import EdgeCaseGenerator, LabelledCase, choose_base_claims, rule_text
from .examples import similar_rules
from .llm import AuthoringModels
from .missing_data import IT_DEPENDS, IT_DEPENDS_OPTION, decided_by_text, question_text, read_answer, situations
from .oracle import Oracle
from .prompts import prompt_fingerprint
from .sheet import quoted_outcomes, reference_sheets

logger = logging.getLogger(__name__)

RULE_FIELDS = ("title", "severity", "logic", "corrective_action")


class AuthoringError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


INDEPENDENT_READING_MODES = ("off", "advice", "block")
DRAFTING_FORMATS = ("spec", "sheet")
MAX_COMMITTEE = 5
# Short answers that only make sense for a yes/no question, and the word they mean.
BARE_ANSWERS = {"yes": "yes", "y": "yes", "oui": "yes", "no": "no", "n": "no", "non": "no"}
MAX_CORRECTIONS = 100
MAX_EXAMPLES = 10  # example claims the author gives at a time
MAX_SITUATION_QUESTIONS = 10  # missing-data questions per draft, over all its rounds
MAX_GOOD_DRAFTS = 5  # drafts that passed every check, kept for the admin to choose from
EMAIL_ADDRESS = re.compile(r"[^@\s<>\"]+@[^@\s<>\"]+\.[^@\s<>\"]+")
MAX_EMAIL_TEXT = 1500  # mail apps truncate long mailto links


@dataclass(frozen=True)
class AuthoringSettings:
    require_author_confirmation: bool = True
    drafts_per_hour: int = 20
    max_rounds: int = 6
    max_case_questions: int = 3  # asked at a time
    max_case_questions_total: int = 6  # per draft; beyond this the rule text is probably ambiguous
    # Room for a small model's slips; drafting runs in the background.
    drafter_max_turns: int = 14  # per drafter session
    drafter_max_invalid_replies: int = 5
    # Reasoning models think 15-160 s before each reply, so a session needs room for ~10 replies.
    drafter_time_budget_seconds: float = 1200.0
    # The second model that reads the English rule independently:
    #   "off"    (default) no second reading. The author checks the rule's outcome on
    #            the generated test claims, and every correction becomes a test.
    #            Confirmation is then always required.
    #   "advice" its disagreements are shown to the author, who confirms or cancels.
    #   "block"  disagreements become questions, and unresolved ones reject the draft.
    independent_reading: str = "off"
    max_clarifications: int = 2  # free questions the drafter may ask per draft
    # "spec": the drafter writes full specs. "sheet": it writes rule sheets (sheet.py),
    # compiled by code, with the full language only for what a sheet cannot say.
    drafting_format: str = "sheet"
    # How many independent drafts to compare (committee.py); 1 drafts once.
    committee_size: int = 1
    # Examples shown to the drafter (the active rules most like the new one):
    #   "drafted"   only rules the drafter wrote and an admin confirmed (nothing hand-written);
    #   "catalogue" every active rule, hand-written ones included;
    #   "none"      no examples (measures the drafter on its own).
    example_source: str = "drafted"
    # In sheet mode, whether the drafter's prompt also holds the full rule language's manual, for
    # what a sheet cannot say (False: sheets only, a shorter prompt and no switching mid-way).
    full_language_fallback: bool = True
    # Who a rule that cannot be generated is escalated to (the email the admin's mail app opens).
    technical_contact: str = ""
    # Once a draft passes the checks, ask the author what missing or unknown data gives, once
    # per situation (missing_data.py), before the test-claim table.
    missing_data_questions: bool = True
    # The longest the admin waits for a draft after their last input: then drafting stops and
    # the admin chooses (a draft that passed every check, more time, examples, or cancelling).
    max_drafting_minutes: float = 10.0
    # A draft that passes every check and gives every outcome the author confirmed goes to the
    # author at once, without the drafter's extra "try" and "propose" turns (drafter.py).
    auto_propose: bool = True
    # When drafting stops, whether "give example claims" is one of the admin's choices. Off
    # until the admin panel has a form for example claims (the API takes them already).
    offer_example_claims: bool = False

    @classmethod
    def from_environment(cls) -> "AuthoringSettings":
        confirmation = (os.getenv("RULE_REQUIRE_AUTHOR_CONFIRMATION") or "true").strip().lower()
        drafts_per_hour = (os.getenv("RULE_DRAFTS_PER_HOUR") or "20").strip()
        reading = (os.getenv("RULE_INDEPENDENT_READING") or "off").strip().lower()
        drafting_format = (os.getenv("RULE_DRAFTING_FORMAT") or "sheet").strip().lower()
        committee = (os.getenv("RULE_COMMITTEE_SIZE") or "1").strip()
        time_budget = (os.getenv("RULE_DRAFTER_TIME_BUDGET") or "").strip()
        fallback = (os.getenv("RULE_FULL_LANGUAGE_FALLBACK") or "true").strip().lower()
        contact = (os.getenv("CLAIMGUARD_TECH_CONTACT_EMAIL") or "").strip()
        missing_data = (os.getenv("RULE_MISSING_DATA_QUESTIONS") or "true").strip().lower()
        minutes = (os.getenv("RULE_MAX_DRAFTING_MINUTES") or "").strip()
        auto = (os.getenv("RULE_AUTO_PROPOSE") or "true").strip().lower()
        offer_examples = (os.getenv("RULE_OFFER_EXAMPLE_CLAIMS") or "false").strip().lower()
        return cls(
            offer_example_claims=offer_examples in ("true", "1", "yes"),
            auto_propose=auto not in ("false", "0", "no"),
            **({"max_drafting_minutes": float(minutes)} if minutes.replace(".", "", 1).isdigit() and float(minutes) > 0 else {}),
            require_author_confirmation=confirmation not in ("false", "0", "no"),
            drafts_per_hour=int(drafts_per_hour) if drafts_per_hour.isdigit() else 20,
            independent_reading=reading if reading in INDEPENDENT_READING_MODES else "off",
            drafting_format=drafting_format if drafting_format in DRAFTING_FORMATS else "spec",
            committee_size=min(int(committee), MAX_COMMITTEE) if committee.isdigit() and int(committee) > 0 else 1,
            **({"drafter_time_budget_seconds": float(time_budget)} if time_budget.isdigit() else {}),
            full_language_fallback=fallback not in ("false", "0", "no"),
            technical_contact=contact if EMAIL_ADDRESS.fullmatch(contact) else "",
            missing_data_questions=missing_data not in ("false", "0", "no"),
        )


@dataclass
class _Toolkit:
    drafter: Drafter
    checker: DraftChecker
    committee: Committee


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

    def submit(self, rule_fields: dict[str, Any], actor: str, rule_id: str | None = None,
               examples: list[tuple[dict[str, Any], str]] | None = None) -> Draft:
        """Start drafting a new rule, or a new revision of an existing one. Optional example
        claims with the outcome the author expects guide the drafter from its first draft."""
        since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        if self.drafts.count_created_since(since) >= self.settings.drafts_per_hour:
            raise AuthoringError(429, "too_many_drafts", "Too many rule drafts in the last hour; try again later")
        given = self._author_examples(examples or [], allow_none=True)

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
                examples=given,
            )
            draft.log("submitted", f"by {actor}" + (f" with {len(given)} example claims" if given else ""))
            self._audit(draft, "rule_draft_submitted", {
                "kind": kind,
                "logic_sha256": logic_fingerprint(draft.rule["logic"]),
                "examples": len(given),
            }, actor=actor)
            return self.drafts.save(draft)

    def add_examples(self, draft_id: str, examples: list[tuple[dict[str, Any], str]], actor: str) -> Draft:
        """Answer the drafter's request for examples: claims with the outcome the author expects.

        They become permanent examples the rule must reproduce, like corrections, and the
        drafter starts again with them.
        """
        draft = self.get_draft(draft_id)
        request = next((q for q in draft.open_questions() if q.kind == EXAMPLE), None)
        if draft.state != AWAITING_AUTHOR or request is None:
            raise AuthoringError(409, "no_example_request", "This draft is not asking for example claims")
        given = self._author_examples(examples)
        keys = {claim_key(example.claim) for example in given}
        draft.examples = [example for example in draft.examples if claim_key(example.claim) not in keys] + given
        request.answer = f"{len(given)} example claims"
        request.answered_by = actor
        draft.chosen = False
        draft.rounds_since_input = 0
        draft.input_at = now()  # the drafting time limit counts from the admin's last input
        draft.log("examples given", f"{len(given)} example claims by {actor}")
        self._audit(draft, "rule_draft_examples_given", {"question_id": request.question_id, "examples": len(given)},
                    actor=actor)
        if not draft.open_questions():
            draft.state = QUEUED
        return self.drafts.save(draft)

    def _author_examples(self, examples: list[tuple[dict[str, Any], str]], allow_none: bool = False) -> list[LabelledCase]:
        if not examples and allow_none:
            return []
        if not 0 < len(examples) <= MAX_EXAMPLES:
            raise AuthoringError(422, "invalid_examples", f"Give between 1 and {MAX_EXAMPLES} example claims")
        given = []
        for claim, expected in examples:
            if expected not in OUTCOMES:
                raise AuthoringError(422, "invalid_answer", "Answer with one of: " + ", ".join(OUTCOMES))
            try:
                validate_transport(claim)
            except (ValueError, KeyError, TypeError) as error:
                raise AuthoringError(422, "invalid_claim", f"An example claim is not a valid claim: {error}") from error
            given.append(LabelledCase(description=f"example claim {claim['claim_id']} given by the author",
                                      claim=claim, expected_status=expected, shown=True))
        return given

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
        if question.kind == EXAMPLE:
            raise AuthoringError(422, "examples_expected", "This request is answered with example claims and the "
                                                           "outcome each should get (or cancel the draft)")

        answer = answer.strip()
        if question.kind == CHOICE:
            return self._answer_choice(draft, question, answer, actor)
        if question.kind == SITUATION:
            answer = self._answer_situation(draft, question, answer)
        elif question.kind == CASE:
            if answer not in OUTCOMES:
                raise AuthoringError(422, "invalid_answer", "Answer with one of: " + ", ".join(OUTCOMES))
            draft.examples.append(LabelledCase(
                description=question.case["description"],
                claim=question.case["claim"],
                expected_status=answer,
            ))
        else:
            answer = _resolve_answer(answer, question.options)
            draft.author_answers.append({"question": question.text, "answer": answer})
            draft.proposal = None  # new information: draft again
        question.answer = answer
        question.answered_by = actor
        draft.rounds_since_input = 0
        draft.input_at = now()  # the drafting time limit counts from the admin's last input
        draft.log("answered", f"{question.kind} question {question.question_id} by {actor}")
        self._audit(draft, "rule_draft_answered", {
            "question_id": question.question_id,
            "question_kind": question.kind,
            "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
        }, actor=actor)
        if not draft.open_questions():
            draft.state = QUEUED
        return self.drafts.save(draft)

    def _answer_situation(self, draft: Draft, question: Question, answer: str) -> str:
        """One outcome for every test claim of a missing-data situation, or "it depends"."""
        choice = read_answer(answer, OUTCOMES)
        if choice is None:
            raise AuthoringError(422, "invalid_answer", "Answer with one of: " + ", ".join(OUTCOMES)
                                 + f', or "{IT_DEPENDS_OPTION}"')
        if choice == IT_DEPENDS:
            return choice  # no test: these claims stay in the test-claim table, one by one
        for case in question.situation["cases"]:
            key = claim_key(case["claim"])
            if any(claim_key(example.claim) == key and example.expected_status == choice for example in draft.examples):
                continue
            draft.examples = [example for example in draft.examples if claim_key(example.claim) != key]
            draft.examples.append(LabelledCase(description=case["description"], claim=case["claim"],
                                               expected_status=choice,
                                               confirmed=choice == case["drafted_rule_says"]))
        # The situation in words, for the drafter: it says what the claims have in common.
        draft.author_answers.append({"question": f"What should the rule decide when {question.situation['text']}?",
                                     "answer": choice})
        return choice

    def correct(self, draft_id: str, corrections: list[tuple[str, str]], actor: str) -> Draft:
        """The author's verdicts on the generated test claims of a draft awaiting confirmation.

        Each verdict becomes a permanent example for this rule (an outcome the
        rule must reproduce exactly). When at least one differs from what the
        draft decides, the draft goes back to the drafter, which must match them.
        A verdict equal to the draft's outcome confirms it: the next draft must keep it
        (a draft once fixed one corrected outcome and broke 15 right ones elsewhere).
        """
        draft = self.get_draft(draft_id)
        if draft.state != AWAITING_CONFIRMATION or draft.proposal is None:
            raise AuthoringError(409, "not_awaiting_confirmation", "Only a draft awaiting confirmation can be corrected")
        if not 0 < len(corrections) <= MAX_CORRECTIONS:
            raise AuthoringError(422, "invalid_corrections", f"Send between 1 and {MAX_CORRECTIONS} corrections")
        shown = {case["case_id"]: case for case in (draft.report or {}).get("cases", [])}
        spec_status = {case_id: case["spec_status"] for case_id, case in shown.items()}
        claims = self._case_claims(draft)
        changed = 0
        for case_id, expected in corrections:
            if expected not in OUTCOMES:
                raise AuthoringError(422, "invalid_answer", "Answer with one of: " + ", ".join(OUTCOMES))
            if case_id not in spec_status or case_id not in claims:
                raise AuthoringError(404, "case_not_found", f"No test claim {case_id} in this draft")
            description, claim = claims[case_id]
            if description != shown[case_id]["description"]:
                # The cases are regenerated to find the claim; after an update of the generator
                # the same id can name another claim, and the verdict would land on it.
                raise AuthoringError(409, "cases_changed", "The test claims shown for this draft were made by an "
                                                           "earlier version; cancel it and draft the rule again")
            changed += expected != spec_status[case_id]
            key = claim_key(claim)
            if any(claim_key(example.claim) == key and example.expected_status == expected for example in draft.examples):
                continue  # already a test with this outcome: kept as it was given (a correction stays one)
            draft.examples = [example for example in draft.examples if claim_key(example.claim) != key]
            draft.examples.append(LabelledCase(description=description, claim=claim, expected_status=expected,
                                               confirmed=expected == spec_status[case_id]))

        self._audit(draft, "rule_draft_corrected", {"verdicts": len(corrections), "corrected": changed}, actor=actor)
        if changed:
            draft.state = QUEUED  # draft again: the new rule must reproduce every verdict
            draft.chosen = False
            draft.rounds_since_input = 0
            draft.input_at = now()  # the drafting time limit counts from the admin's last input
            draft.log("corrected", f"{changed} test claim outcomes corrected by {actor}")
        else:
            draft.log("cases confirmed", f"{len(corrections)} test claim outcomes confirmed by {actor}")
        return self.drafts.save(draft)

    def confirm(self, draft_id: str, actor: str) -> Draft:
        draft = self.get_draft(draft_id)
        report = draft.report or {}
        if draft.state != AWAITING_CONFIRMATION or not (report.get("passed") or report.get("code_checks_passed")):
            raise AuthoringError(409, "not_ready", "Only a draft that passed every code check can be confirmed")
        return self._activate(draft, actor)

    def escalate(self, draft_id: str, actor: str) -> tuple[Draft, dict[str, str]]:
        """Hand a rule the drafter could not generate to a technical manager.

        Records who escalated it and when (on the draft and in the audit log) and returns an
        email for the admin's own mail app to open, pre-filled: nothing is sent from here.
        The email holds the rule and why drafting stopped, never claim data; everything else
        (every attempt, test claim and correction) stays in ClaimGuard under the draft id.
        """
        draft = self.get_draft(draft_id)
        if draft.state not in (REJECTED, AWAITING_AUTHOR):
            raise AuthoringError(409, "not_stuck", "Only a rule that could not be generated can be escalated")
        stamp = datetime.now(timezone.utc).isoformat()
        draft.escalations.append({"at": stamp, "by": actor})
        draft.log("escalated", f"to a technical manager by {actor}")
        self._audit(draft, "rule_draft_escalated", {"to_contact": bool(self.settings.technical_contact)}, actor=actor)
        open_request = next((q.text for q in draft.open_questions()), "")
        why = draft.outcome_reason or open_request or "drafting did not produce a rule"
        body = "\n".join([
            f"The rule {draft.rule_id} could not be generated automatically and needs a technical review.",
            "",
            f"Rule: {draft.rule['title']} ({draft.rule['severity']})",
            f"Rule text: {draft.rule['logic']}",
            f"Why it stopped: {why}",
            f"Attempts: {draft.rounds} drafting rounds, {draft.provenance.get('drafter_turns', 0)} model turns, "
            f"{len(draft.examples)} outcomes confirmed by the admin.",
            "",
            f"Every attempt, test claim and correction is in ClaimGuard under draft {draft.draft_id}.",
            f"Escalated by {actor} on {stamp[:10]}.",
        ])[:MAX_EMAIL_TEXT]
        subject = f"ClaimGuard: rule {draft.rule_id} needs a technical review"
        to = self.settings.technical_contact
        email = {"to": to, "subject": subject, "body": body,
                 "mailto": f"mailto:{quote(to, safe='@')}?subject={quote(subject)}&body={quote(body)}"}
        return self.drafts.save(draft), email

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

        limit = self.settings.max_drafting_minutes * 60
        while draft.rounds_since_input < self.settings.max_rounds:
            waited = (datetime.now(timezone.utc) - datetime.fromisoformat(draft.input_at)).total_seconds()
            if waited >= limit:
                self._stop(draft, f"it has drafted for {self.settings.max_drafting_minutes:g} minutes since your last input")
                return
            # A session never runs past the time limit: the admin is not kept waiting.
            toolkit.drafter.time_budget_seconds = max(60.0, min(self.settings.drafter_time_budget_seconds, limit - waited))
            draft.rounds += 1
            draft.rounds_since_input += 1
            spec = self._usable_proposal(draft)
            candidates: list[Candidate] = []
            if spec is None and draft.candidates:
                # The admin answered the committee's questions: keep the drafts that agree.
                candidates = toolkit.committee.survivors(
                    [Candidate.from_json(item) for item in draft.candidates], draft.examples)
                draft.candidates = []
                draft.log("committee", f"{len(candidates)} drafts agree with the author's answers")
            if spec is None and not candidates:
                self._set_state(draft, DRAFTING)
                asked = sum(question.kind == CLARIFICATION for question in draft.questions)
                results = self._draft_all(toolkit, DraftingContext(
                    rule=draft.rule,
                    author_answers=draft.author_answers,
                    author_examples=draft.examples,
                    feedback=draft.feedback,
                    similar_rules=self._similar_rules(draft),
                    questions_left=max(0, self.settings.max_clarifications - asked),
                    known_expressible=_passed_checks_before(draft),
                    last_draft=draft.last_draft,
                ))
                draft.provenance["drafter_turns"] = draft.provenance.get("drafter_turns", 0) + sum(r.turns for r in results)
                unreadable = [reply for result in results for reply in result.unreadable]
                if unreadable:
                    # Kept to diagnose format slips without running the model again.
                    draft.provenance["unreadable_replies"] = unreadable[-3:]
                candidates = [Candidate(r.spec, r.intent, r.assumptions, r.sheet) for r in results if r.outcome == PROPOSED]
                if not candidates:
                    result = next((r for r in results if r.outcome == NEEDS_CLARIFICATION), results[0])
                    if result.outcome == NEEDS_CLARIFICATION:
                        self._ask(draft, [Question(question_id=uuid4().hex[:8], kind=CLARIFICATION,
                                                   text=result.question, options=result.options)])
                        return
                    # No new rule this session (the drafter failed, gave up, or the model was
                    # unavailable): the admin chooses what next, and keeps every good draft.
                    self._stop(draft, f"the drafter could not produce a rule ({result.outcome}): {result.reason}")
                    return
            if spec is None:
                chosen, questions = self._committee_choice(draft, candidates, toolkit)
                if questions:
                    # The drafts disagree on these claims: the admin's answers decide.
                    draft.candidates = [candidate.to_json() for candidate in candidates]
                    self._ask(draft, questions)
                    return
                spec = chosen.spec
                draft.chosen = False  # a new draft: not the one the admin chose
                draft.proposal = {"spec": spec.to_json(), "intent": chosen.intent, "assumptions": chosen.assumptions}
                if chosen.sheet is not None:
                    draft.proposal["sheet"] = chosen.sheet

            self._set_state(draft, CHECKING)
            report = toolkit.checker.run(draft.rule, spec, draft.examples, baseline=self._baseline(draft))
            draft.report = report.to_json()
            # Kept for the next round: after the author's corrections (or failed checks) the
            # drafter repairs this draft instead of writing the whole rule again from scratch.
            draft.last_draft = {"draft": draft.proposal.get("sheet") or draft.proposal["spec"],
                                "passed_checks": report.only_disagreements_remain()}
            self._audit(draft, "rule_draft_checked", {
                "passed": report.passed,
                "spec_sha256": spec_fingerprint(spec),
                "report_sha256": _fingerprint(draft.report),
                "disagreements": len(report.disagreements),
            })
            reading = self.settings.independent_reading
            if reading != "off" and report.cases and all(case.oracle_status is None for case in report.cases):
                if reading == "block":
                    self._reject(draft, "the independent reading is unavailable, so the draft cannot be verified")
                    return
                draft.log("independent reading unavailable", "the author's confirmation is the only review")
            ready = report.passed or (report.only_disagreements_remain() and reading != "block")
            if ready:
                self._keep_good_draft(draft)
            if ready and self.settings.missing_data_questions and not draft.chosen:
                questions = self._situation_questions(draft, spec, report)
                if questions:
                    # Before the table: what missing or unknown data gives, once per situation.
                    self._ask(draft, questions)
                    return
            if report.passed:
                # Without a second reading the author is the only review: always confirm.
                if self.settings.require_author_confirmation or reading == "off":
                    draft.log("checks passed", "waiting for the author to confirm the readback")
                    self._set_state(draft, AWAITING_CONFIRMATION)
                else:
                    self._activate(draft, actor="automatic")
                return
            if report.only_disagreements_remain() and reading != "block":
                # Every code check passed. The second reading is advice: its
                # disagreements are shown to the author, who confirms or cancels.
                # Never activated without that confirmation.
                draft.log("code checks passed",
                          f"the independent reading disagrees on {len(report.disagreements)} cases; "
                          "review them before confirming")
                self._set_state(draft, AWAITING_CONFIRMATION)
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

        self._stop(draft, f"the checks still failed after {self.settings.max_rounds} rounds")

    def _keep_good_draft(self, draft: Draft) -> None:
        """A draft that passed every check, kept for the admin: a later draft can go wrong."""
        fingerprint = spec_fingerprint(parse_spec(draft.proposal["spec"]))
        if any(good["fingerprint"] == fingerprint for good in draft.good_drafts):
            return
        draft.good_drafts.append({"proposal": json.loads(json.dumps(draft.proposal)), "fingerprint": fingerprint,
                                  "at": now(), "round": draft.rounds})
        draft.good_drafts = draft.good_drafts[-MAX_GOOD_DRAFTS:]

    def _stop(self, draft: Draft, reason: str) -> None:
        """Drafting stopped without a draft to confirm (the time limit, or the drafter failed or
        gave up): the admin chooses what happens next instead of the rule being rejected.

        The options: each good draft (passed every check), best first, with how many of the
        admin's outcomes it agrees with; more drafting time; example claims; cancelling.
        In collection run 2, R013 had a draft right on all 600 official claims at minute 1 and
        was rejected after 56 minutes; R006 lost one at minute 4 and gave up."""
        reference = ReferenceData.load(self.rules_dir)
        total = len(draft.examples)
        ranked = []
        for index, good in enumerate(draft.good_drafts):
            spec = parse_spec(good["proposal"]["spec"])
            agree = sum(_outcome(spec, example.claim, reference) == example.expected_status for example in draft.examples)
            ranked.append((agree, index))
        options, actions = [], []
        for agree, index in sorted(ranked, key=lambda item: (-item[0], -item[1]))[:3]:
            dropped = total - agree
            options.append(f"Use draft {index + 1} (round {draft.good_drafts[index]['round']}): it passed every check "
                           f"and agrees with {agree} of your {total} outcomes"
                           + (f"; the other {dropped} are dropped" if dropped else ""))
            actions.append({"action": "use", "draft": index})
        minutes = f"{self.settings.max_drafting_minutes:g}"
        options.append(f"Keep drafting for up to {minutes} more minutes")
        actions.append({"action": "more"})
        if self.settings.offer_example_claims:
            options.append("Give example claims, then draft again")
            actions.append({"action": "examples"})
        options.append("Cancel this draft")
        actions.append({"action": "cancel"})
        draft.feedback = []
        draft.log("drafting stopped", reason)
        self._ask(draft, [Question(question_id=uuid4().hex[:8], kind=CHOICE, options=options, choice=actions,
                                   text=f"Drafting stopped: {reason}. What should happen next?")])

    def _answer_choice(self, draft: Draft, question: Question, answer: str, actor: str) -> Draft:
        index = _option_index(answer, question.options)
        if index is None:
            raise AuthoringError(422, "invalid_answer", "Answer with one of: " + " | ".join(question.options))
        action = question.choice[index]
        question.answer, question.answered_by = question.options[index], actor
        draft.input_at, draft.rounds_since_input = now(), 0
        self._audit(draft, "rule_draft_answered", {"question_id": question.question_id, "question_kind": CHOICE,
                                                   "choice": action["action"]}, actor=actor)
        if action["action"] == "cancel":
            self.drafts.save(draft)
            return self.cancel(draft.draft_id, actor)
        if action["action"] == "examples":
            draft.log("answered", f"{actor} chose to give example claims")
            self._ask(draft, [Question(question_id=uuid4().hex[:8], kind=EXAMPLE, text=(
                "Give one or more example claims with the outcome each should get (PASS, FAIL, UNABLE_TO_ASSESS or "
                "NOT_APPLICABLE): they become tests the rule must reproduce, and drafting starts again."))])
            return self.drafts.save(draft)
        if action["action"] == "use":
            good = draft.good_drafts[action["draft"]]
            spec = parse_spec(good["proposal"]["spec"])
            reference = ReferenceData.load(self.rules_dir)
            dropped = [example for example in draft.examples
                       if _outcome(spec, example.claim, reference) != example.expected_status]
            draft.examples = [example for example in draft.examples if example not in dropped]
            draft.waived += [{"description": example.description, "claim_key": claim_key(example.claim),
                              "expected_status": example.expected_status} for example in dropped]
            draft.proposal = json.loads(json.dumps(good["proposal"]))
            draft.chosen = True
            draft.log("draft chosen", f"draft {action['draft'] + 1} by {actor}"
                      + (f"; {len(dropped)} of their outcomes dropped" if dropped else ""))
            self._audit(draft, "rule_draft_chosen", {"draft": action["draft"] + 1, "outcomes_dropped": len(dropped),
                                                     "spec_sha256": spec_fingerprint(spec)}, actor=actor)
        else:
            draft.log("answered", f"{actor} chose to keep drafting")
        draft.state = QUEUED  # a chosen draft is checked again; more time drafts again
        return self.drafts.save(draft)

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

    def _draft_all(self, toolkit: "_Toolkit", context: DraftingContext) -> list[DrafterResult]:
        """One drafter session, or a committee of independent ones run side by side."""
        size = self.settings.committee_size
        if size <= 1:
            return [toolkit.drafter.draft(context)]
        temperatures = [round(0.9 * index / (size - 1), 2) for index in range(size)]  # 0 ... 0.9
        base = self.models.drafter
        drafters = [toolkit.drafter.with_model(getattr(base, "with_temperature", lambda _: base)(t)) for t in temperatures]
        with ThreadPoolExecutor(max_workers=size) as pool:
            return list(pool.map(lambda drafter: drafter.draft(context), drafters))

    def _committee_choice(self, draft: Draft, candidates: list[Candidate],
                          toolkit: "_Toolkit") -> tuple[Candidate, list[Question]]:
        """The draft to check, or the questions that decide between disagreeing drafts.

        Drafts that decide every test claim alike are one candidate rule. When there are
        several, the admin is asked about the claims that tell them apart, within the
        question budget; past it, the largest group of agreeing drafts is taken."""
        if len(candidates) == 1:
            return candidates[0], []
        probes = toolkit.committee.probes(candidates, draft.rule)
        groups = toolkit.committee.groups(candidates, probes)
        draft.log("committee", f"{len(candidates)} drafts, {len(groups)} different rules")
        if len(groups) == 1:
            return groups[0][0], []
        asked = sum(question.kind == CASE for question in draft.questions)
        room = min(self.settings.max_case_questions, self.settings.max_case_questions_total - asked)
        splits = toolkit.committee.splits(groups, probes, room) if room > 0 else []
        if not splits:
            return groups[0][0], []
        return groups[0][0], [
            Question(
                question_id=uuid4().hex[:8],
                kind=CASE,
                text=f"What should this rule decide for a claim where {split.case.description}?",
                case={
                    "description": split.case.description,
                    "claim": split.case.claim,
                    "drafts_say": dict(split.outcomes),
                    "options": list(OUTCOMES),
                },
            )
            for split in splits
        ]

    def _situation_questions(self, draft: Draft, spec: RuleSpec, report: CheckReport) -> list[Question]:
        """The missing-data situations of this draft not asked about yet (missing_data.py). A
        situation whose claims all have an outcome from the author already is not asked."""
        asked = [question for question in draft.questions if question.kind == SITUATION]
        room = MAX_SITUATION_QUESTIONS - len(asked)
        if room <= 0:
            return []
        asked_texts = {question.situation["text"] for question in asked}
        answered = {claim_key(example.claim) for example in draft.examples}
        applicability = analyse_spec(spec, FieldCatalogue.from_backend_root(self.backend_root)).applicability_fields
        # What the rule text says missing data and unknown codes give, as the draft's sheet quotes it.
        written = (draft.proposal or {}).get("sheet") or {}
        quoted = written.get("outcomes") if isinstance(written, dict) else None
        table = quoted_outcomes(quoted, rule_text(draft.rule))
        questions = []
        for situation in situations(report.cases, applicability, ReferenceData.load(self.rules_dir)):
            entries = decided_by_text(situation, table)
            if entries:
                # The text already answers it, and the draft follows: not asked. The admin still
                # sees these test claims in the table.
                self._note_decided_by_text(draft, situation.text, {entry: quoted[entry] for entry in entries})
                continue
            situation.cases = [case for case in situation.cases if claim_key(case.claim) not in answered]
            if situation.text in asked_texts or not situation.cases:
                continue
            questions.append(Question(
                question_id=uuid4().hex[:8],
                kind=SITUATION,
                text=question_text(situation),
                options=[*OUTCOMES, IT_DEPENDS_OPTION],
                situation={"text": situation.text, "cases": [
                    {"description": case.description, "claim": case.claim, "drafted_rule_says": case.spec_status}
                    for case in situation.cases]},
            ))
        return questions[:room]

    @staticmethod
    def _note_decided_by_text(draft: Draft, situation: str, entries: dict[str, dict[str, str]]) -> None:
        decided = draft.provenance.setdefault("decided_by_text", [])
        if any(item["situation"] == situation for item in decided):
            return
        decided.append({"situation": situation, "entries": entries})
        said = "; ".join(f'{entry["outcome"]}: "{entry["quote"]}"' for entry in entries.values())
        draft.log("decided by the rule text", f"not asked, the rule text says it ({said}): {situation}"[:500])

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
            if draft.proposal.get("sheet") is not None:
                provenance["sheet"] = draft.proposal["sheet"]  # shown as an example for similar rules
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
        oracle = None if self.settings.independent_reading == "off" else Oracle(self.models.oracle, reference)
        return _Toolkit(
            drafter=Drafter(
                self.models.drafter,
                self.fields,
                reference,
                generator,
                max_turns=self.settings.drafter_max_turns,
                max_invalid_replies=self.settings.drafter_max_invalid_replies,
                time_budget_seconds=self.settings.drafter_time_budget_seconds,
                prompt=self._drafter_prompt(),
                auto_propose=self.settings.auto_propose,
            ),
            checker=DraftChecker(self.fields, reference, generator, oracle, claims,
                                 sheet=self.settings.drafting_format == "sheet"),
            committee=Committee(generator, reference),
        )

    def _drafter_prompt(self) -> str:
        if self.settings.drafting_format != "sheet":
            return "drafter"
        return "drafter_sheet" if self.settings.full_language_fallback else "drafter_sheet_only"

    def _baseline(self, draft: Draft) -> Baseline:
        """What a revision is measured against before the author confirms it: the rule running
        today, and, while the rule's text is unchanged, the known correct outcomes of the
        development claims (the challenge's expected results). A new rule has neither."""
        if draft.kind != "revision":
            return Baseline()
        catalogue = self._read_catalogue()
        stored = self.specs.load_active(catalogue, self.fields).active.get(draft.rule_id)
        entry = next((rule for rule in catalogue if rule["rule_id"] == draft.rule_id), None)
        unchanged = entry is not None and all(entry.get(key) == draft.rule[key] for key in RULE_FIELDS)
        expected: dict[str, str] = {}
        path = self.backend_root / "data" / "development" / "expected_results.jsonl"
        if unchanged and path.exists():
            with path.open(encoding="utf-8") as stream:
                for line in stream:
                    if line.strip() and (row := json.loads(line)).get("rule_id") == draft.rule_id:
                        expected[row["claim_id"]] = row["status"]
        return Baseline(current=stored.spec if stored else None, expected=expected)

    def _case_claims(self, draft: Draft) -> dict[str, tuple[str, dict[str, Any]]]:
        """case_id -> (description, claim) for the draft's test claims. The generator is
        deterministic, so regenerating from the proposed spec gives the same cases."""
        reference = ReferenceData.load(self.rules_dir)
        generator = EdgeCaseGenerator(choose_base_claims(self._development_claims()), self.fields, reference,
                                      self.claim_schema)
        cases = generator.generate(parse_spec(draft.proposal["spec"]), draft.rule)
        return {case.case_id: (case.description, case.claim) for case in cases}

    def _similar_rules(self, draft: Draft) -> list[dict[str, Any]]:
        """Working rules that read most like the draft (examples.py).

        "drafted" (the default): only rules the drafter wrote and an admin confirmed, so
        nothing hand-written guides it; each confirmed rule becomes an example for the
        next. "catalogue": every active rule. "none": no examples."""
        if self.settings.example_source == "none":
            return []
        catalogue = self._read_catalogue()
        active = self.specs.load_active(catalogue, self.fields).active
        proven_sheets = reference_sheets() if self.settings.drafting_format == "sheet" else {}
        candidates = []
        for rule in catalogue:
            stored = active.get(rule["rule_id"])
            if stored is None or (self.settings.example_source == "drafted" and stored.origin != "agent"):
                continue
            if self.settings.drafting_format != "sheet":
                candidates.append({**rule, "spec": stored.spec.to_json()})
                continue
            # When the drafter writes sheets, examples are sheets: the drafter copies the form it
            # sees, and R009 and R010 wrote the full language for 14 turns after being shown R008
            # in it. A hand-written rule shows its proven sheet; a rule with no sheet is not shown.
            sheet = stored.provenance.get("sheet")
            if sheet is None and stored.origin == "reference":
                sheet = proven_sheets.get(rule["rule_id"])
            if sheet is not None:
                candidates.append({**rule, "sheet": sheet})
        return similar_rules(draft.rule, candidates, exclude_rule_id=draft.rule_id)

    def _model_provenance(self) -> dict[str, Any]:
        return {
            "drafter_model": self.models.drafter.name,
            "oracle_model": self.models.oracle.name if self.settings.independent_reading != "off" else "none",
            "drafter_prompt_sha256": prompt_fingerprint(self._drafter_prompt()),
            "drafting_format": self.settings.drafting_format,
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
        """The catalogue entry after activation. A rule is its text: when a revision only
        replaces the implementation (same title, severity, logic and corrective action),
        the rule keeps its version and source (R001 stays fictional-rulebook/R001@1.0.0),
        and the spec store records that its implementation is now drafted. A changed
        text is a new version of the rule."""
        existing = next((rule for rule in catalogue if rule["rule_id"] == draft.rule_id), None)
        if existing is not None and all(existing.get(key) == draft.rule[key] for key in RULE_FIELDS):
            return dict(existing)
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


def _resolve_answer(answer: str, options: list[str]) -> str:
    """The author's answer, as the full option text when it picks an option.

    A bare "yes" or "no" is accepted only when exactly one option starts with
    that word; otherwise it is ambiguous and refused.
    """
    if not options:
        return answer
    for option in options:
        if answer.lower() == option.lower():
            return option
    word = BARE_ANSWERS.get(answer.lower().rstrip(".! "))
    if word is not None:
        matching = [option for option in options if _first_word(option) == word]
        if len(matching) == 1:
            return matching[0]
        raise AuthoringError(422, "ambiguous_answer", "Pick one of the options, or answer in a full sentence")
    return answer


def _option_index(answer: str, options: list[str]) -> int | None:
    """Which option an answer picks: its full text, its number ("1"), or the start of it ("Use draft 2")."""
    text = answer.strip().lower()
    for index, option in enumerate(options):
        if text == option.lower():
            return index
    if text.isdigit() and 1 <= int(text) <= len(options):
        return int(text) - 1
    starting = [index for index, option in enumerate(options) if text and option.lower().startswith(text)]
    return starting[0] if len(starting) == 1 else None


def _outcome(spec: RuleSpec, claim: dict[str, Any], reference: ReferenceData) -> str:
    try:
        return evaluate_rule(spec, claim, reference).status
    except EvaluationLimitExceeded:
        return "ERROR"


def _first_word(option: str) -> str:
    match = re.match(r"\s*([A-Za-z]+)", option)
    return match.group(1).lower() if match else ""


def _with_entry(catalogue: list[dict[str, Any]], entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Replace the rule in place (a revision) or append it (a new rule)."""
    if any(rule["rule_id"] == entry["rule_id"] for rule in catalogue):
        return [entry if rule["rule_id"] == entry["rule_id"] else rule for rule in catalogue]
    return [*catalogue, entry]


def _passed_checks_before(draft: Draft) -> bool:
    """An earlier draft of this rule passed every code check: the rule can be written."""
    return any(event["event"] in ("checks passed", "code checks passed") for event in draft.events)


def _fingerprint(data: Any) -> str:
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _next_patch(version: str) -> str:
    parts = version.split(".")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
    return "1.0.1"
