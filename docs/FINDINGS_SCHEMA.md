# Structured Findings Schema

Each rule execution yields one machine-readable finding (`make_result` in `engine_core.py`).

```json
{
  "claim_id": "CLM-0001",
  "rule_id": "R003",
  "rule_version": "1.0",
  "status": "FAIL",
  "severity": "high",
  "affected_line_ids": ["L1"],
  "evidence": [
    {"path": "/coverage/end_date", "value": "2026-01-31"},
    {"path": "/lines/0/service_date", "value": "2026-03-14"}
  ],
  "rule_source": "Fictional Payer Manual s.4.2",
  "explanation": "service outside coverage period",
  "corrective_action": "Update the coverage status or dates so all services fall within the active coverage period.",
  "confidence": 0.98,
  "confidence_kind": "uncalibrated",
  "requires_human_review": true,
  "method": "deterministic",
  "review_status": "unreviewed"
}
```

| Field | Meaning |
|---|---|
| `claim_id`, `rule_id`, `rule_version` | Identity of the check |
| `status` | `PASS`, `FAIL`, `UNABLE_TO_ASSESS`, `NOT_APPLICABLE`, `NOT_IMPLEMENTED` |
| `severity` | `low`, `medium`, `high` (from rule definition) |
| `evidence[]` | JSON-pointer `path` into the claim plus the observed `value` (rule-linked evidence) |
| `rule_source` | Fictional payer-rule reference |
| `confidence` / `confidence_kind` | Certainty heuristic; explicitly flagged as not a calibrated probability |
| `requires_human_review` | `true` for FAIL and UNABLE_TO_ASSESS |
| `corrective_action` | Suggested fix, filled only for FAIL / UNABLE_TO_ASSESS |

## AI explanation object (`POST /api/v1/explanations`)

```json
{
  "explanation": "...",
  "cited_evidence_paths": ["/coverage/end_date"],
  "cited_rule_ids": ["R003"],
  "needs_human_review": true,
  "recommendation": "...",
  "provider": "mock",
  "fallback_used": false,
  "assessment": {
    "explanation_source": "llm",
    "evidence_completeness": null,
    "explanation_grounding": 0.5,
    "review_priority": 3,
    "escalate": true,
    "escalation_reasons": ["high_severity"]
  }
}
```

Validation rules enforced before an explanation is accepted: exactly these 5 keys; at least one cited path; cited paths are a subset of the finding's evidence; cited rule equals the finding's rule; `needs_human_review` equals `requires_human_review`. Otherwise the deterministic fallback is returned.

## Rejected record (ingestion)

```json
{"index": 3, "reason": "ENVELOPE_INVALID",
 "findings": [{"severity": "error", "code": "invalid_claim", "message": "...", "path": ""}]}
```
Reasons: `PARSE_ERROR`, `INVALID_RECORD`, `ENVELOPE_INVALID`, `DUPLICATE_CLAIM_ID`, `FHIR_INVALID`, `FHIR_MALFORMED`.