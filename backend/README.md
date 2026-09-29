# ClaimGuard AI Backend

The backend owns deterministic claim evaluation, JSON/CSV/FHIR normalization, grounded explanations, and the persistent tamper-evident audit log. The HTTP boundary is a FastAPI application; domain logic remains in `src/rule_engine`, `src/normalisation`, `src/AI_agent`, and `src/audit`.

## Setup and tests

From the repository root in PowerShell:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m unittest discover -s backend\tests -v
```

Python 3.10 or newer is required.

## Run the API

From the repository root:

```powershell
backend\.venv\Scripts\python.exe backend\src\api.py --host 127.0.0.1 --port 8000
```

The service listens on `http://127.0.0.1:8000`. Interactive OpenAPI documentation is at `http://127.0.0.1:8000/docs`; the machine-readable contract is at `/openapi.json`.

The versioned API is rooted at `/api/v1`. During frontend migration, the previous `/api/datasets/*` and `/api/fhir/*` routes remain available as compatibility aliases.

## API routes

For Swagger-ready request bodies, field alternatives, limits, and endpoint-by-endpoint testing steps, see [API_TESTING.md](API_TESTING.md).

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Health/status check |
| `GET` | `/api/v1/datasets/{split}` | Return development, validation, or stress data; optional `limit` |
| `POST` | `/api/v1/claims/evaluate` | Validate and evaluate one normalized claim |
| `POST` | `/api/v1/claims/evaluate/batch` | Evaluate up to 100 normalized claims |
| `POST` | `/api/v1/ingest/jsonl` | Parse JSON, JSON arrays, or line-delimited JSON and evaluate valid claims |
| `POST` | `/api/v1/ingest/csv` | Convert the five related CSV files and evaluate the resulting claims |
| `POST` | `/api/v1/ingest/fhir` | Import FHIR bundles, optionally restoring a known dataset sidecar |
| `POST` | `/api/v1/fhir/validate` | Inspect FHIR bundle structure and report findings |
| `POST` | `/api/v1/fhir/export` | Export a normalized claim as a FHIR bundle |
| `POST` | `/api/v1/explanations` | Recompute a finding and return a grounded explanation |
| `POST` | `/api/v1/reviews` | Record a reviewer decision in the audit chain |
| `GET` | `/api/v1/audit/events` | List recent minimized audit events |
| `GET` | `/api/v1/audit/verify` | Verify the stored audit hash chain |

POST endpoints accept JSON request objects documented in `/docs`. Claim payloads are checked against `schemas/claim.schema.json` and the engine's transport validation before evaluation. Invalid inputs return `422`; request bodies larger than 5 MB return `413`.

## AI provider configuration

Explanations use the deterministic mock provider by default. To explicitly request the OpenAI provider, set `OPENAI_API_KEY` in the process environment; `OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`. Keys are not stored in the repository. Provider errors fall back to the deterministic explanation and are marked in the response.

## Audit and local-demo boundaries

Audit events are appended to `backend/outputs/audit_log.jsonl` by default. Override the path with `CLAIMGUARD_AUDIT_LOG`. Rule audit entries contain minimized summaries, AI events contain a finding hash, and human-review reasons are hashed rather than stored as plain text. The API rejects oversized requests and only allows the local frontend origins by default; configure `CLAIMGUARD_CORS_ORIGINS` as a comma-separated list if needed.

This is a local educational demo using synthetic claims. The hash chain is tamper-evident, not immutable storage or a substitute for authentication, authorization, external backups, or a production security review. Do not use real patient data or expose this service publicly.

