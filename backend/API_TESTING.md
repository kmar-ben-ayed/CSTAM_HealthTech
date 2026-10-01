# Backend API Testing Guide

Use this guide to test the backend from FastAPI's interactive Swagger UI. All examples use synthetic data.

## Start the Backend

Run these commands from the repository root in PowerShell. If you have not installed the backend dependencies yet:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

Start the API on port `8000` (use another free port if needed):

```powershell
backend\.venv\Scripts\python.exe backend\src\api.py --host 127.0.0.1 --port 8000
```

Open Swagger at **http://127.0.0.1:8000/docs**. The health check is **http://127.0.0.1:8000/api/v1/health**. Stop the server with `Ctrl+C`.

If you use a different backend port, set `VITE_API_BASE_URL` to the matching origin before starting or restarting the frontend. For example, for port `8001`, use `http://127.0.0.1:8001` as described in the repository README's alternate-port instructions.

In Swagger, expand an endpoint, select **Try it out**, enter any path/query parameters and request body below, then select **Execute**. Keep the API server terminal open while testing.

### About the Swagger `additionalProp` Example

Claim properties are intentionally represented as a generic JSON object in OpenAPI, so Swagger may show an example such as `{"additionalProp1": {}}`. That is only a placeholder, not a valid claim. Replace it with the complete claim below. An incomplete object correctly receives `422 Unprocessable Entity`.

## Reusable Claim Example

Use this complete claim for evaluation, batch evaluation, FHIR export, and explanations. The IDs and records are fictional.

```json
{
  "schema_version": "1.0.0",
  "claim_id": "API-TEST-001",
  "invoice_number": "INV-API-001",
  "patient_id": "PAT-API-001",
  "member_id": "MEM-API-001",
  "provider_id": "EDU-PROV-01",
  "payer_id": "EDU-PAYER",
  "policy_id": "EDU-BASIC",
  "diagnosis_code": "DX-EDU-01",
  "submission_date": "2026-06-06",
  "currency": "SAR",
  "total_amount": 100,
  "coverage": {
    "coverage_id": "COV-API-001",
    "status": "active",
    "beneficiary_patient_id": "PAT-API-001",
    "member_id": "MEM-API-001",
    "start_date": "2026-01-01",
    "end_date": "2026-12-31"
  },
  "lines": [
    {
      "line_id": "L1",
      "service_code": "SVC-LAB",
      "service_date": "2026-06-01",
      "modifier": null,
      "quantity": 1,
      "unit_price": 100,
      "net_amount": 100,
      "authorization_id": null
    }
  ],
  "authorizations": [],
  "attachments": [],
  "notes": "Synthetic API test data only."
}
```

For the dataset endpoint, another option is to call `GET /api/v1/datasets/development?limit=1` and copy one object from the returned `claims` array.

## Endpoint Tests

### 1. Health

`GET /api/v1/health`

No parameters or request body. Expected: `200` with `status: "ok"` and API version.

### 2. Get Dataset

`GET /api/v1/datasets/{split}`

Path values: `development`, `validation`, or `stress`.

Optional query parameter `limit`: integer from `1` through `500`. Omit it to return the whole split. Start with:

```text
/api/v1/datasets/development?limit=1
```

Expected: `200` with `claims` and an `evaluations` object keyed by claim ID.

### 3. Evaluate One Claim

`POST /api/v1/claims/evaluate`

```json
{
  "claim": {
    "schema_version": "1.0.0",
    "claim_id": "API-TEST-001",
    "invoice_number": "INV-API-001",
    "patient_id": "PAT-API-001",
    "member_id": "MEM-API-001",
    "provider_id": "EDU-PROV-01",
    "payer_id": "EDU-PAYER",
    "policy_id": "EDU-BASIC",
    "diagnosis_code": "DX-EDU-01",
    "submission_date": "2026-06-06",
    "currency": "SAR",
    "total_amount": 100,
    "coverage": {
      "coverage_id": "COV-API-001",
      "status": "active",
      "beneficiary_patient_id": "PAT-API-001",
      "member_id": "MEM-API-001",
      "start_date": "2026-01-01",
      "end_date": "2026-12-31"
    },
    "lines": [
      {
        "line_id": "L1",
        "service_code": "SVC-LAB",
        "service_date": "2026-06-01",
        "modifier": null,
        "quantity": 1,
        "unit_price": 100,
        "net_amount": 100,
        "authorization_id": null
      }
    ],
    "authorizations": [],
    "attachments": [],
    "notes": "Synthetic API test data only."
  }
}
```

Expected: `200`, an `evaluation_id`, and 15 rule results. Successful evaluations are recorded in the audit chain using minimized rule summaries.

### 4. Evaluate a Batch

`POST /api/v1/claims/evaluate/batch`

`claims` must contain between `1` and `100` complete claims. Put the reusable claim object from above inside the array:

```json
{
  "claims": [
    {
      "schema_version": "1.0.0",
      "claim_id": "API-TEST-001",
      "invoice_number": "INV-API-001",
      "patient_id": "PAT-API-001",
      "member_id": "MEM-API-001",
      "provider_id": "EDU-PROV-01",
      "payer_id": "EDU-PAYER",
      "policy_id": "EDU-BASIC",
      "diagnosis_code": "DX-EDU-01",
      "submission_date": "2026-06-06",
      "currency": "SAR",
      "total_amount": 100,
      "coverage": {
        "coverage_id": "COV-API-001",
        "status": "active",
        "beneficiary_patient_id": "PAT-API-001",
        "member_id": "MEM-API-001",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31"
      },
      "lines": [
        {
          "line_id": "L1",
          "service_code": "SVC-LAB",
          "service_date": "2026-06-01",
          "modifier": null,
          "quantity": 1,
          "unit_price": 100,
          "net_amount": 100,
          "authorization_id": null
        }
      ],
      "authorizations": [],
      "attachments": [],
      "notes": "Synthetic API test data only."
    }
  ]
}
```

Expected: `200` with an `evaluations` array. To test multiple claims, duplicate the object and change `claim_id`, `invoice_number`, `patient_id`, `member_id`, `coverage_id`, and `line_id` in the second copy.

### 5. Ingest JSON or JSONL

`POST /api/v1/ingest/jsonl`

`text` is a string containing one JSON claim, a JSON array, or newline-delimited JSON. For the easiest Swagger test, paste the reusable claim as compact one-line JSON inside the `text` value, escaping its quotation marks:

```json
{
  "text": "{\"schema_version\":\"1.0.0\",\"claim_id\":\"API-TEST-001\",\"invoice_number\":\"INV-API-001\",\"patient_id\":\"PAT-API-001\",\"member_id\":\"MEM-API-001\",\"provider_id\":\"EDU-PROV-01\",\"payer_id\":\"EDU-PAYER\",\"policy_id\":\"EDU-BASIC\",\"diagnosis_code\":\"DX-EDU-01\",\"submission_date\":\"2026-06-06\",\"currency\":\"SAR\",\"total_amount\":100,\"coverage\":{\"coverage_id\":\"COV-API-001\",\"status\":\"active\",\"beneficiary_patient_id\":\"PAT-API-001\",\"member_id\":\"MEM-API-001\",\"start_date\":\"2026-01-01\",\"end_date\":\"2026-12-31\"},\"lines\":[{\"line_id\":\"L1\",\"service_code\":\"SVC-LAB\",\"service_date\":\"2026-06-01\",\"modifier\":null,\"quantity\":1,\"unit_price\":100,\"net_amount\":100,\"authorization_id\":null}],\"authorizations\":[],\"attachments\":[],\"notes\":\"Synthetic API test data only.\"}"
}
```

Expected: `200`; valid claims appear under `claims` and `evaluations`. Invalid JSON lines and invalid claim envelopes are listed under `rejected` rather than stopping the whole import.

### 6. Ingest the CSV Pack

`POST /api/v1/ingest/csv`

This endpoint expects the five related CSV files, each supplied as a string. The keys must be exactly `claims.csv`, `lines.csv`, `coverage.csv`, `authorizations.csv`, and `attachments.csv`.

```json
{
  "files": {
    "claims.csv": "schema_version,claim_id,invoice_number,patient_id,member_id,provider_id,payer_id,policy_id,diagnosis_code,submission_date,currency,total_amount,notes\n1.0.0,API-TEST-001,INV-API-001,PAT-API-001,MEM-API-001,EDU-PROV-01,EDU-PAYER,EDU-BASIC,DX-EDU-01,2026-06-06,SAR,100,Synthetic API test data only.",
    "lines.csv": "claim_id,line_id,service_code,service_date,modifier,quantity,unit_price,net_amount,authorization_id\nAPI-TEST-001,L1,SVC-LAB,2026-06-01,,1,100,100,",
    "coverage.csv": "claim_id,coverage_id,status,beneficiary_patient_id,member_id,start_date,end_date\nAPI-TEST-001,COV-API-001,active,PAT-API-001,MEM-API-001,2026-01-01,2026-12-31",
    "authorizations.csv": "claim_id,authorization_id,patient_id,service_code,status,valid_from,valid_to,max_quantity",
    "attachments.csv": "claim_id,attachment_id,type,patient_id,service_code,service_date,document_status,text"
  }
}
```

Expected: `200` with one accepted claim. For a real pack, the columns must match those files in `backend/data/<split>/csv/`.

### 7. Ingest FHIR Bundles

`POST /api/v1/ingest/fhir`

The `text` value must be a string containing a FHIR Bundle or JSONL of Bundles. To get a valid Bundle, first call `POST /api/v1/fhir/export` with the reusable claim, then copy the returned Bundle JSON into the `text` string. JSON inside a JSON string must have its double quotes escaped.

```json
{
  "text": "{\"resourceType\":\"Bundle\",\"id\":\"B-API-TEST-001\",\"type\":\"collection\",\"entry\":[{\"fullUrl\":\"https://claimguard.example/fhir/Patient/PAT-API-001\",\"resource\":{\"resourceType\":\"Patient\",\"id\":\"PAT-API-001\",\"active\":true,\"identifier\":[{\"system\":\"https://claimguard.example/ids/member\",\"value\":\"MEM-API-001\"}]}},{\"fullUrl\":\"https://claimguard.example/fhir/Organization/EDU-PROV-01\",\"resource\":{\"resourceType\":\"Organization\",\"id\":\"EDU-PROV-01\",\"name\":\"Synthetic provider EDU-PROV-01\"}},{\"fullUrl\":\"https://claimguard.example/fhir/Organization/EDU-PAYER\",\"resource\":{\"resourceType\":\"Organization\",\"id\":\"EDU-PAYER\",\"name\":\"Fictional Education Payer\"}},{\"fullUrl\":\"https://claimguard.example/fhir/Coverage/COV-API-001\",\"resource\":{\"resourceType\":\"Coverage\",\"id\":\"COV-API-001\",\"status\":\"active\",\"beneficiary\":{\"reference\":\"https://claimguard.example/fhir/Patient/PAT-API-001\"},\"payor\":[{\"reference\":\"https://claimguard.example/fhir/Organization/EDU-PAYER\"}],\"class\":[{\"type\":{\"coding\":[{\"system\":\"http://terminology.hl7.org/CodeSystem/coverage-class\",\"code\":\"plan\"}]},\"value\":\"EDU-BASIC\"}],\"subscriberId\":\"MEM-API-001\",\"period\":{\"start\":\"2026-01-01\",\"end\":\"2026-12-31\"}}},{\"fullUrl\":\"https://claimguard.example/fhir/Claim/API-TEST-001\",\"resource\":{\"resourceType\":\"Claim\",\"id\":\"API-TEST-001\",\"status\":\"active\",\"type\":{\"coding\":[{\"system\":\"http://terminology.hl7.org/CodeSystem/claim-type\",\"code\":\"professional\"}]},\"use\":\"claim\",\"patient\":{\"reference\":\"https://claimguard.example/fhir/Patient/PAT-API-001\"},\"created\":\"2026-06-06\",\"provider\":{\"reference\":\"https://claimguard.example/fhir/Organization/EDU-PROV-01\"},\"insurer\":{\"reference\":\"https://claimguard.example/fhir/Organization/EDU-PAYER\"},\"priority\":{\"coding\":[{\"system\":\"http://terminology.hl7.org/CodeSystem/processpriority\",\"code\":\"normal\"}]},\"insurance\":[{\"sequence\":1,\"focal\":true,\"coverage\":{\"reference\":\"https://claimguard.example/fhir/Coverage/COV-API-001\"}}],\"item\":[{\"sequence\":1,\"productOrService\":{\"coding\":[{\"system\":\"https://claimguard.example/codes/services\",\"code\":\"SVC-LAB\"}]},\"servicedDate\":\"2026-06-01\",\"quantity\":{\"value\":1},\"unitPrice\":{\"value\":100,\"currency\":\"SAR\"},\"net\":{\"value\":100,\"currency\":\"SAR\"}}],\"total\":{\"value\":100,\"currency\":\"SAR\"},\"identifier\":[{\"system\":\"https://claimguard.example/ids/invoice\",\"value\":\"INV-API-001\"}],\"diagnosis\":[{\"sequence\":1,\"diagnosisCodeableConcept\":{\"coding\":[{\"system\":\"https://claimguard.example/codes/diagnoses\",\"code\":\"DX-EDU-01\"}]}}]}}]}"
}
```

Optional `sidecar_split` values are `development`, `validation`, or `stress`; use one only when importing a bundle whose matching normalized claim is in that dataset. Otherwise omit it or set it to `null`.

Expected: `200` with `claims`, `evaluations`, `fhir_findings`, and `rejected`. Structurally invalid bundles are reported in `rejected`.

### 8. Validate a FHIR Bundle

`POST /api/v1/fhir/validate`

Follow these steps to validate the Bundle you exported in section 9:

If Swagger only shows a `text` field in the request schema, stop and restart the backend so it loads the updated API. The updated endpoint accepts the Bundle directly under `bundle`.

1. In Swagger, expand `POST /api/v1/fhir/validate` and click **Try it out**.
2. In the request body, type `{"bundle":`.
3. Copy the complete JSON object from the `/api/v1/fhir/export` **Server response → Response body** and paste it immediately after the colon. Copy the response body itself, not the generated `curl` command.
4. Type `}` after the pasted object, then click **Execute**.

For this method, the request has one `bundle` property whose value is the complete exported Bundle object. Keep the Bundle's own opening and closing braces. Do **not** escape its quotes or include the export request's `claim` wrapper.

Expected result for the valid exported Bundle: `200`, `parse_errors` is empty, and `results[0].findings` is `[]`.

#### Alternative: Validate Using `text`

The endpoint also accepts the older serialized-text format. Send **either** `bundle` **or** `text`, never both in the same request. With `text`, the Bundle must be encoded as a JSON string, so its quotation marks are escaped.

To validate the same valid Bundle using `text`, open **section 7, Ingest FHIR Bundles**, copy its complete JSON request body, and submit that body to `/api/v1/fhir/validate` instead of `/api/v1/ingest/fhir`. The section 7 example already contains the full Bundle in the required escaped-string format. Expected: `200`, an empty `parse_errors` list, and `results[0].findings` equal to `[]`.

For a small negative test in the text format, use:

```json
{
  "text": "{\"resourceType\":\"Bundle\",\"type\":\"collection\",\"entry\":[]}"
}
```

This should return `200` with a `FHIR_NO_ENTRIES` finding. Use the complete section 7 example when you want to test a valid Bundle.

#### Optional Negative Test

This separate request intentionally has no entries, so it should produce `FHIR_NO_ENTRIES`:

```json
{
  "bundle": {
    "resourceType": "Bundle",
    "type": "collection",
    "entry": []
  }
}
```

Expected: `200`; inspect `results[0].findings` for the `FHIR_NO_ENTRIES` finding. This is a negative test only; use your exported Bundle for the valid test.

### 9. Export a Claim to FHIR

`POST /api/v1/fhir/export`

Send the reusable claim under the `claim` property, as in **Evaluate One Claim**. Expected: `200` with a FHIR `Bundle` (`resourceType: "Bundle"`). You can use that Bundle for the FHIR validation and ingestion tests above.

### 10. Request a Grounded Explanation

`POST /api/v1/explanations`

Send the reusable claim, a rule ID, and provider:

```json
{
  "claim": {
    "schema_version": "1.0.0",
    "claim_id": "API-TEST-001",
    "invoice_number": "INV-API-001",
    "patient_id": "PAT-API-001",
    "member_id": "MEM-API-001",
    "provider_id": "EDU-PROV-01",
    "payer_id": "EDU-PAYER",
    "policy_id": "EDU-BASIC",
    "diagnosis_code": "DX-EDU-01",
    "submission_date": "2026-06-06",
    "currency": "SAR",
    "total_amount": 100,
    "coverage": {
      "coverage_id": "COV-API-001",
      "status": "active",
      "beneficiary_patient_id": "PAT-API-001",
      "member_id": "MEM-API-001",
      "start_date": "2026-01-01",
      "end_date": "2026-12-31"
    },
    "lines": [
      {
        "line_id": "L1",
        "service_code": "SVC-LAB",
        "service_date": "2026-06-01",
        "modifier": null,
        "quantity": 1,
        "unit_price": 100,
        "net_amount": 100,
        "authorization_id": null
      }
    ],
    "authorizations": [],
    "attachments": [],
    "notes": "Synthetic API test data only."
  },
  "rule_id": "R001",
  "provider": "mock"
}
```

`rule_id` must be one of `R001` through `R015`. `provider` is either `mock` or `openai`; use `mock` for a no-key local test. `openai` requires `OPENAI_API_KEY` in the API process environment; `OPENAI_MODEL` is optional.

Expected: `200` with cited rule/evidence paths and a recommendation. The finding is recomputed by the backend; the request cannot supply its own evaluation result.

### 11. Record a Review Decision

`POST /api/v1/reviews`

```json
{
  "claim_id": "API-TEST-001",
  "rule_id": "R001",
  "action": "confirm_issue",
  "actor": "reviewer-demo",
  "reason": "Synthetic test review; source record checked.",
  "created_at": "2026-09-29T16:00:00Z",
  "original_status": "FAIL"
}
```

Allowed `action` values: `confirm_issue`, `dismiss_with_reason`, `request_information`, `mark_corrected_for_recheck`.

Allowed `original_status` values: `PASS`, `FAIL`, `UNABLE_TO_ASSESS`, `NOT_APPLICABLE`, `NOT_IMPLEMENTED`. `rule_id` must be `R001` through `R015`; `actor` is 1–128 characters; `reason` is 1–2000 non-whitespace characters; `created_at` must be an ISO 8601 date-time.

Expected: `201` with the new `audit_index` and `entry_hash`. The reason is hashed and is not returned in audit event listings.

### 12. List Audit Events

`GET /api/v1/audit/events`

Optional `limit`: integer from `1` through `500`, default `100`.

```text
/api/v1/audit/events?limit=20
```

Expected: `200` with `total_count` and newest-first minimized `events`. Call evaluation or record a review first if the audit log is empty.

### 13. Verify Audit Integrity

`GET /api/v1/audit/verify`

No parameters or request body. Expected for an untouched chain:

```json
{
  "valid": true,
  "first_broken_index": null
}
```

The endpoint reports a broken chain if an event was edited. It does not protect against deletion of the entire log or truncation of its final entries; keep an external trusted copy of the chain head for that stronger check.

## Common Errors and Limits

- `422`: invalid/missing request fields or a claim that fails the claim schema/transport checks.
- `413`: request body exceeds 5 MB.
- `404`: unknown route, dataset, or rule.
- `503`: audit storage is unavailable/corrupt, or the requested OpenAI provider is not configured.
- Batch evaluation accepts 1–100 claims; dataset and audit `limit` values are 1–500.
- Use synthetic data only. Do not send real patient information or expose this local demo publicly.