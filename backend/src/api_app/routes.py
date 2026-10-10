import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api_app.schemas import (
    ClaimRequest,
    ClaimsBatchRequest,
    CsvIngestRequest,
    ExplanationRequest,
    FhirIngestRequest,
    FhirValidateRequest,
    ReviewDecisionRequest,
    TextIngestRequest,
)
from api_app.security import require_admin
from api_app.services import DATASET_SPLITS, load_claim_file


v1_router = APIRouter(prefix="/api/v1")
legacy_router = APIRouter()

ALLOWED_CONFIG_FILES = {"rules.json", "policies.json", "diagnoses.json", "providers.json", "services.json"}

# rules.json can be read here, but rules are created, changed and switched off
# through /api/v1/rules, which drafts and checks an implementation first.
READ_ONLY_CONFIG_FILES = {"rules.json"}

MAX_ACTOR_LENGTH = 128


def _service(request: Request, name: str) -> Any:
    return getattr(request.app.state, name)


def _rules_dir(request: Request) -> Path:
    """The config documents live in <backend root>/rules of this app instance."""
    return request.app.state.backend_root / "rules"


def _load_rules_data(rules_dir: Path, filename: str, overrides: dict[str, Any] | None = None):
    """Load a config file from disk, return parsed data (list or dict)."""
    if overrides and filename in overrides:
        return overrides[filename]
    path = rules_dir / filename
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_config(
    rules_dir: Path,
    filename: str,
    data: Any,
    overrides: dict[str, Any] | None = None,
) -> list[str]:
    """
    Cross-file integrity checks.
    Returns a list of human-readable error strings (empty = all good).
    """
    errors: list[str] = []

    # ── Helpers to load reference sets ───────────────────────────────────────
    def svc_codes() -> set[str]:
        raw = _load_rules_data(rules_dir, "services.json", overrides) or {}
        return set(raw.keys())

    def provider_ids() -> set[str]:
        raw = _load_rules_data(rules_dir, "providers.json", overrides) or []
        return {p["provider_id"] for p in raw if isinstance(p, dict) and "provider_id" in p}

    def diagnosis_codes() -> set[str]:
        raw = _load_rules_data(rules_dir, "diagnoses.json", overrides) or []
        return {d["code"] for d in raw if isinstance(d, dict) and "code" in d}

    def policy_ids() -> set[str]:
        raw = _load_rules_data(rules_dir, "policies.json", overrides) or {}
        return set(raw.keys())

    # ── policies.json ─────────────────────────────────────────────────────────
    if filename == "policies.json":
        if not isinstance(data, dict):
            errors.append("policies.json must be a JSON object keyed by policy_id.")
            return errors
        known_svcs = svc_codes()
        known_provs = provider_ids()
        for pid, policy in data.items():
            if not isinstance(policy, dict):
                errors.append(f"Policy '{pid}': must be an object.")
                continue
            if policy.get("policy_id") != pid:
                errors.append(f"Policy '{pid}': policy_id must match the object key.")
            for field in ("policy_id", "version", "payer_id", "currency"):
                if not isinstance(policy.get(field), str) or not policy[field].strip():
                    errors.append(f"Policy '{pid}': {field} is required.")
            for field in ("allowed_providers", "auth_required_services"):
                if not isinstance(policy.get(field), list) or not all(isinstance(value, str) and value.strip() for value in policy.get(field, [])):
                    errors.append(f"Policy '{pid}': {field} must be a list of non-empty strings.")
            for field in ("required_documents", "max_unit_price", "max_quantity_per_line"):
                if not isinstance(policy.get(field), dict):
                    errors.append(f"Policy '{pid}': {field} must be an object.")
            if isinstance(policy.get("required_documents"), dict):
                for svc, doc in policy["required_documents"].items():
                    if not isinstance(doc, str) or not doc.strip():
                        errors.append(f"Policy '{pid}': required_documents['{svc}'] must be a non-empty string.")
            for field in ("max_unit_price", "max_quantity_per_line"):
                if isinstance(policy.get(field), dict):
                    for svc, value in policy[field].items():
                        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
                            errors.append(f"Policy '{pid}': {field}['{svc}'] must be a positive number.")
            # Allowed providers must exist
            for prov in policy.get("allowed_providers", []):
                if prov and prov not in known_provs:
                    errors.append(f"Policy '{pid}': provider '{prov}' not found in providers.json.")
            # Auth-required services must exist
            for svc in policy.get("auth_required_services", []):
                if svc and svc not in known_svcs:
                    errors.append(f"Policy '{pid}': auth_required_service '{svc}' not found in services.json.")
            # required_documents keys must be valid service codes
            for svc in policy.get("required_documents", {}).keys():
                if svc and svc not in known_svcs:
                    errors.append(f"Policy '{pid}': required_documents key '{svc}' not found in services.json.")
            # max_unit_price keys must be valid service codes
            for svc in policy.get("max_unit_price", {}).keys():
                if svc and svc not in known_svcs:
                    errors.append(f"Policy '{pid}': max_unit_price key '{svc}' not found in services.json.")
            # max_quantity_per_line keys must be valid service codes
            for svc in policy.get("max_quantity_per_line", {}).keys():
                if svc and svc not in known_svcs:
                    errors.append(f"Policy '{pid}': max_quantity_per_line key '{svc}' not found in services.json.")
            # Currency must be non-empty
            # Submission window must be positive
            if not isinstance(policy.get("submission_window_days"), (int, float)) or policy.get("submission_window_days", 0) <= 0:
                errors.append(f"Policy '{pid}': submission_window_days must be a positive number.")

    # ── diagnoses.json ────────────────────────────────────────────────────────
    elif filename == "diagnoses.json":
        if not isinstance(data, list):
            errors.append("diagnoses.json must be a JSON array.")
            return errors
        seen_codes: set[str] = set()
        for i, dx in enumerate(data):
            if not isinstance(dx, dict):
                errors.append(f"Diagnosis #{i}: must be an object.")
                continue
            code = dx.get("code", "")
            if not code:
                errors.append(f"Diagnosis #{i}: missing code.")
            elif code in seen_codes:
                errors.append(f"Diagnosis #{i}: duplicate code '{code}'.")
            else:
                seen_codes.add(code)
            if not dx.get("display", "").strip():
                errors.append(f"Diagnosis '{code}': display description is required.")

    # ── providers.json ────────────────────────────────────────────────────────
    elif filename == "providers.json":
        if not isinstance(data, list):
            errors.append("providers.json must be a JSON array.")
            return errors
        seen_pids: set[str] = set()
        for i, prov in enumerate(data):
            if not isinstance(prov, dict):
                errors.append(f"Provider #{i}: must be an object.")
                continue
            pid = prov.get("provider_id", "")
            if not pid:
                errors.append(f"Provider #{i}: missing provider_id.")
            elif pid in seen_pids:
                errors.append(f"Provider #{i}: duplicate provider_id '{pid}'.")
            else:
                seen_pids.add(pid)
            if not prov.get("display", "").strip():
                errors.append(f"Provider '{pid}': display name is required.")

    # ── services.json ─────────────────────────────────────────────────────────
    elif filename == "services.json":
        if not isinstance(data, dict):
            errors.append("services.json must be a JSON object keyed by service code.")
            return errors
        for code, svc in data.items():
            if not isinstance(svc, dict):
                errors.append(f"Service '{code}': must be an object.")
                continue
            if not svc.get("description", "").strip():
                errors.append(f"Service '{code}': description is required.")
            bp = svc.get("base_price")
            mp = svc.get("max_price")
            mq = svc.get("max_quantity")
            if not isinstance(bp, (int, float)) or bp < 0:
                errors.append(f"Service '{code}': base_price must be a non-negative number.")
            if not isinstance(mp, (int, float)) or mp < 0:
                errors.append(f"Service '{code}': max_price must be a non-negative number.")
            if isinstance(bp, (int, float)) and isinstance(mp, (int, float)) and mp < bp:
                errors.append(f"Service '{code}': max_price ({mp}) must be >= base_price ({bp}).")
            if not isinstance(mq, int) or mq < 1:
                errors.append(f"Service '{code}': max_quantity must be a positive integer.")

    return errors


@v1_router.get("/config/{filename}", tags=["config"])
def get_config(filename: str, request: Request):
    if filename not in ALLOWED_CONFIG_FILES:
        raise HTTPException(status_code=400, detail="Invalid config file")
    file_path = _rules_dir(request) / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return json.loads(file_path.read_text(encoding="utf-8"))

@v1_router.post("/config/{filename}", tags=["config"], dependencies=[Depends(require_admin)])
async def save_config(filename: str, request: Request):
    if filename not in ALLOWED_CONFIG_FILES:
        raise HTTPException(status_code=400, detail="Invalid config file")
    if filename in READ_ONLY_CONFIG_FILES:
        raise HTTPException(
            status_code=409,
            detail={"errors": ["Rules are managed through /api/v1/rules, which checks an implementation before it runs."]},
        )
    data = await request.json()
    rules_dir = _rules_dir(request)

    errors = _validate_config(rules_dir, filename, data, {filename: data})
    # Provider and service edits can invalidate references from existing policies.
    if filename in {"providers.json", "services.json"}:
        policies = _load_rules_data(rules_dir, "policies.json")
        errors.extend(_validate_config(rules_dir, "policies.json", policies, {filename: data}))
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    file_path = rules_dir / filename
    temporary_path = file_path.with_suffix(f"{file_path.suffix}.tmp")
    temporary_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary_path.replace(file_path)
    request.app.state.reload_rules()
    return {"status": "ok", "message": f"{filename} saved successfully."}


@v1_router.get("/health", tags=["system"])
def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "service": "claimguard-api", "version": request.app.version}


@v1_router.get("/datasets/{split}", tags=["datasets"])
def get_dataset(split: str, request: Request, limit: int | None = Query(default=None, ge=1, le=500)):
    return _service(request, "dataset_service").get_dataset(split, limit)


@v1_router.get("/claims", tags=["claims"])
def get_ingested_claims(request: Request, limit: int | None = Query(default=None, ge=1)):
    return _service(request, "ingestion_service").store.latest(limit)


@v1_router.get("/claims/{claim_id}", tags=["claims"])
def get_ingested_claim(claim_id: str, request: Request):
    return _service(request, "ingestion_service").store.claim(claim_id)


@v1_router.get("/runs", tags=["ingestion"])
def get_ingestion_runs(request: Request):
    return {"runs": _service(request, "ingestion_service").store.runs()}


@v1_router.post("/claims/evaluate", tags=["claims"])
def evaluate_claim(payload: ClaimRequest, request: Request):
    return _service(request, "claim_service").evaluate(payload.claim)


@v1_router.post("/claims/evaluate/batch", tags=["claims"])
def evaluate_claims(payload: ClaimsBatchRequest, request: Request):
    return {"evaluations": _service(request, "claim_service").evaluate_many(payload.claims)}


@v1_router.post("/ingest/jsonl", tags=["ingestion"])
def ingest_jsonl(payload: TextIngestRequest, request: Request):
    return _service(request, "ingestion_service").ingest_jsonl(payload.text)


@v1_router.post("/ingest/csv", tags=["ingestion"])
def ingest_csv(payload: CsvIngestRequest, request: Request):
    return _service(request, "ingestion_service").ingest_csv(payload.files)


@v1_router.post("/ingest/fhir", tags=["ingestion"])
def ingest_fhir(payload: FhirIngestRequest, request: Request):
    return _service(request, "ingestion_service").ingest_fhir(payload.text, payload.sidecar_split)


@v1_router.post("/fhir/validate", tags=["fhir"])
def validate_fhir(payload: FhirValidateRequest, request: Request):
    text = payload.text if payload.text is not None else json.dumps(payload.bundle)
    return _service(request, "ingestion_service").validate_fhir(text)


@v1_router.post("/fhir/export", tags=["fhir"])
def export_fhir(payload: ClaimRequest, request: Request):
    return _service(request, "ingestion_service").export_fhir(payload.claim)


@v1_router.post("/explanations", tags=["explanations"])
def explain(payload: ExplanationRequest, request: Request):
    return _service(request, "explanation_service").explain(
        payload.claim, payload.rule_id, payload.provider
    )


@v1_router.post("/reviews", status_code=201, tags=["reviews"])
def record_review(payload: ReviewDecisionRequest, request: Request):
    decision = payload.model_dump(mode="json")

    # The X-Actor header may *name* the actor, but it must not be able to write
    # an unvalidated identity into the audit trail. Applying it after schema
    # validation meant a blank or 300-character header silently overrode an
    # already-validated body field.
    header_actor = request.headers.get("X-Actor")
    if header_actor is not None:
        cleaned = header_actor.strip()
        if not cleaned:
            raise HTTPException(
                status_code=422,
                detail={"errors": ["X-Actor header must not be blank."]},
            )
        if len(cleaned) > MAX_ACTOR_LENGTH:
            raise HTTPException(
                status_code=422,
                detail={"errors": [f"X-Actor header must be at most {MAX_ACTOR_LENGTH} characters."]},
            )
        decision["actor"] = cleaned

    return _service(request, "audit_service").record_review(decision)


@v1_router.get("/audit/events", tags=["audit"])
def audit_events(request: Request, limit: int = Query(default=100, ge=1, le=500)):
    return _service(request, "audit_service").recent_events(limit)


@v1_router.get("/audit/verify", tags=["audit"])
def verify_audit(request: Request):
    return _service(request, "audit_service").verify()


@legacy_router.get("/", include_in_schema=False)
@legacy_router.get("/api", include_in_schema=False)
def legacy_index() -> dict[str, Any]:
    return {
        "name": "ClaimGuard AI backend API",
        "status": "ok",
        "health": "/api/health",
        "datasets": [
            "/api/datasets/development",
            "/api/datasets/validation",
            "/api/datasets/stress",
        ],
    }


@legacy_router.get("/health", include_in_schema=False)
@legacy_router.get("/api/health", include_in_schema=False)
def legacy_health():
    return {"status": "ok", "engine": "backend.rule_engine"}


@legacy_router.get("/v1/models", include_in_schema=False)
def legacy_models():
    return {"object": "list", "data": []}


@legacy_router.get("/api/datasets/{split}", include_in_schema=False)
def legacy_dataset(split: str, request: Request, limit: int | None = Query(default=None, ge=1, le=500)):
    return _service(request, "dataset_service").get_dataset(split, limit)


@legacy_router.get("/api/fhir/export/{split}/{claim_id}", include_in_schema=False)
def legacy_export_fhir(split: str, claim_id: str, request: Request):
    if split not in DATASET_SPLITS:
        raise HTTPException(status_code=404, detail="Claim not found")
    backend_root = _service(request, "ingestion_service").backend_root
    claims = load_claim_file(backend_root / "data" / split / "claims.jsonl")
    claim = next((row for row in claims if row.get("claim_id") == claim_id), None)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    return _service(request, "ingestion_service").export_fhir(claim)


async def _legacy_text_body(request: Request) -> str:
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Request body is required")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=400, detail="Request body must be UTF-8 text") from error


@legacy_router.post("/api/fhir/validate", include_in_schema=False)
async def legacy_validate_fhir(request: Request):
    return _service(request, "ingestion_service").validate_fhir(await _legacy_text_body(request))


@legacy_router.post("/api/fhir/ingest", include_in_schema=False)
async def legacy_ingest_fhir(request: Request, sidecar: str | None = None):
    return _service(request, "ingestion_service").ingest_fhir(await _legacy_text_body(request), sidecar)


@legacy_router.post("/api/fhir/export", include_in_schema=False)
async def legacy_export_fhir_post(request: Request):
    try:
        claim = json.loads(await _legacy_text_body(request))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Request body must contain valid JSON") from error
    return _service(request, "ingestion_service").export_fhir(claim)