"""Safe deterministic evaluator for validated rule expression trees."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

def empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def valid_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _value(value: Any, claim: dict, config: dict, item: Any) -> Any:
    if isinstance(value, str) and value.startswith("$item"):
        current = item
        for part in value[5:].strip("/").split("/"):
            if part:
                current = current.get(part) if isinstance(current, dict) else None
        return current
    if isinstance(value, str) and value.startswith("/"):
        current: Any = claim
        for part in value.strip("/").split("/"):
            current = current.get(part) if isinstance(current, dict) else None
        return current
    return value


def _compare(op: str, left: Any, right: Any) -> bool | None:
    if left is None or right is None or (isinstance(left, str) and not left.strip()):
        return None
    if op in {"date_before_or_equal", "date_after_or_equal"}:
        left, right = valid_date(left), valid_date(right)
        if left is None or right is None:
            return None
    try:
        return {
            "equals": left == right,
            "not_equals": left != right,
            "greater_than": left > right,
            "greater_than_or_equal": left >= right,
            "less_than": left < right,
            "less_than_or_equal": left <= right,
            "date_before_or_equal": left <= right,
            "date_after_or_equal": left >= right,
        }[op]
    except (TypeError, KeyError):
        return None


def evaluate(node: dict, claim: dict, config: dict, item: Any = None) -> bool | None:
    op = node["op"]
    if op in {"and", "or"}:
        results = [evaluate(child, claim, config, item) for child in node["items"]]
        return all(results) if op == "and" and all(value is not None for value in results) else (
            True if op == "or" and True in results else (
                False if op == "and" and False in results else None
            )
        )
    if op == "not":
        result = evaluate(node["item"], claim, config, item)
        return None if result is None else not result
    if op in {"all", "any"}:
        collection = _value(node["collection"], claim, config, item)
        if not isinstance(collection, list) or not collection:
            return None
        results = [evaluate(node["item"], claim, config, child) for child in collection]
        return all(results) if op == "all" and all(value is not None for value in results) else (
            True if op == "any" and True in results else (
                False if op == "all" and False in results else None
            )
        )
    if op == "duplicate_by":
        collection = _value(node["collection"], claim, config, item)
        if not isinstance(collection, list):
            return None
        keys = []
        for child in collection:
            key = tuple(child.get(field) for field in node["fields"]) if isinstance(child, dict) else None
            if key is None or any(value is None for value in key):
                return None
            keys.append(key)
        return len(keys) != len(set(keys))
    if op == "is_present":
        return not empty(_value(node["value"], claim, config, item))
    if op == "is_empty":
        return empty(_value(node["value"], claim, config, item))
    if op == "date_year":
        parsed = valid_date(_value(node["value"], claim, config, item))
        return None if parsed is None else parsed.year == node["year"]
    if op == "in":
        value = _value(node.get("value"), claim, config, item)
        choices = _value(node.get("choices"), claim, config, item)
        return None if value is None or not isinstance(choices, list) else value in choices
    if op == "contains":
        value = _value(node.get("value"), claim, config, item)
        expected = _value(node.get("expected"), claim, config, item)
        return None if value is None else expected in value
    if op in {"sum", "count", "maximum", "minimum"}:
        values = _value(node["value"], claim, config, item)
        if not isinstance(values, list) or not values:
            return None
        if op == "count":
            return len(values)
        numbers = [Decimal(str(value)) for value in values if isinstance(value, (int, float)) and not isinstance(value, bool)]
        if len(numbers) != len(values):
            return None
        return {"sum": sum(numbers), "maximum": max(numbers), "minimum": min(numbers)}[op]
    if op in {"equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "date_before_or_equal", "date_after_or_equal"}:
        return _compare(op, _value(node.get("left"), claim, config, item), _value(node.get("right"), claim, config, item))
    return None


def check_spec(claim: dict, rule: dict, config: dict, spec: dict) -> dict:
    result = evaluate(spec["expression"], claim, config)
    status = spec["on_missing"] if result is None else spec["on_true"] if result else spec["on_false"]
    return {
        "status": status,
        "paths": [spec.get("evidence_path", "/")],
        "message": spec.get("message", f"Expression evaluated to {status}."),
    }
