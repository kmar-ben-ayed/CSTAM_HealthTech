import json
import shutil
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
        cls.rule_count = len(json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8")))

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
        self.assertEqual(len(response.json()["results"]), self.rule_count)

        events = self.client.get("/api/v1/audit/events").json()
        self.assertEqual(events["total_count"], self.rule_count)
        self.assertNotIn("invoice_number", json.dumps(events))
        self.assertNotIn("patient_id", json.dumps(events))

    def test_deleted_rule_is_removed_from_live_claim_evaluation(self):
        isolated_root = Path(self.temp_dir.name) / "backend"
        shutil.copytree(BACKEND_ROOT / "rules", isolated_root / "rules")
        shutil.copytree(BACKEND_ROOT / "schemas", isolated_root / "schemas")
        isolated_audit_path = isolated_root / "audit.jsonl"
        original_rules = json.loads(
            (isolated_root / "rules" / "rules.json").read_text(encoding="utf-8")
        )
        original_rules = [
            rule for rule in original_rules if rule["rule_id"] != "R016"
        ]
        deleted_rule = {
            "rule_id": "R016",
            "title": "Temporary rule",
            "severity": "medium",
            "logic": "If provider is EDU-PROV-02 pass, missing and other prov is fail",
            "corrective_action": "Reject the claim.",
            "version": "1.0.0",
            "source": "fictional-rulebook/R016@1.0.0",
        }
        with TestClient(
            create_app(backend_root=isolated_root, audit_log_path=isolated_audit_path)
        ) as client:
            self.assertEqual(
                client.post(
                    "/api/v1/config/rules.json",
                    json=original_rules + [deleted_rule],
                ).status_code,
                200,
            )
            with_rule = client.post(
                "/api/v1/claims/evaluate",
                json={"claim": self.claim},
            ).json()["results"]
            self.assertIn("R016", [result["rule_id"] for result in with_rule])

            self.assertEqual(
                client.post(
                    "/api/v1/config/rules.json",
                    json=original_rules,
                ).status_code,
                200,
            )
            without_rule = client.post(
                "/api/v1/claims/evaluate",
                json={"claim": self.claim},
            ).json()["results"]
            self.assertNotIn("R016", [result["rule_id"] for result in without_rule])

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
        self.assertEqual(
            len(response.json()["evaluations"][0]["results"]),
            self.rule_count,
        )

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
        self.assertEqual(
            self.client.get("/api/v1/audit/events").json()["total_count"],
            self.rule_count,
        )

    def test_distinct_uploads_accumulate_in_ingested_claims(self):
        second_claim = json.loads(json.dumps(self.claim))
        second_claim["claim_id"] = "CG-SECOND-UPLOAD"
        second_claim["invoice_number"] = "INV-SECOND-UPLOAD"

        first = self.client.post("/api/v1/ingest/jsonl", json={"text": json.dumps(self.claim)})
        second = self.client.post("/api/v1/ingest/jsonl", json={"text": json.dumps(second_claim)})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        accumulated = self.client.get("/api/v1/claims").json()
        self.assertEqual(
            {claim["claim_id"] for claim in accumulated["claims"]},
            {self.claim["claim_id"], second_claim["claim_id"]},
        )
        self.assertEqual(
            self.client.get(f"/api/v1/claims/{second_claim['claim_id']}").json()["claim"]["claim_id"],
            second_claim["claim_id"],
        )

    def test_ingested_claims_endpoint_accepts_limits_above_500(self):
        response = self.client.get("/api/v1/claims?limit=501")
        self.assertEqual(response.status_code, 404)

        self.client.post("/api/v1/ingest/jsonl", json={"text": json.dumps(self.claim)})
        response = self.client.get("/api/v1/claims?limit=501")
        self.assertEqual(response.status_code, 200)

    def test_ingested_claims_survive_app_restart(self):
        text = json.dumps(self.claim)
        first = self.client.post("/api/v1/ingest/jsonl", json={"text": text})
        self.assertEqual(first.status_code, 200)
        self.client.__exit__(None, None, None)

        restarted_client = TestClient(create_app(audit_log_path=self.audit_path))
        with restarted_client:
            response = restarted_client.get("/api/v1/claims")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["claims"][0]["claim_id"], self.claim["claim_id"])

    def test_ingestion_runs_report_real_batches(self):
        response = self.client.post("/api/v1/ingest/jsonl", json={"text": json.dumps(self.claim)})
        self.assertEqual(response.status_code, 200)
        runs = self.client.get("/api/v1/runs")
        self.assertEqual(runs.status_code, 200)
        self.assertEqual(runs.json()["runs"][0]["run_id"], response.json()["batch_id"])
        self.assertEqual(runs.json()["runs"][0]["source"], "JSONL")
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

    def test_audit_history_survives_app_restart(self):
        response = self.client.post("/api/v1/claims/evaluate", json={"claim": self.claim})
        self.assertEqual(response.status_code, 200)

        restarted_client = TestClient(create_app(audit_log_path=self.audit_path))
        with restarted_client:
            events = restarted_client.get("/api/v1/audit/events")
            self.assertEqual(events.status_code, 200)
            self.assertEqual(
                events.json()["total_count"],
                self.rule_count,
            )
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