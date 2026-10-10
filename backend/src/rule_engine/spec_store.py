"""Versioned storage of the specs that implement each rule, in one SQLite database.

Two tables:

    rule_spec_revisions  every revision ever activated (append-only: a trigger
                         forbids UPDATE and DELETE, so history is never rewritten)
    active_rule_specs    which revision of each rule runs (no row = inactive)

The 15 reference rules ship in rules/reference_specs.json, a single reviewable
file. They are loaded into the database automatically, and a changed reference
spec becomes a new revision, unless an admin has since revised that rule.

Every stored spec is bound to the exact English logic it implements
(``logic_sha256``). If a rule's logic in rules.json changes without going
through the drafting flow, the spec no longer matches and the rule is treated
as inactive instead of silently running old logic. Specs are re-checked every
time they are loaded, so a corrupted or hand-edited row is never run.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .catalogue import FieldCatalogue
from .language import RuleSpec, SpecError, parse_spec
from .validation import check_spec

RULE_ID_PATTERN = re.compile(r"^R\d{3,}$")
ORIGINS = ("reference", "agent")
SEED_ACTOR = "reference-seed"

SCHEMA = """
CREATE TABLE IF NOT EXISTS rule_spec_revisions (
    rule_id       TEXT    NOT NULL,
    revision      INTEGER NOT NULL,
    origin        TEXT    NOT NULL,
    logic_sha256  TEXT    NOT NULL,
    spec_sha256   TEXT    NOT NULL,
    activated_at  TEXT    NOT NULL,
    activated_by  TEXT    NOT NULL,
    provenance    TEXT    NOT NULL,
    spec          TEXT    NOT NULL,
    PRIMARY KEY (rule_id, revision)
);
CREATE TABLE IF NOT EXISTS active_rule_specs (
    rule_id   TEXT    PRIMARY KEY,
    revision  INTEGER NOT NULL,
    FOREIGN KEY (rule_id, revision) REFERENCES rule_spec_revisions (rule_id, revision)
);
CREATE TRIGGER IF NOT EXISTS revisions_cannot_change BEFORE UPDATE ON rule_spec_revisions
BEGIN SELECT RAISE(ABORT, 'rule spec revisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS revisions_cannot_be_deleted BEFORE DELETE ON rule_spec_revisions
BEGIN SELECT RAISE(ABORT, 'rule spec revisions are append-only'); END;
"""


class SpecStoreError(RuntimeError):
    """A storage operation could not be completed safely."""


def logic_fingerprint(logic: str) -> str:
    return hashlib.sha256(logic.encode("utf-8")).hexdigest()


def spec_fingerprint(spec: RuleSpec) -> str:
    canonical = json.dumps(spec.to_json(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def default_database(backend_root: Path) -> str:
    """CLAIMGUARD_RULES_DB if set, else <backend root>/outputs/rules.sqlite3."""
    return os.getenv("CLAIMGUARD_RULES_DB") or str(Path(backend_root) / "outputs" / "rules.sqlite3")


def reference_seed_file(backend_root: Path) -> Path:
    return Path(backend_root) / "rules" / "reference_specs.json"


@dataclass(frozen=True)
class StoredSpec:
    rule_id: str
    revision: int
    origin: str
    logic_sha256: str
    activated_at: str
    activated_by: str
    spec: RuleSpec
    provenance: dict[str, Any] = field(default_factory=dict)

    @property
    def spec_sha256(self) -> str:
        return spec_fingerprint(self.spec)

    def to_json(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "revision": self.revision,
            "origin": self.origin,
            "logic_sha256": self.logic_sha256,
            "spec_sha256": self.spec_sha256,
            "activated_at": self.activated_at,
            "activated_by": self.activated_by,
            "provenance": self.provenance,
            "spec": self.spec.to_json(),
        }


@dataclass
class ActiveSpecs:
    """Result of loading the store against the current rule catalogue."""

    active: dict[str, StoredSpec]
    inactive: dict[str, str]  # rule_id -> human-readable reason


_COLUMNS = "rule_id, revision, origin, logic_sha256, spec_sha256, activated_at, activated_by, provenance, spec"


class SpecStore:
    """One store per database. Use it as a context manager, or call close()."""

    def __init__(self, database: Path | str, seed_file: Path | None = None):
        database = str(database)
        if database != ":memory:":
            Path(database).parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database, check_same_thread=False, timeout=10)
        self._connection.execute("PRAGMA foreign_keys = ON")
        self._lock = threading.RLock()
        with self._lock, self._connection:
            self._connection.executescript(SCHEMA)
        if seed_file is not None:
            self._load_reference_seed(Path(seed_file))

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> "SpecStore":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    # ------------------------------------------------------------- reading

    def read(self, rule_id: str) -> StoredSpec | None:
        """The active revision of a rule, or None if the rule is not active."""
        row = self._query_one(
            f"SELECT {_prefixed('r')} FROM active_rule_specs a "
            "JOIN rule_spec_revisions r USING (rule_id, revision) WHERE a.rule_id = ?",
            (rule_id,),
        )
        return None if row is None else _stored(row)

    def is_active(self, rule_id: str) -> bool:
        return self._query_one("SELECT 1 FROM active_rule_specs WHERE rule_id = ?", (rule_id,)) is not None

    def load_active(self, rules: list[dict[str, Any]], fields: FieldCatalogue) -> ActiveSpecs:
        """Return the specs that may run for this catalogue, and why the others may not."""
        rows = self._query_all(
            f"SELECT {_prefixed('r')} FROM active_rule_specs a "
            "JOIN rule_spec_revisions r USING (rule_id, revision)",
            (),
        )
        rows_by_id = {row[0]: row for row in rows}
        active: dict[str, StoredSpec] = {}
        inactive: dict[str, str] = {}
        for rule in rules:
            rule_id = rule.get("rule_id", "")
            row = rows_by_id.get(rule_id)
            if row is None:
                inactive[rule_id] = "no active implementation"
                continue
            try:
                stored = _stored(row)
            except (ValueError, KeyError, TypeError, SpecError) as error:
                inactive[rule_id] = f"stored spec is unreadable: {error}"
                continue
            if stored.logic_sha256 != logic_fingerprint(rule.get("logic", "")):
                inactive[rule_id] = "the rule text changed after its implementation was activated"
            elif problems := check_spec(stored.spec, fields):
                inactive[rule_id] = "stored spec fails checks: " + "; ".join(problems)
            else:
                active[rule_id] = stored
        return ActiveSpecs(active=active, inactive=inactive)

    def history(self, rule_id: str) -> list[dict[str, Any]]:
        rows = self._query_all(
            f"SELECT {_COLUMNS} FROM rule_spec_revisions WHERE rule_id = ? ORDER BY revision", (rule_id,)
        )
        return [
            {"revision": row[1], "origin": row[2], "spec_sha256": row[4], "activated_at": row[5], "activated_by": row[6]}
            for row in rows
        ]

    def known_rule_ids(self) -> set[str]:
        """Every rule id that ever had a revision (used so ids are never reused)."""
        return {row[0] for row in self._query_all("SELECT DISTINCT rule_id FROM rule_spec_revisions", ())}

    # ------------------------------------------------------------- writing

    def activate(
        self,
        rule_id: str,
        spec: RuleSpec,
        logic: str,
        *,
        origin: str,
        actor: str,
        provenance: dict[str, Any] | None = None,
    ) -> StoredSpec:
        """Store a new revision and make it the active one, in one transaction."""
        return self._activate(rule_id, spec, logic_fingerprint(logic), origin=origin, actor=actor,
                              provenance=provenance)

    def deactivate(self, rule_id: str) -> bool:
        """Stop running a rule. Its history is kept. Returns False if it was not active."""
        with self._lock, self._connection:
            cursor = self._connection.execute("DELETE FROM active_rule_specs WHERE rule_id = ?", (rule_id,))
            return cursor.rowcount > 0

    # ------------------------------------------------------------- internals

    def _activate(self, rule_id, spec, logic_sha256, *, origin, actor, provenance) -> StoredSpec:
        if origin not in ORIGINS:
            raise SpecStoreError(f"unknown origin {origin!r}")
        if not isinstance(rule_id, str) or not RULE_ID_PATTERN.fullmatch(rule_id):
            raise SpecStoreError(f"invalid rule id {rule_id!r}")
        with self._lock, self._connection:
            latest = self._connection.execute(
                "SELECT COALESCE(MAX(revision), 0) FROM rule_spec_revisions WHERE rule_id = ?", (rule_id,)
            ).fetchone()[0]
            stored = StoredSpec(
                rule_id=rule_id,
                revision=latest + 1,
                origin=origin,
                logic_sha256=logic_sha256,
                activated_at=datetime.now(timezone.utc).isoformat(),
                activated_by=actor,
                spec=spec,
                provenance=dict(provenance or {}),
            )
            self._connection.execute(
                f"INSERT INTO rule_spec_revisions ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    stored.rule_id, stored.revision, stored.origin, stored.logic_sha256, stored.spec_sha256,
                    stored.activated_at, stored.activated_by,
                    json.dumps(stored.provenance, ensure_ascii=False),
                    json.dumps(spec.to_json(), ensure_ascii=False),
                ),
            )
            self._connection.execute(
                "INSERT INTO active_rule_specs (rule_id, revision) VALUES (?, ?) "
                "ON CONFLICT(rule_id) DO UPDATE SET revision = excluded.revision",
                (rule_id, stored.revision),
            )
        return stored

    def _load_reference_seed(self, seed_file: Path) -> None:
        """Bring the reference specs from the seed file into the database.

        - A rule with no revision yet gets the seed as revision 1.
        - A rule whose active revision is a reference revision gets a new
          revision when the seed has changed.
        - A rule an admin has revised (origin "agent") or deactivated is left alone.
        """
        seed = json.loads(seed_file.read_text(encoding="utf-8"))
        for rule_id, entry in seed["specs"].items():
            spec = parse_spec(entry["spec"])
            with self._lock:
                has_history = rule_id in self.known_rule_ids()
                current = self.read(rule_id)
                outdated = (
                    current is not None
                    and current.origin == "reference"
                    and (current.spec_sha256 != spec_fingerprint(spec) or current.logic_sha256 != entry["logic_sha256"])
                )
                if not has_history or outdated:
                    self._activate(rule_id, spec, entry["logic_sha256"], origin="reference", actor=SEED_ACTOR,
                                   provenance=dict(seed.get("provenance", {})))

    def _query_one(self, sql: str, parameters: tuple):
        with self._lock:
            return self._connection.execute(sql, parameters).fetchone()

    def _query_all(self, sql: str, parameters: tuple) -> list[tuple]:
        with self._lock:
            return self._connection.execute(sql, parameters).fetchall()


def _prefixed(alias: str) -> str:
    return ", ".join(f"{alias}.{column.strip()}" for column in _COLUMNS.split(","))


def _stored(row: tuple) -> StoredSpec:
    rule_id, revision, origin, logic_sha256, _, activated_at, activated_by, provenance, spec = row
    return StoredSpec(
        rule_id=rule_id,
        revision=revision,
        origin=origin,
        logic_sha256=logic_sha256,
        activated_at=activated_at,
        activated_by=activated_by,
        spec=parse_spec(json.loads(spec)),
        provenance=json.loads(provenance),
    )
