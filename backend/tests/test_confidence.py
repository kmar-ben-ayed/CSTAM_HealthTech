import json
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from AI_agent.confidence import assess
from api_app.main import create_app
from rule_engine.engine_core import load_jsonl


class ConfidenceAssessmentTests(unittest.TestCase):
    def test_unable_to_assess_has_known_evidence_ratio(self):
        finding = {
            "status": "UNABLE_TO_ASSESS",
            "severity": "high",
            "evidence": [
                {"path": "/a", "value": "x"},
                {"path": "/b", "value": None},
                {"path": "/c", "value": 1},
                {"path": "/d", "value": 2},
            ],
        }
        assessment = assess(finding, {"cited_evidence_paths": ["/a", "/c"]}, "llm")
        self.assertEqual(assessment["evidence_completeness"], 0.75)

    def test_fail_with_null_evidence_keeps_completeness_none(self):
        finding = {
            "status": "FAIL",
            "severity": "high",
            "evidence": [
                {"path": "/a", "value": None},
                {"path": "/b", "value": 2},
            ],
        }
        assessment = assess(finding, {"cited_evidence_paths": ["/a"]}, "llm")
        self.assertIsNone(assessment["evidence_completeness"])

    def test_grounding_is_computed_from_allowed_paths(self):
        finding = {
            "status": "FAIL",
            "severity": "high",
            "evidence": [
                {"path": "/a", "value": "x"},
                {"path": "/b", "value": "y"},
                {"path": "/c", "value": "z"},
                {"path": "/d", "value": "w"},
            ],
        }

        full = assess(finding, {"cited_evidence_paths": ["/a", "/b", "/c", "/d"]}, "llm")
        partial = assess(finding, {"cited_evidence_paths": ["/a"]}, "llm")

        self.assertEqual(full["explanation_grounding"], 1.0)
        self.assertEqual(partial["explanation_grounding"], 0.25)

    def test_fallback_escalates(self):
        finding = {"status": "FAIL", "severity": "medium", "evidence": [{"path": "/a", "value": "x"}]}
        assessment = assess(finding, {"cited_evidence_paths": ["/a"]}, "fallback")
        self.assertIn("ai_explanation_failed", assessment["escalation_reasons"])
        self.assertTrue(assessment["escalate"])

    def test_high_severity_fail_requires_review(self):
        finding = {"status": "FAIL", "severity": "high", "evidence": [{"path": "/a", "value": "x"}]}
        assessment = assess(finding, {"cited_evidence_paths": ["/a"]}, "llm")
        self.assertIn("high_severity", assessment["escalation_reasons"])
        self.assertTrue(assessment["escalate"])

    def test_medium_fail_with_full_grounding_does_not_escalate(self):
        finding = {"status": "FAIL", "severity": "medium", "evidence": [{"path": "/a", "value": "x"}]}
        assessment = assess(finding, {"cited_evidence_paths": ["/a"]}, "llm")
        self.assertFalse(assessment["escalate"])

    def test_pass_is_not_reviewed_and_has_zero_priority(self):
        finding = {"status": "PASS", "severity": "high", "evidence": [{"path": "/a", "value": "x"}]}
        assessment = assess(finding, {"cited_evidence_paths": ["/a"]}, "skipped")
        self.assertEqual(assessment["review_priority"], 0)
        self.assertFalse(assessment["escalate"])

    def test_not_implemented_escalates(self):
        finding = {"status": "NOT_IMPLEMENTED", "severity": "medium", "evidence": []}
        assessment = assess(finding, {"cited_evidence_paths": []}, "llm")
        self.assertIn("not_implemented", assessment["escalation_reasons"])
        self.assertTrue(assessment["escalate"])

    def test_confidence_is_never_probabilistic(self):
        for source in ("llm", "fallback", "skipped"):
            assessment = assess(
                {"status": "FAIL", "severity": "medium", "evidence": [{"path": "/a", "value": "x"}]},
                {"cited_evidence_paths": ["/a"]},
                source,
            )
            self.assertIsNone(assessment["confidence"])
            self.assertEqual(assessment["confidence_kind"], "not_probabilistic")

    def test_explanation_api_includes_assessment_and_audit_stays_valid(self):
        claim = load_jsonl(BACKEND_ROOT / "data" / "development" / "claims.jsonl")[0]
        with tempfile.TemporaryDirectory() as tmpdir:
            audit_path = Path(tmpdir) / "audit.jsonl"
            client = TestClient(create_app(audit_log_path=audit_path))
            with client:
                response = client.post(
                    "/api/v1/explanations",
                    json={"claim": claim, "rule_id": "R001", "provider": "mock"},
                )
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertIn("assessment", payload)
                self.assertIn("explanation", payload)
                self.assertIn("cited_evidence_paths", payload)
                self.assertIn("cited_rule_ids", payload)
                self.assertIn("needs_human_review", payload)
                self.assertIn("recommendation", payload)
                self.assertIn("provider", payload)
                self.assertIn("fallback_used", payload)
                self.assertIn("explanation_source", payload["assessment"])
                self.assertTrue(client.get("/api/v1/audit/verify").json()["valid"])


if __name__ == "__main__":
    unittest.main()
