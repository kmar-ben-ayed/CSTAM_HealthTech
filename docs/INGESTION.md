# Data Ingestion & Normalisation

## Supported inputs

| Input | Endpoint | Notes |
|---|---|---|
| Normalised claims (JSON array, single object, or JSON Lines) | `POST /api/v1/ingest/jsonl` `{text}` | Bad lines reported as `PARSE_ERROR` without failing the batch |
| Relational CSV pack | `POST /api/v1/ingest/csv` `{files}` | Exactly `claims.csv, lines.csv, coverage.csv, authorizations.csv, attachments.csv` |
| FHIR R4 Bundle(s) (collection) | `POST /api/v1/ingest/fhir` `{text, sidecar_split?}` | One bundle per claim; array, object or NDJSON |
| FHIR structural check only | `POST /api/v1/fhir/validate` `{bundle | text}` | Returns findings, never raises |
| Export claim to FHIR | `POST /api/v1/fhir/export` `{claim}` | `claim_to_bundle` |

## FHIR mapping principles (`normalisation/fhir_adapter.py`)

1. Nothing is invented: absent field -> `None` -> rule engine yields `UNABLE_TO_ASSESS` / `FAIL`.
2. FHIR is lossy for this dataset (authorization details, notes). An optional **sidecar** (normalised claim from a dataset split) restores them; without it the response carries an `authorization_warning` (R009 may be `UNABLE_TO_ASSESS`).
3. Attachment content is decoded for display only, never executed; payloads capped at 200 000 bytes.
4. Custom extensions: `line-authorization-id`, `authorization-details`; custom code systems under `https://claimguard.example/codes`.

## Resilience

- Request body limited to 5 MB (413 `body_too_large`).
- A malformed bundle rejects only that bundle (`FHIR_INVALID` / `FHIR_MALFORMED`).
- Duplicate `claim_id` inside a batch -> `DUPLICATE_CLAIM_ID`.
- Re-uploading identical content is idempotent (SHA-256 fingerprint cache in SQLite) and does not re-write audit events.
- Accumulated claims from successive uploads are available at `GET /api/v1/claims` and `GET /api/v1/claims/{claim_id}`.

## Response shape

```json
{
  "batch_id": "…",
  "claims": [ /* normalised claims */ ],
  "evaluations": { "CLM-0001": [ /* 15 findings */ ] },
  "rejected": [ { "index": 2, "reason": "FHIR_INVALID", "findings": [] } ],
  "fhir_findings": [ { "claim_id": "CLM-0001", "findings": [] } ],
  "authorization_warning": null
}
```