"""Persistent records of rule drafts (SQLite), from submission to activation.

A draft holds everything needed to resume or audit it: the rule text, the
author's answers and confirmed examples, the latest proposal and check report,
and a short event history.

    queued -> drafting -> checking -> awaiting_confirmation -> active
                  |           |
                  +-----------+--> awaiting_author (a question) -> queued -> ...

Any open draft can end as rejected or cancelled.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import closing
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .edge_cases import LabelledCase

QUEUED = "queued"
DRAFTING = "drafting"
CHECKING = "checking"
AWAITING_AUTHOR = "awaiting_author"
AWAITING_CONFIRMATION = "awaiting_confirmation"
ACTIVE = "active"
REJECTED = "rejected"
CANCELLED = "cancelled"

RUNNING_STATES = {QUEUED, DRAFTING, CHECKING}
OPEN_STATES = RUNNING_STATES | {AWAITING_AUTHOR, AWAITING_CONFIRMATION}

CLARIFICATION = "clarification"
CASE = "case"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Question:
    question_id: str
    kind: str  # CLARIFICATION (free text) or CASE (pick the correct outcome for a claim)
    text: str
    case: dict[str, Any] | None = None
    answer: str | None = None
    answered_by: str | None = None


@dataclass
class Draft:
    draft_id: str
    rule_id: str
    kind: str  # "new" or "revision"
    rule: dict[str, Any]  # title, severity, logic, corrective_action
    author: str
    state: str = QUEUED
    created_at: str = field(default_factory=now)
    updated_at: str = field(default_factory=now)
    rounds: int = 0
    questions: list[Question] = field(default_factory=list)
    author_answers: list[dict[str, str]] = field(default_factory=list)
    examples: list[LabelledCase] = field(default_factory=list)
    feedback: list[str] = field(default_factory=list)
    proposal: dict[str, Any] | None = None  # spec, intent, assumptions
    report: dict[str, Any] | None = None
    outcome_reason: str = ""
    provenance: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, str]] = field(default_factory=list)

    @property
    def is_open(self) -> bool:
        return self.state in OPEN_STATES

    def open_questions(self) -> list[Question]:
        return [question for question in self.questions if question.answer is None]

    def log(self, event: str, detail: str = "") -> None:
        self.events.append({"at": now(), "event": event, "detail": detail[:500]})

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["examples"] = [example.to_json() for example in self.examples]
        return data

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Draft":
        data = dict(data)
        data["questions"] = [Question(**question) for question in data.get("questions", [])]
        data["examples"] = [LabelledCase.from_json(example) for example in data.get("examples", [])]
        return cls(**data)


class DraftStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS rule_drafts ("
                " draft_id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, state TEXT NOT NULL,"
                " created_at TEXT NOT NULL, record TEXT NOT NULL)"
            )

    def save(self, draft: Draft) -> Draft:
        draft.updated_at = now()
        record = json.dumps(draft.to_json(), ensure_ascii=False)
        with self._lock, closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute(
                "INSERT INTO rule_drafts (draft_id, rule_id, state, created_at, record) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(draft_id) DO UPDATE SET state = excluded.state, record = excluded.record",
                (draft.draft_id, draft.rule_id, draft.state, draft.created_at, record),
            )
        return draft

    def get(self, draft_id: str) -> Draft | None:
        rows = self._query("SELECT record FROM rule_drafts WHERE draft_id = ?", (draft_id,))
        return Draft.from_json(json.loads(rows[0][0])) if rows else None

    def list(self, limit: int = 50) -> list[Draft]:
        rows = self._query("SELECT record FROM rule_drafts ORDER BY created_at DESC LIMIT ?", (limit,))
        return [Draft.from_json(json.loads(row[0])) for row in rows]

    def open_draft_for(self, rule_id: str) -> Draft | None:
        placeholders = ",".join("?" for _ in OPEN_STATES)
        rows = self._query(
            f"SELECT record FROM rule_drafts WHERE rule_id = ? AND state IN ({placeholders})",
            (rule_id, *sorted(OPEN_STATES)),
        )
        return Draft.from_json(json.loads(rows[0][0])) if rows else None

    def count_created_since(self, timestamp: str) -> int:
        return self._query("SELECT COUNT(*) FROM rule_drafts WHERE created_at >= ?", (timestamp,))[0][0]

    def rule_ids(self) -> list[str]:
        return [row[0] for row in self._query("SELECT DISTINCT rule_id FROM rule_drafts", ())]

    def reject_interrupted(self) -> list[Draft]:
        """On startup: drafts that were mid-run when the server stopped cannot be trusted."""
        placeholders = ",".join("?" for _ in RUNNING_STATES)
        rows = self._query(
            f"SELECT record FROM rule_drafts WHERE state IN ({placeholders})", tuple(sorted(RUNNING_STATES))
        )
        interrupted = []
        for row in rows:
            draft = Draft.from_json(json.loads(row[0]))
            draft.state = REJECTED
            draft.outcome_reason = "interrupted by a server restart; submit the rule again"
            draft.log("rejected", draft.outcome_reason)
            interrupted.append(self.save(draft))
        return interrupted

    def _query(self, sql: str, parameters: tuple) -> list[tuple]:
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            return connection.execute(sql, parameters).fetchall()
