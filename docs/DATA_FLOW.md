# ClaimGuard AI Data Flow

## 1. End-to-end flow: ingest, validate, explain, review, audit

```mermaid
sequenceDiagram
    actor R as Reviewer
    participant UI as Frontend
    participant API as FastAPI routes
    participant ING as IngestionService
    participant ADP as CSV / FHIR adapters
    participant CLS as ClaimService
    participant RE as Rule engine (R001-R015)
    participant DB as SQLite ingestion store
    participant AUD as AuditLogger
    participant EXS as ExplanationService
    participant LLM as LLM provider

    R->>UI: Upload JSONL / CSV pack / FHIR Bundle
    UI->>API: POST /api/v1/ingest/{jsonl|csv|fhir}
    API->>ING: payload (<= 5 MB)
    ING->>DB: lookup SHA-256 fingerprint
    alt fingerprint already ingested
        DB-->>ING: cached response
    else new input
        ING->>ADP: parse + normalise
        ADP-->>ING: claims + rejected records
        loop each claim
            ING->>CLS: validate_claim (schema + transport)
            alt invalid
                CLS-->>ING: ApiProblem 422 -> goes to rejected[]
            else duplicate claim_id
                ING-->>ING: rejected: DUPLICATE_CLAIM_ID
            else valid
                ING->>RE: baseline(claim, rules_config)
                RE-->>ING: 15 results (status, evidence, confidence)
            end
        end
        ING->>AUD: log_batch(rule_execution events)
        ING->>DB: save response (accumulate by claim_id)
    end
    API-->>UI: claims, evaluations, rejected, fhir_findings
    UI-->>R: Dashboard, claim list, review queue

    R->>UI: Open a FAIL / UNABLE_TO_ASSESS finding
    UI->>API: POST /api/v1/explanations
    API->>EXS: claim, rule_id, provider
    EXS->>RE: recompute finding (source of truth)
    EXS->>LLM: grounded prompt (finding + evidence + rule excerpt)
    LLM-->>EXS: JSON explanation
    alt valid and grounded
        EXS->>EXS: validate_explanation OK, source=llm
    else timeout / invalid / no API key
        EXS->>EXS: deterministic_fallback, source=fallback
    end
    EXS->>EXS: assess() -> completeness, grounding, escalation reasons
    EXS->>AUD: log_ai_decision(finding_hash, provider, fallback_used, assessment)
    API-->>UI: explanation + recommendation + assessment

    R->>UI: Choose action + reason
    UI->>API: POST /api/v1/reviews (X-Actor header)
    API->>AUD: log_human_decision (reason stored as SHA-256 hash)
    API-->>UI: 201 audit_index + entry_hash
    UI->>API: GET /api/v1/audit/verify
    API-->>UI: valid + first_broken_index
```

## 2. Ingestion and normalisation

```mermaid
flowchart TD
    A["Input"] --> B{"Endpoint"}
    B -->|"/ingest/jsonl"| J["Decode JSON array / object / JSON lines<br/>bad line -> PARSE_ERROR"]
    B -->|"/ingest/csv"| C["convert_files: claims, lines, coverage,<br/>authorizations, attachments .csv<br/>missing/extra file -> 422 invalid_csv_pack"]
    B -->|"/ingest/fhir"| F["parse_bundles_text -> claim_and_findings<br/>optional sidecar_split restores fields lost in FHIR"]
    J --> V
    C --> V
    F -->|"FhirError"| X1["rejected: FHIR_INVALID"]
    F -->|"other exception"| X2["rejected: FHIR_MALFORMED"]
    F --> V
    V["validate_claim<br/>1) schema_subset vs claim.schema.json<br/>2) validate_transport (exact keys, types, dates)"]
    V -->|"fail"| X3["rejected: ENVELOPE_INVALID"]
    V -->|"ok"| D{"claim_id already seen in batch?"}
    D -->|"yes"| X4["rejected: DUPLICATE_CLAIM_ID"]
    D -->|"no"| E["Accepted claim (normalised envelope)"]
    E --> R["Rule engine"]
```

Normalised claim envelope (exact key set enforced by `validate_transport`):
`schema_version, claim_id, invoice_number, patient_id, member_id, provider_id, payer_id, policy_id, diagnosis_code, submission_date, currency, total_amount, coverage, lines[], authorizations[], attachments[], notes`.
Line keys: `line_id, service_code, service_date, modifier, quantity, unit_price, net_amount, authorization_id`.

## 3. Rule engine and escalation

```mermaid
flowchart TD
    A["Normalised claim"] --> B["config(): rules.json, policies.json, services.json"]
    B --> C["baseline(): run R001..R015"]
    C --> D{"Result per rule"}
    D -->|"data present, check ok"| P["PASS (confidence 0.98)"]
    D -->|"data present, check violated"| F["FAIL (confidence 0.98)<br/>requires_human_review = true"]
    D -->|"input missing / unparseable"| U["UNABLE_TO_ASSESS (confidence 0.40)<br/>requires_human_review = true"]
    D -->|"rule not applicable"| N["NOT_APPLICABLE"]
    D -->|"no implementation"| NI["NOT_IMPLEMENTED"]
    F --> E["Evidence: JSON-pointer path + value"]
    U --> E
    E --> S["corrective_action from rule definition"]
    S --> Q["Review queue"]
    P --> Z["No action"]
    N --> Z
```

`confidence_kind` is `"uncalibrated"`: the 0.98 / 0.40 values are a certainty heuristic, not a probability.

## 4. AI explanation guardrails

```mermaid
flowchart TD
    A["Deterministic finding"] --> B{"Status FAIL or UNABLE_TO_ASSESS?"}
    B -->|"no"| S["source = skipped"]
    B -->|"yes"| C{"provider"}
    C -->|"mock or no API key"| M["MockExplanationProvider"]
    C -->|"openai + key"| O["OpenAI-compatible call<br/>temperature 0, JSON mode, 20 s timeout"]
    O --> V
    M --> V
    V{"validate_explanation"}
    V -->|"exact 5 keys<br/>cited paths subset of evidence<br/>cited rule = finding rule<br/>needs_human_review unchanged"| OK["source = llm"]
    V -->|"any violation or exception"| FB["deterministic_fallback<br/>source = fallback"]
    OK --> AS["assess(): evidence_completeness, grounding,<br/>escalation_reasons, review_priority"]
    FB --> AS
    S --> AS
    AS --> LOG["audit: ai_decision"]
```

Prompt-injection posture: claim fields, notes and attachment text are declared untrusted in the system prompt; the model may not approve payment, infer clinical necessity or accuse of fraud.
Escalation reasons: `not_implemented`, `high_severity`, `low_evidence_completeness` (< 0.5), `ai_explanation_failed`, `weak_grounding` (< 0.5).

## 5. Human review loop

```mermaid
stateDiagram-v2
    [*] --> Unreviewed: rule FAIL / UNABLE_TO_ASSESS
    Unreviewed --> ConfirmIssue: confirm_issue
    Unreviewed --> Dismissed: dismiss_with_reason
    Unreviewed --> InfoRequested: request_information
    Unreviewed --> Corrected: mark_corrected_for_recheck
    Corrected --> Unreviewed: re-ingest + re-evaluate
    InfoRequested --> Unreviewed: new data received
    ConfirmIssue --> [*]
    Dismissed --> [*]
    note right of Unreviewed: Every decision requires actor + reason<br/>and is written to the audit chain
```