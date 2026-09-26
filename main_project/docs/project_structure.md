# Project structure

This repository is organized to resemble a real project layout for a published challenge or starter repo.

## Top-level folders

- frontend/: browser-based claim review interface
- backend/: Python engine, rule definitions, datasets, and validation tools
- docs/: repository notes and architecture references

## Why this layout works

- Frontend changes do not overwrite the rule engine source.
- Backend logic remains easy to validate with unit tests and schema checks.
- Data and examples stay separate from app code.
- The repository is easier to navigate by a future team or grader.
