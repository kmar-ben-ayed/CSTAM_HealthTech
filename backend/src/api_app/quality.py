"""Live validation quality: the current engine scored against a split's ground truth.

Uses the same definitions as evaluate.py (a FAIL is the positive class), but
scores only the (claim, rule) pairs that have a gold label, so rules without
ground truth (for example agent-authored ones) are reported as unscored
instead of failing the whole run.
"""
from collections import Counter
from typing import Any


def _metrics(pairs: list[tuple[str, str]]) -> dict[str, Any]:
    """pairs: (expected_status, predicted_status) for one group of results."""
    tp = sum(g == "FAIL" and p == "FAIL" for g, p in pairs)
    fp = sum(g != "FAIL" and p == "FAIL" for g, p in pairs)
    fn = sum(g == "FAIL" and p != "FAIL" for g, p in pairs)
    tn = len(pairs) - tp - fp - fn
    return {
        "count": len(pairs),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "issue_precision": tp / (tp + fp) if tp + fp else None,
        "issue_recall": tp / (tp + fn) if tp + fn else None,
        "issue_f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
        "false_alarm_rate": fp / (fp + tn) if fp + tn else None,
        "status_accuracy": sum(g == p for g, p in pairs) / len(pairs) if pairs else None,
        "false_abstentions": sum(p == "UNABLE_TO_ASSESS" and g != "UNABLE_TO_ASSESS" for g, p in pairs),
        "missed_abstentions": sum(g == "UNABLE_TO_ASSESS" and p != "UNABLE_TO_ASSESS" for g, p in pairs),
        "missing_predictions": sum(p == "MISSING" for _, p in pairs),
    }


def score_quality(gold: list[dict[str, Any]], predictions: list[dict[str, Any]]) -> dict[str, Any]:
    predicted = {(row["claim_id"], row["rule_id"]): row["status"] for row in predictions}
    expected = {(row["claim_id"], row["rule_id"]): row["status"] for row in gold}
    pairs_by_rule: dict[str, list[tuple[str, str]]] = {}
    for key, status in expected.items():
        pairs_by_rule.setdefault(key[1], []).append((status, predicted.get(key, "MISSING")))
    all_pairs = [pair for pairs in pairs_by_rule.values() for pair in pairs]
    gold_rules = set(pairs_by_rule)
    confusion = Counter(all_pairs)
    return {
        "overall": _metrics(all_pairs),
        "by_rule": {rule: _metrics(pairs) for rule, pairs in sorted(pairs_by_rule.items())},
        "confusion": [
            {"expected": g, "predicted": p, "count": n} for (g, p), n in sorted(confusion.items())
        ],
        "claims": len({claim_id for claim_id, _ in expected}),
        "unscored_rules": sorted({rule for _, rule in predicted} - gold_rules),
        "note": "Synthetic teaching benchmark. A FAIL is the positive class; NOT_IMPLEMENTED and missing results count as wrong.",
    }
