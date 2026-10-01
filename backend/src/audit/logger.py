import threading
from datetime import datetime, timezone
import hashlib
from typing import Any

from .chain import GENESIS_HASH, compute_hash, verify_chain
from .models import AuditEntry
from .store import AuditStore


class AuditWriteError(RuntimeError):
    """Raised when an event cannot be safely persisted to the audit chain."""


class AuditIntegrityError(AuditWriteError):
    """Raised when the existing audit history is invalid."""


class AuditLogger:
    def __init__(self, store: AuditStore):
        self.store = store
        self._lock = threading.Lock()

    def log(self, event_type: str, claim_id: str, actor: str, payload: dict[str, Any]) -> AuditEntry:
        return self.log_batch([(event_type, claim_id, actor, payload)])[0]

    def log_batch(
        self,
        events: list[tuple[str, str, str, dict[str, Any]]],
    ) -> list[AuditEntry]:
        if not events:
            return []
        with self._lock:
            try:
                existing_entries = self.store.all_entries()
            except (OSError, ValueError, TypeError, KeyError) as exc:
                raise AuditWriteError("Could not read the existing audit log") from exc
            valid, broken_index = verify_chain(existing_entries)
            if not valid:
                raise AuditIntegrityError(f"Existing audit chain is invalid at index {broken_index}")

            previous = existing_entries[-1] if existing_entries else None
            new_entries = []
            for event_type, claim_id, actor, payload in events:
                entry = AuditEntry(
                    index=previous.index + 1 if previous else 0,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    event_type=event_type,
                    claim_id=claim_id,
                    actor=actor,
                    payload=payload,
                    prev_hash=previous.entry_hash if previous else GENESIS_HASH,
                    entry_hash="",
                )
                entry.entry_hash = compute_hash(entry)
                new_entries.append(entry)
                previous = entry

            try:
                self.store.append_many(new_entries)
            except OSError as exc:
                raise AuditWriteError("Could not persist audit events") from exc
            return new_entries

    def log_rule_executions(
        self,
        claim_id: str,
        evaluation_id: str,
        results: list[dict[str, Any]],
    ) -> list[AuditEntry]:
        events = []
        for result in results:
            summary = {
                "evaluation_id": evaluation_id,
                "rule_id": result["rule_id"],
                "rule_version": result["rule_version"],
                "status": result["status"],
                "severity": result["severity"],
                "requires_human_review": result["requires_human_review"],
                "confidence": result.get("confidence"),
                "confidence_kind": result.get("confidence_kind"),
                "method": result.get("method"),
            }
            events.append(("rule_execution", claim_id, "system", summary))
        return self.log_batch(events)

    def log_rule_execution(
        self,
        claim_id: str,
        rule_id: str,
        result: dict[str, Any],
        evaluation_id: str,
    ) -> AuditEntry:
        summary = {
            "evaluation_id": evaluation_id,
            "rule_id": rule_id,
            "rule_version": result["rule_version"],
            "status": result["status"],
            "severity": result["severity"],
            "requires_human_review": result["requires_human_review"],
            "confidence": result.get("confidence"),
            "confidence_kind": result.get("confidence_kind"),
            "method": result.get("method"),
        }
        return self.log("rule_execution", claim_id, "system", summary)

    def log_human_decision(self, decision: dict[str, Any]) -> AuditEntry:
        reason = decision.get("reason", "")
        reason_hash = hashlib.sha256(reason.encode("utf-8")).hexdigest() if reason else None
        payload = {
            "rule_id": decision["rule_id"],
            "action": decision["action"],
            "original_status": decision["original_status"],
            "decision_timestamp": (
                decision["created_at"].isoformat()
                if hasattr(decision["created_at"], "isoformat")
                else str(decision["created_at"])
            ),
            "reason_hash": reason_hash,
        }
        return self.log("human_decision", decision["claim_id"], decision["actor"], payload)

    def log_ai_decision(
        self,
        claim_id: str,
        rule_id: str,
        provider: str,
        finding_hash: str,
        fallback_used: bool,
        assessment=None
    ) -> AuditEntry:
        payload = {
        "rule_id": rule_id, "provider": provider,
        "finding_hash": finding_hash, "fallback_used": fallback_used,
        }
        if assessment:
            payload["assessment"] = {
                k: assessment.get(k) for k in
                ("explanation_source", "evidence_completeness", "explanation_grounding",
                "review_priority", "escalate", "escalation_reasons")
            }
        return self.log("ai_decision", claim_id, "ai", payload)
