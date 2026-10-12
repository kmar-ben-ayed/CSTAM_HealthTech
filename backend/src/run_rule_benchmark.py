"""Measure how reliably the rule-authoring pipeline turns English rules into correct specs.

Uses the real language models configured in .env (OPENAI_API_KEY, OPENAI_BASE_URL,
RULE_DRAFTER_MODEL, RULE_ORACLE_MODEL), so it costs model calls.

    python src/run_rule_benchmark.py --set reference --out outputs/rule_benchmark.json
    python src/run_rule_benchmark.py --only R005,INV-03
    python src/run_rule_benchmark.py --only R001,R003 --repeat 3 --max-turns 16
"""

import argparse
import json
import sys
from pathlib import Path

import paths  # noqa: F401  (makes the sub-packages importable)
from AI_agent.llm_adapter import load_project_env
from rule_authoring.llm import models_from_environment
from rule_authoring.service import AuthoringSettings
from rule_benchmark.runner import QUICK_SET, Benchmark, invented_items, reference_items

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", choices=("reference", "invented", "all", "quick"), default="all",
                        help="quick: 10 representative rules, about ten minutes")
    parser.add_argument("--workers", type=int, default=4,
                        help="rules drafted at the same time (keep within the provider's rate limit)")
    parser.add_argument("--record", type=Path, help="file for every model reply (default: next to --out)")
    parser.add_argument("--format", choices=("spec", "sheet"), default="spec",
                        help="what the drafter writes: full specs, or rule sheets compiled by code")
    parser.add_argument("--committee", type=int, default=1,
                        help="independent drafts compared per rule; where they disagree, the admin is asked")
    parser.add_argument("--examples", choices=("drafted", "catalogue", "none"), default="drafted",
                        help="examples shown to the drafter: drafted (only rules it drafted and an admin "
                             "confirmed), catalogue (every active rule, hand-written ones included), none")
    parser.add_argument("--no-full-language", action="store_true",
                        help="sheet format only: the drafter's prompt leaves out the full rule language's manual")
    parser.add_argument("--no-missing-data-questions", action="store_true",
                        help="do not ask the simulated admin what missing or unknown data gives before the table")
    parser.add_argument("--only", help="comma-separated rule ids to run, e.g. R005,INV-03")
    parser.add_argument("--mutants", type=int, default=1000, help="extra mutated claims to compare on")
    parser.add_argument("--out", type=Path, default=BACKEND_ROOT / "outputs" / "rule_benchmark.json")
    parser.add_argument("--repeat", type=int, default=1, help="run each rule this many times (small models vary)")
    parser.add_argument("--reading", choices=("off", "advice", "block"), default="off",
                        help="the independent second reading (default off: the simulated author checks the cases)")
    parser.add_argument("--no-corrections", action="store_true", help="the simulated author does not correct the case table")
    defaults = AuthoringSettings()
    parser.add_argument("--max-turns", type=int, default=defaults.drafter_max_turns, help="drafter turns per session")
    parser.add_argument("--max-invalid", type=int, default=defaults.drafter_max_invalid_replies,
                        help="malformed drafter replies tolerated per session")
    parser.add_argument("--time-budget", type=float, default=defaults.drafter_time_budget_seconds,
                        help="seconds per drafter session")
    args = parser.parse_args()

    load_project_env()
    models = models_from_environment()
    if models is None:
        print("No OPENAI_API_KEY is configured; the benchmark needs real models.", file=sys.stderr)
        return 1

    items = []
    if args.set in ("reference", "all", "quick"):
        items += reference_items(BACKEND_ROOT)
    if args.set in ("invented", "all", "quick"):
        items += invented_items()
    if args.set == "quick":
        items = [item for item in items if item.item_id in QUICK_SET]
    if args.only:
        wanted = {item_id.strip() for item_id in args.only.split(",")}
        items = [item for item in items if item.item_id in wanted]
    items = [item for item in items for _ in range(max(1, args.repeat))]
    settings = AuthoringSettings(
        independent_reading=args.reading,
        drafter_max_turns=args.max_turns,
        drafter_max_invalid_replies=args.max_invalid,
        drafter_time_budget_seconds=args.time_budget,
        drafting_format=args.format,
        committee_size=args.committee,
        example_source=args.examples,
        full_language_fallback=not args.no_full_language,
        missing_data_questions=not args.no_missing_data_questions,
    )

    print(f"Drafting {len(items)} rules with drafter={models.drafter.name}, oracle={models.oracle.name}, "
          f"turns={args.max_turns}, invalid replies={args.max_invalid}, time budget={args.time_budget:.0f}s, "
          f"format={args.format}, workers={args.workers}, committee={args.committee}, examples={args.examples}, "
          f"full language={'no' if args.no_full_language else 'yes'}, "
          f"missing-data questions={'no' if args.no_missing_data_questions else 'yes'}",
          flush=True)

    def show(position, result):
        agreement = "-" if result.agreement is None else f"{result.agreement:.1%}"
        questions = result.clarification_questions + result.case_questions + result.situation_questions
        # Official rules: agreement and F1 on the official data (expected_results.jsonl) only.
        f1 = result.official["issue_f1"] if result.official else None
        official = f"  official F1 {f1:.3f}" if f1 is not None else ""
        if result.gate:  # would the draft replace the rule running today (decided on development claims)
            official += "  deployable" if result.gate["deploy"] else "  not deployable"
        if result.first_deployable_seconds is not None:
            official += f" (first deployable draft after {result.first_deployable_seconds:.0f}s)"
        print(f"[{position}/{len(items)}] {result.item_id:8} {result.classification:24} agreement {agreement:>7}{official}  "
              f"questions {questions:2}  corrections {result.corrections:3}  {result.seconds:6.0f}s  {result.reason[:60]}",
              flush=True)

    record = args.record or args.out.with_suffix(".replies.jsonl")
    benchmark = Benchmark(BACKEND_ROOT, models, mutants=args.mutants, settings=settings,
                          author_corrects=not args.no_corrections, record=record)
    report = benchmark.run(items, on_result=show, workers=args.workers)
    print(json.dumps(report["summary"], indent=2))
    print(f"Every model reply: {record}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Full report: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
