"""System prompts for the rule-authoring models, loaded from the .md files here."""

import hashlib
from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent

# "drafter_sheet_only" is drafter_sheet.md without its last section, which offers the full rule
# language for what a sheet cannot say: the drafter then writes sheets only. Given that manual, it
# switched to the full language whenever a sheet got a problem (R009, R010), and did worse there.
FALLBACK_SECTION = "## When a sheet cannot express the rule"
SHEET_ONLY_ENDING = f"""{FALLBACK_SECTION}

A sheet is the only format. If part of the rule seems impossible, re-read the constructs above
(`then` to look up a record and check its fields, `where` and `group_by` on sum and count,
`first_present` for a default, a check's own `needs`, `"otherwise": "UNABLE_TO_ASSESS"`) and
write the closest sheet; `check` tells you what to change. Answer `unsupported` only when no
sheet can express the rule.
"""


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    if name == "drafter_sheet_only":
        return load_prompt("drafter_sheet").split(FALLBACK_SECTION)[0] + SHEET_ONLY_ENDING
    text = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    if name in ("drafter", "drafter_sheet"):
        text = text.replace("{rule_language}", load_prompt("rule_language"))
    return text


def prompt_fingerprint(name: str) -> str:
    """Recorded in the audit trail, so every activated rule names the exact prompt used."""
    return hashlib.sha256(load_prompt(name).encode("utf-8")).hexdigest()
