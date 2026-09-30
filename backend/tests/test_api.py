import json
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from src.api_app.main import create_app
from src.rule_engine.engine_core import load_jsonl


class ApiRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.claim = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")[0]
        cls.bundle = load_jsonl(BACKEND_ROOT / "data" / "development" / "fhir_bundles.jsonl")[0]

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.audit_path = Path(self.temp_dir.name) / "audit.jsonl"
        self.client = TestClient(create_app(audit_log_path=self.audit_path))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def test_health_docs_and_legacy_frontend_routes(self):
        self.assertEqual(self.client.get("/api/v1/health").status_code, 200)
        self.assertEqual(self.client.get("/docs").status_code, 200)
        current = self.client.get("/api/datasets/development?limit=1")
        self.assertEqual(current.status_code, 200)
        self.assertEqual(len(current.json()["claims"]), 1)

    def test_claim_evaluation_records_minimized_audit_events(self):
        response = self.client.post("/api/v1/claims/evaluate", json={"claim": self.claim})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 15)

        events = self.client.get("/api/v1/audit/events").json()
        self.assertEqual(events["total_count"], 15)
        self.assertNotIn("invoice_number", json.dumps(events))
        self.assertNotIn("patient_id", json.dumps(events))

    def test_invalid_claim_returns_structured_422(self):
        response = self.client.post("/api/v1/claims/evaluate", json={"claim": {"claim_id": "bad"}})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "invalid_claim")

    def test_claim_schema_rejects_unrecognized_fields(self):
        claim = {**self.claim, "unrecognized": "value"}
        response = self.client.post("/api/v1/claims/evaluate", json={"claim": claim})
        self.assertEqual(response.status_code, 422)

    def test_batch_evaluation_returns_one_result_per_claim(self):
        response = self.client.post(
            "/api/v1/claims/evaluate/batch",
            json={"claims": [self.claim]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["evaluations"]), 1)
        self.assertEqual(len(response.json()["evaluations"][0]["results"]), 15)

    def test_jsonl_ingestion_accepts_good_record_and_reports_bad_line(self):
        text = "\n".join([json.dumps(self.claim), "{broken"])
        response = self.client.post("/api/v1/ingest/jsonl", json={"text": text})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["claims"]), 1)
        self.assertEqual(response.json()["rejected"][0]["reason"], "PARSE_ERROR")

    def test_csv_pack_ingestion(self):
        csv_dir = BACKEND_ROOT / "data" / "development" / "csv"
        files = {
            f"{name}.csv": (csv_dir / f"{name}.csv").read_text(encoding="utf-8")
            for name in ("claims", "lines", "coverage", "authorizations", "attachments")
        }
        response = self.client.post("/api/v1/ingest/csv", json={"files": files})
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()["claims"]), 0)

    def test_fhir_ingestion_and_export(self):
        response = self.client.post("/api/v1/ingest/fhir", json={"text": json.dumps(self.bundle)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["claims"]), 1)

        exported = self.client.post("/api/v1/fhir/export", json={"claim": self.claim})
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported.json()["resourceType"], "Bundle")

        validated = self.client.post("/api/v1/fhir/validate", json={"bundle": exported.json()})
        self.assertEqual(validated.status_code, 200)
        self.assertEqual(validated.json()["results"][0]["findings"], [])

    def test_fhir_validate_rejects_missing_or_ambiguous_input(self):
        self.assertEqual(self.client.post("/api/v1/fhir/validate", json={}).status_code, 422)
        self.assertEqual(self.client.post(
            "/api/v1/fhir/validate",
            json={"bundle": self.bundle, "text": json.dumps(self.bundle)},
        ).status_code, 422)

    def test_explanation_is_recomputed_and_audited(self):
        response = self.client.post(
            "/api/v1/explanations",
            json={"claim": self.claim, "rule_id": "R001", "provider": "mock"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cited_rule_ids"], ["R001"])
        self.assertEqual(response.json()["provider"], "mock")
        self.assertEqual(self.client.get("/api/v1/audit/events").json()["total_count"], 1)

    def test_explanation_rejects_rule_outside_engine_catalogue(self):
        response = self.client.post(
            "/api/v1/explanations",
            json={"claim": self.claim, "rule_id": "R999", "provider": "mock"},
        )
        self.assertEqual(response.status_code, 422)

    def test_review_reason_is_hashed_not_returned(self):
        review = {
            "claim_id": "CG-TEST",
            "rule_id": "R001",
            "action": "confirm_issue",
            "actor": "reviewer-1",
            "reason": "source record checked",
            "created_at": "2026-09-29T12:00:00Z",
            "original_status": "FAIL",
        }
        response = self.client.post("/api/v1/reviews", json=review)
        self.assertEqual(response.status_code, 201)
        events = self.client.get("/api/v1/audit/events").json()
        self.assertNotIn("source record checked", json.dumps(events))
        self.assertTrue(events["events"][0]["payload"]["reason_recorded"])
        self.assertEqual(self.client.get("/api/v1/audit/verify").json(), {
            "valid": True,
            "first_broken_index": None,
        })

    def test_audit_history_survives_app_restart(self):
        response = self.client.post("/api/v1/claims/evaluate", json={"claim": self.claim})
        self.assertEqual(response.status_code, 200)

        restarted_client = TestClient(create_app(audit_log_path=self.audit_path))
        with restarted_client:
            events = restarted_client.get("/api/v1/audit/events")
            self.assertEqual(events.status_code, 200)
            self.assertEqual(events.json()["total_count"], 15)
            self.assertTrue(restarted_client.get("/api/v1/audit/verify").json()["valid"])

    def test_audit_endpoint_detects_tampered_history(self):
        self.client.post(
            "/api/v1/claims/evaluate",
            json={"claim": self.claim},
        )
        records = self.audit_path.read_text(encoding="utf-8").splitlines()
        record = json.loads(records[0])
        record["payload"]["status"] = "TAMPERED"
        self.audit_path.write_text(json.dumps(record) + "\n" + "\n".join(records[1:]), encoding="utf-8")

        verification = self.client.get("/api/v1/audit/verify")
        self.assertEqual(verification.status_code, 200)
        self.assertFalse(verification.json()["valid"])
        self.assertEqual(verification.json()["first_broken_index"], 0)
        self.assertEqual(self.client.get("/api/v1/audit/events").status_code, 503)

    def test_rejects_oversized_request(self):
        response = self.client.post("/api/v1/ingest/jsonl", content=b"x" * (5 * 1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()