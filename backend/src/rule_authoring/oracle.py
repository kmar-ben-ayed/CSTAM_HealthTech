"""The oracle: an independent reading of a rule, used to test the drafter's spec.

The oracle sees the English rule, the reference data and test claims, but never
the drafted spec. It predicts the outcome of each claim. Code then compares
these predictions with what the spec actually produces; any disagreement is
put to the rule's author as a concrete question.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any

from rule_engine.catalogue import ReferenceData
from rule_engine.language import OUTCOMES

from .edge_cases import EdgeCase, LabelledCase
from .llm import ChatModel, ModelError
from .prompts import load_prompt

BATCH_SIZE = 3  # small models read a few claims far more reliably than many
MAX_EXAMPLES = 4
REDACTED = "[free text omitted]"
FREE_TEXT_FIELDS = ("/notes", "/attachments/*/text")


@dataclass
class Prediction:
    case_id: str
    status: str
    reason: str


class Oracle:
    def __init__(self, model: ChatModel, reference: ReferenceData, batch_size: int = BATCH_SIZE):
        self.model = model
        self.reference = reference
        self.batch_size = batch_size

    def predict(
        self,
        rule: dict[str, Any],
        cases: list[EdgeCase],
        examples: list[LabelledCase],
        fields_read: set[str],
    ) -> dict[str, Prediction]:
        """Predictions by case id. Cases the model failed to answer are simply absent."""
        predictions: dict[str, Prediction] = {}
        for start in range(0, len(cases), self.batch_size):
            batch = cases[start:start + self.batch_size]
            try:
                reply = self.model.complete_json(self._messages(rule, batch, examples, fields_read))
            except ModelError:
                continue
            predictions.update(_read_predictions(reply, {case.case_id for case in batch}))
        return predictions

    def _messages(self, rule, batch, examples, fields_read) -> list[dict[str, str]]:
        examples = examples[-MAX_EXAMPLES:]
        payload = {
            "rule": {"title": rule["title"], "logic": rule["logic"]},
            "reference_data": self._reference_for([case.claim for case in batch] + [e.claim for e in examples]),
            "confirmed_examples": [
                {"claim": redact(example.claim, fields_read), "status": example.expected_status}
                for example in examples
            ],
            "cases": [{"case_id": case.case_id, "claim": redact(case.claim, fields_read)} for case in batch],
        }
        return [
            {"role": "system", "content": load_prompt("oracle")},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]

    def _reference_for(self, claims: list[dict[str, Any]]) -> dict[str, Any]:
        """Only the reference data these claims refer to, so a small model is not swamped."""
        policy_ids = {claim.get("policy_id") for claim in claims}
        codes = {line.get("service_code") for claim in claims for line in claim.get("lines", [])}
        return {
            "note": "Policies and services are listed only for the policy ids and service codes used in these "
                    "claims. A policy id or service code that is not listed does not exist.",
            "policies": {pid: policy for pid, policy in self.reference.policies.items() if pid in policy_ids},
            "services": {code: entry for code, entry in self.reference.services.items() if code in codes},
            "provider_ids": self.reference.provider_ids,
            "diagnosis_codes": self.reference.diagnosis_codes,
        }


def redact(claim: dict[str, Any], fields_read: set[str]) -> dict[str, Any]:
    """Hide free-text fields the rule does not read: they are the main injection surface."""
    shown = copy.deepcopy(claim)
    if "/notes" not in fields_read and "notes" in shown:
        shown["notes"] = REDACTED
    if "/attachments/*/text" not in fields_read:
        for attachment in shown.get("attachments", []):
            if isinstance(attachment, dict) and "text" in attachment:
                attachment["text"] = REDACTED
    return shown


def _read_predictions(reply: dict[str, Any], expected_ids: set[str]) -> dict[str, Prediction]:
    found: dict[str, Prediction] = {}
    items = reply.get("predictions")
    if not isinstance(items, list):
        return found
    for item in items:
        if not isinstance(item, dict):
            continue
        case_id, status = item.get("case_id"), item.get("status")
        if case_id in expected_ids and status in OUTCOMES and case_id not in found:
            reason = str(item.get("reason", ""))[:300]
            found[case_id] = Prediction(case_id=case_id, status=status, reason=reason)
    return found
