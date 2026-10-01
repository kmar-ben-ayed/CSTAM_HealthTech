# ClaimGuard AI

ClaimGuard AI is a local, synthetic-data healthcare claims validation and review workspace. It combines deterministic claim rules, evidence-linked findings, grounded AI explanations, structured human decisions, and a tamper-evident audit trail.

The system is designed as an explainable decision-support prototype: the rule engine is authoritative, the AI layer explains deterministic findings, and reviewers remain responsible for decisions. It is not a production payer platform or a substitute for clinical, legal, security, privacy, or compliance review.

## What the project does

ClaimGuard accepts normalized claims and common healthcare exchange formats, evaluates them against a configured rule catalog, and presents the result for human review.

The current backend supports:

- Deterministic evaluation of 15 claim rules.
- JSON, JSONL, CSV-pack, and FHIR Bundle ingestion.
- FHIR validation and normalized-claim export.
- Grounded explanations through a deterministic mock provider or OpenAI.
- Structured review decisions with hashed review reasons.
- A persistent, hash-chained audit log with integrity verification.
- Development, validation, and stress datasets containing synthetic claims.

The current frontend is a React/Vite workspace. These areas are connected to backend APIs:

- Claims list and deterministic evaluations.
- Claim Review, including rule findings, evidence paths, AI explanations, and review decisions.
- Data ingestion for JSON, CSV, and FHIR flows.
- Audit Trail loading and audit-chain verification.

The following screens are currently product-surface prototypes and still contain static sample data rather than complete backend read models:

- Dashboard metrics and activity feed.
- Review Queue assignments and workload state.
- Runs and performance history.
- Analytics trends and aggregates.
- Rules and policy catalog metadata.

This distinction is intentional. The repository demonstrates the core validation and review vertical slice while the broader operations workspace is being integrated.

## Architecture

```text
Browser
  React 19 + Vite + Tailwind CSS
  frontend/src/api/client.ts
        |
        | HTTP/JSON, default API origin: http://127.0.0.1:8000
        v
FastAPI application
  backend/src/api_app/
        |
        +-- Claim service -> schema and transport validation -> rule engine
        +-- Ingestion service -> JSON/CSV/FHIR normalization -> evaluation
        +-- Explanation service -> grounded mock/OpenAI explanation
        +-- Audit service -> minimized, hash-chained JSONL events
        |
        +-- backend/rules/     Rule and policy configuration
        +-- backend/schemas/    Claim, result, and review contracts
        +-- backend/data/       Synthetic development/validation/stress data
        +-- backend/outputs/    Local predictions and audit output
```

### Backend ownership

- `backend/src/api_app/` owns the FastAPI application, routes, request models, and service orchestration.
- `backend/src/rule_engine/` owns deterministic rule evaluation and transport checks.
- `backend/src/normalisation/` owns CSV and FHIR conversion, validation findings, and round-trip behavior.
- `backend/src/AI_agent/` owns explanation-provider adapters and grounded explanation validation.
- `backend/src/audit/` owns audit models, persistence, hash computation, and chain verification.
- `backend/rules/`, `backend/schemas/`, and `backend/data/` provide configuration, contracts, and synthetic fixtures.

### Frontend ownership

- `frontend/src/App.tsx` owns routing, workspace layout, authentication-demo state, and navigation.
- `frontend/src/api/` owns typed HTTP clients and backend response mapping.
- `frontend/src/pages/` contains the landing, claims, review, ingestion, audit, and prototype operations screens.
- `frontend/src/components/` contains reusable workspace components such as the Sentinel status indicator and search modal.
- `frontend/src/hooks/` contains shared UI hooks such as theme management.

## Prerequisites

- Python 3.10 or newer.
- Node.js 22. The frontend toolchain is pinned for Node 22 in `frontend/.mise.toml`.
- Corepack, included with current Node.js distributions.
- PowerShell on Windows, or an equivalent shell on macOS/Linux.

The frontend declares pnpm as its package manager and commits `frontend/pnpm-lock.yaml`. Use pnpm to install frontend dependencies. After installation, both `corepack pnpm dev` and `npm run dev` are supported ways to execute the same Vite development script. Using npm to run a script does not change the package manager used to install dependencies.

## Quick start on Windows

Run the commands below from the repository root.

### 1. Install backend dependencies

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

If PowerShell blocks virtual-environment activation, either allow it for the current session with `Set-ExecutionPolicy -Scope Process Bypass` or use the interpreter directly as shown below.

### 2. Install frontend dependencies

```powershell
corepack enable
Set-Location frontend
corepack pnpm install --frozen-lockfile
Set-Location ..
```

If `--frozen-lockfile` reports that the lockfile and package manifest differ, do not silently regenerate the lockfile in a demo checkout. First check whether the repository changed, then use `corepack pnpm install` only when intentionally updating dependencies.

### 3. Start the backend

Open a terminal at the repository root and run:

```powershell
backend\.venv\Scripts\python.exe backend\src\api.py --host 127.0.0.1 --port 8000
```

Keep this terminal running. Verify the service at:

- Health: http://127.0.0.1:8000/api/v1/health
- Swagger UI: http://127.0.0.1:8000/docs
- OpenAPI contract: http://127.0.0.1:8000/openapi.json

### 4. Start the frontend

Open a second terminal and run:

```powershell
Set-Location frontend
corepack pnpm dev
```

Vite uses port `8443` by default and prints the actual URL in the terminal. Open the printed local URL, normally http://localhost:8443.

The frontend defaults to `http://127.0.0.1:8000` for the backend API, so no extra frontend configuration is needed when using the backend command above.

### Start with npm instead

If you normally use npm, the equivalent command is:

```powershell
Set-Location frontend
npm run dev
```

This works because `dev` is a package script defined in `frontend/package.json`. Keep using `corepack pnpm install --frozen-lockfile` for dependency installation so the committed pnpm lockfile remains the source of truth. Do not mix `npm install` and `pnpm install` in the same checkout unless you intentionally migrate the lockfile and dependency layout.

## Alternate ports and API configuration

The backend and frontend use strict, explicit ports in local development. If a port is already in use, choose another port and configure the other service accordingly.

For example, to run the backend on port `8001`:

```powershell
backend\.venv\Scripts\python.exe backend\src\api.py --host 127.0.0.1 --port 8001
```

Start the frontend with the matching API origin:

```powershell
Set-Location frontend
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8001'
corepack pnpm dev
```

To change the frontend port, set `PORT` before starting Vite:

```powershell
$env:PORT = '8444'
corepack pnpm dev
```

The backend allows local frontend origins by default, including ports `5173` and `8443`. For another frontend origin, set `CLAIMGUARD_CORS_ORIGINS` to a comma-separated list before starting the backend.

## Testing and verification

### Backend tests

From the repository root:

```powershell
backend\.venv\Scripts\python.exe -m unittest discover -s backend\tests -t backend -v
```

The backend tests cover API validation, deterministic evaluations, ingestion, FHIR round trips, explanation auditing, review decisions, audit persistence, tamper detection, and request-size limits.

### Frontend checks

From `frontend`:

```powershell
corepack pnpm exec tsc --noEmit
corepack pnpm build
```

The frontend package also provides:

```powershell
corepack pnpm format
corepack pnpm preview
```

### Manual smoke test

1. Start the backend and confirm `/api/v1/health` returns `status: "ok"`.
2. Start the frontend and open the Claims screen.
3. Confirm synthetic claims and rule results load from the development dataset.
4. Open a claim with a finding and inspect its evidence paths.
5. Request an explanation with the mock provider for a no-key local test.
6. Submit a review decision.
7. Open Audit Trail and verify that the rule execution, AI decision, and human decision are present.
8. Use Verify chain and confirm the audit chain is valid.
9. Test ingestion through the Ingest Data screen or the examples in [backend/API_TESTING.md](backend/API_TESTING.md).

## Backend API

The versioned API is rooted at `/api/v1`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Service health and version |
| `GET` | `/api/v1/datasets/{split}` | Synthetic dataset and evaluations |
| `POST` | `/api/v1/claims/evaluate` | Evaluate one normalized claim |
| `POST` | `/api/v1/claims/evaluate/batch` | Evaluate up to 100 claims |
| `POST` | `/api/v1/ingest/jsonl` | Import JSON, arrays, or JSONL |
| `POST` | `/api/v1/ingest/csv` | Import the five-file CSV pack |
| `POST` | `/api/v1/ingest/fhir` | Import FHIR Bundles |
| `POST` | `/api/v1/fhir/validate` | Validate FHIR structure and findings |
| `POST` | `/api/v1/fhir/export` | Export a claim as a FHIR Bundle |
| `POST` | `/api/v1/explanations` | Request a grounded explanation |
| `POST` | `/api/v1/reviews` | Record a human review decision |
| `GET` | `/api/v1/audit/events` | List minimized audit events |
| `GET` | `/api/v1/audit/verify` | Verify audit-chain integrity |

Use the interactive Swagger documentation and [backend/API_TESTING.md](backend/API_TESTING.md) for request bodies, expected responses, limits, negative tests, and FHIR examples.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Frontend API origin | `http://127.0.0.1:8000` |
| `PORT` | Frontend Vite port | `8443` |
| `CLAIMGUARD_CORS_ORIGINS` | Allowed browser origins | Local development origins |
| `CLAIMGUARD_AUDIT_LOG` | Audit JSONL path | `backend/outputs/audit_log.jsonl` |
| `OPENAI_API_KEY` | Enables LLM explanations | Not set |
| `OPENAI_MODEL` | Explanation model name | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | OpenAI-compatible API endpoint | OpenAI's default |

For local testing without an API key, request the `mock` explanation provider. The backend can fall back to a deterministic explanation when the configured AI provider is unavailable, and the response identifies that fallback.

### Using a free NVIDIA NIM model instead of OpenAI

The explanation client is OpenAI-SDK-compatible, so it also works against [NVIDIA's NIM API](https://build.nvidia.com), which offers a free tier. Set in `backend/.env`:

```
OPENAI_API_KEY=nvapi-your-key-here
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
OPENAI_MODEL=meta/llama-3.2-11b-vision-instruct
```

Note that NVIDIA periodically retires older model slugs from this catalog (for example, `meta/llama-3.1-8b-instruct` was retired 2026-08-26); call `GET /v1/models` against the same base URL and key if the configured model starts returning `410 Gone`. Smaller models are more likely to fail the server's strict evidence-grounding validation (fabricating an evidence path or flipping `needs_human_review`); when that happens the backend safely falls back to a deterministic explanation rather than serving an ungrounded one, and `fallback_used: true` / `assessment.explanation_source: "fallback"` reflect it in the response.

## Data, security, and production boundaries

- All included records are synthetic. Do not add real patient, member, provider, or payer information.
- The rule engine is deterministic, but its configured rules and reference data are educational fixtures rather than a complete payer policy implementation.
- The audit chain is tamper-evident. It is not immutable storage and does not replace trusted external backups or operational monitoring.
- The frontend authentication flow is a local demo state held in browser session storage. It is not identity management or authorization.
- The API has local CORS restrictions and a 5 MB request-body limit, but it has not undergone a production security review.
- No claim should be used for real reimbursement, coverage, clinical, or compliance decisions without appropriate domain validation and governance.

## Repository layout

```text
.
├── backend/
│   ├── src/
│   │   ├── api_app/          FastAPI app, routes, schemas, services
│   │   ├── rule_engine/      Deterministic rule evaluation
│   │   ├── normalisation/    CSV and FHIR conversion and validation
│   │   ├── AI_agent/         Mock/OpenAI explanation adapters
│   │   └── audit/            Hash-chained audit persistence
│   ├── data/                 Synthetic development/validation/stress data
│   ├── rules/                Rule and policy configuration
│   ├── schemas/              Claim, result, and review schemas
│   ├── tests/                Backend unit and API tests
│   ├── API_TESTING.md        Swagger and endpoint testing guide
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/              Typed backend clients and mappings
│   │   ├── pages/            Workspace screens
│   │   ├── components/       Shared UI components
│   │   └── hooks/            Shared React hooks
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── vite.config.ts
├── outputs/                  Root-level generated artifacts, if used
├── LICENSE
└── README.md
```

## Troubleshooting

### `package.json` cannot be found

Run frontend commands from `frontend`, not the repository root:

```powershell
Set-Location frontend
corepack pnpm dev
```

### Port `8443` is already in use

Stop the process that owns the port, or choose another frontend port with `$env:PORT = '8444'`. Because Vite is configured with `strictPort: true`, it does not silently choose a different port.

### The frontend cannot reach the backend

Confirm the backend is running, check `VITE_API_BASE_URL`, and restart Vite after changing the variable. If the frontend uses a non-default origin, add that origin to `CLAIMGUARD_CORS_ORIGINS` before starting the backend.

### OpenAI explanations fail

Use the `mock` provider for local testing, or set `OPENAI_API_KEY` in the environment of the backend process. Never commit API keys.

### CSV ingestion rejects a file pack

The backend CSV endpoint expects the related files with these exact keys: `claims.csv`, `lines.csv`, `coverage.csv`, `authorizations.csv`, and `attachments.csv`. In the Ingest Data screen, select or drop all five files together in the "Upload file" tab; a single CSV file is always rejected because the pack is incomplete. See [backend/API_TESTING.md](backend/API_TESTING.md) for a complete example of the raw request.

## Further documentation

- [Backend README](backend/README.md)
- [Backend API testing guide](backend/API_TESTING.md)
- [Frontend contributor notes](frontend/AGENTS.md)
- [License](LICENSE)
