"""What a rule can read: claim fields (from claim.schema.json) and reference data.

The catalogue is used by the static checks in ``validation.py`` and to describe
the available fields to the drafting agent. Array elements are written with
"*": "/lines/*/service_date" is the service_date of any line.
"""

from __future__ import annotations

import difflib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# The reference data files in rules/, which rules read through {"config": ...}.
DATA_FILES = ("policies.json", "services.json", "providers.json", "diagnoses.json")

# Value types used across the rule language checks.
TEXT = "text"
NUMBER = "number"
DATE = "date"
BOOLEAN = "boolean"
OBJECT = "object"
LIST = "list"
MAP = "map"


@dataclass(frozen=True)
class FieldInfo:
    path: str
    types: frozenset[str]
    nullable: bool
    description: str = ""

    @property
    def is_list(self) -> bool:
        return LIST in self.types


class FieldCatalogue:
    """Claim fields by path, e.g. "/currency" or "/lines/*/quantity"."""

    def __init__(self, fields: dict[str, FieldInfo]):
        self.fields = fields

    @classmethod
    def from_schema(cls, schema: dict[str, Any]) -> "FieldCatalogue":
        fields: dict[str, FieldInfo] = {}
        _collect(schema, "", fields)
        return cls(fields)

    @classmethod
    def from_backend_root(cls, backend_root: Path) -> "FieldCatalogue":
        schema_path = Path(backend_root) / "schemas" / "claim.schema.json"
        return cls.from_schema(json.loads(schema_path.read_text(encoding="utf-8")))

    def get(self, path: str) -> FieldInfo | None:
        return self.fields.get(path)

    def unknown_field(self, path: str, shown_as: str | None = None) -> str:
        """The message for a path that is not a claim field, naming the fields it may have
        meant: those with the same name elsewhere ("/lines/*/patient_id" -> "/patient_id"),
        else the closest spellings. A bare "not a claim field" made a drafter rewrite a sheet
        that was right apart from that one path."""
        name = path.rstrip("/").rsplit("/", 1)[-1]
        same_name = [field for field in self.fields if field.rsplit("/", 1)[-1] == name and field != path]
        candidates = same_name or difflib.get_close_matches(path, list(self.fields), n=3, cutoff=0.75)
        message = f'"{shown_as or path}" is not a claim field'
        if candidates:
            message += "; the claim has " + ", ".join(f'"{field}"' for field in candidates[:4])
        return message

    def describe(self) -> list[dict[str, Any]]:
        """A compact list for prompts and the UI."""
        return [
            {"path": info.path, "type": "/".join(sorted(info.types)), "nullable": info.nullable}
            for info in self.fields.values()
        ]


def _collect(schema: dict[str, Any], path: str, fields: dict[str, FieldInfo]) -> None:
    raw_types = schema.get("type", [])
    raw_types = [raw_types] if isinstance(raw_types, str) else list(raw_types)
    nullable = "null" in raw_types
    types = set()
    for raw in raw_types:
        if raw == "string":
            types.add(DATE if schema.get("format") == "date" else TEXT)
        elif raw in ("number", "integer"):
            types.add(NUMBER)
        elif raw == "boolean":
            types.add(BOOLEAN)
        elif raw == "object":
            types.add(OBJECT)
        elif raw == "array":
            types.add(LIST)
    if "const" in schema and not types:
        types.add(TEXT)

    if path:
        fields[path] = FieldInfo(path=path, types=frozenset(types), nullable=nullable)

    for name, child in schema.get("properties", {}).items():
        _collect(child, f"{path}/{name}", fields)
    if isinstance(schema.get("items"), dict):
        _collect(schema["items"], f"{path}/*", fields)


# --------------------------------------------------------------------------
# Reference data a rule can read through {"config": ...}.
# --------------------------------------------------------------------------

# Policy fields: name -> (value type, type of map/list entries, description)
POLICY_FIELDS: dict[str, tuple[str, str | None, str]] = {
    "policy_id": (TEXT, None, "policy identifier"),
    "version": (TEXT, None, "policy version"),
    "payer_id": (TEXT, None, "payer identifier"),
    "currency": (TEXT, None, "currency code, e.g. SAR"),
    "submission_window_days": (NUMBER, None, "days allowed between the latest service and submission"),
    "allowed_providers": (LIST, TEXT, "provider ids allowed under the policy"),
    "auth_required_services": (LIST, TEXT, "service codes that need prior authorization"),
    "required_documents": (MAP, TEXT, "service code -> required attachment type"),
    "max_unit_price": (MAP, NUMBER, "service code -> maximum unit price"),
    "max_quantity_per_line": (MAP, NUMBER, "service code -> maximum quantity on one line"),
}

# Service catalogue entry fields: name -> (type, description)
SERVICE_FIELDS: dict[str, tuple[str, str]] = {
    "description": (TEXT, "service description"),
    "base_price": (NUMBER, "reference price"),
    "max_price": (NUMBER, "catalogue maximum price"),
    "max_quantity": (NUMBER, "catalogue maximum quantity"),
}


@dataclass(frozen=True)
class ReferenceData:
    """Reference data in the form the interpreter reads it."""

    policies: dict[str, dict[str, Any]]
    services: dict[str, dict[str, Any]]
    provider_ids: list[str]
    diagnosis_codes: list[str]
    # The four data files as written, for the rule drafter to read (never the rule
    # catalogue or the reference specs, which would hand it the answers).
    files: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, rules_dir: Path) -> "ReferenceData":
        def read(name: str) -> Any:
            return json.loads((Path(rules_dir) / name).read_text(encoding="utf-8"))

        files = {name: read(name) for name in DATA_FILES}
        return cls(
            policies=files["policies.json"],
            services=files["services.json"],
            provider_ids=[item["provider_id"] for item in files["providers.json"] if isinstance(item, dict)],
            diagnosis_codes=[item["code"] for item in files["diagnoses.json"] if isinstance(item, dict)],
            files=files,
        )

    def summary(self) -> dict[str, Any]:
        """What exists, for prompts and the UI (ids and field names, not full records)."""
        return {
            "policy_ids": sorted(self.policies),
            "policy_fields": {name: description for name, (_, _, description) in POLICY_FIELDS.items()},
            "service_codes": sorted(self.services),
            "service_fields": {name: description for name, (_, description) in SERVICE_FIELDS.items()},
            "provider_ids": list(self.provider_ids),
            "diagnosis_codes": list(self.diagnosis_codes),
        }
