# ClaimGuardAI Command Results

This document explains the five commands from the project quick-start sequence, the errors that occurred, and the files produced by the successful commands.

## Summary

| Command | Result | Meaning |
|---|---|---|
| `python src/validate_pack.py` | Failed | The release checksum manifest references a handbook PDF that is not in the workspace. |
| `python -m unittest discover -s tests -v` | Failed before tests ran | `src/llm_adapter.py` imports optional packages that are not installed, although `requirements.txt` says the baseline has no required third-party packages. |
| `python src/run_baseline.py ...` | Passed | Generated predictions for the 400 development claims. |
| `python src/evaluate.py ...` | Passed | Compared the predictions with the expected results and wrote metrics. |
| `python src/make_review.py ...` | Passed | Generated an HTML review page from the predictions. |

No source files were changed for this explanation. The earlier edit to `src/llm_adapter.py` was reverted, so its current behavior is still the original behavior described below.

## 1. Pack validation

Command:

```text
python src/validate_pack.py
```

This script checks the integrity of the teaching pack. It verifies:

- the expected number of claims in development, validation, and stress data;
- unique claim and patient IDs across splits;
- JSONL and CSV representations match;
- expected results cover every claim and rule;
- result records satisfy the supplied schema;
- FHIR teaching bundles map to the claim data; and
- files listed in `SHA256SUMS.json` exist and have the expected SHA-256 hash.

The failure is at the final release-checksum step. `SHA256SUMS.json` contains this entry:

```text
ClaimGuardAI_Student_Handbook.pdf
```

That PDF is not present in the current workspace. Therefore the validator cannot verify it and raises an error similar to:

```text
AssertionError: Release checksum differs: ClaimGuardAI_Student_Handbook.pdf
```

This is a pack-content or distribution problem, not a claim-processing problem. `QA_REPORT.md` also says that intentional edits can change checksums and that an untouched original pack should be retained for comparison. Do not regenerate the checksum just to hide the missing file; either restore the expected PDF from the original pack or update the pack distribution deliberately.

## 2. Unit tests

Command:

```text
python -m unittest discover -s tests -v
```

The test discovery fails while importing modules, before the test methods execute. The current `src/llm_adapter.py` contains these module-level imports:

```python
from dotenv import load_dotenv
from openai import OpenAI
```

The current `requirements.txt` says:

```text
No third-party packages are required for the supplied baseline, scorer, CSV conversion or audit tools.
```

That creates a dependency mismatch. A clean Python installation can fail with a `ModuleNotFoundError`, first for `dotenv` if `python-dotenv` is absent. If that import is made available, `openai` can also fail if the OpenAI package is absent. The deterministic mock provider and the baseline do not need either package, so these optional model-integration imports should not prevent the ordinary tests from loading.

This is separate from the checksum failure. Installing optional packages may make the tests import successfully, but it will not restore the missing handbook PDF.

## 3. Baseline predictions

Command:

```text
python src/run_baseline.py \
  --input data/development/claims.jsonl \
  --output outputs/dev_predictions.jsonl
```

This command passed. It reads the 400 development claims, applies the implemented baseline rules, and writes one result for each claim-rule pair.

The output file is:

- `outputs/dev_predictions.jsonl` - newline-delimited prediction records.

There are 15 rules per claim, so the expected output contains 400 x 15 = 6,000 result records. The project README explains that the starter baseline fully covers only R001, R003, and R006; the current run output and evaluator metrics show all development rule outcomes as implemented in this workspace.

## 4. Evaluation metrics

Command:

```text
python src/evaluate.py \
  --gold data/development/expected_results.jsonl \
  --pred outputs/dev_predictions.jsonl \
  --claims data/development/claims.jsonl \
  --output outputs/dev_metrics.json
```

This command passed. It compares the generated predictions with the gold file, joins them to the original claims, and writes aggregate and per-rule metrics.

The output file is:

- `outputs/dev_metrics.json` - JSON evaluation metrics.

The current metrics report:

- 6,000 total claim-rule results;
- 319 true positives;
- 0 false positives;
- 0 false negatives;
- 5,681 true negatives;
- issue precision, recall, and F1 of 1.0;
- status accuracy of 1.0; and
- false-alarm rate of 0.0.

These are results against this synthetic development dataset. They show that the generated predictions match the supplied expected results; they are not evidence of production payer accuracy or real-world clinical validity.

## 5. Review page

Command:

```text
python src/make_review.py \
  --input outputs/dev_predictions.jsonl \
  --output outputs/review.html
```

This command passed. It converts the JSONL predictions into a browser-viewable static HTML review page.

The output file is:

- `outputs/review.html` - a local report for browsing findings, filtering results, and reviewing the generated claim decisions.

Open it in a browser to inspect the development predictions. It is a static local artifact; it does not call an external model or payer system.

## Files created or updated by the commands

The successful pipeline commands create or overwrite these files:

```text
outputs/dev_predictions.jsonl
outputs/dev_metrics.json
outputs/review.html
```

The validation and test commands are checks only and do not normally create project outputs. Python may also create a `__pycache__` directory containing bytecode; that is temporary and should not be treated as a project result.

The explanatory file you are reading is an additional file:

```text
RUN_RESULTS_EXPLANATION.md
```

## Recommended order to resolve the issues

1. Restore `ClaimGuardAI_Student_Handbook.pdf` if it is part of the intended starter pack, then rerun `python src/validate_pack.py`.
2. Decide whether `python-dotenv` and `openai` are optional dependencies. The current project documentation says they are optional, so the adapter should load them lazily or handle their absence instead of blocking deterministic tests.
3. Rerun the unit tests after the dependency behavior is corrected.
4. Rerun the baseline, evaluator, and review commands to confirm that the generated outputs remain unchanged.

Until then, the baseline/evaluation/review workflow is operational, but the pack is not fully clean because release validation and test discovery still report independent problems.
