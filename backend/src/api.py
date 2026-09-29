"""Small HTTP wrapper exposing backend claims and deterministic evaluations."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from rule_engine.engine_core import baseline, config, load_jsonl, validate_transport
from normalisation.fhir_adapter import (FhirError, bundle_to_claim, check_bundle, claim_and_findings,
                          claim_to_bundle, parse_bundles_text)

ROOT = Path(__file__).resolve().parents[1]
SPLITS = {
    "development": (ROOT / "data" / "development" / "claims.jsonl", "Development Suite"),
    "validation": (ROOT / "data" / "validation" / "claims.jsonl", "Validation Suite"),
    "stress": (ROOT / "data" / "stress" / "claims.jsonl", "Stress Test Suite"),
}


def load_claim_file(path):
    """Load normal JSONL plus adjacent pretty-printed JSON objects."""
    text = path.read_text(encoding="utf-8")
    try:
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        claims = []
        position = 0
        while position < len(text):
            while position < len(text) and text[position].isspace():
                position += 1
            if position >= len(text):
                break
            claim, next_position = decoder.raw_decode(text, position)
            claims.append(claim)
            position = next_position
        return claims


def load_dataset(split, limit=None):
    if split not in SPLITS:
        raise ValueError(f"Unknown dataset split: {split}")

    claims_path, name = SPLITS[split]
    claims = load_claim_file(claims_path)
    if limit is not None:
        claims = claims[:limit]

    rules_config = config(ROOT)
    evaluations = {}
    for claim in claims:
        validate_transport(claim)
        evaluations[claim["claim_id"]] = baseline(claim, rules_config)

    return {
        "dataset": split,
        "name": f"{name} ({len(claims)} Claims)",
        "claims": claims,
        "evaluations": evaluations,
    }

MAX_BODY_BYTES = 5 * 1024 * 1024  # reject oversized uploads (data-minimisation / DoS guard)

def sidecar_index(split):
    """turns claim_id to normalized claim, used to restore authorizations FHIR cannot carry."""
    if split not in SPLITS:
        raise ValueError(f"Unknown sidecar split: {split}")
    return {c["claim_id"]: c for c in load_claim_file(SPLITS[split][0])}
 
 
def ingest_fhir(text, sidecar_split=None):
    """Parse Bundles, map to normalized claims, run the deterministic engine.
 
    Malformed input never raises: each rejected bundle is reported with findings.
    """
    bundles, parse_errors = parse_bundles_text(text)
    sidecars = sidecar_index(sidecar_split) if sidecar_split else {}
    rules_config = config(ROOT)
    claims, evaluations, reports, rejected = [], {}, [], []
    for n, bundle in enumerate(bundles):
        try:
            claim, findings = claim_and_findings(bundle, None)
            if claim["claim_id"] in sidecars:
                claim, findings = claim_and_findings(bundle, sidecars[claim["claim_id"]])
            validate_transport(claim)  # same envelope check as every other input
        except FhirError as error:
            rejected.append({"index": n, "reason": "FHIR_INVALID", "findings": error.findings})
            continue
        except (ValueError, KeyError, TypeError) as error:
            rejected.append({"index": n, "reason": "ENVELOPE_INVALID",
                             "findings": [{"severity": "error", "code": "ENVELOPE_INVALID",
                                           "message": str(error), "path": ""}]})
            continue
        claims.append(claim)
        evaluations[claim["claim_id"]] = baseline(claim, rules_config)
        reports.append({"claim_id": claim["claim_id"], "findings": findings})
    for e in parse_errors:
        rejected.append({"index": None, "reason": "PARSE_ERROR", "findings": [
            {"severity": "error", "code": "PARSE_ERROR", "message": f"line {e['line']}: {e['message']}", "path": ""}]})
    return {"claims": claims, "evaluations": evaluations, "fhir_findings": reports, "rejected": rejected}

class ApiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path in ("/", "/api"):
                payload = {
                    "name": "ClaimGuard AI backend API",
                    "status": "ok",
                    "frontend": "http://localhost:3000",
                    "health": "/api/health",
                    "datasets": [
                        "/api/datasets/development",
                        "/api/datasets/validation",
                        "/api/datasets/stress",
                    ],
                }
            elif parsed.path == "/api/health":
                payload = {"status": "ok", "engine": "backend.engine_core"}
            elif parsed.path.startswith("/api/fhir/export/"):
                _, _, _, _, split, claim_id = parsed.path.split("/", 5)
                claim = sidecar_index(split).get(claim_id)

                if claim is None:
                    self.write_json({"error": "Claim not found"}, 404)
                    return

                payload = claim_to_bundle(claim)
            elif parsed.path.startswith("/api/datasets/"):
                split = parsed.path.rsplit("/", 1)[-1]
                limit_value = query.get("limit", [None])[0]
                limit = int(limit_value) if limit_value else None
                payload = load_dataset(split, limit)
            else:
                self.write_json({"error": "Not found"}, 404)
                return
            self.write_json(payload)
        except (ValueError, FileNotFoundError, json.JSONDecodeError) as error:
            self.write_json({"error": str(error)}, 400)
        except Exception as error:
            self.write_json({"error": str(error)}, 500)


    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Body missing or larger than the 5 MB limit")
        return self.rfile.read(length).decode("utf-8")
 
    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            body = self.read_body()
            if parsed.path == "/api/fhir/validate":
                bundles, errors = parse_bundles_text(body)
                payload = {"results": [{"index": i, "findings": check_bundle(b)} for i, b in enumerate(bundles)],
                           "parse_errors": errors}
            elif parsed.path == "/api/fhir/ingest":
                payload = ingest_fhir(body, query.get("sidecar", [None])[0])
            elif parsed.path == "/api/fhir/export":
                claim = json.loads(body)
                validate_transport(claim)
                payload = claim_to_bundle(claim)
            else:
                self.write_json({"error": "Not found"}, 404)
                return
            self.write_json(payload)
        except (ValueError, KeyError, TypeError, FileNotFoundError, json.JSONDecodeError) as error:
            self.write_json({"error": str(error)}, 400)
        except Exception:
            self.write_json({"error": "Internal server error"}, 500)  # no internal details leaked
 

    def write_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        print(f"[api] {format_string % args}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), ApiHandler)
    print(f"ClaimGuard backend API listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
