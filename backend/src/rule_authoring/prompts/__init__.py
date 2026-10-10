"""System prompts for the rule-authoring models, loaded from the .md files here."""

import hashlib
from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    text = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    if name == "drafter":
        text = text.replace("{rule_language}", load_prompt("rule_language"))
    return text


def prompt_fingerprint(name: str) -> str:
    """Recorded in the audit trail, so every activated rule names the exact prompt used."""
    return hashlib.sha256(load_prompt(name).encode("utf-8")).hexdigest()
