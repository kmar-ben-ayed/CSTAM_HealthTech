# ClaimGuard AI Backend

The backend owns deterministic claim evaluation, JSON/CSV/FHIR normalization, grounded explanations, and the persistent tamper-evident audit log. The HTTP boundary is a FastAPI application; domain logic remains in `src/rule_engine`, `src/normalisation`, `src/AI_agent`, and `src/audit`.

## Setup and tests

From the repository root in PowerShell:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m unittest discover -s backend\tests -t backend -v
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
| `POST` | `/api/v1/reviews/opened` | Record a claim review visit in the audit chain |
| `POST` | `/api/v1/runs` | Evaluate a dataset and persist a run record |
| `GET` | `/api/v1/runs` | List persisted dataset runs |
| `GET` | `/api/v1/runs/{run_id}` | Return one persisted dataset run |
| `GET` | `/api/v1/audit/events` | List minimized audit events with offset pagination |
| `GET` | `/api/v1/audit/export` | Export the complete hash-linked audit chain |
| `GET` | `/api/v1/audit/verify` | Verify the stored audit hash chain |

POST endpoints accept JSON request objects documented in `/docs`. Claim payloads are checked against `schemas/claim.schema.json` and the engine's transport validation before evaluation. Invalid inputs return `422`; request bodies larger than 5 MB return `413`.

## AI provider configuration

Explanations use the deterministic mock provider by default. To explicitly request the `openai` provider, set `OPENAI_API_KEY` in the process environment; `OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`. Keys are not stored in the repository. Provider errors fall back to the deterministic explanation and are marked in the response (`fallback_used`, `assessment.explanation_source`).

The client is OpenAI-SDK-compatible, so any OpenAI-compatible endpoint works by also setting `OPENAI_BASE_URL`, including [NVIDIA NIM](https://build.nvidia.com)'s free tier (`OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1`, `OPENAI_MODEL=meta/llama-3.2-11b-vision-instruct`, an `nvapi-...` key as `OPENAI_API_KEY`). See the root README's "Using a free NVIDIA NIM model instead of OpenAI" section for details and caveats.

## Confidence and escalation

The rule engine remains strictly deterministic: rule verdicts such as `FAIL`, `PASS`, or `UNABLE_TO_ASSESS` are computed from explicit evidence and carry `confidence: null` with `confidence_kind: "not_probabilistic"`. This is intentional and required by the challenge; a percentage on a deterministic rule would be invented rather than measured.

The explanation endpoint adds a separate `assessment` object for reviewer-facing triage. It measures three things without changing the verdict itself:

- `evidence_completeness`: for `UNABLE_TO_ASSESS` findings only, the share of known evidence values over the total evidence items.
- `explanation_grounding`: the overlap between cited evidence paths and the evidence paths actually present in the finding.
- `explanation_source`: whether the explanation came from the model (`llm`), was skipped for a non-actionable result (`skipped`), or used the deterministic fallback after a model failure (`fallback`).

`review_priority` and `escalate` are used to sort the human-review queue, not to override the deterministic rule verdict. `escalate` is triggered for high-severity failures, low evidence completeness, fallback explanations, weak grounding, and `NOT_IMPLEMENTED` status. The thresholds of `0.5` for completeness and grounding are operational tuning parameters for the validation set, not calibrated probabilities.

## Audit and local-demo boundaries

Audit events are appended to `backend/outputs/audit_log.jsonl` by default. Override the path with `CLAIMGUARD_AUDIT_LOG`. Rule audit entries contain minimized summaries, AI events contain a finding hash, and human-review reasons are hashed rather than stored as plain text. Dataset runs are appended to `backend/outputs/run_log.jsonl`; override the path with `CLAIMGUARD_RUNS_LOG`. The stress split contains 52 source claims but only 50 expected-result labels, so unlabeled claims are evaluated while excluded from benchmark metrics. The API rejects oversized requests and only allows the local frontend origins by default; configure `CLAIMGUARD_CORS_ORIGINS` as a comma-separated list if needed.

This is a local educational demo using synthetic claims. The hash chain is tamper-evident, not immutable storage or a substitute for authentication, authorization, external backups, or a production security review. Do not use real patient data or expose this service publicly.

