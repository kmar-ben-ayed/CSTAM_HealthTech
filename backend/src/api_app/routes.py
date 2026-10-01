import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from api_app.schemas import (
    ClaimRequest,
    ClaimsBatchRequest,
    DatasetRunRequest,
    CsvIngestRequest,
    ExplanationRequest,
    FhirIngestRequest,
    FhirValidateRequest,
    ReviewDecisionRequest,
    ReviewOpenedRequest,
    TextIngestRequest,
)
from api_app.services import DATASET_SPLITS, load_claim_file


v1_router = APIRouter(prefix="/api/v1")
legacy_router = APIRouter()


def _service(request: Request, name: str) -> Any:
    return getattr(request.app.state, name)


@v1_router.get("/health", tags=["system"])
def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "service": "claimguard-api", "version": request.app.version}


@v1_router.get("/datasets/{split}", tags=["datasets"])
def get_dataset(split: str, request: Request, limit: int | None = Query(default=None, ge=1, le=500)):
    return _service(request, "dataset_service").get_dataset(split, limit)


@v1_router.get("/claims", tags=["claims"])
def get_ingested_claims(request: Request, limit: int | None = Query(default=None, ge=1, le=500)):
    return _service(request, "ingestion_service").store.latest(limit)


@v1_router.get("/claims/{claim_id}", tags=["claims"])
def get_ingested_claim(claim_id: str, request: Request):
    return _service(request, "ingestion_service").store.claim(claim_id)


@v1_router.post("/claims/evaluate", tags=["claims"])
def evaluate_claim(payload: ClaimRequest, request: Request):
    return _service(request, "claim_service").evaluate(payload.claim)


@v1_router.post("/claims/evaluate/batch", tags=["claims"])
def evaluate_claims(payload: ClaimsBatchRequest, request: Request):
    return {"evaluations": _service(request, "claim_service").evaluate_many(payload.claims)}


@v1_router.post("/runs", status_code=201, tags=["runs"])
def create_dataset_run(payload: DatasetRunRequest, request: Request):
    return _service(request, "run_service").create_dataset_run(payload.split)


@v1_router.get("/runs", tags=["runs"])
def list_runs(request: Request, limit: int = Query(default=100, ge=1, le=500)):
    return _service(request, "run_service").list_runs(limit)


@v1_router.get("/runs/{run_id}", tags=["runs"])
def get_run(run_id: str, request: Request):
    return _service(request, "run_service").get_run(run_id)


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
    actor = request.headers.get("X-Actor")
    if actor:
        decision["actor"] = actor
    return _service(request, "audit_service").record_review(decision)


@v1_router.post("/reviews/opened", status_code=201, tags=["reviews"])
def record_review_opened(payload: ReviewOpenedRequest, request: Request):
    visit = payload.model_dump(mode="python")
    actor = request.headers.get("X-Actor")
    if actor:
        visit["actor"] = actor
    return _service(request, "audit_service").record_review_open(visit)


@v1_router.get("/audit/events", tags=["audit"])
def audit_events(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    return _service(request, "audit_service").recent_events(limit, offset)


@v1_router.get("/audit/export", tags=["audit"])
def export_audit(request: Request):
    return _service(request, "audit_service").export_chain()


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


@legacy_router.get("/api/health", include_in_schema=False)
def legacy_health():
    return {"status": "ok", "engine": "backend.rule_engine"}


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