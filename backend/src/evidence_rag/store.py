"""SQLite store for uploaded documents and their passages, keyed by claim.
The PDF bytes themselves are not kept: only their sha256, metadata and the
extracted passages. Nothing is written to disk under a user-supplied name."""
import json
import sqlite3
import threading
from contextlib import closing
from pathlib import Path

from evidence_rag.models import Document, Passage


class EvidenceStore:
    def __init__(self, storage_path: Path):
        self._lock = threading.Lock()
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS documents ("
                    "document_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, attachment_id TEXT NOT NULL, "
                    "filename TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, "
                    "page_count INTEGER NOT NULL, method TEXT NOT NULL, warnings TEXT NOT NULL, "
                    "created_at TEXT NOT NULL, UNIQUE (claim_id, attachment_id, sha256))"
                )
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS passages ("
                    "passage_id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE, "
                    "claim_id TEXT NOT NULL, page INTEGER, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, "
                    "text TEXT NOT NULL, ordinal INTEGER NOT NULL)"
                )
                connection.execute("CREATE INDEX IF NOT EXISTS passages_by_claim ON passages (claim_id)")
                connection.execute("CREATE INDEX IF NOT EXISTS documents_by_claim ON documents (claim_id)")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.storage_path)
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @staticmethod
    def _document(row) -> Document:
        return Document(
            document_id=row[0], claim_id=row[1], attachment_id=row[2], filename=row[3], sha256=row[4],
            size_bytes=row[5], page_count=row[6], method=row[7], warnings=json.loads(row[8]), created_at=row[9],
        )

    _DOCUMENT_COLUMNS = (
        "document_id, claim_id, attachment_id, filename, sha256, size_bytes, page_count, method, warnings, created_at"
    )

    def find(self, claim_id: str, attachment_id: str, sha256: str) -> Document | None:
        with self._lock, closing(self._connect()) as connection:
            row = connection.execute(
                f"SELECT {self._DOCUMENT_COLUMNS} FROM documents WHERE claim_id = ? AND attachment_id = ? AND sha256 = ?",
                (claim_id, attachment_id, sha256),
            ).fetchone()
        return self._document(row) if row else None

    def save(self, document: Document, passages: list[Passage]) -> tuple[Document, bool]:
        """Insert a document and its passages. Returns (document, created)."""
        with self._lock, closing(self._connect()) as connection:
            with connection:
                existing = connection.execute(
                    f"SELECT {self._DOCUMENT_COLUMNS} FROM documents WHERE claim_id = ? AND attachment_id = ? AND sha256 = ?",
                    (document.claim_id, document.attachment_id, document.sha256),
                ).fetchone()
                if existing:
                    return self._document(existing), False
                connection.execute(
                    f"INSERT INTO documents ({self._DOCUMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (document.document_id, document.claim_id, document.attachment_id, document.filename,
                     document.sha256, document.size_bytes, document.page_count, document.method,
                     json.dumps(document.warnings), document.created_at),
                )
                connection.executemany(
                    "INSERT OR IGNORE INTO passages (passage_id, document_id, claim_id, page, start_offset, end_offset, text, ordinal) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [(p.passage_id, document.document_id, document.claim_id, p.page, p.start, p.end, p.text, i)
                     for i, p in enumerate(passages)],
                )
        return document, True

    def list_documents(self, claim_id: str) -> list[Document]:
        with self._lock, closing(self._connect()) as connection:
            rows = connection.execute(
                f"SELECT {self._DOCUMENT_COLUMNS} FROM documents WHERE claim_id = ? ORDER BY created_at, document_id",
                (claim_id,),
            ).fetchall()
        return [self._document(row) for row in rows]

    def delete(self, claim_id: str, document_id: str) -> Document | None:
        with self._lock, closing(self._connect()) as connection:
            with connection:
                row = connection.execute(
                    f"SELECT {self._DOCUMENT_COLUMNS} FROM documents WHERE claim_id = ? AND document_id = ?",
                    (claim_id, document_id),
                ).fetchone()
                if not row:
                    return None
                connection.execute("DELETE FROM passages WHERE document_id = ?", (document_id,))
                connection.execute("DELETE FROM documents WHERE document_id = ?", (document_id,))
        return self._document(row)

    def passages_for_claim(self, claim_id: str) -> list[Passage]:
        """Every passage of this claim's documents, and nothing from any other claim."""
        with self._lock, closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT p.passage_id, p.document_id, d.attachment_id, d.filename, p.page, p.start_offset, "
                "p.end_offset, p.text FROM passages p JOIN documents d ON d.document_id = p.document_id "
                "WHERE p.claim_id = ? AND d.claim_id = ? ORDER BY d.created_at, p.document_id, p.ordinal",
                (claim_id, claim_id),
            ).fetchall()
        return [
            Passage(passage_id=r[0], document_id=r[1], attachment_id=r[2], filename=r[3], page=r[4],
                    start=r[5], end=r[6], text=r[7])
            for r in rows
        ]
