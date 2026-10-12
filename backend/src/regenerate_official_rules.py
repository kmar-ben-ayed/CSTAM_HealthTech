"""Regenerate the official rulebook rules (R001-R015) with the rule drafter.

Each rule's exact text from rules/rules.json is submitted as a revision, as an admin
pressing "revise" in the admin panel without changing a word. The drafter writes the
rule, the checks run, and the drafts wait in the admin panel until an admin reviews and
confirms them. Only a confirmed draft replaces the rule's current implementation; the
rule keeps its rulebook identity (fictional-rulebook/R001@1.0.0), so the official
pipeline and scorer then run the drafted rules.

The drafter's questions and the test-claim table are answered either here, as an admin
who knows the rulebook would (--answers rulebook: the outcome the current verified
implementation gives), or left to an admin in the panel (--answers panel).

--confirm confirms a waiting draft only when it clears the gate on the development claims
(issue F1 >= 0.95 and status agreement >= 98% against the official expected results; see
rule_benchmark/official.py). A draft below the gate stays waiting with its numbers shown,
and the rule keeps running its current implementation. The score on the validation and
stress claims, which the decision never looks at, is printed beside it.

Uses the real rule database and audit log, like the running app, so the backend server
must be stopped while it runs. rules/rules.json and the rule database are backed up first.

    python src/regenerate_official_rules.py --model nvidia/nemotron-3-super-120b-a12b
    python src/regenerate_official_rules.py --rules R006,R009 --answers panel
    python src/regenerate_official_rules.py --rules R001,R002 --confirm
"""

import argparse
import json
import os
import shutil
import socket
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import paths  # noqa: F401  (makes the sub-packages importable)
from AI_agent.llm_adapter import load_project_env
from audit.logger import AuditLogger
from audit.store import AuditStore
from rule_authoring.drafts import AWAITING_AUTHOR, AWAITING_CONFIRMATION, DraftStore
from rule_authoring.edge_cases import EdgeCaseGenerator, choose_base_claims
from rule_authoring.llm import AuthoringModels, models_from_environment
from rule_authoring.service import AuthoringError, AuthoringSettings, RuleAuthoringService
from rule_benchmark.official import MIN_AGREEMENT, MIN_F1, Gate, describe, expected_outcomes, official_claims
from rule_benchmark.runner import (
    MAX_AUTHOR_ROUNDS,
    DraftLog,
    RecordingModel,
    ReplySink,
    Review,
    SimulatedAuthor,
    answer_open_questions,
)
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl
from rule_engine.language import parse_spec
from rule_engine.spec_store import default_database, reference_seed_file

BACKEND_ROOT = Path(__file__).resolve().parents[1]
RULEBOOK = [f"R{number:03d}" for number in range(1, 16)]
ACTOR = "official-rules-regeneration"
RULE_FIELDS = ("title", "severity", "logic", "corrective_action")


def server_running(port: int = 8000) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


DRAFTING = threading.local()  # the rule each worker thread is drafting


class RuleReplySink(ReplySink):
    """Every model reply, labelled with the rule its worker thread is drafting."""

    def write(self, record: dict) -> None:
        super().write({"rule": getattr(DRAFTING, "rule_id", None), **record})


def back_up(rules_db: Path) -> Path:
    folder = BACKEND_ROOT / "outputs" / "backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    folder.mkdir(parents=True)
    shutil.copy2(BACKEND_ROOT / "rules" / "rules.json", folder / "rules.json")
    if rules_db.exists():
        shutil.copy2(rules_db, folder / rules_db.name)
    return folder


class RulebookAdmin:
    """Answers like an admin who knows what each official rule decides: the outcome of
    its current, verified implementation (the one the official expected results match)."""

    def __init__(self, backend_root: Path, reference_data: ReferenceData, edge_cases: EdgeCaseGenerator):
        seed = json.loads(reference_seed_file(backend_root).read_text(encoding="utf-8"))["specs"]
        self.verified = {rule_id: parse_spec(entry["spec"]) for rule_id, entry in seed.items()}
        self.reference_data = reference_data
        self.edge_cases = edge_cases
        self.example_pool = load_jsonl(backend_root / "data" / "development" / "claims.jsonl")

    def author(self, rule_id: str) -> SimulatedAuthor:
        return SimulatedAuthor(self.verified[rule_id], self.reference_data)

    def review(self, draft) -> Review:
        """The wrong outcomes in a draft's test claims, one field at a time, and the right
        ones checked on the way (confirmed, so the next draft keeps them)."""
        return SimulatedAuthor(self.verified[draft.rule_id], self.reference_data).review(draft, self.edge_cases)


def regenerate(service: RuleAuthoringService, rule: dict, admin: RulebookAdmin | None, replace: bool = False,
               sink: ReplySink | None = None) -> dict:
    rule_id = rule["rule_id"]
    log = DraftLog(sink, rule_id)  # what happens to the draft, next to the model calls in the log
    open_draft = service.drafts.open_draft_for(rule_id)
    if replace and open_draft is not None:
        service.cancel(open_draft.draft_id, ACTOR)  # as the admin panel's cancel button does
    try:
        draft = service.submit({key: rule[key] for key in RULE_FIELDS}, ACTOR, rule_id=rule_id)
    except AuthoringError as error:
        return {"rule_id": rule_id, "state": "not submitted", "detail": error.message}
    answered = corrected = 0
    service.run(draft.draft_id)
    try:
        for _ in range(MAX_AUTHOR_ROUNDS):
            draft = service.get_draft(draft.draft_id)
            log.update(draft)
            if admin is None:
                break
            if draft.state == AWAITING_AUTHOR:
                asked = {question.question_id for question in draft.open_questions()}
                answered += len(asked)
                # Example requests get development claims only: validation and stress stay unseen.
                answer_open_questions(service, draft, admin.author(rule_id), admin.example_pool, ACTOR)
                log.answers(service.get_draft(draft.draft_id), asked)
            elif draft.state == AWAITING_CONFIRMATION:
                if draft.chosen:
                    break  # the admin chose this draft over drafting more: ready for its confirmation
                review = admin.review(draft)
                if not review.corrections:
                    break  # every outcome is right: ready for the admin's confirmation
                log.review(draft, review)
                service.correct(draft.draft_id, review.verdicts, ACTOR)
                corrected += len(review.corrections)
            else:
                break
            service.run(draft.draft_id)
    except AuthoringError as error:
        draft = service.get_draft(draft.draft_id)
        return {"rule_id": rule_id, "state": draft.state, "questions_answered": answered,
                "outcomes_corrected": corrected, "detail": f"stopped: {error.message}"}
    draft = service.get_draft(draft.draft_id)
    log.update(draft)
    log.write("finished", state=draft.state, reason=draft.outcome_reason)
    return {"rule_id": rule_id, "state": draft.state, "questions_answered": answered,
            "outcomes_corrected": corrected, "detail": draft.outcome_reason}


class OfficialCheck:
    """Judges a waiting draft of an official rule against the official expected results."""

    def __init__(self, backend_root: Path, reference_data: ReferenceData, gate: Gate):
        self.claims = official_claims(backend_root)
        self.expected = expected_outcomes(backend_root)
        self.reference_data = reference_data
        self.gate = gate

    def judge(self, draft) -> dict:
        spec = parse_spec(draft.proposal["spec"]) if draft.proposal else None
        return self.gate.judge(spec, self.expected.get(draft.rule_id, {}), self.claims, self.reference_data)


def confirm_waiting(service: RuleAuthoringService, rule_id: str, check: OfficialCheck) -> str:
    """Confirm the rule's draft waiting for confirmation, as the admin panel's confirm button
    does, when it clears the gate. The verdict and its numbers go to the audit log either way."""
    draft = service.drafts.open_draft_for(rule_id)
    if draft is None or draft.state != AWAITING_CONFIRMATION:
        return f"{rule_id}: no draft waiting for confirmation, nothing confirmed"
    verdict = check.judge(draft)
    service.audit_logger.log("official_rule_gate", f"rule:{rule_id}", ACTOR, {
        "draft_id": draft.draft_id, "deploy": verdict["deploy"], "why_not": verdict["why_not"],
        "min_f1": check.gate.min_f1, "min_agreement": check.gate.min_agreement,
        **{f"{part}_{key}": verdict[part][key] for part in ("development", "held_out")
           for key in ("claims", "agree", "issue_f1", "status_accuracy")},
    })
    if not verdict["deploy"]:
        return (f"{rule_id}: kept waiting, the current implementation keeps running "
                f"({'; '.join(verdict['why_not'])}). {describe(verdict)}")
    try:
        confirmed = service.confirm(draft.draft_id, ACTOR)
    except AuthoringError as error:
        return f"{rule_id}: not confirmed: {error.message}"
    return (f"{rule_id}: {confirmed.state} (revision {confirmed.provenance.get('revision')}, drafted by the AI). "
            f"{describe(verdict)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rules", help="comma-separated rule ids (default: R001-R015)")
    parser.add_argument("--answers", choices=("rulebook", "panel"), default="rulebook",
                        help="who answers the drafter's questions and the test-claim table")
    parser.add_argument("--model", help="drafter model for this run (default: RULE_DRAFTER_MODEL from .env)")
    parser.add_argument("--workers", type=int, default=2, help="rules drafted at the same time")
    parser.add_argument("--confirm", action="store_true",
                        help="instead of drafting, confirm the --rules drafts waiting for confirmation that clear "
                             "the gate, as the admin panel's confirm button does (they replace the rules' current "
                             "implementation)")
    parser.add_argument("--min-f1", type=float, default=MIN_F1,
                        help="the gate: lowest issue F1 on the development claims (ignored when the rule fails "
                             "none of them)")
    parser.add_argument("--min-agreement", type=float, default=MIN_AGREEMENT,
                        help="the gate: lowest share of development claims with the expected status")
    parser.add_argument("--replace", action="store_true",
                        help="cancel a rule's open draft first (e.g. one waiting for confirmation) and draft it again")
    parser.add_argument("--record", type=Path,
                        help="file for every model reply (default: outputs/regenerate_<time>.replies.jsonl)")
    # The settings the benchmark drafts with, to regenerate the rules exactly as they were drafted
    # there (otherwise they come from .env): all 15 official rules came out right on 2026-10-12 with
    # --format sheet --examples none --no-full-language.
    parser.add_argument("--format", choices=("spec", "sheet"), help="what the drafter writes (default: .env)")
    parser.add_argument("--examples", choices=("drafted", "catalogue", "none"),
                        help="similar rules shown to the drafter (default: drafted)")
    parser.add_argument("--no-full-language", action="store_true",
                        help="sheet format only: leave the full rule language's manual out of the prompt")
    args = parser.parse_args()
    if args.confirm and not args.rules:
        parser.error("--confirm needs --rules: name the rules to confirm")

    if server_running():
        print("The backend server is running on port 8000. Stop it first: this script writes the same "
              "rule database and audit log.", file=sys.stderr)
        return 2
    load_project_env()
    if args.model:
        os.environ["RULE_DRAFTER_MODEL"] = args.model
    models = models_from_environment()
    if models is None:
        print("No OPENAI_API_KEY is configured.", file=sys.stderr)
        return 1

    wanted = [rule_id.strip() for rule_id in args.rules.split(",")] if args.rules else RULEBOOK
    catalogue = {rule["rule_id"]: rule for rule in json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8"))}
    rules = [catalogue[rule_id] for rule_id in wanted if rule_id in catalogue]

    rules_db = Path(default_database(BACKEND_ROOT))
    backup = back_up(rules_db)
    record = args.record or BACKEND_ROOT / "outputs" / f"regenerate_{backup.name}.replies.jsonl"
    sink = RuleReplySink(record)
    models = AuthoringModels(drafter=RecordingModel(models.drafter, "drafter", sink),
                             oracle=RecordingModel(models.oracle, "oracle", sink))
    audit_path = Path(os.getenv("CLAIMGUARD_AUDIT_LOG", str(BACKEND_ROOT / "outputs" / "audit_log.jsonl")))
    overrides = {
        **({"drafting_format": args.format} if args.format else {}),
        **({"example_source": args.examples} if args.examples else {}),
        **({"full_language_fallback": False} if args.no_full_language else {}),
    }
    settings = replace(AuthoringSettings.from_environment(), drafts_per_hour=10_000, **overrides)
    service = RuleAuthoringService(
        backend_root=BACKEND_ROOT,
        rules_db=rules_db,
        drafts=DraftStore(rules_db),
        audit_logger=AuditLogger(AuditStore(audit_path)),
        models=models,
        on_rules_changed=lambda: None,
        settings=settings,
    )
    reference_data = ReferenceData.load(BACKEND_ROOT / "rules")
    schema = json.loads((BACKEND_ROOT / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
    edge_cases = EdgeCaseGenerator(choose_base_claims(load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")),
                                   FieldCatalogue.from_backend_root(BACKEND_ROOT), reference_data, schema)
    admin = RulebookAdmin(BACKEND_ROOT, reference_data, edge_cases) if args.answers == "rulebook" else None
    check = OfficialCheck(BACKEND_ROOT, reference_data, Gate(args.min_f1, args.min_agreement))

    if args.confirm:
        print(f"Gate on the development claims: issue F1 >= {args.min_f1} and agreement >= {args.min_agreement}.")
        try:
            for rule in rules:
                print("  " + confirm_waiting(service, rule["rule_id"], check), flush=True)
        finally:
            service.close()
        print(f"Backup of the rules before confirming: {backup}")
        return 0

    print(f"Regenerating {len(rules)} rules with drafter={models.drafter.name}, format={settings.drafting_format}, "
          f"examples={settings.example_source}, full language={'yes' if settings.full_language_fallback else 'no'}, "
          f"missing-data questions={'yes' if settings.missing_data_questions else 'no'}, "
          f"time limit={settings.max_drafting_minutes:g} min, answers={args.answers}. Backup: {backup}. Replies: {record}",
          flush=True)

    def one(rule: dict) -> dict:
        DRAFTING.rule_id = rule["rule_id"]
        result = regenerate(service, rule, admin, replace=args.replace, sink=sink)
        print(f"  {result['rule_id']}: {result['state']}  questions answered {result.get('questions_answered', 0)}, "
              f"outcomes corrected {result.get('outcomes_corrected', 0)}  {result.get('detail', '')[:100]}", flush=True)
        return result

    try:
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            results = list(pool.map(one, rules))
        waiting = [result["rule_id"] for result in results if result["state"] == AWAITING_CONFIRMATION]
        print(f"\n{len(waiting)} of {len(results)} rules are waiting for confirmation in the admin panel. "
              f"The gate (issue F1 >= {args.min_f1}, agreement >= {args.min_agreement}, development claims):")
        for rule_id in waiting:
            verdict = check.judge(service.drafts.open_draft_for(rule_id))
            print(f"  {rule_id}: {'clears it' if verdict['deploy'] else 'below it: ' + '; '.join(verdict['why_not'])}. "
                  f"{describe(verdict)}")
    finally:
        service.close()
    print("Confirm the drafts that clear the gate: --confirm --rules <ids> (or review them in the admin panel).")
    print("Then score what runs: python src/run_baseline.py and python src/evaluate.py (as before).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
