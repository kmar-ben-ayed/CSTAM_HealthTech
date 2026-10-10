# ClaimGuard AI Source Architecture

## 1. Design principles

1. **Deterministic rules decide, AI only explains.** The verdict (`PASS/FAIL/UNABLE_TO_ASSESS/NOT_APPLICABLE`) always comes from the rule specs, evaluated by `rule_engine/interpreter.py`. The LLM can never change a status, severity or the `requires_human_review` flag. When a model drafts a *new* rule, it only proposes a spec; code checks it before it runs ([RULE_ENGINE.md](RULE_ENGINE.md)).
2. **Nothing is invented.** Missing data stays `None`, which yields `UNABLE_TO_ASSESS` (low confidence, human review) instead of a guessed default.
3. **Every action is audited** in a hash-chained, append-only log. If the audit write fails, the request fails (HTTP 503) rather than proceeding unlogged.
4. **Human in the loop.** Failing / uncertain findings are routed to a reviewer who records one of four actions with a mandatory reason.
5. **Graceful degradation.** No API key, LLM timeout or invalid LLM output falls back to a deterministic explanation.

## 2. Component diagram

```mermaid
flowchart LR
    subgraph FE["Frontend - React + Vite + TypeScript"]
        PAGES["Pages: Landing, Login, Dashboard, Claims,<br/>ClaimReview, ReviewQueue, Ingest,<br/>Rules, Runs, Analytics, AuditTrail"]
        APIC["src/api: client.ts, claims.ts,<br/>ingestion.ts, audit.ts"]
        PAGES --> APIC
    end

    subgraph BE["Backend - FastAPI (api_app)"]
        MW["Middleware<br/>CORS + 5 MB body limit + error handlers"]
        ROUTES["routes.py<br/>/api/v1/* + legacy /api/*"]
        SCHEMAS["schemas.py<br/>Pydantic strict models"]

        subgraph SVC["services.py"]
            ING["IngestionService"]
            CLS["ClaimService"]
            DSS["DatasetService"]
            EXS["ExplanationService"]
            AUS["AuditService"]
        end

        subgraph NORM["normalisation/"]
            CSV["csv_to_jsonl.py"]
            FHIR["fhir_adapter.py<br/>bundle_to_claim / claim_to_bundle / check_bundle"]
            SUB["schema_subset.py<br/>JSON-schema validation"]
        end

        subgraph RE["rule_engine/"]
            CORE["engine_core.py + interpreter.py<br/>validate_transport + active rule specs"]
        end

        subgraph AI["AI_agent/"]
            LLM["llm_adapter.py<br/>Mock / OpenAI-compatible provider<br/>validate_explanation + fallback"]
            CONF["confidence.py<br/>completeness, grounding, escalation"]
        end

        subgraph AUD["audit/"]
            LOGGER["logger.py AuditLogger"]
            CHAIN["chain.py SHA-256 chain"]
            STORE["store.py append-only JSONL"]
        end
    end

    subgraph DATA["Storage"]
        RULESF[("rules/*.json<br/>rules, policies, services")]
        SCH[("schemas/claim.schema.json")]
        DS[("data/development | validation | stress<br/>claims.jsonl")]
        SQL[("outputs/ingestion.sqlite3<br/>fingerprint cache + accumulated claims")]
        ALOG[("outputs/audit_log.jsonl")]
    end

    EXT["LLM provider<br/>OpenAI-compatible API"]

    APIC -->|"HTTP JSON"| MW --> ROUTES
    ROUTES --> SCHEMAS
    ROUTES --> SVC
    ING --> CSV
    ING --> FHIR
    ING --> CLS
    CLS --> SUB
    CLS --> CORE
    DSS --> CLS
    EXS --> CORE
    EXS --> LLM
    EXS --> CONF
    CORE --> RULESF
    SUB --> SCH
    DSS --> DS
    ING --> SQL
    CLS --> LOGGER
    EXS --> LOGGER
    AUS --> LOGGER
    LOGGER --> CHAIN
    LOGGER --> STORE --> ALOG
    LLM -.->|"optional"| EXT
```

## 3. Layer responsibilities

| Layer | Module | Responsibility |
|---|---|---|
| API | `api_app/main.py` | App factory, CORS, 5 MB body limit, uniform JSON errors `{error, code}` |
| API | `api_app/routes.py` | Versioned routes (`/api/v1`) plus legacy `/api/*` compatibility routes |
| API | `api_app/schemas.py` | Strict Pydantic request models (`extra="forbid"`, rule-id regex, review actions enum) |
| Service | `api_app/services.py` | `IngestionService`, `ClaimService`, `DatasetService`, `ExplanationService`, `AuditService`, `IngestionStore` (SQLite) |
| Normalisation | `normalisation/fhir_adapter.py` | FHIR R4 Bundle <-> internal claim envelope, structural checks that never raise |
| Normalisation | `normalisation/csv_to_jsonl.py` | Rebuilds claims from 5 relational CSV files |
| Normalisation | `normalisation/schema_subset.py` | Lightweight validation against `claim.schema.json` |
| Rules | `rule_engine/engine_core.py` | Transport validation, running the active rule specs, evidence pointers, confidence heuristic |
| Rules | `rule_engine/language.py`, `validation.py`, `interpreter.py`, `spec_store.py` | The rule language, its static checks, its evaluator and versioned spec storage |
| Rule authoring | `rule_authoring/*` | Drafter agent, edge cases, oracle, checks and workflow for new rules ([RULE_ENGINE.md](RULE_ENGINE.md)) |
| AI | `AI_agent/llm_adapter.py` | Grounded explanation providers, output validation, deterministic fallback |
| AI | `AI_agent/confidence.py` | Evidence completeness, citation grounding, escalation reasons, review priority |
| Audit | `audit/*` | SHA-256 hash chain, thread-safe logger, fsync'd append-only JSONL store |
| UI | `frontend/src/pages/*` | Reviewer interface (queue, claim review, ingestion, audit trail, analytics) |

## 4. Deployment / runtime view

```mermaid
flowchart TB
    U["Reviewer browser"] -->|"HTTP :5173 (Vite dev)"| FE["Frontend<br/>VITE_API_BASE_URL"]
    FE -->|"REST JSON :8000"| BE["Uvicorn + FastAPI<br/>python src/api.py"]
    BE --> FS[("Local files<br/>rules, schemas, data, outputs")]
    BE --> DB[("SQLite<br/>ingestion.sqlite3")]
    BE --> AL[("audit_log.jsonl")]
    BE -.->|"HTTPS, optional"| LLM["LLM provider<br/>OPENAI_BASE_URL"]
```

## 5. Frontend page map

```mermaid
flowchart LR
    L["Landing"] --> LG["Login"] --> D["Dashboard"]
    D --> C["Claims"]
    D --> RQ["ReviewQueue"]
    D --> IN["Ingest"]
    D --> R["Rules"]
    D --> RU["Runs"]
    D --> AN["Analytics"]
    D --> AT["AuditTrail"]
    C --> CR["ClaimReview<br/>findings, evidence, AI explanation,<br/>review decision form"]
    RQ --> CR
    IN -->|"JSONL / CSV / FHIR"| C
    CR -->|"POST /reviews"| AT
```