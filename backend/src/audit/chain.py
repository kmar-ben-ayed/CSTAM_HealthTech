import hashlib
import json

from .models import AuditEntry

GENESIS_HASH = "0" * 64


def compute_hash(entry: AuditEntry) -> str:
    content = {
        "index": entry.index,
        "timestamp": entry.timestamp,
        "event_type": entry.event_type,
        "claim_id": entry.claim_id,
        "actor": entry.actor,
        "payload": entry.payload,
        "prev_hash": entry.prev_hash,
    }
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def verify_chain(entries: list[AuditEntry]) -> tuple[bool, int | None]:
    expected_previous = GENESIS_HASH
    for expected_index, entry in enumerate(entries):
        if entry.index != expected_index or entry.prev_hash != expected_previous:
            return False, entry.index
        if compute_hash(entry) != entry.entry_hash:
            return False, entry.index
        expected_previous = entry.entry_hash
    return True, None
