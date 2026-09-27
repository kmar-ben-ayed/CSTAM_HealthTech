"""Small HTTP wrapper exposing backend claims and deterministic evaluations."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from engine_core import baseline, config, load_jsonl, validate_transport

ROOT = Path(__file__).resolve().parents[1]
SPLITS = {
    "development": (ROOT / "data" / "development" / "claims.jsonl", "Development Suite"),
    "validation": (ROOT / "data" / "validation" / "claims.jsonl", "Validation Suite"),
    "stress": (ROOT / "data" / "stress" / "claims.jsonl", "Stress Test Suite"),
}


def load_dataset(split, limit=None):
    if split not in SPLITS:
        raise ValueError(f"Unknown dataset split: {split}")

    claims_path, name = SPLITS[split]
    claims = load_jsonl(claims_path)
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


class ApiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
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
