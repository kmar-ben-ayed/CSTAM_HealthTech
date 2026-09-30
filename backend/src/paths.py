"""Import this first in every entry script: makes the sub-packages importable."""
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent
for _sub in ("", "rule_engine", "normalisation", "AI_agent"):
    _p = str(SRC / _sub) if _sub else str(SRC)
    if _p not in sys.path:
        sys.path.insert(0, _p)