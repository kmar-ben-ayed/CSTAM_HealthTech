"""Evidence retrieval must not depend on this dataset's rules or id formats.

These tests use rules that do not exist, id formats that never appear in the
data, claims with no attachments, and a scan of the retrieval source itself.
"""
import json
import re
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

import paths  # noqa: E402,F401
from evidence_rag.models import Passage  # noqa: E402
from evidence_rag.query import derive_query  # noqa: E402
from evidence_rag.retrieve import LexicalRetriever  # noqa: E402
from evidence_rag.signals import patient_match  # noqa: E402
# The same module the app uses: its rules config is only valid for this copy of the engine.
from rule_engine.engine_core import baseline  # noqa: E402
from tests.evidence_fixtures import make_pdf  # noqa: E402
from tests.test_evidence_rag import EvidenceApiBase  # noqa: E402

EVIDENCE_SRC = BACKEND_ROOT / "src" / "evidence_rag"
# demo_docs.py builds the demo on purpose from named rules; it is not on the retrieval path.
DEMO_ONLY = {"demo_docs.py"}
DATASET_SPECIFIC = re.compile(r"\bR0\d\d\b|\b(?:PAT|AUTH|CG|SVC|EDU|DOC|MEM|INV|DX|COV)-")


def passage(text: str, attachment_id: str = "DOC") -> Passage:
    return Passage("p", "d", attachment_id, "f.pdf", 1, 0, len(text), text)


class SourceHasNoDatasetSpecificsTests(unittest.TestCase):
    def test_retrieval_code_names_no_rule_ids_or_dataset_id_prefixes(self):
        offenders = []
        for path in sorted(EVIDENCE_SRC.glob("*.py")):
            if path.name in DEMO_ONLY:
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if DATASET_SPECIFIC.search(line):
                    offenders.append(f"{path.name}:{number}: {line.strip()}")
        self.assertEqual(offenders, [])


class UnseenRuleAndFormatTests(unittest.TestCase):
    def claim(self):
        return {
            "claim_id": "CLM.2031.0007", "patient_id": "PT/99-ALPHA", "member_id": "88812345",
            "invoice_number": "ZZ-INV-777", "provider_id": "clinic_north",
            "lines": [{"line_id": "A", "service_code": "xray chest 2v", "service_date": "2031-01-15",
                       "authorization_id": "PA-5550001"}],
            "attachments": [],
        }

    def finding(self):
        # A rule written after release, with evidence fields the engine has never produced.
        return {
            "rule_id": "R099", "status": "FAIL", "affected_line_ids": ["A"],
            "evidence": [
                {"path": "/lines/0/modifier", "value": "bilateral"},
                {"path": "/referral_number", "value": "QX 12 ZZ"},
                {"path": "/flags", "value": {"urgent": True, "clinic_code": "N7"}},
                {"path": "/related_rule", "value": "R042"},
            ],
        }

    def test_identifiers_come_from_field_names_not_formats(self):
        terms = derive_query(self.finding(), self.claim(), {"title": "Referral letter on file"})
        for expected in ("PT/99-ALPHA", "88812345", "ZZ-INV-777", "clinic_north", "PA-5550001",
                         "xray chest 2v", "QX 12 ZZ"):
            self.assertIn(expected, terms.identifiers)
        self.assertIn("2031-01-15", terms.dates)
        self.assertIn("bilateral", terms.words)
        everything = [t for bucket in terms.as_dict().values() for t in bucket]
        self.assertFalse([t for t in everything if re.fullmatch(r"R\d{3,}", t)], everything)

    def test_unseen_formats_are_retrieved_verbatim(self):
        terms = derive_query(self.finding(), self.claim(), None)
        passages = [
            passage("Referral QX 12 ZZ: PA-5550001 approved for xray chest 2v on 2031-01-15."),
            passage("Diet advice and a gentle walking plan."),
        ]
        ranked = LexicalRetriever().rank(terms, passages)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(set(ranked[0].matched["identifiers"]), {"QX 12 ZZ", "PA-5550001", "xray chest 2v"})


class PatientMatchWithoutFixedFormatTests(unittest.TestCase):
    def check(self, claim_patient, text, expected, attachments=()):
        claim = {"patient_id": claim_patient, "attachments": list(attachments)}
        self.assertEqual(patient_match(passage(text), claim), expected, text)

    def test_prefixed_ids_of_any_style(self):
        self.check("PT/99-ALPHA", "Referral for PT/99-ALPHA approved.", "match")
        self.check("PT/99-ALPHA", "Referral for PT/12-BRAVO approved.", "mismatch")
        self.check("PT/99-ALPHA", "Patient: X-4471 seen today.", "mismatch")
        self.check("PT/99-ALPHA", "Patient reports 3 visits a week.", "unknown")

    def test_plain_numeric_ids(self):
        self.check("88812345", "Patient ID: 88812345, follow up booked.", "match")
        self.check("88812345", "Patient ID: 77712345, follow up booked.", "mismatch")
        self.check("88812345", "Invoice total 4500 for 2 sessions.", "unknown")

    def test_falls_back_to_linked_attachment_metadata(self):
        linked = [{"attachment_id": "DOC", "patient_id": "someone-else"}]
        self.check("88812345", "Imaging report, no identifiers here.", "mismatch", linked)


class ClaimsWithoutAttachmentsTests(EvidenceApiBase):
    def test_every_actionable_finding_without_documents_is_clean(self):
        rules_config = self.client.app.state.claim_service.rules_config
        searched = 0
        for claim in self.claims:
            if claim.get("attachments"):
                continue
            for finding in baseline(claim, rules_config):
                if finding["status"] not in ("FAIL", "UNABLE_TO_ASSESS"):
                    continue
                response = self.client.post(
                    "/api/v1/claims/evidence", json={"claim": claim, "rule_id": finding["rule_id"]}
                )
                self.assertEqual(response.status_code, 200, (claim["claim_id"], finding["rule_id"], response.text))
                body = response.json()
                self.assertEqual(body["passages"], [])
                self.assertEqual(body["advisory"], ["no_supporting_evidence"])
                self.assertEqual(body["documents_searched"], 0)
                searched += 1
        self.assertGreater(searched, 50)
        self.assertTrue(self.client.get("/api/v1/audit/verify").json()["valid"])


class RenamedClaimEndToEndTests(EvidenceApiBase):
    """A real development claim with every id rewritten into formats the dataset never uses."""

    SOURCE_CLAIM = "CG-D11E0A7ED473"

    def renamed_claim(self):
        claim = next(c for c in self.claims if c["claim_id"] == self.SOURCE_CLAIM)
        old_auth = claim["lines"][0]["authorization_id"]
        text = json.dumps(claim)
        for old, new in ((claim["patient_id"], "PT/99-ALPHA"), (old_auth, "PA-5550001"),
                         (claim["claim_id"], "CLM.2031.0007")):
            text = text.replace(old, new)
        return json.loads(text)

    def test_retrieval_and_signals_work_on_unseen_formats(self):
        claim = self.renamed_claim()
        finding = next(f for f in baseline(claim, self.client.app.state.claim_service.rules_config)
                       if f["rule_id"] == "R009")
        self.assertIn(finding["status"], ("FAIL", "UNABLE_TO_ASSESS"))
        date = claim["lines"][0]["service_date"]
        good = make_pdf([f"Payer letter\nPatient: PT/99-ALPHA\nReferral PA-5550001 APPROVED for service on {date}."])
        wrong = make_pdf(["Payer letter\nPatient: PT/12-BRAVO\nReferral PA-5550001 APPROVED."])
        self.assertEqual(self.upload(claim["claim_id"], good, attachment_id="LTR.1").status_code, 201)

        body = self.client.post("/api/v1/claims/evidence", json={"claim": claim, "rule_id": "R009"}).json()
        top = body["passages"][0]
        self.assertEqual(top["attachment_id"], "LTR.1")
        self.assertIn("PA-5550001", top["signals"]["identifier_found"])
        self.assertEqual(top["signals"]["patient_match"], "match")
        self.assertEqual(top["signals"]["status_hint"], "approved")
        self.assertIn("possible_resolution", body["advisory"])

        self.upload(claim["claim_id"], wrong, attachment_id="LTR.2")
        body = self.client.post("/api/v1/claims/evidence", json={"claim": claim, "rule_id": "R009"}).json()
        wrong_passage = next(p for p in body["passages"] if p["attachment_id"] == "LTR.2")
        self.assertEqual(wrong_passage["signals"]["patient_match"], "mismatch")
        self.assertIn("contradicting_evidence", body["advisory"])


if __name__ == "__main__":
    unittest.main()
