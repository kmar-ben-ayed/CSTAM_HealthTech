"""Measure how reliably the rule-authoring pipeline turns English rules into correct specs.

Uses the real language models configured in .env (OPENAI_API_KEY, OPENAI_BASE_URL,
RULE_DRAFTER_MODEL, RULE_ORACLE_MODEL), so it costs model calls.

    python src/run_rule_benchmark.py --set reference --out outputs/rule_benchmark.json
    python src/run_rule_benchmark.py --only R005,INV-03
"""

import argparse
import json
import sys
from pathlib import Path

import paths  # noqa: F401  (makes the sub-packages importable)
from AI_agent.llm_adapter import load_project_env
from rule_authoring.llm import models_from_environment
from rule_benchmark.runner import Benchmark, invented_items, reference_items

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", choices=("reference", "invented", "all"), default="all")
    parser.add_argument("--only", help="comma-separated rule ids to run, e.g. R005,INV-03")
    parser.add_argument("--mutants", type=int, default=1000, help="extra mutated claims to compare on")
    parser.add_argument("--out", type=Path, default=BACKEND_ROOT / "outputs" / "rule_benchmark.json")
    args = parser.parse_args()

    load_project_env()
    models = models_from_environment()
    if models is None:
        print("No OPENAI_API_KEY is configured; the benchmark needs real models.", file=sys.stderr)
        return 1

    items = []
    if args.set in ("reference", "all"):
        items += reference_items(BACKEND_ROOT)
    if args.set in ("invented", "all"):
        items += invented_items()
    if args.only:
        wanted = {item_id.strip() for item_id in args.only.split(",")}
        items = [item for item in items if item.item_id in wanted]

    print(f"Drafting {len(items)} rules with drafter={models.drafter.name}, oracle={models.oracle.name}", flush=True)

    def show(position, result):
        agreement = "-" if result.agreement is None else f"{result.agreement:.1%}"
        questions = result.clarification_questions + result.case_questions
        print(f"[{position}/{len(items)}] {result.item_id:8} {result.classification:24} agreement {agreement:>7}  "
              f"questions {questions:2}  {result.seconds:6.0f}s  {result.reason[:60]}", flush=True)

    report = Benchmark(BACKEND_ROOT, models, mutants=args.mutants).run(items, on_result=show)
    print(json.dumps(report["summary"], indent=2))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Full report: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
