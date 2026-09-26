# ClaimGuard AI Frontend Integration Files

This file is the handoff checklist for moving the ClaimGuard AI challenge backend into the main project alongside the frontend.

## Current state

- `frontend/` already contains a working vanilla JavaScript application.
- The frontend currently runs the deterministic rule engine in the browser and does not require an HTTP API.
- The data is synthetic teaching data only.
- The rule engine returns all 15 documented rule results for each claim.
- A future production-style integration can replace the local data source with a backend API without changing the review screens.

### Existing frontend files

```text
frontend/
  index.html       # Application shell and page sections
  styles.css       # Responsive visual system and components
  app.js           # Application controller, views, filters, review workflow
  engine.js        # Client-side 15-rule deterministic evaluator
  datasets.js      # Worked, development-sample, and stress fixtures
  data.js          # Claim loading, selection, editing, and state management
  audit.js         # Browser-side SHA-256 audit chain
  ai_copilot.js    # Bounded deterministic/AI explanation layer
  package.json     # Local static-server scripts
  README.md        # Frontend launch instructions
```

## Copy these files and folders

Copy the following paths into the main project. Preserve the relative folder structure unless the frontend framework requires a dedicated `backend/` directory.

### Backend runtime

```text
src/engine_core.py
src/run_baseline.py
src/evaluate.py
src/csv_to_jsonl.py
src/make_review.py
src/audit.py
src/schema_subset.py
src/llm_adapter.py
src/explain_rule_results.py
src/validate_pack.py
requirements.txt
```

### Rule and contract files

```text
rules/diagnoses.json
rules/policies.json
rules/providers.json
rules/rules.json
rules/services.json
schemas/claim.schema.json
schemas/result.schema.json
schemas/review_event.schema.json
```

### Runtime data

For a full local demonstration, copy these folders:

```text
data/development/
data/validation/
data/stress/
```

For a smaller frontend demo, copy only:

```text
examples/first_10_claims.jsonl
examples/first_10_expected_results.jsonl
examples/worked_cases.json
```

Do not expose mentor-held or private assessment data in a browser build.

### Frontend reference material

```text
examples/review_demo.html
prompts/explain_findings.md
docs/04_Rulebook.md
docs/05_Architecture_and_AI.md
docs/10_Privacy_Security_and_Audit.md
CLAIMGUARD_AI_CHALLENGE_SPEC.md
```

## Recommended destination layout

```text
main-project/
  frontend/
    index.html
    styles.css
    app.js
    engine.js
    datasets.js
    data.js
    audit.js
    ai_copilot.js
    package.json
    README.md
  backend/
    src/
    rules/
    schemas/
    data/
    requirements.txt
  FRONTEND_INTEGRATION_FILES.md
```

If the main project is Python-based, the backend folders may remain at the project root instead of under `backend/`.

## Recommended main project tree

Use this layout for the existing vanilla JavaScript frontend with an optional Python backend. Keep the browser app and the authoritative backend implementation separate so frontend changes do not accidentally alter the rule engine or source data.

```text
main-project/
  frontend/
    index.html
    styles.css
    app.js
    engine.js
    datasets.js
    data.js
    audit.js
    ai_copilot.js
    package.json
    README.md
  backend/
    src/
      engine_core.py
      api.py                 # Optional later: HTTP wrapper around engine_core
      audit.py
      csv_to_jsonl.py
      evaluate.py
      run_baseline.py
      validate_pack.py
    rules/
    schemas/
    data/
      development/
      validation/
      stress/
    examples/
    requirements.txt
    tests/
  outputs/
    .gitkeep
  docs/
    FRONTEND_INTEGRATION_FILES.md
    architecture.md
  .env.example
  .gitignore
  README.md
```

The current frontend already uses curated fixtures in `datasets.js`. Keep those fixtures small for demos. Do not place the full development dataset in the browser bundle until the team has decided that exposing it is acceptable.

## Working plan

### Phase 1: establish a reproducible baseline

1. Keep the existing frontend files together under `frontend/`.
2. Copy the backend files, rules, schemas, and a small example dataset into `backend/`.
3. Start the frontend with `python -m http.server 3000` from `frontend/`.
4. Run `python src/validate_pack.py` from `backend/`.
5. Run `python -m unittest discover -s tests -v` from `backend/`.
6. Record the Python version, browser used, and successful commands in `README.md`.

**Done when:** the backend validates and tests pass before any UI work begins.

### Phase 2: verify and extend the existing claim viewer

1. Run the existing frontend and verify dashboard, queue, inspector, audit, and rulebook views.
2. Verify the existing claim list search and status/severity filters.
3. Verify the existing claim details view, 15-rule checklist, and unresolved-count summary.
4. Verify each evidence JSON Pointer resolves against the original claim and shows the exact value.
5. Fix only confirmed UI or rule-display defects before adding new features.

**Done when:** a reviewer can select any fixture claim and trace every finding back to source data without editing it.

### Phase 3: add the human review workflow

1. Add the four review actions from this document.
2. Require reviewer identity and a non-empty reason for every action.
3. Store decisions separately from claim data and rule results.
4. Add a review history panel for the selected claim and rule.
5. Add an export button that produces newline-delimited JSON review events.

**Done when:** a decision never overwrites the original claim or changes the deterministic rule status.

### Phase 4: connect the Python engine

The current app already evaluates curated claims locally through `engine.js`. Keep that working path as the offline demo. When backend parity is needed, add `backend/src/api.py` and expose only the narrow endpoints listed below. Then compare API results with the existing browser engine before switching the data source.

```text
GET  /api/claims
GET  /api/claims/{claim_id}
POST /api/claims/{claim_id}/evaluate
GET  /api/results/{claim_id}
POST /api/review-events
GET  /api/audit/verify
```

The API wrapper should preserve the original claim, validate incoming data, call `engine_core.baseline`, and return schema-compatible results. The frontend should never run Python commands or access the shell.

**Done when:** selecting a claim in the UI retrieves the same result statuses and evidence values as the CLI evaluator.

### Phase 5: audit and bounded AI

1. Send exported review events to the audit wrapper and verify the hash chain.
2. Display audit verification status without claiming that the local file is immutable.
3. Add the mock explanation provider first.
4. Validate every AI response against the expected schema and allowed evidence paths.
5. Fall back to the deterministic explanation when the provider fails or returns invalid data.

**Done when:** AI text can improve readability but cannot change rule status, evidence, corrective action, or review boundaries.

### Phase 6: evaluation and delivery

1. Run development evaluation and save metrics.
2. Test validation and stress splits separately; do not tune hidden mentor data.
3. Test missing values, invalid dates, duplicate lines, incorrect amounts, unknown services, and malicious attachment text.
4. Test the review lifecycle and audit verification in the browser.
5. Document known limitations, screenshots, architecture, and exact launch commands.

**Done when:** the demo is reproducible from a clean checkout and the submission explains both successful checks and uncertainty.

## Suggested team split

For a small team, divide work by ownership:

| Owner | Responsibility | Deliverable |
|---|---|---|
| Frontend | Claim list, detail view, filters, evidence display | Read-only review screen |
| Workflow | Review actions, local state, export | Decision history and JSONL export |
| Backend | API wrapper, validation, engine integration | Stable `/api` endpoints |
| Quality | Tests, edge cases, metrics, documentation | Acceptance evidence and demo checklist |

One person should own the final integration branch and run the complete validation sequence before a demo.

## Generated files the frontend can consume

Run these commands from the ClaimGuard project root:

```bash
python src/validate_pack.py
python src/run_baseline.py --input data/development/claims.jsonl --output outputs/dev_predictions.jsonl
python src/evaluate.py --gold data/development/expected_results.jsonl --pred outputs/dev_predictions.jsonl --claims data/development/claims.jsonl --output outputs/dev_metrics.json
python src/make_review.py --input outputs/dev_predictions.jsonl --output outputs/review.html
```

The frontend can load:

```text
outputs/dev_predictions.jsonl   # One result per claim-rule pair
outputs/dev_metrics.json        # Evaluation metrics
outputs/review.html             # Standalone reference review page
```

For a browser demo, convert JSONL to an array during the backend/API step. Do not import JSONL directly into client code unless the client has an intentional line-by-line parser.

## Result object used by the frontend

Each prediction contains these fields:

```json
{
  "claim_id": "CG-EXAMPLE",
  "rule_id": "R007",
  "rule_version": "1.0.0",
  "status": "FAIL",
  "severity": "high",
  "affected_line_ids": ["L1"],
  "evidence": [
    {"path": "/lines/0/net_amount", "value": 710.0}
  ],
  "rule_source": "fictional-rulebook/R007@1.0.0",
  "explanation": "Net amount does not equal quantity * unit price for some lines.",
  "corrective_action": "Review and correct the affected line amount.",
  "confidence": null,
  "confidence_kind": "not_probabilistic",
  "requires_human_review": true,
  "method": "deterministic",
  "review_status": "unreviewed"
}
```

The UI should display at minimum:

- Claim ID
- Rule ID and version
- Status: `PASS`, `FAIL`, `UNABLE_TO_ASSESS`, `NOT_APPLICABLE`, or `NOT_IMPLEMENTED`
- Severity
- Affected line IDs
- Exact evidence JSON paths and values
- Explanation
- Corrective action
- Human-review requirement

Never change a deterministic `FAIL` to `PASS` because of an AI explanation.

## Claim input object

A claim is one JSON object from:

```text
data/development/claims.jsonl
```

The frontend should preserve the original claim object and display source values using the evidence JSON Pointer paths. The original input must not be overwritten when a reviewer records a correction or decision.

## Review actions

The review UI should support these actions for `FAIL` and `UNABLE_TO_ASSESS` results:

```text
confirm_issue
dismiss_with_reason
request_information
mark_corrected_for_recheck
```

Each action needs:

```json
{
  "claim_id": "CG-EXAMPLE",
  "rule_id": "R007",
  "action": "confirm_issue",
  "actor": "reviewer-id",
  "reason": "Verified against the submitted line item.",
  "created_at": "2026-09-26T12:00:00Z",
  "original_status": "FAIL"
}
```

Send exported review events through `src/audit.py` so they are stored in a tamper-evident hash chain:

```bash
python src/audit.py --events outputs/review_decisions.jsonl --log outputs/audit.jsonl
python src/audit.py --verify --log outputs/audit.jsonl
```

The audit file is a teaching prototype. Production use would also require authentication, access control, append-only storage, trusted head anchoring, and concurrent-write handling.

## Integration options

### Option A: generated-file demo

1. Run the Python commands above.
2. Copy or serve `outputs/dev_predictions.jsonl` and the selected claims file as static frontend assets.
3. Parse the files in the frontend.
4. Store review decisions locally or export them as JSONL.

This is the fastest offline demonstration, but it does not recalculate results after edits.

### Option B: backend wrapper

Create a small FastAPI, Flask, or equivalent service around the Python modules. Recommended endpoints:

```text
GET  /api/claims
GET  /api/claims/{claim_id}
POST /api/claims/{claim_id}/evaluate
GET  /api/results/{claim_id}
POST /api/review-events
GET  /api/audit/verify
```

The wrapper should call `engine_core.baseline`, validate inputs with `validate_transport`, preserve the original claim, and return schema-compatible result objects. Do not let the frontend directly execute shell commands or import private files.

## Files not to copy into the frontend build

```text
.venv/
__pycache__/
outputs/*.jsonl
outputs/*.json
outputs/*.html
SHA256SUMS.json
```

Generated outputs may be copied into a local demo asset folder, but should not be committed as frontend source unless they are intentionally fixtures. Never include API keys, `.env` files, real patient information, or mentor-only data.

## Acceptance checklist

- [ ] The frontend loads a complete claim without dropping nullable fields.
- [ ] A selected claim shows all 15 rule results.
- [ ] Evidence paths resolve to the original claim values.
- [ ] `UNABLE_TO_ASSESS` is visibly different from `PASS`.
- [ ] `NOT_IMPLEMENTED` is never represented as `PASS`.
- [ ] Review actions require an actor and reason.
- [ ] Original claim data remains unchanged after a review action.
- [ ] Corrected claims are evaluated as a new version.
- [ ] Review events can be exported and verified with the audit tool.
- [ ] No secrets or mentor-held records enter the browser bundle.
