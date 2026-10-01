import hashlib
import json
import os
from json import JSONDecoder, JSONDecodeError
from pathlib import Path
from typing import Any
from uuid import uuid4

from openai import OpenAI

from AI_agent.confidence import assess
from AI_agent.llm_adapter import (
    MockExplanationProvider,
    OpenAIExplanationProvider,
    deterministic_fallback,
    validate_explanation,
)
from audit.chain import verify_chain
from audit.logger import AuditLogger, AuditWriteError
from audit.store import AuditStore
from normalisation.csv_to_jsonl import convert_files
from normalisation.fhir_adapter import (
    FhirError,
    check_bundle,
    claim_and_findings,
    claim_to_bundle,
    parse_bundles_text,
)
from normalisation.schema_subset import validate as validate_claim_schema
from rule_engine.engine_core import baseline, validate_transport


BACKEND_ROOT = Path(__file__).resolve().parents[2]
DATASET_SPLITS = {
    "development": ("Development Suite", BACKEND_ROOT / "data" / "development" / "claims.jsonl"),
    "validation": ("Validation Suite", BACKEND_ROOT / "data" / "validation" / "claims.jsonl"),
    "stress": ("Stress Test Suite", BACKEND_ROOT / "data" / "stress" / "claims.jsonl"),
}


class ApiProblem(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def load_claim_file(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
    except JSONDecodeError:
        pass

    decoder = JSONDecoder()
    claims = []
    position = 0
    while position < len(text):
        while position < len(text) and text[position].isspace():
            position += 1
        if position >= len(text):
            break
        claim, position = decoder.raw_decode(text, position)
        if not isinstance(claim, dict):
            raise ValueError("Dataset records must be JSON objects")
        claims.append(claim)
    return claims


class ClaimService:
    def __init__(self, rules_config: dict[str, Any], claim_schema: dict[str, Any], audit_logger: AuditLogger):
        self.rules_config = rules_config
        self.claim_schema = claim_schema
        self.audit_logger = audit_logger

    def validate_claim(self, claim: dict[str, Any]) -> None:
        try:
            validate_claim_schema(claim, self.claim_schema)
            validate_transport(claim)
        except (ValueError, KeyError, TypeError) as error:
            raise ApiProblem(422, "invalid_claim", str(error)) from error

    def evaluate(self, claim: dict[str, Any], *, record_audit: bool = True) -> dict[str, Any]:
        return self.evaluate_many([claim], record_audit=record_audit)[0]

    def evaluate_many(
        self,
        claims: list[dict[str, Any]],
        *,
        record_audit: bool = True,
    ) -> list[dict[str, Any]]:
        for claim in claims:
            self.validate_claim(claim)

        evaluations = [
            {
                "evaluation_id": uuid4().hex,
                "claim_id": claim["claim_id"],
                "results": baseline(claim, self.rules_config),
            }
            for claim in claims
        ]
        if record_audit:
            events = []
            for evaluation in evaluations:
                for result in evaluation["results"]:
                    payload = {
                        "evaluation_id": evaluation["evaluation_id"],
                        "rule_id": result["rule_id"],
                        "rule_version": result["rule_version"],
                        "status": result["status"],
                        "severity": result["severity"],
                        "requires_human_review": result["requires_human_review"],
                        "confidence": result.get("confidence"),
                        "confidence_kind": result.get("confidence_kind"),
                        "method": result.get("method"),
                    }
                    events.append(("rule_execution", evaluation["claim_id"], "system", payload))
            try:
                self.audit_logger.log_batch(events)
            except AuditWriteError as error:
                raise ApiProblem(503, "audit_unavailable", "Could not safely record the evaluation") from error
        return evaluations


class DatasetService:
    def __init__(self, claims_service: ClaimService, backend_root: Path = BACKEND_ROOT):
        self.claims_service = claims_service
        self.backend_root = Path(backend_root)

    def get_dataset(self, split: str, limit: int | None = None) -> dict[str, Any]:
        if split not in DATASET_SPLITS:
            raise ApiProblem(404, "dataset_not_found", "Unknown dataset")
        if limit is not None and not 1 <= limit <= 500:
            raise ApiProblem(422, "invalid_limit", "limit must be between 1 and 500")

        name, path = DATASET_SPLITS[split]
        path = self.backend_root / "data" / split / "claims.jsonl"
        claims = load_claim_file(path)
        if limit is not None:
            claims = claims[:limit]
        evaluations = self.claims_service.evaluate_many(claims, record_audit=False)
        return {
            "dataset": split,
            "name": f"{name} ({len(claims)} Claims)",
            "claims": claims,
            "evaluations": {row["claim_id"]: row["results"] for row in evaluations},
        }


def _decode_records(text: str) -> tuple[list[Any], list[dict[str, Any]]]:
    try:
        payload = json.loads(text)
        if isinstance(payload, list):
            return payload, []
        return [payload], []
    except JSONDecodeError:
        records = []
        errors = []
        for line_number, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except JSONDecodeError:
                errors.append({
                    "index": None,
                    "reason": "PARSE_ERROR",
                    "findings": [{
                        "severity": "error",
                        "code": "PARSE_ERROR",
                        "message": f"Invalid JSON on line {line_number}.",
                        "path": "",
                    }],
                })
        return records, errors


class IngestionService:
    def __init__(self, claims_service: ClaimService, backend_root: Path = BACKEND_ROOT):
        self.claims_service = claims_service
        self.backend_root = Path(backend_root)

    def _evaluate_imports(
        self,
        records: list[Any],
        rejected: list[dict[str, Any]] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
        rejected = list(rejected or [])
        accepted = []
        seen_ids = set()
        for index, claim in enumerate(records):
            if not isinstance(claim, dict):
                rejected.append({"index": index, "reason": "INVALID_RECORD", "findings": []})
                continue
            try:
                self.claims_service.validate_claim(claim)
            except ApiProblem as error:
                rejected.append({
                    "index": index,
                    "reason": "ENVELOPE_INVALID",
                    "findings": [{"severity": "error", "code": error.code, "message": error.message, "path": ""}],
                })
                continue
            if claim["claim_id"] in seen_ids:
                rejected.append({"index": index, "reason": "DUPLICATE_CLAIM_ID", "findings": []})
                continue
            seen_ids.add(claim["claim_id"])
            accepted.append(claim)

        evaluated = self.claims_service.evaluate_many(accepted) if accepted else []
        results = {row["claim_id"]: row["results"] for row in evaluated}
        return accepted, results, rejected

    def ingest_jsonl(self, text: str) -> dict[str, Any]:
        records, rejected = _decode_records(text)
        claims, evaluations, rejected = self._evaluate_imports(records, rejected)
        return {"claims": claims, "evaluations": evaluations, "rejected": rejected}

    def ingest_csv(self, files: dict[str, str]) -> dict[str, Any]:
        try:
            claims = convert_files(files)
        except (ValueError, KeyError, TypeError) as error:
            raise ApiProblem(422, "invalid_csv_pack", str(error)) from error
        claims, evaluations, rejected = self._evaluate_imports(claims)
        return {"claims": claims, "evaluations": evaluations, "rejected": rejected}

    def validate_fhir(self, text: str) -> dict[str, Any]:
        bundles, parse_errors = parse_bundles_text(text)
        def safe(bundle):
            try:
                return check_bundle(bundle)
            except Exception:
                return [{"severity": "error", "code": "FHIR_MALFORMED",
                         "message": "Bundle structure could not be processed.", "path": ""}]
        return {"results": [{"index": i, "findings": safe(b)} for i, b in enumerate(bundles)],
                "parse_errors": parse_errors}

    def ingest_fhir(self, text: str, sidecar_split: str | None = None) -> dict[str, Any]:
        bundles, parse_errors = parse_bundles_text(text)
        sidecars = {}
        if sidecar_split:
            if sidecar_split not in DATASET_SPLITS:
                raise ApiProblem(422, "invalid_sidecar", "Unknown dataset sidecar")
            sidecars = {
                claim["claim_id"]: claim
                for claim in load_claim_file(self.backend_root / "data" / sidecar_split / "claims.jsonl")
            }

        claims = []
        findings_by_claim = []
        rejected = []
        for index, bundle in enumerate(bundles):
            try:
                claim, findings = claim_and_findings(bundle, None)
                if claim["claim_id"] in sidecars:
                    claim, findings = claim_and_findings(bundle, sidecars[claim["claim_id"]])
                self.claims_service.validate_claim(claim)
            except FhirError as error:
                rejected.append({"index": index, "reason": "FHIR_INVALID", "findings": error.findings})
                continue
            except ApiProblem as error:
                rejected.append({
                    "index": index,
                    "reason": "ENVELOPE_INVALID",
                    "findings": [{"severity": "error", "code": error.code, "message": error.message, "path": ""}],
                })
                continue
            except Exception:  # malformed structure rejects this bundle, not the whole upload
                rejected.append({"index": index, "reason": "FHIR_MALFORMED", "findings": [{
                    "severity": "error", "code": "FHIR_MALFORMED",
                    "message": "Bundle structure could not be processed.", "path": ""}]})
                continue
            claims.append(claim)
            findings_by_claim.append({"claim_id": claim["claim_id"], "findings": findings})

        for error in parse_errors:
            rejected.append({
                "index": None,
                "reason": "PARSE_ERROR",
                "findings": [{
                    "severity": "error",
                    "code": "PARSE_ERROR",
                    "message": f"line {error['line']}: {error['message']}",
                    "path": "",
                }],
            })

        claims, evaluations, rejected = self._evaluate_imports(claims, rejected)
        accepted_ids = set(evaluations)
        return {
            "claims": claims,
            "evaluations": evaluations,
            "fhir_findings": [item for item in findings_by_claim if item["claim_id"] in accepted_ids],
            "rejected": rejected,
        }

    def export_fhir(self, claim: dict[str, Any]) -> dict[str, Any]:
        self.claims_service.validate_claim(claim)
        return claim_to_bundle(claim)


class ExplanationService:
    def __init__(self, rules_config: dict[str, Any], claims_service: ClaimService, audit_logger: AuditLogger):
        self.rules = {rule["rule_id"]: rule for rule in rules_config["rules"]}
        self.claims_service = claims_service
        self.audit_logger = audit_logger

    def explain(self, claim: dict[str, Any], rule_id: str, provider_name: str) -> dict[str, Any]:
        self.claims_service.validate_claim(claim)
        rule = self.rules.get(rule_id)
        if rule is None:
            raise ApiProblem(404, "rule_not_found", "Unknown rule ID")
        finding = next(result for result in baseline(claim, self.claims_service.rules_config) if result["rule_id"] == rule_id)

        fallback_used = False
        if provider_name == "mock":
            provider = MockExplanationProvider()
            provider_label = "mock"
        elif os.environ.get("OPENAI_API_KEY"):
            model_name = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
            base_url = os.environ.get("OPENAI_BASE_URL") or None
            provider = OpenAIExplanationProvider(
                OpenAI(base_url=base_url), model_name=model_name
            )
            provider_label = model_name
        else:
            provider = MockExplanationProvider()
            provider_label = "mock"
            fallback_used = True

        source = "skipped" if finding["status"] not in {"FAIL", "UNABLE_TO_ASSESS"} else "llm"
        try:
            explanation = validate_explanation(provider.explain(finding, rule), finding)
        except Exception:
            explanation = deterministic_fallback(finding)
            fallback_used = True
            source = "fallback"

        finding_hash = hashlib.sha256(
            json.dumps(finding, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        quality = assess(finding, explanation, source)
        try:
            self.audit_logger.log_ai_decision(
                claim["claim_id"], rule_id, provider_label, finding_hash, fallback_used, assessment=quality
            )
        except AuditWriteError as error:
            raise ApiProblem(503, "audit_unavailable", "Could not safely record the explanation") from error
        return {**explanation, "provider": provider_label, "fallback_used": fallback_used, "assessment": quality}


class AuditService:
    def __init__(self, audit_path: Path, audit_logger: AuditLogger | None = None):
        self.store = AuditStore(audit_path)
        self.logger = audit_logger or AuditLogger(self.store)

    def verify(self) -> dict[str, Any]:
        try:
            valid, first_broken_index = verify_chain(self.store.all_entries())
        except (OSError, ValueError, TypeError, KeyError) as error:
            raise ApiProblem(503, "audit_integrity_error", "Audit history could not be read") from error
        return {"valid": valid, "first_broken_index": first_broken_index}

    def record_review(self, decision: dict[str, Any]) -> dict[str, Any]:
        try:
            entry = self.logger.log_human_decision(decision)
        except AuditWriteError as error:
            raise ApiProblem(503, "audit_unavailable", "Could not safely record the review decision") from error
        return {"audit_index": entry.index, "entry_hash": entry.entry_hash}

    def recent_events(self, limit: int) -> dict[str, Any]:
        try:
            entries = self.store.all_entries()
        except (OSError, ValueError, TypeError, KeyError) as error:
            raise ApiProblem(503, "audit_integrity_error", "Audit history could not be read") from error
        valid, broken_index = verify_chain(entries)
        if not valid:
            raise ApiProblem(503, "audit_integrity_error", f"Audit history is invalid at index {broken_index}")

        allowed_fields = {
            "rule_execution": ("evaluation_id", "rule_id", "rule_version", "status", "severity", "requires_human_review", "confidence", "confidence_kind", "method"),
            "ai_decision": ("rule_id", "provider", "fallback_used"),
            "human_decision": ("rule_id", "action", "original_status", "decision_timestamp"),
        }
        recent = []
        for entry in reversed(entries[-limit:]):
            fields = allowed_fields.get(entry.event_type, ())
            payload = {key: entry.payload[key] for key in fields if key in entry.payload}
            if entry.event_type == "human_decision":
                payload["reason_recorded"] = bool(entry.payload.get("reason_hash"))
            recent.append({
                "index": entry.index,
                "timestamp": entry.timestamp,
                "event_type": entry.event_type,
                "claim_id": entry.claim_id,
                "actor": entry.actor,
                "payload": payload,
                "entry_hash": entry.entry_hash,  
            })
        return {"total_count": len(entries), "events": recent}