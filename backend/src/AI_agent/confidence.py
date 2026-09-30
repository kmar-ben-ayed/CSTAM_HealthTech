"""Pure confidence scoring for explanation quality and reviewer escalation."""

SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}
STATUS_RANK = {"FAIL": 2, "UNABLE_TO_ASSESS": 1}

# These thresholds are operational tuning knobs for the validation set,
# not calibrated probabilities for the deterministic rule engine.
COMPLETENESS_MIN = 0.5
GROUNDING_MIN = 0.5


def evidence_completeness(finding) -> float | None:
    """Return completeness for incomplete findings only; FAILs are not treated as uncertain data."""
    if not isinstance(finding, dict):
        return None

    if finding.get("status") != "UNABLE_TO_ASSESS":
        return None

    evidence = finding.get("evidence") or []
    if not evidence:
        return None

    known = sum(
        1
        for item in evidence
        if isinstance(item, dict) and item.get("value") is not None
    )
    return round(known / len(evidence), 2)


def grounding(finding, explanation) -> float | None:
    """Share of allowed evidence paths that were actually cited by the explanation."""
    if not isinstance(finding, dict):
        return None

    allowed_paths = {
        item["path"]
        for item in (finding.get("evidence") or [])
        if isinstance(item, dict) and "path" in item and item.get("path")
    }
    if not allowed_paths:
        return None

    cited_paths = explanation.get("cited_evidence_paths", []) if isinstance(explanation, dict) else []
    cited = {path for path in cited_paths if isinstance(path, str) and path}
    return round(len(cited & allowed_paths) / len(allowed_paths), 2)


def assess(finding, explanation, source) -> dict:
    """Return explanation quality and escalation metadata without altering rule verdicts."""
    if source not in {"llm", "skipped", "fallback"}:
        raise ValueError("source must be one of {'llm', 'skipped', 'fallback'}")

    completeness = evidence_completeness(finding)
    grounding_score = grounding(finding, explanation)
    status = str(finding.get("status", "")).upper()
    severity = str(finding.get("severity", "low")).lower()

    escalation_reasons = []
    if status == "NOT_IMPLEMENTED":
        escalation_reasons.append("not_implemented")
    elif severity == "high" and status in {"FAIL", "UNABLE_TO_ASSESS"}:
        escalation_reasons.append("high_severity")

    if completeness is not None and completeness < COMPLETENESS_MIN:
        escalation_reasons.append("low_evidence_completeness")

    if source == "fallback":
        escalation_reasons.append("ai_explanation_failed")

    if source == "llm" and grounding_score is not None and grounding_score < GROUNDING_MIN:
        escalation_reasons.append("weak_grounding")

    escalation_reasons = list(dict.fromkeys(escalation_reasons))
    review_priority = 0
    if status not in {"PASS", "NOT_APPLICABLE", "NOT_IMPLEMENTED"}:
        review_priority = SEVERITY_RANK.get(severity, 0) * STATUS_RANK.get(status, 0)

    return {
        "confidence": None,
        "confidence_kind": "not_probabilistic",
        "evidence_completeness": completeness,
        "explanation_grounding": grounding_score,
        "explanation_source": source,
        "review_priority": review_priority,
        "escalate": bool(escalation_reasons),
        "escalation_reasons": escalation_reasons,
    }
