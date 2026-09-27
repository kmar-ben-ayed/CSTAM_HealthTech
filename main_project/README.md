# ClaimGuard AI

A publishable starter project for synthetic claim validation, review workflows, and explainable rule-based decision support.

## Overview

This repository contains a Python backend for claim processing and a browser-based frontend for human review. The project is designed to be clear, reproducible, and safe for demonstration purposes, with synthetic healthcare data only.

## Repository structure

```text
main_project/
├── README.md
├── .gitignore
├── .env.example
├── frontend/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── engine.js
│   ├── data.js
│   ├── datasets.js
│   ├── audit.js
│   ├── ai_copilot.js
│   ├── package.json
│   └── README.md
├── backend/
│   ├── src/
│   ├── rules/
│   ├── schemas/
│   ├── data/
│   ├── examples/
│   ├── docs/
│   ├── outputs/
│   ├── prompts/
│   ├── tests/
│   ├── requirements.txt
│   ├── README.md
│   ├── validate_pack.py
│   ├── run_baseline.py
│   ├── evaluate.py
│   └── make_review.py
├── docs/
│   ├── project_structure.md
│   └── architecture_notes.md
└── LICENSE
```

## Quick start

### Backend

```bash
cd backend
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

### Frontend

```bash
cd frontend
python -m http.server 3000
```

In a second terminal, start the backend API from the project root:

```bash
python backend/src/api.py --port 8000
```

The frontend now loads the development, validation, and stress datasets from
`backend/data` through the API. Open http://localhost:3000 in a browser. If the
API is stopped, the frontend falls back to its small bundled demo fixtures.

## Good repo practices used here

- Separate runtime logic from UI code.
- Keep backend, frontend, docs, and test assets organized by purpose.
- Store environment variables in a template file rather than a committed secret file.
- Use synthetic records only and avoid exposing real patient data.
- Keep the repository publishable, understandable, and easy to run locally.

## Notes

This project is for educational and challenge work. It is not a production payer system, and it should not be used as a real claims adjudication engine outside a controlled demo environment.



python backend/src/run_baseline.py --input backend/data/development/claims.jsonl --output backend/outputs/dev_predictions.jsonl
python backend/src/explain_rule_results.py --input backend/outputs/dev_predictions.jsonl --output backend/outputs/dev_explanations.jsonl
python backend/src/evaluate.py --gold backend/data/development/expected_results.jsonl --pred backend/outputs/dev_predictions.jsonl --claims backend/data/development/claims.jsonl --output outputs/dev_metrics.json
python backend/src/make_review.py --input backend/outputs/dev_predictions.jsonl --output backend/outputs/review.html
