"""This is the FHIR R4 adapter.

Three responsibilities:
  1. claim_to_bundle : turns normalized claim  to FHIR R4 collection Bundle
  2. bundle_to_claim : turns FHIR R4 Bundle to normalized claim envelope (reverse adapter)
  3. check_bundle    : structural FHIR checks that NEVER raise; they return findings

 The rules:
  1. Nothing is invented. A field absent from FHIR becomes None (the rule engine then
    reports UNABLE_TO_ASSESS or FAIL) instead of receiving a made-up default.
  2. FHIR is lossy for this pack (authorization details, notes). bundle_to_claim can
    merge an optional "sidecar" (the normalized claim) to restore those fields.
  3. Attachment text is decoded for viewing only and is never executed or trusted.
"""
import base64
import binascii
import copy
import json
from datetime import date

BASE = "https://claimguard.example/fhir"
CODES = "https://claimguard.example/codes"
IDS = "https://claimguard.example/ids"
EXT_LINE_AUTH = "https://claimguard.example/StructureDefinition/line-authorization-id"
EXT_AUTH_DETAILS = "https://claimguard.example/StructureDefinition/authorization-details"
SYS_SERVICE = f"{CODES}/services"
SYS_MODIFIER = f"{CODES}/modifiers"
SYS_DIAGNOSIS = f"{CODES}/diagnoses"
SYS_DOCTYPE = f"{CODES}/document-types"
SYS_SUPPORTING = f"{CODES}/supporting-info"

# Pack status -> FHIR DocumentReference.docStatus (value set: preliminary|final|amended|entered-in-error)
DOC_STATUS_TO_FHIR = {"draft": "preliminary", "final": "final", "amended": "amended"}
DOC_STATUS_FROM_FHIR = {v: k for k, v in DOC_STATUS_TO_FHIR.items()}

MAX_ATTACHMENT_BYTES = 200_000  # data-minimisation / abuse guard for base64 payloads


class FhirError(ValueError):
    """Raised by bundle_to_claim when a bundle cannot be mapped at all."""

    def __init__(self, findings):
        self.findings = findings
        super().__init__("; ".join(f["message"] for f in findings if f["severity"] == "error"))


# helpers
def _ref(kind, rid):
    return {"reference": f"{BASE}/{kind}/{rid}"}


def _coding(system, code):
    return {"coding": [{"system": system, "code": code}]}


def _money(value, currency):
    return {"value": value, "currency": currency}


def _valid_date(v):
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        return None


def _finding(severity, code, message, path=""):
    return {"severity": severity, "code": code, "message": message, "path": path}


def _ref_id(reference):
    """' anything like https://x/fhir/Patient/P1' or 'Patient/P1' turns to ('Patient', 'P1')."""
    if not isinstance(reference, str) or "/" not in reference:
        return None, None
    parts = reference.rstrip("/").split("/")
    return parts[-2], parts[-1]


#  exporting
def claim_to_bundle(claim):
    """turns normalized claim to FHIR R4 collection Bundle."""
    cur = claim.get("currency")
    patient_id = claim["patient_id"]
    cov = claim.get("coverage") or {}
    claim_id = claim["claim_id"]
    cov_id = cov.get("coverage_id") or f"COV-{claim_id}"

    patient = {"resourceType": "Patient", "id": patient_id, "active": True}
    if claim.get("member_id"):
        patient["identifier"] = [{"system": f"{IDS}/member", "value": claim["member_id"]}]

    provider = {"resourceType": "Organization", "id": claim["provider_id"],
                "name": f"Synthetic provider {claim['provider_id']}"}
    payer = {"resourceType": "Organization", "id": claim["payer_id"],
             "name": "Fictional Education Payer"}

    coverage = {
        "resourceType": "Coverage", "id": cov_id, "status": cov.get("status"),
        "beneficiary": _ref("Patient", cov.get("beneficiary_patient_id") or patient_id),
        "payor": [_ref("Organization", claim["payer_id"])],
        "class": [{"type": _coding("http://terminology.hl7.org/CodeSystem/coverage-class", "plan"),
                   "value": claim["policy_id"]}],
    }
    if cov.get("member_id"):
        coverage["subscriberId"] = cov["member_id"]
    period = {k: v for k, v in (("start", cov.get("start_date")), ("end", cov.get("end_date"))) if v}
    if period:
        coverage["period"] = period
    if coverage["status"] is None:
        del coverage["status"]

    items = []
    for i, line in enumerate(claim["lines"]):
        item = {"sequence": i + 1}
        if line.get("service_code"):
            item["productOrService"] = _coding(SYS_SERVICE, line["service_code"])
        if line.get("service_date"):
            item["servicedDate"] = line["service_date"]
        if line.get("modifier"):
            item["modifier"] = [_coding(SYS_MODIFIER, line["modifier"])]
        if line.get("quantity") is not None:
            item["quantity"] = {"value": line["quantity"]}
        if line.get("unit_price") is not None:
            item["unitPrice"] = _money(line["unit_price"], cur)
        if line.get("net_amount") is not None:
            item["net"] = _money(line["net_amount"], cur)
        if line.get("authorization_id"):
            item["extension"] = [{"url": EXT_LINE_AUTH, "valueString": line["authorization_id"]}]
        items.append(item)

    insurance = {"sequence": 1, "focal": True, "coverage": _ref("Coverage", cov_id)}
    pre_auth = list(dict.fromkeys(a["authorization_id"] for a in claim.get("authorizations", [])
                                  if a.get("authorization_id")))
    if pre_auth:
        insurance["preAuthRef"] = pre_auth

    fhir_claim = {
        "resourceType": "Claim", "id": claim_id, "status": "active",
        "type": _coding("http://terminology.hl7.org/CodeSystem/claim-type", "professional"),
        "use": "claim", "patient": _ref("Patient", patient_id),
        "created": claim["submission_date"], "provider": _ref("Organization", claim["provider_id"]),
        "insurer": _ref("Organization", claim["payer_id"]),
        "priority": _coding("http://terminology.hl7.org/CodeSystem/processpriority", "normal"),
        "insurance": [insurance], "item": items,
        "total": _money(claim.get("total_amount"), cur),
    }
    if claim.get("invoice_number"):
        fhir_claim["identifier"] = [{"system": f"{IDS}/invoice", "value": claim["invoice_number"]}]
    if claim.get("diagnosis_code"):
        fhir_claim["diagnosis"] = [{"sequence": 1, "diagnosisCodeableConcept":
                                    _coding(SYS_DIAGNOSIS, claim["diagnosis_code"])}]
    if claim.get("authorizations"):
        fhir_claim.setdefault("extension", []).append({
            "url": EXT_AUTH_DETAILS,
            "valueString": json.dumps(claim["authorizations"], sort_keys=True, separators=(",", ":")),
        })

    docs = []
    for a in claim.get("attachments", []):
        text = a.get("text") or ""
        doc = {
            "resourceType": "DocumentReference", "id": a["attachment_id"], "status": "current",
            "type": _coding(SYS_DOCTYPE, a.get("type")),
            "subject": _ref("Patient", a.get("patient_id")),
            "description": f"Synthetic {a.get('service_code')}",
            "content": [{"attachment": {
                "contentType": "text/plain",
                "data": base64.b64encode(text.encode("utf-8")).decode("ascii"),
                "title": "Fictional supporting record"}}],
            "context": {"period": {"start": a.get("service_date"), "end": a.get("service_date")}},
        }
        if a.get("document_status"):
            doc["docStatus"] = DOC_STATUS_TO_FHIR.get(a["document_status"], a["document_status"])
        docs.append(doc)
    if docs:
        fhir_claim["supportingInfo"] = [
            {"sequence": n + 1,
             "category": _coding(SYS_SUPPORTING, "attachment"),
             "valueReference": _ref("DocumentReference", d["id"])}
            for n, d in enumerate(docs)]

    resources = [patient, provider, payer, coverage, fhir_claim] + docs
    return {
        "resourceType": "Bundle", "id": f"B-{claim_id}", "type": "collection",
        "entry": [{"fullUrl": f"{BASE}/{r['resourceType']}/{r['id']}", "resource": r} for r in resources],
    }


# validation
def check_bundle(bundle):
    """Return a list of findings (severity error/warning)."""
    f = []
    if not isinstance(bundle, dict):
        return [_finding("error", "FHIR_NOT_OBJECT", "Payload must be a JSON object.")]
    if bundle.get("resourceType") != "Bundle":
        return [_finding("error", "FHIR_NOT_BUNDLE",
                         f"resourceType must be 'Bundle', got {bundle.get('resourceType')!r}.", "/resourceType")]
    entries = bundle.get("entry")
    if not isinstance(entries, list) or not entries:
        return [_finding("error", "FHIR_NO_ENTRIES", "Bundle.entry must be a non-empty array.", "/entry")]

    index, claims = {}, []
    for i, e in enumerate(entries):
        res = e.get("resource") if isinstance(e, dict) else None
        if not isinstance(res, dict) or not isinstance(res.get("resourceType"), str):
            f.append(_finding("error", "FHIR_BAD_ENTRY", "Entry has no valid resource.", f"/entry/{i}"))
            continue
        rt, rid = res["resourceType"], res.get("id")
        if not rid:
            f.append(_finding("warning", "FHIR_NO_ID", f"{rt} has no id.", f"/entry/{i}/resource/id"))
        index[(rt, rid)] = res
        if e.get("fullUrl"):
            index[("url", e["fullUrl"])] = res
        if rt == "Claim":
            claims.append((i, res))

    if len(claims) != 1:
        f.append(_finding("error", "FHIR_CLAIM_COUNT",
                          f"Exactly one Claim is required, found {len(claims)}.", "/entry"))
        return f
    i, c = claims[0]
    base = f"/entry/{i}/resource"

    def resolve(reference, expected):
        kind, rid = _ref_id(reference)
        res = index.get(("url", reference)) or index.get((kind, rid))
        return res if res is not None and res["resourceType"] == expected else None

    for field, kind in (("patient", "Patient"), ("provider", "Organization"), ("insurer", "Organization")):
        ref = (c.get(field) or {}).get("reference")
        if not ref:
            f.append(_finding("error" if field == "patient" else "warning", "FHIR_MISSING_REF",
                              f"Claim.{field} reference is missing.", f"{base}/{field}"))
        elif resolve(ref, kind) is None:
            f.append(_finding("warning", "FHIR_UNRESOLVED_REF",
                              f"Claim.{field} -> {ref} does not resolve to a {kind} in the bundle.",
                              f"{base}/{field}/reference"))

    ins = c.get("insurance")
    if not isinstance(ins, list) or not ins:
        f.append(_finding("warning", "FHIR_NO_INSURANCE", "Claim.insurance is missing.", f"{base}/insurance"))
    else:
        ref = ((ins[0] or {}).get("coverage") or {}).get("reference")
        cov = resolve(ref, "Coverage") if ref else None
        if cov is None:
            f.append(_finding("warning", "FHIR_UNRESOLVED_REF",
                              "Claim.insurance[0].coverage does not resolve to a Coverage.",
                              f"{base}/insurance/0/coverage"))
        else:
            b = (cov.get("beneficiary") or {}).get("reference")
            if b and resolve(b, "Patient") is None:
                f.append(_finding("warning", "FHIR_UNRESOLVED_REF",
                                  "Coverage.beneficiary does not resolve to a Patient.", "/Coverage/beneficiary"))

    if not _valid_date(c.get("created")):
        f.append(_finding("warning", "FHIR_BAD_DATE", "Claim.created is missing or not YYYY-MM-DD.",
                          f"{base}/created"))
    items = c.get("item")
    if not isinstance(items, list) or not items:
        f.append(_finding("error", "FHIR_NO_ITEMS", "Claim.item must be a non-empty array.", f"{base}/item"))
        items = []
    for n, it in enumerate(items):
        if not isinstance(it, dict):
            f.append(_finding("error", "FHIR_BAD_ITEM", "Claim.item entry must be an object.", f"{base}/item/{n}"))
            continue
        sd = it.get("servicedDate")
        if sd is not None and not _valid_date(sd):
            f.append(_finding("warning", "FHIR_BAD_DATE", f"item[{n}].servicedDate is not YYYY-MM-DD.",
                              f"{base}/item/{n}/servicedDate"))
        for k in ("quantity", "unitPrice", "net"):
            v = (it.get(k) or {}).get("value") if isinstance(it.get(k), dict) else None
            if k in it and (isinstance(v, bool) or not isinstance(v, (int, float))):
                f.append(_finding("warning", "FHIR_BAD_NUMBER", f"item[{n}].{k}.value is not numeric.",
                                  f"{base}/item/{n}/{k}/value"))

    for n, si in enumerate(c.get("supportingInfo") or []):
        ref = ((si or {}).get("valueReference") or {}).get("reference")
        doc = resolve(ref, "DocumentReference") if ref else None
        if doc is None:
            f.append(_finding("warning", "FHIR_UNRESOLVED_REF",
                              f"supportingInfo[{n}] does not resolve to a DocumentReference.",
                              f"{base}/supportingInfo/{n}"))
            continue
        subj = ((doc.get("subject") or {}).get("reference"))
        if subj and _ref_id(subj)[1] != _ref_id((c.get("patient") or {}).get("reference"))[1]:
            f.append(_finding("warning", "FHIR_DOC_PATIENT_MISMATCH",
                              f"DocumentReference {doc.get('id')} belongs to a different patient than the Claim.",
                              f"/DocumentReference/{doc.get('id')}/subject"))
        for cont in doc.get("content") or []:
            data = ((cont or {}).get("attachment") or {}).get("data")
            if data is not None:
                try:
                    if len(data) > MAX_ATTACHMENT_BYTES * 4 // 3 + 4:
                        f.append(_finding("warning", "FHIR_ATTACHMENT_TOO_LARGE",
                                          f"Attachment of {doc.get('id')} exceeds the size limit; text ignored.",
                                          f"/DocumentReference/{doc.get('id')}/content"))
                    else:
                        base64.b64decode(data, validate=True)
                except (binascii.Error, ValueError, TypeError):
                    f.append(_finding("warning", "FHIR_BAD_BASE64",
                                      f"Attachment of {doc.get('id')} is not valid base64.",
                                      f"/DocumentReference/{doc.get('id')}/content"))
    return f


# importing
def _decode_text(doc):
    for cont in doc.get("content") or []:
        data = ((cont or {}).get("attachment") or {}).get("data")
        if not isinstance(data, str) or len(data) > MAX_ATTACHMENT_BYTES * 4 // 3 + 4:
            continue
        try:
            return base64.b64decode(data, validate=True).decode("utf-8")
        except (binascii.Error, ValueError, UnicodeDecodeError):
            return None
    return None


def _first_code(cc):
    try:
        return cc["coding"][0]["code"]
    except (KeyError, IndexError, TypeError):
        return None


def _num(block):
    v = block.get("value") if isinstance(block, dict) else None
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def bundle_to_claim(bundle, sidecar=None):
    """turns FHIR Bundle to normalized claim. Raises FhirError only if the bundle is unusable.

    Non-fatal problems are returned through claim_and_findings(). 
    `sidecar` is an optional normalized claim used to restore
    fields FHIR cannot carry (authorization details, notes).
    """
    claim, _ = claim_and_findings(bundle, sidecar)
    return claim


def claim_and_findings(bundle, sidecar=None):
    findings = check_bundle(bundle)
    if any(x["severity"] == "error" for x in findings):
        raise FhirError(findings)

    entries = [e["resource"] for e in bundle["entry"] if isinstance(e.get("resource"), dict)]
    by_key = {(r["resourceType"], r.get("id")): r for r in entries}
    by_url = {e.get("fullUrl"): e["resource"] for e in bundle["entry"] if e.get("fullUrl")}

    def get(reference, kind):
        if not reference:
            return None
        k, rid = _ref_id(reference)
        r = by_url.get(reference) or by_key.get((k, rid))
        return r if r and r["resourceType"] == kind else None

    c = next(r for r in entries if r["resourceType"] == "Claim")
    pat_ref = (c.get("patient") or {}).get("reference")
    patient = get(pat_ref, "Patient")
    patient_id = _ref_id(pat_ref)[1]
    ins = (c.get("insurance") or [{}])[0] or {}
    cov = get((ins.get("coverage") or {}).get("reference"), "Coverage") or {}
    member = next((i.get("value") for i in (patient or {}).get("identifier", [])
                   if str(i.get("system", "")).endswith("/member")), None)
    invoice = next((i.get("value") for i in c.get("identifier", [])
                    if str(i.get("system", "")).endswith("/invoice")), None)
    plan = next((k.get("value") for k in cov.get("class", [])
                 if _first_code(k.get("type")) == "plan"), None)
    payer_ref = (c.get("insurer") or {}).get("reference") or next(
        ((p or {}).get("reference") for p in cov.get("payor", [])), None)
    currency = ((c.get("total") or {}).get("currency")
                or next((_currency for it in c.get("item", []) for _currency in
                         [(it.get("net") or {}).get("currency")] if _currency), None))

    lines = []
    for i, it in enumerate(c.get("item", [])):
        auth = next((e.get("valueString") for e in it.get("extension", [])
                     if e.get("url") == EXT_LINE_AUTH), None)
        lines.append({
            "line_id": f"L{it.get('sequence', i + 1)}",
            "service_code": _first_code(it.get("productOrService")),
            "service_date": it.get("servicedDate"),
            "modifier": _first_code((it.get("modifier") or [None])[0]),
            "quantity": _num(it.get("quantity")),
            "unit_price": _num(it.get("unitPrice")),
            "net_amount": _num(it.get("net")),
            "authorization_id": auth,
        })

    attachments = []
    for si in c.get("supportingInfo") or []:
        doc = get(((si or {}).get("valueReference") or {}).get("reference"), "DocumentReference")
        if not doc:
            continue
        period = (doc.get("context") or {}).get("period") or {}
        desc = doc.get("description") or ""
        attachments.append({
            "attachment_id": doc.get("id"),
            "type": _first_code(doc.get("type")),
            "patient_id": _ref_id((doc.get("subject") or {}).get("reference"))[1],
            "service_code": desc.split()[-1] if desc.startswith("Synthetic ") else None,
            "service_date": period.get("start"),
            "document_status": DOC_STATUS_FROM_FHIR.get(doc.get("docStatus"), doc.get("docStatus")),
            "text": _decode_text(doc),
        })

    authorization_extension = next(
        (extension.get("valueString") for extension in c.get("extension", [])
         if extension.get("url") == EXT_AUTH_DETAILS),
        None,
    )
    try:
        authorizations = json.loads(authorization_extension) if authorization_extension else []
        if not isinstance(authorizations, list) or not all(isinstance(item, dict) for item in authorizations):
            authorizations = []
    except (TypeError, json.JSONDecodeError):
        authorizations = []

    auth_ids = list(dict.fromkeys(ins.get("preAuthRef") or []))
    auth_ids += [l["authorization_id"] for l in lines
                 if l["authorization_id"] and l["authorization_id"] not in auth_ids]
    existing_ids = {a.get("authorization_id") for a in authorizations}
    authorizations.extend(
        {"authorization_id": a, "patient_id": None, "service_code": None, "status": None,
         "valid_from": None, "valid_to": None, "max_quantity": None}
        for a in auth_ids if a not in existing_ids
    )

    claim = {
        "schema_version": "1.0.0",
        "claim_id": c.get("id"),
        "invoice_number": invoice,
        "patient_id": patient_id,
        "member_id": member,
        "provider_id": _ref_id((c.get("provider") or {}).get("reference"))[1],
        "payer_id": _ref_id(payer_ref)[1],
        "policy_id": plan,
        "diagnosis_code": _first_code(((c.get("diagnosis") or [{}])[0] or {}).get("diagnosisCodeableConcept")),
        "submission_date": c.get("created"),
        "currency": currency,
        "total_amount": _num(c.get("total")),
        "coverage": {
            "coverage_id": cov.get("id"),
            "status": cov.get("status"),
            "beneficiary_patient_id": _ref_id((cov.get("beneficiary") or {}).get("reference"))[1],
            "member_id": cov.get("subscriberId"),
            "start_date": (cov.get("period") or {}).get("start"),
            "end_date": (cov.get("period") or {}).get("end"),
        },
        "lines": lines,
        "authorizations": authorizations,
        "attachments": attachments,
        "notes": "Imported from FHIR R4 Bundle; authorization details are restored from the ClaimGuard extension when present.",
    }

    if sidecar:
        claim = merge_sidecar(claim, sidecar)
    return claim, findings


def merge_sidecar(claim, sidecar):
    """Restore fields FHIR cannot carry from the normalized record with the same claim_id."""
    if sidecar.get("claim_id") != claim.get("claim_id"):
        raise ValueError("Sidecar claim_id does not match the bundle claim_id.")
    merged = copy.deepcopy(claim)
    merged["authorizations"] = copy.deepcopy(sidecar.get("authorizations", []))
    merged["notes"] = sidecar.get("notes", merged["notes"])
    return merged


def parse_bundles_text(text):
    """Accept a single Bundle, a JSON array of Bundles, or JSONL.

    Returns (bundles, errors) where errors is a list of {'line', 'message'}.
    """
    bundles, errors = [], []
    text = (text or "").strip()
    if not text:
        return [], [{"line": 0, "message": "Empty payload."}]
    try:
        parsed = json.loads(text)
        items = parsed if isinstance(parsed, list) else [parsed]
        return items, []
    except json.JSONDecodeError:
        pass
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            bundles.append(json.loads(line))
        except json.JSONDecodeError as e:
            errors.append({"line": n, "message": f"Invalid JSON: {e.msg}"})
    return bundles, errors