# ClaimGuard AI Backend

This backend provides the deterministic claim-processing engine, validation tooling, evaluation scripts, and synthetic datasets used by the project.

## Purpose

The backend is the source of truth for:

- rule evaluation
- data validation
- result generation
- metrics and review outputs
- audit and reproducibility checks

## Structure

```text
backend/
├── src/
│   ├── engine_core.py
│   ├── evaluate.py
│   ├── run_baseline.py
│   ├── make_review.py
│   ├── validate_pack.py
│   ├── audit.py
│   ├── csv_to_jsonl.py
│   ├── explain_rule_results.py
│   ├── llm_adapter.py
│   └── schema_subset.py
├── rules/
├── schemas/
├── data/
├── examples/
├── prompts/
├── tests/
├── outputs/
├── requirements.txt
├── README.md
├── START_HERE.html
├── FRONTEND_INTEGRATION_FILES.md
└── QA_REPORT.md
```

## Quick validation

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
python src/validate_pack.py
python -m unittest discover -s tests -v
python src/run_baseline.py --input data/development/claims.jsonl --output outputs/dev_predictions.jsonl
```

## Frontend data API

Run this from `main_project` to serve claims from `backend/data` and results
from the deterministic `engine_core` implementation:

```bash
python backend/src/api.py --port 8000
```

The browser frontend connects to `http://127.0.0.1:8000/api`. Available
dataset routes are `/api/datasets/development`, `/api/datasets/validation`,
and `/api/datasets/stress`.

## Notes

This backend is intentionally deterministic and safe for educational use. It does not require a live production API or external patient data.

