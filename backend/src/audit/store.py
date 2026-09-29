import json
import os
from pathlib import Path

from .models import AuditEntry


class AuditStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)

    def get_last_entry(self) -> AuditEntry | None:
        last = None
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                last = json.loads(line)
        return AuditEntry(**last) if last else None

    def append(self, entry: AuditEntry) -> None:
        self.append_many([entry])

    def append_many(self, entries: list[AuditEntry]) -> None:
        if not entries:
            return
        content = "".join(
            json.dumps(entry.as_dict(), sort_keys=True, separators=(",", ":")) + "\n"
            for entry in entries
        )
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())

    def all_entries(self) -> list[AuditEntry]:
        entries = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                entries.append(AuditEntry(**json.loads(line)))
        return entries
