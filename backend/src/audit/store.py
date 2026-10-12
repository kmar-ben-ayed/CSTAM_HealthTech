import json
import os
import time
from contextlib import contextmanager
from pathlib import Path

from .models import AuditEntry

LOCK_TIMEOUT_SECONDS = 30
TAIL_BLOCK = 64 * 1024

if os.name == "nt":
    import msvcrt

    def _lock(handle) -> None:
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                return
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.02)

    def _unlock(handle) -> None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _lock(handle) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)

    def _unlock(handle) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


class AuditStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)
        self.lock_path = self.path.with_name(self.path.name + ".lock")

    @contextmanager
    def locked(self):
        """One writer at a time across processes (the app, scripts), so the chain never forks."""
        with self.lock_path.open("a+b") as handle:
            _lock(handle)
            try:
                yield
            finally:
                _unlock(handle)

    def size(self) -> int:
        return self.path.stat().st_size

    def get_last_entry(self) -> AuditEntry | None:
        """The last entry, read from the end of the file (the log holds many thousands)."""
        with self.path.open("rb") as stream:
            end = stream.seek(0, os.SEEK_END)
            position = end
            tail = b""
            while position > 0:
                position = max(0, position - TAIL_BLOCK)
                stream.seek(position)
                tail = stream.read(end - position)
                if b"\n" in tail.rstrip():
                    break
        body = tail.rstrip()
        if not body:
            return None
        return AuditEntry(**json.loads(body.rsplit(b"\n", 1)[-1]))

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
