"""EvidenceService: document upload, listing, removal and (later) retrieval.

Nothing here touches rule evaluation: findings are only ever read, never changed."""
import base64
import binascii
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from api_app.services import ApiProblem
from audit.logger import AuditLogger, AuditWriteError
from evidence_rag.chunk import chunk_page, chunk_pages
from evidence_rag.extract import ExtractionError, extract_pdf
from evidence_rag.models import Document, Passage, QueryTerms, ScoredPassage
from evidence_rag.query import derive_query, line_service_dates
from evidence_rag.retrieve import (
    EmbeddingRetriever,
    LexicalRetriever,
    exact_pattern,
    retriever_from_environment,
    word_pattern,
)
from evidence_rag.sanitize import clean_label, clean_text
from evidence_rag.signals import advisory_flags, compute_signals
from evidence_rag.store import EvidenceStore
from rule_engine.engine_core import baseline

MAX_PDF_BYTES = 3 * 1024 * 1024
MAX_PAGES = 30
MAX_CHARS = 200_000
MAX_INLINE_CHARS = 20_000
DISPLAY_CHARS = 600
ACTIONABLE = {"FAIL", "UNABLE_TO_ASSESS"}
NOTICE = "Retrieved text is unverified. The rule result is unchanged."
OCR_WARNINGS = {"ocr_unavailable", "ocr_low_confidence", "no_text_extracted"}


def _hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _display(passage: Passage, terms: QueryTerms, matched: dict[str, list[str]]) -> tuple[str, list[dict[str, Any]]]:
    """Cap the passage at DISPLAY_CHARS around its first strong hit, and locate highlights in that text."""
    text = passage.text
    start = 0
    if len(text) > DISPLAY_CHARS:
        first = [m.start() for term in matched["identifiers"] + matched["dates"]
                 for m in [exact_pattern(term).search(text)] if m]
        start = max(0, min(min(first, default=0) - DISPLAY_CHARS // 4, len(text) - DISPLAY_CHARS))
    shown = text[start:start + DISPLAY_CHARS]
    highlights = []
    for term in matched["identifiers"] + matched["dates"]:
        highlights += [{"start": m.start(), "end": m.end(), "term": term} for m in exact_pattern(term).finditer(shown)]
    for term in dict.fromkeys(matched["words"]):
        highlights += [{"start": m.start(), "end": m.end(), "term": term} for m in word_pattern(term).finditer(shown)]
    highlights.sort(key=lambda h: (h["start"], -h["end"]))
    merged: list[dict[str, Any]] = []
    for highlight in highlights:  # drop overlaps so the client can render spans in order
        if merged and highlight["start"] < merged[-1]["end"]:
            continue
        merged.append(highlight)
    return shown, merged


class EvidenceService:
    def __init__(self, store: EvidenceStore, claim_service, audit_logger: AuditLogger, retriever_factory=None):
        self.store = store
        self.claim_service = claim_service
        self.audit_logger = audit_logger
        self.retriever_factory = retriever_factory or retriever_from_environment

    def _audit(self, event_type: str, claim_id: str, actor: str, payload: dict[str, Any]) -> None:
        try:
            self.audit_logger.log(event_type, claim_id, actor, payload)
        except AuditWriteError as error:
            raise ApiProblem(503, "audit_unavailable", "Could not safely record the evidence event") from error

    # ── Documents ────────────────────────────────────────────────────────────
    def upload(self, claim_id: str, attachment_id: str, filename: str, content_base64: str, actor: str) -> dict[str, Any]:
        try:
            data = base64.b64decode(content_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ApiProblem(422, "invalid_document", "content_base64 is not valid base64") from error
        if len(data) > MAX_PDF_BYTES:
            raise ApiProblem(422, "document_too_large", "The PDF is larger than 3 MB")
        if not data.startswith(b"%PDF-"):
            raise ApiProblem(422, "invalid_document", "The file is not a PDF")

        sha256 = hashlib.sha256(data).hexdigest()
        try:
            existing = self.store.find(claim_id, attachment_id, sha256)
        except sqlite3.Error as error:
            raise ApiProblem(503, "evidence_unavailable", "The document store is unavailable") from error
        if existing is not None:
            return {**existing.metadata(), "created": False}

        try:
            extraction = extract_pdf(data, max_pages=MAX_PAGES, max_chars=MAX_CHARS)
        except ExtractionError as error:
            raise ApiProblem(422, error.code, error.message) from error
        except Exception as error:  # a hostile or broken PDF must give a clean 422
            raise ApiProblem(422, "invalid_document", "The PDF could not be processed") from error

        document_id = "evd-" + hashlib.sha256(f"{claim_id}\x1f{attachment_id}\x1f{sha256}".encode("utf-8")).hexdigest()[:20]
        document = Document(
            document_id=document_id,
            claim_id=claim_id,
            attachment_id=attachment_id,
            filename=clean_label(filename) or "document.pdf",
            sha256=sha256,
            size_bytes=len(data),
            page_count=len(extraction.pages),
            method=extraction.method,
            warnings=extraction.warnings,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        passages = chunk_pages(document_id, attachment_id, document.filename, extraction.pages)
        try:
            saved, created = self.store.save(document, passages)
        except sqlite3.Error as error:
            raise ApiProblem(503, "evidence_unavailable", "The document store is unavailable") from error
        if created:
            self._audit("evidence_document_added", claim_id, actor, {
                "document_id": saved.document_id,
                "attachment_id": saved.attachment_id,
                "document_sha256": saved.sha256,
                "page_count": saved.page_count,
                "method": saved.method,
            })
        return {**saved.metadata(), "created": created, "passage_count": len(passages)}

    def list_documents(self, claim_id: str) -> dict[str, Any]:
        try:
            documents = self.store.list_documents(claim_id)
        except sqlite3.Error as error:
            raise ApiProblem(503, "evidence_unavailable", "The document store is unavailable") from error
        return {"claim_id": claim_id, "documents": [document.metadata() for document in documents]}

    def delete(self, claim_id: str, document_id: str, actor: str) -> dict[str, Any]:
        try:
            removed = self.store.delete(claim_id, document_id)
        except sqlite3.Error as error:
            raise ApiProblem(503, "evidence_unavailable", "The document store is unavailable") from error
        if removed is None:
            raise ApiProblem(404, "document_not_found", "No such document for this claim")
        self._audit("evidence_document_removed", claim_id, actor, {
            "document_id": removed.document_id,
            "attachment_id": removed.attachment_id,
            "document_sha256": removed.sha256,
            "page_count": removed.page_count,
            "method": removed.method,
        })
        return {"document_id": removed.document_id, "removed": True}

    # ── Retrieval ────────────────────────────────────────────────────────────
    def _finding(self, claim: dict[str, Any], rule_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        """Recompute the finding server-side, exactly as the explanation endpoint does,
        so a client can never supply (or forge) the finding it searches for."""
        rules = {rule["rule_id"]: rule for rule in self.claim_service.rules_config["rules"]}
        rule = rules.get(rule_id)
        if rule is None:
            raise ApiProblem(404, "rule_not_found", "Unknown rule ID")
        finding = next(
            (result for result in baseline(claim, self.claim_service.rules_config) if result["rule_id"] == rule_id),
            None,
        )
        if finding is None:
            raise ApiProblem(404, "rule_not_active", "This rule is not active, so it has no finding to search for")
        return finding, rule

    @staticmethod
    def _inline_passages(claim: dict[str, Any]) -> list[Passage]:
        passages = []
        for attachment in claim.get("attachments") or []:
            if not isinstance(attachment, dict):
                continue
            text = attachment.get("text")
            attachment_id = attachment.get("attachment_id")
            if not isinstance(text, str) or not text.strip() or not isinstance(attachment_id, str):
                continue
            document_id = f"inline:{attachment_id}"[:64]
            passages.extend(chunk_page(
                document_id, attachment_id, "Claim attachment text", None,
                clean_text(text, MAX_INLINE_CHARS), source="inline",
            ))
        return passages

    def search(self, claim: dict[str, Any], rule_id: str, actor: str) -> dict[str, Any]:
        self.claim_service.validate_claim(claim)
        finding, rule = self._finding(claim, rule_id)
        claim_id = claim["claim_id"]
        base = {
            "claim_id": claim_id,
            "rule_id": rule_id,
            "finding_status": finding["status"],
            "notice": NOTICE,
        }
        if finding["status"] not in ACTIONABLE:
            # Nothing to resolve, so nothing is searched and nothing is audited.
            return {**base, "applicable": False, "retriever": None, "advisory": [], "passages": [],
                    "documents_searched": 0, "warnings": []}

        warnings: list[str] = []
        try:
            documents = self.store.list_documents(claim_id)
            stored = self.store.passages_for_claim(claim_id)
        except sqlite3.Error:
            documents, stored = [], []
            warnings.append("document_store_unavailable")
        inline = self._inline_passages(claim)
        candidates = stored + inline

        terms = derive_query(finding, claim, rule)
        retriever = self.retriever_factory()
        try:
            ranked: list[ScoredPassage] = retriever.rank(terms, candidates)
        except Exception:
            retriever = LexicalRetriever()
            ranked = retriever.rank(terms, candidates)
            warnings.append("retriever_fallback")
        retriever_name = retriever.name
        if isinstance(retriever, EmbeddingRetriever) and retriever.last_fallback:
            retriever_name = "lexical"
            warnings.append("embedding_fallback")

        service_dates = line_service_dates(finding, claim)
        evaluated = [(item, compute_signals(item.passage, claim, terms.identifiers, service_dates)) for item in ranked]
        ocr_concern = any(document.method in {"ocr", "mixed"} or OCR_WARNINGS & set(document.warnings)
                          for document in documents)
        advisory = advisory_flags(evaluated, ocr_concern)

        passages = []
        for item, signals in evaluated:
            text, highlights = _display(item.passage, terms, item.matched)
            passages.append({
                "passage_id": item.passage.passage_id,
                "document_id": item.passage.document_id,
                "attachment_id": item.passage.attachment_id,
                "filename": item.passage.filename,
                "source": item.passage.source,
                "page": item.passage.page,
                "text": text,
                "highlights": highlights,
                "score": item.score,
                "matched": {key: item.matched[key] for key in ("identifiers", "dates", "words")},
                "signals": signals.as_dict(),
            })

        self._audit("evidence_retrieval", claim_id, actor, {
            "rule_id": rule_id,
            "query_sha256": _hash(terms.as_dict()),
            "retriever": retriever_name,
            "result_count": len(passages),
            "passage_ids": [p["passage_id"] for p in passages],
            "document_ids": list(dict.fromkeys(p["document_id"] for p in passages)),
            "advisory": advisory,
        })
        inline_sources = {p.document_id for p in inline}
        return {
            **base,
            "applicable": True,
            "retriever": retriever_name,
            "advisory": advisory,
            "passages": passages,
            "documents_searched": len(documents) + len(inline_sources),
            "warnings": warnings,
        }
