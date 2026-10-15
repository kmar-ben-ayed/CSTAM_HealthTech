"""Generate and load the synthetic evidence-retrieval demo documents.

  python src/load_demo_documents.py              load the committed demo PDFs into outputs/evidence.sqlite3
  python src/load_demo_documents.py --generate   regenerate PDFs + manifest first (needs reportlab)
  python src/load_demo_documents.py --verify     run all six scenarios end to end in an isolated temp app

All documents are fictional. Uploads go through the API, so they are validated and audited.
"""
import argparse
import base64
import json
import sys
import tempfile
from pathlib import Path

import paths  # noqa: F401
from fastapi.testclient import TestClient

from api_app.main import create_app
from evidence_rag.demo_docs import pick_scenarios, render_pdf
from rule_engine.engine_core import config, load_jsonl

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = BACKEND_ROOT / "data" / "demo_documents"
MANIFEST = DEMO_DIR / "manifest.json"
CLAIMS = BACKEND_ROOT / "data" / "development" / "claims.jsonl"
ACTOR = {"X-Actor": "demo-loader"}


def generate() -> dict:
    scenarios = pick_scenarios(load_jsonl(CLAIMS), config(BACKEND_ROOT))
    entries = []
    for number, scenario in enumerate(scenarios, start=1):
        filename = f"{number:02d}_{scenario.key}.pdf"
        render_pdf(scenario, DEMO_DIR / filename)
        entries.append({
            "scenario": number,
            "key": scenario.key,
            "title": scenario.title,
            "claim_id": scenario.claim["claim_id"],
            "rule_id": scenario.rule_id,
            "attachment_id": scenario.attachment_id,
            "file": filename,
            "display_filename": scenario.filename,
            "expect_advisory": scenario.expect_advisory,
            "expect_status_hint": scenario.expect_status_hint,
            "expect_warning": scenario.expect_warning,
            "story": scenario.story,
        })
    manifest = {
        "notice": "All demo documents are synthetic and fictional. No real patient information.",
        "source_split": "development",
        "scenarios": entries,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(entries)} demo PDFs in {DEMO_DIR}")
    return manifest


def load_manifest(regenerate: bool) -> dict:
    if regenerate or not MANIFEST.exists():
        return generate()
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def upload(client: TestClient, entry: dict) -> dict:
    data = (DEMO_DIR / entry["file"]).read_bytes()
    response = client.post(
        f"/api/v1/claims/{entry['claim_id']}/documents",
        json={"attachment_id": entry["attachment_id"], "filename": entry["display_filename"],
              "content_base64": base64.b64encode(data).decode("ascii")},
        headers=ACTOR,
    )
    if response.status_code != 201:
        raise SystemExit(f"Upload failed for {entry['file']}: {response.status_code} {response.text}")
    return response.json()


def verify(manifest: dict) -> bool:
    claims = {claim["claim_id"]: claim for claim in load_jsonl(CLAIMS)}
    ok = True
    with tempfile.TemporaryDirectory() as temp:
        app = create_app(audit_log_path=Path(temp) / "audit.jsonl", load_models_from_environment=False)
        with TestClient(app) as client:
            def results(claim_id):
                body = client.post("/api/v1/claims/evaluate", json={"claim": claims[claim_id]}).json()
                return json.dumps(body["results"], sort_keys=True)

            for entry in manifest["scenarios"]:
                claim = claims[entry["claim_id"]]
                before = results(entry["claim_id"])
                document = upload(client, entry)
                body = client.post("/api/v1/claims/evidence", json={"claim": claim, "rule_id": entry["rule_id"]},
                                   headers=ACTOR).json()
                after = results(entry["claim_id"])
                problems = [f"missing advisory {flag}" for flag in entry["expect_advisory"] if flag not in body["advisory"]]
                hints = {p["signals"]["status_hint"] for p in body["passages"] if p["source"] == "pdf"}
                if entry.get("expect_status_hint") and entry["expect_status_hint"] not in hints:
                    problems.append(f"status hint {entry['expect_status_hint']} not found (got {sorted(map(str, hints))})")
                if entry.get("expect_warning") and entry["expect_warning"] not in document["warnings"] \
                        and document["method"] == "none":
                    problems.append(f"missing warning {entry['expect_warning']}")
                if before != after:
                    problems.append("rule results changed")
                ok = ok and not problems
                print(f"{'PASS' if not problems else 'FAIL'}  {entry['scenario']}. {entry['title']:<44} "
                      f"{entry['claim_id']} {entry['rule_id']} {body['finding_status']:<17} "
                      f"advisory={body['advisory']} method={document['method']} warnings={document['warnings']}")
                for problem in problems:
                    print(f"      - {problem}")
            valid = client.get("/api/v1/audit/verify").json()["valid"]
            print(f"Audit chain valid: {valid}")
            ok = ok and valid
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--generate", action="store_true", help="regenerate the PDFs and manifest (needs reportlab)")
    parser.add_argument("--verify", action="store_true", help="check every scenario in an isolated temporary app")
    args = parser.parse_args()
    manifest = load_manifest(args.generate)
    if args.verify:
        sys.exit(0 if verify(manifest) else 1)
    app = create_app(load_models_from_environment=False)
    with TestClient(app) as client:
        for entry in manifest["scenarios"]:
            document = upload(client, entry)
            state = "added" if document["created"] else "already present"
            print(f"{entry['scenario']}. {entry['title']}: {entry['claim_id']} / {entry['attachment_id']} ({state})")
    print("Demo documents loaded. Open a listed claim, select the rule's finding and see Supporting passages.")


if __name__ == "__main__":
    main()
