from dataclasses import dataclass, field
from typing import Any


@dataclass
class Document:
    document_id: str
    claim_id: str
    attachment_id: str
    filename: str
    sha256: str
    size_bytes: int
    page_count: int
    method: str
    warnings: list[str]
    created_at: str

    def metadata(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "claim_id": self.claim_id,
            "attachment_id": self.attachment_id,
            "filename": self.filename,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "page_count": self.page_count,
            "method": self.method,
            "warnings": list(self.warnings),
            "created_at": self.created_at,
        }


@dataclass
class Passage:
    passage_id: str
    document_id: str
    attachment_id: str
    filename: str
    page: int | None
    start: int  # character offset of the passage inside its page text
    end: int
    text: str
    source: str = "pdf"  # "pdf" or "inline" (attachment.text from the claim)


@dataclass
class QueryTerms:
    identifiers: list[str] = field(default_factory=list)
    dates: list[str] = field(default_factory=list)
    numbers: list[str] = field(default_factory=list)
    words: list[str] = field(default_factory=list)  # from evidence values: normal weight
    hints: list[str] = field(default_factory=list)  # from rule title / corrective action: low weight

    def as_dict(self) -> dict[str, list[str]]:
        return {
            "identifiers": self.identifiers,
            "dates": self.dates,
            "numbers": self.numbers,
            "words": self.words,
            "hints": self.hints,
        }


@dataclass
class Signals:
    patient_match: str  # match | mismatch | unknown
    date_relation: str  # equal | different | none
    identifier_found: list[str]
    status_hint: str | None
    injection_suspected: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "patient_match": self.patient_match,
            "date_relation": self.date_relation,
            "identifier_found": list(self.identifier_found),
            "status_hint": self.status_hint,
            "injection_suspected": self.injection_suspected,
        }


@dataclass
class ScoredPassage:
    passage: Passage
    score: float
    matched: dict[str, list[str]]
