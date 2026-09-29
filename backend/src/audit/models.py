from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class AuditEntry:
    index: int
    timestamp: str
    event_type: str
    claim_id: str
    actor: str
    payload: dict[str, Any]
    prev_hash: str
    entry_hash: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
