import json
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from src.api_app.main import create_app  # noqa: E402
from src.rule_engine.engine_core import load_jsonl  # noqa: E402
from tests.evidence_fixtures import b64, encrypted_pdf, make_pdf  # noqa: E402


class EvidenceApiBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.claims = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.audit_path = Path(self.temp_dir.name) / "audit.jsonl"
        self.client = TestClient(create_app(audit_log_path=self.audit_path, load_models_from_environment=False))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def upload(self, claim_id, data, attachment_id="DOC-1", filename="letter.pdf"):
        return self.client.post(
            f"/api/v1/claims/{claim_id}/documents",
            json={"attachment_id": attachment_id, "filename": filename, "content_base64": b64(data)},
        )


class DocumentUploadTests(EvidenceApiBase):
    def test_valid_pdf_is_listed_and_reupload_is_idempotent(self):
        pdf = make_pdf(["Authorization AUTH-CG-1 approved for PAT-0000000001 on 2026-03-06."])
        first = self.upload("CG-A", pdf)
        self.assertEqual(first.status_code, 201, first.text)
        body = first.json()
        self.assertTrue(body["created"])
        self.assertEqual(body["page_count"], 1)
        self.assertEqual(body["method"], "text")

        again = self.upload("CG-A", pdf)
        self.assertEqual(again.status_code, 201)
        self.assertFalse(again.json()["created"])
        self.assertEqual(again.json()["document_id"], body["document_id"])

        listed = self.client.get("/api/v1/claims/CG-A/documents").json()
        self.assertEqual(len(listed["documents"]), 1)
        self.assertNotIn("AUTH-CG-1", json.dumps(listed))  # metadata only, no text

        events = self.client.get("/api/v1/audit/events").json()["events"]
        added = [e for e in events if e["event_type"] == "evidence_document_added"]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]["payload"]["document_sha256"], body["sha256"])
        self.assertNotIn("letter.pdf", json.dumps(events))

    def test_bad_uploads_are_rejected_with_422(self):
        cases = {
            "not a pdf": b"hello world, definitely not a PDF",
            "encrypted": encrypted_pdf("secret text"),
            "malformed": b"%PDF-1.4\n garbage without objects",
            "too many pages": make_pdf(["page"] * 31),
        }
        for label, data in cases.items():
            with self.subTest(label):
                response = self.upload("CG-A", data)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn(response.json()["code"], {"invalid_document", "document_too_large"})

        bad_b64 = self.client.post(
            "/api/v1/claims/CG-A/documents",
            json={"attachment_id": "DOC-1", "filename": "x.pdf", "content_base64": "%%%not-base64%%%"},
        )
        self.assertEqual(bad_b64.status_code, 422)
        self.assertEqual(bad_b64.json()["code"], "invalid_document")

        oversize = self.upload("CG-A", b"%PDF-1.4\n" + b"0" * (3 * 1024 * 1024 + 1))
        self.assertEqual(oversize.status_code, 422)
        self.assertEqual(oversize.json()["code"], "document_too_large")

        extra = self.client.post(
            "/api/v1/claims/CG-A/documents",
            json={"attachment_id": "DOC-1", "filename": "x.pdf", "content_base64": b64(make_pdf(["x"])), "path": "../x"},
        )
        self.assertEqual(extra.status_code, 422)
        self.assertEqual(self.client.get("/api/v1/claims/CG-A/documents").json()["documents"], [])

    def test_filename_is_metadata_only(self):
        response = self.upload("CG-A", make_pdf(["some text for the store"]), filename="../../etc/passwd\n.pdf")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["filename"], "../../etc/passwd .pdf")
        self.assertFalse((Path(self.temp_dir.name).parent / "etc").exists())

    def test_image_only_pdf_is_accepted_with_a_warning(self):
        response = self.upload("CG-A", make_pdf([""]), attachment_id="DOC-SCAN")
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        if body["method"] == "none":  # no OCR engine installed
            self.assertIn("ocr_unavailable", body["warnings"])

    def test_delete_removes_and_is_audited(self):
        document_id = self.upload("CG-A", make_pdf(["text to remove later"])).json()["document_id"]
        self.assertEqual(self.client.delete(f"/api/v1/claims/CG-B/documents/{document_id}").status_code, 404)
        response = self.client.delete(f"/api/v1/claims/CG-A/documents/{document_id}", headers={"X-Actor": "alice"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/claims/CG-A/documents").json()["documents"], [])
        removed = [e for e in self.client.get("/api/v1/audit/events").json()["events"]
                   if e["event_type"] == "evidence_document_removed"]
        self.assertEqual(removed[0]["actor"], "alice")
        self.assertTrue(self.client.get("/api/v1/audit/verify").json()["valid"])


if __name__ == "__main__":
    unittest.main()
