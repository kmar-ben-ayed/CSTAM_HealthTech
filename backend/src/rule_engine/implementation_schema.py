"""Validation for the small, allowlisted rule implementation language."""

from __future__ import annotations

from typing import Any

ALLOWED_KINDS = {"builtin", "expression"}
ALLOWED_STATUSES = {"PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE","pass", "fail", "unable_to_assess", "not_applicable"}
ALLOWED_OPERATORS = {
    "and", "or", "not", "equals", "not_equals", "greater_than",
    "greater_than_or_equal", "less_than", "less_than_or_equal",
    "date_before_or_equal", "date_after_or_equal", "date_year",
    "is_present", "is_empty", "in", "contains", "sum", "count",
    "maximum", "minimum", "duplicate_by", "all", "any",
}


class SpecificationError(ValueError):
    """Raised when a catalog implementation contract is not safe to generate."""


def validate_implementation(rule: dict[str, Any]) -> dict[str, Any]:
    print("see rule", rule)
    implementation = rule.get("implementation")
    if not isinstance(implementation, dict):
        raise SpecificationError(f"{rule.get('rule_id', '<unknown>')}: implementation is required")
    kind = implementation.get("kind")
    if kind not in ALLOWED_KINDS:
        raise SpecificationError(f"{rule['rule_id']}: unsupported implementation kind {kind!r}")
    allowed = (
        {"kind", "schema_version"} if kind == "builtin" else {"kind", "schema_version", "expression", "on_missing", "on_false", "on_true", "evidence_path", "message"}
    )
    extra = set(implementation) - allowed
    if extra:
        raise SpecificationError(f"{rule['rule_id']}: unsupported implementation fields: {sorted(extra)}")
    if implementation.get("schema_version") != 1:
        raise SpecificationError(f"{rule['rule_id']}: schema_version must be 1")
    if kind == "expression":
        for name in ("on_missing", "on_false", "on_true"):
            if implementation.get(name) not in ALLOWED_STATUSES:
                raise SpecificationError(f"{rule['rule_id']}: {name} is invalid")
        _validate_expression(implementation.get("expression"), rule["rule_id"])
    return implementation


def _validate_expression(node: Any, rule_id: str) -> None:
    if not isinstance(node, dict) or not isinstance(node.get("op"), str):
        raise SpecificationError(f"{rule_id}: expression nodes require an op")
    op = node["op"]
    if op not in ALLOWED_OPERATORS:
        raise SpecificationError(f"{rule_id}: unsupported expression operator {op!r}")
    if op in {"and", "or"}:
        items = node.get("items")
        if not isinstance(items, list) or not items:
            raise SpecificationError(f"{rule_id}: {op} requires non-empty items")
        for item in items:
            _validate_expression(item, rule_id)
    elif op == "not":
        _validate_expression(node.get("item"), rule_id)
    elif op in {"all", "any"}:
        if not isinstance(node.get("collection"), str) or not isinstance(node.get("item"), dict):
            raise SpecificationError(f"{rule_id}: {op} requires collection and item")
        _validate_expression(node["item"], rule_id)
    elif op == "duplicate_by":
        if not isinstance(node.get("collection"), str) or not isinstance(node.get("fields"), list):
            raise SpecificationError(f"{rule_id}: duplicate_by requires collection and fields")
        if not node["fields"] or not all(isinstance(field, str) for field in node["fields"]):
            raise SpecificationError(f"{rule_id}: duplicate_by fields must be strings")
    elif op in {"is_present", "is_empty", "sum", "count", "maximum", "minimum"}:
        if not isinstance(node.get("value"), str):
            raise SpecificationError(f"{rule_id}: {op} requires a value path")
    elif op == "date_year":
        if not isinstance(node.get("value"), str) or not isinstance(node.get("year"), int):
            raise SpecificationError(f"{rule_id}: date_year requires value and integer year")
    else:
        for key in ("left", "right"):
            if not isinstance(node.get(key), (str, int, float, bool, type(None), list)):
                raise SpecificationError(f"{rule_id}: {op} operands are invalid")


def validate_catalog(rules: Any) -> list[dict[str, Any]]:
    if not isinstance(rules, list):
        raise SpecificationError("rules.json must contain an array")
    seen: set[str] = set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise SpecificationError("every rule must be an object")
        rule_id = rule.get("rule_id")
        if not isinstance(rule_id, str) or not rule_id:
            raise SpecificationError("every rule must have a rule_id")
        if rule_id in seen:
            raise SpecificationError(f"duplicate rule_id {rule_id}")
        seen.add(rule_id)
        validate_implementation(rule)
    return rules
