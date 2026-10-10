# API Reference (`/api/v1`)

Errors always have the shape `{"error": "...", "code": "..."}`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + version |
| GET | `/datasets/{split}?limit=` | Evaluate a built-in split (`development`, `validation`, `stress`), no audit write |
| GET | `/claims?limit=` | Accumulated ingested claims + evaluations |
| GET | `/claims/{claim_id}` | One ingested claim + its findings |
| POST | `/claims/evaluate` | Evaluate one claim `{claim}` (audited) |
| POST | `/claims/evaluate/batch` | Evaluate 1-100 claims `{claims}` |
| POST | `/ingest/jsonl` | `{text}` |
| POST | `/ingest/csv` | `{files: {"claims.csv": "..."}}` |
| POST | `/ingest/fhir` | `{text, sidecar_split?}` |
| POST | `/fhir/validate` | `{bundle}` or `{text}` |
| POST | `/fhir/export` | `{claim}` -> FHIR Bundle |
| POST | `/explanations` | `{claim, rule_id, provider: "mock"|"openai"}` |
| POST | `/reviews` | Record human decision (201) |
| GET | `/audit/events?limit=` | Recent audit events (allow-listed fields) |
| GET | `/audit/verify` | `{valid, first_broken_index}` |
| GET | `/config/{file}` | Read a reference file (`rules.json`, `policies.json`, ...) |
| POST | `/config/{file}` | Save a reference file. **Admin token required**; `rules.json` is read-only here (409) |
| GET / POST | `/rules`, `/rules/drafts`, ... | Rule catalogue and rule authoring, see [RULE_ENGINE.md](RULE_ENGINE.md#4-api) |

Endpoints that change rules or reference data require the `X-Admin-Token` header (matching `CLAIMGUARD_ADMIN_TOKEN` on the server; if it is not set, they return 503). `X-Actor` names the admin in the audit log.

Review body: `claim_id, rule_id (R + digits), action (confirm_issue | dismiss_with_reason | request_information | mark_corrected_for_recheck), actor, reason, created_at, original_status`.

Common error codes: `invalid_claim` 422, `request_validation_error` 422, `body_too_large` 413, `claims_not_found` 404, `rule_not_found` 404, `rule_not_active` 404, `dataset_not_found` 404, `draft_in_progress` 409, `too_many_drafts` 429, `audit_unavailable` 503, `audit_integrity_error` 503.

Legacy routes under `/api/*` (health, datasets, fhir validate/ingest/export) are kept for the first static UI.