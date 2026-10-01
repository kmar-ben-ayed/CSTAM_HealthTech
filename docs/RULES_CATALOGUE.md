# Payer Rule Catalogue (R001-R015)

All rules are **deterministic** (`method: "deterministic"`) and implemented in `backend/src/rule_engine/engine_core.py`.
Rule metadata (id, version, severity, source, corrective action) lives in `backend/rules/rules.json`; allowed providers per policy in `policies.json`; service catalogue in `services.json`.

| Rule | Category | What it checks | FAIL when | UNABLE_TO_ASSESS when |
|---|---|---|---|---|
| R001 | Missing data | Required header fields (`invoice_number`, `member_id`, `diagnosis_code`) and line fields (`service_date`, `service_code`, `quantity`, `unit_price`, `net_amount`) | Any is empty | - |
| R002 | Inconsistent | Service date is not after submission date | A line date is later than `submission_date` | Dates missing or invalid |
| R003 | Coverage | Coverage is `active` and each service date falls in `[start_date, end_date]` | Inactive coverage or date outside period | Status, period or dates missing |
| R004 | Inconsistent | `member_id` and `patient_id` match the coverage record | IDs differ | Either side missing |
| R005 | Unsupported | `provider_id` is in the policy's `allowed_providers` | Provider not allowed | Provider or policy unknown |
| R006 | Duplicate | Duplicate service lines within a claim | Same line repeated | Key fields missing |
| R007 | Inconsistent | Line arithmetic (`quantity x unit_price` vs `net_amount`) | Amounts do not reconcile | Inputs missing |
| R008 | Authorization | Service requiring prior authorization has one attached | Required authorization absent | Policy data missing |
| R009 | Authorization | Authorization status / validity / quantity | Authorization invalid or exceeded | Authorization registry details absent |
| R010 | Attachments | Required supporting document present and `final` | Missing or not final | Attachment data missing |
| R011 | Unsupported | `service_code` exists in the service catalogue | Unknown code | Code empty |
| R012 | Inconsistent | Claim `total_amount` equals sum of lines / allowed limits | Totals mismatch | Total missing |
| R013 | Policy limit | Line quantity within policy maximum | Quantity over limit | Quantity missing |
| R014 | Timing | Submission within the allowed window | Outside window | Dates missing |
| R015 | Currency | Currency is the allowed billing currency and amounts are consistent | Disallowed currency | Currency missing |

Confidence heuristic (uncalibrated): `PASS/FAIL/NOT_APPLICABLE = 0.98`, `UNABLE_TO_ASSESS = 0.40`.
`requires_human_review = true` for `FAIL` and `UNABLE_TO_ASSESS`.

## Result object

See [FINDINGS_SCHEMA.md](FINDINGS_SCHEMA.md).

## Benchmark

`python src/evaluate.py` scores predictions per rule against the gold labels (precision, recall, issue F1, false-alarm rate, status accuracy, confusion matrix). Splits: `development`, `validation`, `stress`.