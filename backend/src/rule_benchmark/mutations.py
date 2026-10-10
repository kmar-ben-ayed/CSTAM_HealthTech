"""Seeded, targeted mutations of dataset claims for differential testing.

Each mutation pushes a claim towards an edge the rules care about: missing or
blank values, boundary dates and amounts, unknown codes, duplicate lines,
duplicate authorization ids, draft documents, and so on. Mutants that the
transport contract would reject are dropped, because rules never see them.
"""

from __future__ import annotations

import copy
import random
from datetime import date, timedelta
from typing import Any, Callable, Iterator

from rule_engine.engine_core import validate_transport

KNOWN_SERVICES = ["SVC-CONSULT", "SVC-LAB", "SVC-IMAGE", "SVC-THERAPY", "SVC-DENTAL", "SVC-PHARM"]


def _shift(value: str | None, days: int) -> str | None:
    if not value:
        return value
    try:
        return (date.fromisoformat(value) + timedelta(days=days)).isoformat()
    except ValueError:
        return value


def _line(claim: dict, rng: random.Random) -> dict:
    return rng.choice(claim["lines"])


def _nullable_line_field(claim, rng):
    line = _line(claim, rng)
    field = rng.choice(["service_code", "service_date", "modifier", "quantity", "unit_price", "net_amount", "authorization_id"])
    line[field] = None


def _blank_claim_field(claim, rng):
    field = rng.choice(["invoice_number", "member_id", "diagnosis_code"])
    claim[field] = rng.choice([None, "", "  "])


def _coverage_field(claim, rng):
    field = rng.choice(["status", "beneficiary_patient_id", "member_id", "start_date", "end_date"])
    claim["coverage"][field] = rng.choice([None, "", "cancelled", "active"]) if field == "status" else None


def _coverage_boundary(claim, rng):
    day = _line(claim, rng)["service_date"]
    if day:
        claim["coverage"]["start_date"] = _shift(day, rng.choice([-1, 0, 1]))
        claim["coverage"]["end_date"] = _shift(day, rng.choice([-1, 0, 1]))


def _identity_mismatch(claim, rng):
    if rng.random() < 0.5:
        claim["coverage"]["member_id"] = "MEM-OTHER"
    else:
        claim["coverage"]["beneficiary_patient_id"] = "PAT-OTHER"


def _service_code(claim, rng):
    _line(claim, rng)["service_code"] = rng.choice(KNOWN_SERVICES + ["SVC-UNKNOWN", ""])


def _service_date(claim, rng):
    line = _line(claim, rng)
    line["service_date"] = _shift(line["service_date"] or claim["submission_date"], rng.choice([-60, -31, -30, -1, 0, 1, 2]))


def _submission_date(claim, rng):
    latest = max((line["service_date"] for line in claim["lines"] if line["service_date"]), default=None)
    if latest:
        claim["submission_date"] = _shift(latest, rng.choice([-1, 0, 1, 29, 30, 31, 45]))


def _amounts(claim, rng):
    line = _line(claim, rng)
    choice = rng.randrange(5)
    if choice == 0:
        line["quantity"] = rng.choice([0, -1, 1.5, 2, 3, 4, 5, 11])
    elif choice == 1:
        line["unit_price"] = rng.choice([0, -5, 0.335, 199.99, 200, 200.01, 350, 350.01, 2200, 2200.01])
    elif choice == 2 and line["net_amount"] is not None:
        line["net_amount"] = round(line["net_amount"] + rng.choice([-0.02, -0.01, 0.01, 0.02, 5]), 2)
    elif choice == 3 and claim["total_amount"] is not None:
        claim["total_amount"] = round(claim["total_amount"] + rng.choice([-0.02, -0.01, 0.01, 0.02]), 2)
    else:
        if line["quantity"] is not None and line["unit_price"] is not None:
            line["net_amount"] = round(line["quantity"] * line["unit_price"], 2)


def _duplicate_line(claim, rng):
    copy_line = copy.deepcopy(_line(claim, rng))
    copy_line["line_id"] = f"L{len(claim['lines']) + 90}"
    if rng.random() < 0.3:
        copy_line["modifier"] = rng.choice(["EDU-SEPARATE", None, ""])
    claim["lines"].append(copy_line)


def _policy_or_provider(claim, rng):
    if rng.random() < 0.5:
        claim["policy_id"] = rng.choice(["EDU-BASIC", "EDU-PLUS", "EDU-NONE"])
    else:
        claim["provider_id"] = rng.choice(["EDU-PROV-01", "EDU-PROV-02", "EDU-PROV-03", "EDU-PROV-99"])


def _currency(claim, rng):
    claim["currency"] = rng.choice(["SAR", "USD", "sar"])


def _authorization(claim, rng):
    line = _line(claim, rng)
    if not claim["authorizations"] or rng.random() < 0.3:
        line["service_code"] = rng.choice(["SVC-IMAGE", "SVC-THERAPY"])
        line["authorization_id"] = rng.choice([None, "AUTH-MISSING", f"AUTH-{claim['claim_id']}-X"])
        if line["authorization_id"] and line["authorization_id"].endswith("-X"):
            claim["authorizations"].append({
                "authorization_id": line["authorization_id"], "patient_id": claim["patient_id"],
                "service_code": line["service_code"], "status": "approved",
                "valid_from": _shift(line["service_date"], -5), "valid_to": _shift(line["service_date"], 5),
                "max_quantity": rng.choice([1, 2, None]),
            })
        return
    auth = rng.choice(claim["authorizations"])
    choice = rng.randrange(6)
    if choice == 0:
        auth["status"] = rng.choice(["denied", "pending", None, ""])
    elif choice == 1:
        auth[rng.choice(["valid_from", "valid_to"])] = rng.choice([None, _shift(auth["valid_to"], 30), _shift(auth["valid_from"], -30)])
    elif choice == 2:
        auth["max_quantity"] = rng.choice([0, 1, None])
    elif choice == 3:
        auth[rng.choice(["patient_id", "service_code"])] = rng.choice([None, "OTHER"])
    elif choice == 4:
        duplicate = copy.deepcopy(auth)
        duplicate["status"] = rng.choice(["denied", "approved"])
        claim["authorizations"].append(duplicate)
    else:
        claim["authorizations"].remove(auth)


def _attachment(claim, rng):
    line = _line(claim, rng)
    if not claim["attachments"] or rng.random() < 0.3:
        line["service_code"] = rng.choice(["SVC-IMAGE", "SVC-DENTAL"])
        if rng.random() < 0.6:
            claim["attachments"].append({
                "attachment_id": f"DOC-{len(claim['attachments']) + 1}",
                "type": {"SVC-IMAGE": "imaging-report", "SVC-DENTAL": "service-note"}[line["service_code"]],
                "patient_id": claim["patient_id"], "service_code": line["service_code"],
                "service_date": line["service_date"], "document_status": rng.choice(["final", "draft"]),
                "text": "synthetic",
            })
        return
    attachment = rng.choice(claim["attachments"])
    choice = rng.randrange(4)
    if choice == 0:
        attachment["document_status"] = rng.choice(["final", "draft", "unknown"])
    elif choice == 1:
        attachment["service_date"] = rng.choice([None, _shift(attachment["service_date"], 1)])
    elif choice == 2:
        attachment["type"] = rng.choice(["service-note", "imaging-report", "other"])
    else:
        claim["attachments"].remove(attachment)


MUTATIONS: list[Callable[[dict, random.Random], None]] = [
    _nullable_line_field, _blank_claim_field, _coverage_field, _coverage_boundary,
    _identity_mismatch, _service_code, _service_date, _submission_date, _amounts,
    _duplicate_line, _policy_or_provider, _currency, _authorization, _attachment,
]


def mutated_claims(claims: list[dict[str, Any]], count: int, seed: int = 7) -> Iterator[dict[str, Any]]:
    """Yield `count` valid mutants, each with 1 to 3 random mutations."""
    rng = random.Random(seed)
    produced = 0
    attempts = 0
    while produced < count and attempts < count * 5:
        attempts += 1
        claim = copy.deepcopy(rng.choice(claims))
        for mutate in rng.sample(MUTATIONS, rng.randint(1, 3)):
            mutate(claim, rng)
        claim["claim_id"] = f"{claim['claim_id']}-M{produced}"
        try:
            validate_transport(claim)
        except (ValueError, KeyError, TypeError):
            continue
        produced += 1
        yield claim
