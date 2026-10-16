"""Deterministic query derivation from a server-recomputed finding. No LLM, and no
rule-specific code: the terms come from whatever the finding's evidence names,
so rules authored later get the same treatment."""
import re
from typing import Any

from evidence_rag.models import QueryTerms

IDENTIFIER = re.compile(r"\b[A-Z]{2,}-[A-Z0-9][A-Z0-9-]*[A-Z0-9]\b|\b[A-Z]{2,}-[A-Z0-9]\b")
DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
RULE_ID = re.compile(r"^R\d{3,}$")
WORD = re.compile(r"[a-z][a-z0-9]{2,}")

CLAIM_ANCHORS = ("patient_id", "member_id", "invoice_number", "provider_id")
LINE_FIELDS = ("service_code", "service_date", "authorization_id")
# A value is an identifier because of the field that holds it, not because of its shape:
# "PT/99-ALPHA", "88812345" and "XY-AB-1" are all taken verbatim.
IDENTIFIER_FIELD = re.compile(r"(^|_)(id|code|number)$")
MIN_STRING_LENGTH = 3

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "not", "any", "all", "its",
    "has", "have", "had", "per", "into", "onto", "than", "then", "there", "their", "them", "they", "send",
    "obtain", "verify", "check", "request", "correct", "applicable", "information", "required", "matches",
    "match", "against", "supplied", "intended", "human", "review", "claim", "line", "lines", "rule",
}


class _Collector:
    def __init__(self) -> None:
        self.terms = QueryTerms()

    @staticmethod
    def _add(bucket: list[str], value: str) -> None:
        if value and value not in bucket and not RULE_ID.match(value):
            bucket.append(value)

    def identifier(self, value: Any) -> None:
        """Add a value verbatim as an identifier, whatever its format."""
        if value is None or isinstance(value, bool) or not isinstance(value, (str, int)):
            return
        text = str(value).strip()
        if len(text) >= MIN_STRING_LENGTH:
            self._add(self.terms.identifiers, text)

    def scalar(self, value: Any, *, weak: bool = False) -> None:
        if value is None or isinstance(value, bool):
            return
        if isinstance(value, (int, float)):
            text = format(value, "g")
            if len(text.replace(".", "").replace("-", "")) >= 2 and not weak:
                self._add(self.terms.numbers, text)
            return
        if not isinstance(value, str):
            return
        text = value.strip()
        if len(text) < MIN_STRING_LENGTH:
            return
        found_ids = [match for match in IDENTIFIER.findall(text) if not RULE_ID.match(match)]
        found_dates = DATE.findall(text)
        for identifier in found_ids:
            self._add(self.terms.identifiers, identifier)
        for date in found_dates:
            self._add(self.terms.dates, date)
        remainder = DATE.sub(" ", IDENTIFIER.sub(" ", text))
        if re.fullmatch(r"\s*-?\d+(\.\d+)?\s*", remainder) and len(remainder.strip()) >= 2:
            self._add(self.terms.numbers, remainder.strip())
            return
        bucket = self.terms.hints if weak else self.terms.words
        for word in WORD.findall(remainder.lower()):
            if word not in STOPWORDS:
                self._add(bucket, word)

    def field_value(self, field: str, value: Any) -> None:
        if IDENTIFIER_FIELD.search(field) and not isinstance(value, (dict, list)):
            self.identifier(value)
        else:
            self.walk(value)

    def walk(self, value: Any) -> None:
        if isinstance(value, dict):
            # Evidence items name their field in a JSON pointer: {"path": "/lines/0/authorization_id", "value": ...}
            if isinstance(value.get("path"), str) and "value" in value:
                self.field_value(value["path"].rstrip("/").rsplit("/", 1)[-1], value["value"])
                return
            for key, item in value.items():
                if key == "path":  # JSON pointers describe where, not what
                    continue
                self.field_value(str(key), item)
        elif isinstance(value, list):
            for item in value:
                self.walk(item)
        else:
            self.scalar(value)


def derive_query(finding: dict[str, Any], claim: dict[str, Any], rule: dict[str, Any] | None = None) -> QueryTerms:
    collector = _Collector()
    collector.walk(finding.get("evidence"))

    lines = {line.get("line_id"): line for line in claim.get("lines") or [] if isinstance(line, dict)}
    for line_id in finding.get("affected_line_ids") or []:
        line = lines.get(line_id)
        if line:
            for field in LINE_FIELDS:
                collector.field_value(field, line.get(field))

    for field in CLAIM_ANCHORS:
        collector.identifier(claim.get(field))

    for text in ((rule or {}).get("title"), (rule or {}).get("corrective_action") or finding.get("corrective_action")):
        collector.scalar(text, weak=True)

    terms = collector.terms
    # A word already given as a strong term is not repeated as a hint.
    terms.hints = [hint for hint in terms.hints if hint not in terms.words]
    return terms


def line_service_dates(finding: dict[str, Any], claim: dict[str, Any]) -> list[str]:
    """Service dates of the affected lines, or of every line when none is named."""
    lines = [line for line in claim.get("lines") or [] if isinstance(line, dict)]
    affected = set(finding.get("affected_line_ids") or [])
    chosen = [line for line in lines if line.get("line_id") in affected] or lines
    return sorted({line["service_date"] for line in chosen if isinstance(line.get("service_date"), str)})
