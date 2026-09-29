"""Compatibility helpers and CLI for the canonical class-based audit chain."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .chain import GENESIS_HASH, verify_chain
from .logger import AuditLogger
from .store import AuditStore


ALLOWED_ACTIONS = {
    "confirm_issue",
    "dismiss_with_reason",
    "request_information",
    "mark_corrected_for_recheck",
}


def verify(path: str | Path) -> tuple[str, int]:
    audit_path = Path(path)
    if not audit_path.exists():
        return GENESIS_HASH, 0
    entries = AuditStore(audit_path).all_entries()
    valid, broken_index = verify_chain(entries)
    if not valid:
        raise ValueError(f"Audit chain invalid at event {broken_index}")
    return (entries[-1].entry_hash if entries else GENESIS_HASH), len(entries)


def append(path: str | Path, events: list[dict[str, Any]]) -> tuple[str, int]:
    validated = []
    for event in events:
        reason = event.get("reason", "")
        if (
            event.get("action") not in ALLOWED_ACTIONS
            or not event.get("actor")
            or not event.get("claim_id")
            or not event.get("rule_id")
            or not isinstance(reason, str)
            or not reason.strip()
        ):
            raise ValueError("Invalid review event")
        validated.append(("human_decision", event["claim_id"], event["actor"], {
            "rule_id": event["rule_id"],
            "action": event["action"],
            "original_status": event.get("original_status", "UNKNOWN"),
            "decision_timestamp": event.get("created_at", datetime.now(timezone.utc).isoformat()),
            "reason_hash": hashlib.sha256(reason.encode("utf-8")).hexdigest(),
        }))

    store = AuditStore(Path(path))
    AuditLogger(store).log_batch(validated)
    return verify(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", default="outputs/audit.jsonl")
    parser.add_argument("--events")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.events:
        events = [
            json.loads(line)
            for line in Path(args.events).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        head, count = append(args.log, events)
    else:
        head, count = verify(args.log)
    print(f"Chain valid: {count} events; head {head}.")


if __name__ == "__main__":
    main()