"""Generate and verify deterministic rule implementations from rules.json.

Only allowlisted specifications are accepted. Generated files are disposable
artifacts; the catalog remains the source of truth.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import py_compile
import re
import sys
from pathlib import Path

from AI_agent.llm_adapter import load_project_env
from openai import OpenAI
from .implementation_schema import SpecificationError, validate_catalog

ROOT = Path(__file__).resolve().parents[2]
RULES = ROOT / "rules" / "rules.json"
SPECS = ROOT / "rules" / "implementation_specs.json"
GENERATED = Path(__file__).resolve().parent / "generated"
MANIFEST = GENERATED / "manifest.json"
NATIVE_RULE_IDS = {f"R{i:03d}" for i in range(1, 16)}


def _load_specs() -> dict:
    return json.loads(SPECS.read_text(encoding="utf-8")) if SPECS.exists() else {}


def _load_rules(catalog: list[dict] | None = None, specs_override: dict | None = None) -> list[dict]:
    rules = copy.deepcopy(catalog) if catalog is not None else json.loads(RULES.read_text(encoding="utf-8"))
    specs = specs_override if specs_override is not None else _load_specs()
    for rule in rules:
        rule["implementation"] = specs.get(rule["rule_id"], {"kind": "builtin", "schema_version": 1})
        if rule["implementation"]["kind"] == "builtin" and rule["rule_id"] not in NATIVE_RULE_IDS:
            raise SpecificationError(
                f"{rule['rule_id']}: implementation_specs.json must define a generated implementation"
            )
    return validate_catalog(rules)


def _infer_simple_spec(rule: dict) -> dict | None:
    """Convert a small, unambiguous admin phrase without requiring an AI call."""
    logic = str(rule.get("logic", ""))
    match = re.search(
        r"\bprovider(?:_id)?\s+is\s+([A-Za-z0-9][A-Za-z0-9_-]*)",
        logic,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    provider_id = match.group(1)
    providers_path = ROOT / "rules" / "providers.json"
    providers = json.loads(providers_path.read_text(encoding="utf-8"))
    known_ids = {
        item.get("provider_id")
        for item in providers
        if isinstance(item, dict)
    }
    if provider_id not in known_ids:
        raise SpecificationError(
            f"{rule['rule_id']}: provider '{provider_id}' is not in providers.json"
        )
    return {
        "kind": "expression",
        "schema_version": 1,
        "expression": {
            "op": "equals",
            "left": "/provider_id",
            "right": provider_id,
        },
        "on_missing": "FAIL",
        "on_false": "FAIL",
        "on_true": "PASS",
        "evidence_path": "/provider_id",
        "message": f"Provider must be {provider_id}.",
    }


def generate_missing_specs(catalog: list[dict]) -> dict[str, dict]:
    """Ask the configured model for specs, never for executable code."""
    specs = _load_specs()
    catalog_ids = {rule["rule_id"] for rule in catalog}
    specs = {rule_id: spec for rule_id, spec in specs.items() if rule_id in catalog_ids}
    missing = [
        rule for rule in catalog
        if rule["rule_id"] not in NATIVE_RULE_IDS and rule["rule_id"] not in specs
    ]
    unresolved = []
    for rule in missing:
        proposal = _infer_simple_spec(rule)
        if proposal is None:
            unresolved.append(rule)
        else:
            candidate = dict(rule)
            candidate["implementation"] = proposal
            validate_catalog([candidate])
            specs[rule["rule_id"]] = proposal
    missing = unresolved
    if not missing:
        return specs
    load_project_env()
    model_name = os.environ.get("OPENAI_MODEL", "meta/llama-3.2-11b-vision-instruct")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SpecificationError(
            "No OPENAI_API_KEY is configured; the AI cannot safely interpret a new rule."
        )
    client = OpenAI(base_url=os.environ.get("OPENAI_BASE_URL") or None, api_key=api_key)
    for rule in missing:
        rule_id = rule["rule_id"]
        response = client.chat.completions.create(
            model=model_name,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Convert the rule into a safe deterministic expression specification. "
                        "Return JSON only, never Python or prose. The kind=expression is a must and should not be ignored, and a validated "
                        "expression tree. Supported operators are and, or, not, equals, not_equals, "
                        "greater_than, greater_than_or_equal, less_than, less_than_or_equal, "
                        "date_before_or_equal, date_after_or_equal, date_year, is_present, is_empty, "
                        "in, contains, sum, count, maximum, minimum, duplicate_by, all, any. "
                        "Return {\"error\":\"unsupported\"} if the rule cannot be represented."
                        "The evidence_path should start with / and point to the claim field that is being evaluated."
                        "The output should follow this format: {\"kind\": \"expression\",\"schema_version\": 1,\"expression\": {\"op\": \"\",\"left\": \"\",\"right\": \"\"},\"on_missing\": \"\",\"on_false\": \"\",\"on_true\": \"\",\"evidence_path\": \"/\",\"message\": \"\"}"
                    ),
                },
                {"role": "user", "content": json.dumps(rule, ensure_ascii=False)},
            ],
        )
        proposal = json.loads(response.choices[0].message.content)
        if proposal.get("error"):
            raise SpecificationError(f"{rule_id}: AI could not produce a supported specification")
        candidate = dict(rule)
        candidate["implementation"] = proposal
        validate_catalog([candidate])
        specs[rule_id] = proposal
    return specs


def write_specs(specs: dict[str, dict]) -> None:
    temporary_path = SPECS.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(specs, indent=2) + "\n", encoding="utf-8")
    temporary_path.replace(SPECS)


def _manifest(rules: list[dict]) -> dict:
    entries = {}
    for rule in rules:
        source = json.dumps(rule, sort_keys=True, separators=(",", ":")).encode("utf-8")
        entries[rule["rule_id"]] = {
            "version": rule["version"],
            "kind": rule["implementation"]["kind"],
            "source_sha256": hashlib.sha256(source).hexdigest(),
        }
    return {"schema_version": 1, "rules": entries}


def generate(catalog: list[dict] | None = None, specs_override: dict | None = None) -> None:
    rules = _load_rules(catalog, specs_override)
    if GENERATED.exists():
        for path in GENERATED.glob("rule_R*.py"):
            path.unlink()
    else:
        GENERATED.mkdir()
    (GENERATED / "__init__.py").write_text(
        '"""Generated rule implementations. Do not edit manually."""\n',
        encoding="utf-8",
    )
    generated = [rule for rule in rules if rule["implementation"]["kind"] == "expression"]
    source = [
        "# GENERATED FILE. Do not edit manually.",
        '"""Generated implementations in one compact registry module."""',
        "from ..engine_core import make_result",
        "from ..evaluator import check_spec",
        "",
        "RULE_IMPLEMENTATIONS = {}",
    ]
    for rule in generated:
        spec = rule["implementation"]
        source.extend([
            "",
            f"_SPEC_{rule['rule_id']} = {json.dumps(spec, sort_keys=True)}",
            f"def _check_{rule['rule_id']}(claim, rule, config):",
            f"    result = check_spec(claim, rule, config, _SPEC_{rule['rule_id']})",
            "    return make_result(claim, rule, result['status'], result['paths'], result['message'])",
            f"RULE_IMPLEMENTATIONS[{rule['rule_id']!r}] = _check_{rule['rule_id']}",
        ])
    (GENERATED / "rules.py").write_text("\n".join(source) + "\n", encoding="utf-8")
    MANIFEST.write_text(json.dumps(_manifest(rules), indent=2) + "\n", encoding="utf-8")


def check(catalog: list[dict] | None = None, specs_override: dict | None = None) -> list[str]:
    rules = _load_rules(catalog, specs_override)
    errors = []
    if not (GENERATED / "rules.py").exists():
        errors.append("missing generated rule registry")
    if not MANIFEST.exists():
        errors.append("missing generated manifest")
    else:
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
            expected = _manifest(rules)
            if manifest != expected:
                errors.append("generated manifest is stale; run --generate")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"invalid generated manifest: {exc}")
    return errors


def verify(catalog: list[dict] | None = None, specs_override: dict | None = None) -> None:
    generate(catalog, specs_override)
    errors = check(catalog, specs_override)
    for path in GENERATED.glob("*.py"):
        try:
            py_compile.compile(str(path), doraise=True)
        except py_compile.PyCompileError as exc:
            errors.append(str(exc))
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Verified {len(_load_rules(catalog, specs_override))} catalog rules and generated implementations.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    try:
        if args.verify:
            verify()
        elif args.generate:
            generate()
        elif args.check:
            errors = check()
            if errors:
                print("\n".join(errors))
                return 1
            print(f"Generated implementations are present for {len(_load_rules())} rules.")
        else:
            parser.error("choose --check, --generate, or --verify")
    except SpecificationError as exc:
        print(f"Generator rejected the catalog: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
