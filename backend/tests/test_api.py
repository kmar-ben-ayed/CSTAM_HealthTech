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
        self.run_path = Path(self.temp_dir.name) / "runs.jsonl"
        self.client = TestClient(create_app(audit_log_path=self.audit_path, run_log_path=self.run_path))
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

    def test_dataset_split_counts_match_manifest_and_label_coverage(self):
        manifest = json.loads((BACKEND_ROOT / "data" / "dataset_manifest.json").read_text(encoding="utf-8"))
        for split, expected_count in (("development", 400), ("validation", 150), ("stress", 52)):
            response = self.client.get(f"/api/v1/datasets/{split}?limit=500")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["claims"]), expected_count)
            self.assertEqual(manifest["splits"][split]["claims"], expected_count)

        stress = manifest["splits"]["stress"]
        self.assertEqual(stress["labeled_claims"], 50)
        self.assertEqual(stress["unlabeled_claims"], 2)
        self.assertEqual(stress["rule_results"], 750)

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

    def test_ingested_claims_are_readable_and_duplicate_upload_is_idempotent(self):
        text = json.dumps(self.claim)
        first = self.client.post("/api/v1/ingest/jsonl", json={"text": text})
        self.assertEqual(first.status_code, 200)
        batch = self.client.get("/api/v1/claims")
        self.assertEqual(batch.status_code, 200)
        self.assertEqual(batch.json()["batch_id"], first.json()["batch_id"])
        claim = self.client.get(f"/api/v1/claims/{self.claim['claim_id']}")
        self.assertEqual(claim.status_code, 200)
        self.assertEqual(claim.json()["claim"]["claim_id"], self.claim["claim_id"])

        second = self.client.post("/api/v1/ingest/jsonl", json={"text": text})
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["batch_id"], first.json()["batch_id"])
        self.assertEqual(self.client.get("/api/v1/audit/events").json()["total_count"], 15)
    def test_csv_ingestion_rejects_claims_file_without_related_pack(self):
        response = self.client.post(
            "/api/v1/ingest/csv",
            json={"files": {"claims.csv": "claim_id\nAPI-TEST-001\n"}},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "invalid_csv_pack")
        self.assertEqual(
            response.json()["error"],
            "Missing CSV files: attachments.csv, authorizations.csv, coverage.csv, lines.csv",
        )

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

    def test_review_opened_event_records_visit_without_claim_data(self):
        response = self.client.post(
            "/api/v1/reviews/opened",
            headers={"X-Actor": "reviewer-1"},
            json={
                "claim_id": "CG-TEST",
                "actor": "ignored-body-actor",
                "visit_id": "visit-1",
                "opened_at": "2026-10-01T12:00:00Z",
            },
        )
        self.assertEqual(response.status_code, 201)
        event = self.client.get("/api/v1/audit/events").json()["events"][0]
        self.assertEqual(event["event_type"], "review_opened")
        self.assertEqual(event["claim_id"], "CG-TEST")
        self.assertEqual(event["actor"], "reviewer-1")
        self.assertEqual(event["payload"]["visit_id"], "visit-1")
        self.assertTrue(self.client.get("/api/v1/audit/verify").json()["valid"])

    def test_audit_event_offset_pagination_has_no_gaps(self):
        for visit_id in ("visit-1", "visit-2", "visit-3"):
            response = self.client.post(
                "/api/v1/reviews/opened",
                json={
                    "claim_id": "CG-TEST",
                    "actor": "reviewer-1",
                    "visit_id": visit_id,
                    "opened_at": "2026-10-01T12:00:00Z",
                },
            )
            self.assertEqual(response.status_code, 201)

        newest = self.client.get("/api/v1/audit/events?limit=2&offset=0").json()
        older = self.client.get("/api/v1/audit/events?limit=2&offset=2").json()
        self.assertEqual(newest["total_count"], 3)
        self.assertEqual([event["index"] for event in newest["events"]], [2, 1])
        self.assertEqual([event["index"] for event in older["events"]], [0])
        self.assertEqual(newest["events"][1]["prev_hash"], older["events"][0]["entry_hash"])

    def test_full_audit_export_includes_chain_and_keeps_reason_hashed(self):
        reason = "private reviewer note"
        self.client.post(
            "/api/v1/reviews",
            json={
                "claim_id": "CG-TEST",
                "rule_id": "R001",
                "action": "confirm_issue",
                "actor": "reviewer-1",
                "reason": reason,
                "created_at": "2026-10-01T12:00:00Z",
                "original_status": "FAIL",
            },
        )

        response = self.client.get("/api/v1/audit/export")
        exported = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(exported["format"], "claimguard-audit-chain-v1")
        self.assertEqual(exported["entry_count"], 1)
        self.assertTrue(exported["integrity"]["valid"])
        self.assertNotIn(reason, json.dumps(exported))
        self.assertIn("reason_hash", exported["entries"][0]["payload"])
        self.assertIn("prev_hash", exported["entries"][0])
        self.assertIn("entry_hash", exported["entries"][0])

    def test_dataset_run_is_persisted_and_correlated_to_rule_events(self):
        response = self.client.post("/api/v1/runs", json={"split": "development"})
        self.assertEqual(response.status_code, 201)
        run = response.json()
        self.assertEqual(run["source"], {"type": "dataset", "split": "development", "synthetic": True})
        self.assertEqual(run["claim_count"], 400)
        self.assertEqual(run["result_count"], 6000)
        self.assertEqual(run["benchmark_skipped_claims"], 0)
        self.assertIsNotNone(run["benchmark"])

        listed = self.client.get("/api/v1/runs").json()
        self.assertEqual(listed["total_count"], 1)
        self.assertEqual(listed["runs"][0]["run_id"], run["run_id"])
        self.assertEqual(self.client.get(f"/api/v1/runs/{run['run_id']}").json(), run)
        recent_audit = self.client.get("/api/v1/audit/events?limit=1").json()["events"][0]
        self.assertEqual(recent_audit["payload"]["run_id"], run["run_id"])

        restarted_client = TestClient(create_app(audit_log_path=self.audit_path, run_log_path=self.run_path))
        with restarted_client:
            self.assertEqual(restarted_client.get("/api/v1/runs").json()["runs"][0]["run_id"], run["run_id"])
            self.assertTrue(restarted_client.get("/api/v1/audit/verify").json()["valid"])

    def test_stress_run_scores_only_available_labels(self):
        response = self.client.post("/api/v1/runs", json={"split": "stress"})
        self.assertEqual(response.status_code, 201)
        run = response.json()
        self.assertEqual(run["claim_count"], 52)
        self.assertEqual(run["result_count"], 780)
        self.assertEqual(run["benchmark_skipped_claims"], 2)
        self.assertEqual(run["benchmark"]["count"], 750)

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
        self.assertEqual(self.client.get("/api/v1/audit/events").status_code, 200)

    def test_rejects_oversized_request(self):
        response = self.client.post("/api/v1/ingest/jsonl", content=b"x" * (5 * 1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()