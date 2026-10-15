"""Document text is untrusted data. These helpers clean it for storage and display
and flag instruction-like phrasing. Flagged text is never rewritten or obeyed."""
import re

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")
_SPACES = re.compile(r"[ \t\r\f\v]+")

_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)",
    r"disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)",
    r"\bmark\s+(this\s+claim|the\s+claim|every\s+rule|all\s+rules?|it)\s+as\s+(pass|passed|approved)",
    r"\b(set|change|override)\s+(the\s+)?(rule\s+)?status",
    r"(^|\n)\s*(system|assistant|developer)\s*:",
    r"you\s+are\s+now\s+",
    r"new\s+instructions?\s*:",
    r"\bact\s+as\s+(an?\s+)?(admin|administrator|system)",
]
_INJECTION = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)


def clean_text(text: str, limit: int | None = None) -> str:
    text = _CONTROL.sub("", text or "")
    lines = [_SPACES.sub(" ", line).strip() for line in text.replace("\r\n", "\n").split("\n")]
    cleaned = "\n".join(line for line in lines if line)
    return cleaned[:limit] if limit is not None else cleaned


def clean_label(value: str, limit: int = 255) -> str:
    """Filenames and labels are metadata only: one line, no control characters."""
    return _SPACES.sub(" ", _CONTROL.sub("", value or "").replace("\n", " ")).strip()[:limit]


def injection_suspected(text: str) -> bool:
    return bool(_INJECTION.search(text or ""))
