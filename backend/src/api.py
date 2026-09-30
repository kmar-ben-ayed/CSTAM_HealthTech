"""Run the ClaimGuard FastAPI application with Uvicorn."""
import argparse
import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import paths
from rule_engine.engine_core import baseline, config, load_jsonl, validate_transport
from normalisation.fhir_adapter import (FhirError, bundle_to_claim, check_bundle, claim_and_findings,
                          claim_to_bundle, parse_bundles_text)
from audit import AuditLogger, AuditStore, verify_chain
from AI_agent.explain_rule_results import build_agent, make_finding, make_rule
from AI_agent.llm_adapter import deterministic_fallback

ROOT = Path(__file__).resolve().parents[1]

AUDIT = AuditLogger(AuditStore(ROOT / "outputs" / "audit_chain.jsonl"))
_AGENT = None
REVIEW_ACTIONS = {"confirm_issue", "dismiss_with_reason", "request_information", "mark_corrected_for_recheck"}

def audit_safe(fn):
    """Audit must never break validation; failures are printed, not raised."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        print(f"[audit] write failed: {exc}")
        return None


def get_agent():
    global _AGENT
    if _AGENT is None:
        _AGENT = build_agent()  # mock provider when no API key is configured
    return _AGENT

SPLITS = {
    "development": (ROOT / "data" / "development" / "claims.jsonl", "Development Suite"),
    "validation": (ROOT / "data" / "validation" / "claims.jsonl", "Validation Suite"),
    "stress": (ROOT / "data" / "stress" / "claims.jsonl", "Stress Test Suite"),
}
import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    source_root = Path(__file__).resolve().parent
    import sys

    sys.path.insert(0, str(source_root))
    from api_app.main import app

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
