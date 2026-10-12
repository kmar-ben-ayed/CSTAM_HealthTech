"""Similar, already-working rules, shown to the drafter as worked examples.

A small model copies a close worked example far more reliably than it applies
a language manual. For each new rule we pick the existing active rules whose
English is closest to it and hand over their verified specs. The examples grow
with the catalogue: every rule that goes live becomes an example for the next.

Similarity is plain word overlap on the title and logic (field names count as
words), which is deterministic and needs no model.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

from rule_engine.spec_store import logic_fingerprint

MAX_EXAMPLES = 3
MAX_EXAMPLE_CHARS = 8000  # keeps the prompt small enough for a small model

_STOP_WORDS = {
    "a", "an", "and", "any", "are", "as", "at", "be", "by", "each", "every", "for", "from", "has",
    "have", "if", "in", "is", "it", "its", "must", "no", "not", "of", "on", "or", "the", "this",
    "to", "under", "unless", "when", "where", "with", "within", "else", "here", "only", "than",
}


def _words(text: str) -> set[str]:
    words = set()
    for token in re.findall(r"[a-z][a-z0-9_]*", text.lower()):
        if token in _STOP_WORDS:
            continue
        words.add(token)
        words.update(part for part in token.split("_") if len(part) > 2 and part not in _STOP_WORDS)
    return words


def similar_rules(
    rule: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    exclude_rule_id: str | None = None,
) -> list[dict[str, Any]]:
    """The closest working rules to `rule`, as {"title", "logic", "spec"} (or "sheet").

    `candidates` are catalogue entries that carry their active spec under
    "spec", or a proven rule sheet under "sheet". A candidate with the same rule
    id or the same logic text is never used, so a rule is never shown its own answer.
    """
    target = _words(f"{rule.get('title', '')} {rule.get('logic', '')}")
    own_logic = logic_fingerprint(rule.get("logic", ""))
    scored = []
    for candidate in candidates:
        if candidate.get("rule_id") == exclude_rule_id or (candidate.get("spec") is None and candidate.get("sheet") is None):
            continue
        if logic_fingerprint(candidate.get("logic", "")) == own_logic:
            continue
        words = _words(f"{candidate.get('title', '')} {candidate.get('logic', '')}")
        if not target or not words:
            continue
        score = len(target & words) / math.sqrt(len(target) * len(words))
        scored.append((score, candidate))

    chosen, used = [], 0
    for score, candidate in sorted(scored, key=lambda item: item[0], reverse=True):
        if len(chosen) == MAX_EXAMPLES or score == 0:
            break
        form = "sheet" if candidate.get("sheet") is not None else "spec"
        example = {"title": candidate["title"], "logic": candidate["logic"], form: candidate[form]}
        size = len(json.dumps(example, ensure_ascii=False))
        if used + size > MAX_EXAMPLE_CHARS:
            continue  # too long to fit; a shorter, slightly less similar one may still fit
        chosen.append(example)
        used += size
    return chosen
