"""Deterministic consistency signals for a retrieved passage. They state facts
(this id appears, this date differs) and hints, never verdicts, and they never
feed rule status, confidence or requires_human_review."""
import re
from typing import Any

from evidence_rag.models import Passage, Signals
from evidence_rag.query import DATE
from evidence_rag.retrieve import exact_pattern
from evidence_rag.sanitize import injection_suspected

PATIENT_ID = re.compile(r"(?<![A-Za-z0-9])PAT-[A-Z0-9]{4,}(?![A-Za-z0-9])")
STATUS_WINDOW = 120

STATUS_WORDS = {
    "approved": "approved", "authorized": "approved", "authorised": "approved", "granted": "approved",
    "denied": "denied", "rejected": "denied", "declined": "denied", "refused": "denied",
    "pending": "pending", "awaiting": "pending",
    "draft": "draft", "preliminary": "draft", "unsigned": "draft",
    "final": "final", "finalised": "final", "finalized": "final", "signed": "final",
}
_STATUS = re.compile(r"\b(not\s+)?(" + "|".join(STATUS_WORDS) + r")\b", re.IGNORECASE)


def patient_match(passage: Passage, claim: dict[str, Any]) -> str:
    claim_patient = claim.get("patient_id")
    if not isinstance(claim_patient, str) or not claim_patient:
        return "unknown"
    mentioned = set(PATIENT_ID.findall(passage.text))
    if mentioned:
        return "match" if mentioned == {claim_patient} else "mismatch"
    for attachment in claim.get("attachments") or []:
        if isinstance(attachment, dict) and attachment.get("attachment_id") == passage.attachment_id:
            linked = attachment.get("patient_id")
            if isinstance(linked, str) and linked:
                return "match" if linked == claim_patient else "mismatch"
    return "unknown"


def date_relation(passage: Passage, service_dates: list[str]) -> str:
    mentioned = set(DATE.findall(passage.text))
    if not mentioned:
        return "none"
    return "equal" if mentioned & set(service_dates) else "different"


def status_hint(text: str, anchors: list[str]) -> str | None:
    """Status word nearest to a found identifier; with no identifier, the first one."""
    hits = [(m.start(), "denied" if m.group(1) and STATUS_WORDS[m.group(2).lower()] == "approved"
             else STATUS_WORDS[m.group(2).lower()]) for m in _STATUS.finditer(text)]
    if not hits:
        return None
    positions = [m.start() for term in anchors for m in exact_pattern(term).finditer(text)]
    if not positions:
        return hits[0][1]
    best = min(hits, key=lambda hit: min(abs(hit[0] - p) for p in positions))
    if min(abs(best[0] - p) for p in positions) > STATUS_WINDOW:
        return None
    return best[1]


def compute_signals(passage: Passage, claim: dict[str, Any], identifiers: list[str], service_dates: list[str]) -> Signals:
    found = [term for term in identifiers if exact_pattern(term).search(passage.text)]
    return Signals(
        patient_match=patient_match(passage, claim),
        date_relation=date_relation(passage, service_dates),
        identifier_found=found,
        status_hint=status_hint(passage.text, found),
        injection_suspected=injection_suspected(passage.text),
    )


def advisory_flags(items: list[tuple[Any, Signals]], ocr_concern: bool) -> list[str]:
    flags = []
    if not items:
        flags.append("no_supporting_evidence")
    if any(s.patient_match == "mismatch" or s.status_hint == "denied" for _, s in items):
        flags.append("contradicting_evidence")
    if any(
        s.identifier_found and s.status_hint in {"approved", "final"}
        and s.patient_match != "mismatch" and not s.injection_suspected
        for _, s in items
    ):
        flags.append("possible_resolution")
    if any(s.injection_suspected for _, s in items):
        flags.append("injection_suspected")
    if ocr_concern:
        flags.append("ocr_low_confidence")
    return flags
