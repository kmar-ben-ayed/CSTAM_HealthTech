"""Score rules drafted by the AI on the original challenge data, with the official scorer.

Takes a benchmark report (run_rule_benchmark.py --set reference) in which the AI
drafted R001-R015 from their English text alone, and asks: had an admin typed
these 15 rules into ClaimGuard, what would the official evaluation say?

- A rule counts as deployed when its draft reached the admin's confirmation
  screen (the admin would confirm it). Its drafted spec then runs through the
  same code as the official pipeline (engine_core.run_rule).
- A rule the AI could not produce outputs NOT_IMPLEMENTED for every claim,
  which the official scorer counts as wrong.
- The predictions are scored by src/evaluate.py, unchanged, against the
  original expected_results.jsonl of each split.

With --drafts, the AI-drafted rules in the rule database are scored instead: those an
admin confirmed, and the drafts still waiting for confirmation (regenerate_official_rules.py
leaves them there). Rules still running their hand-written spec count as not produced.

Nothing in rules/ or outputs/rules.sqlite3 is changed: the hand-written reference
rules play no part in the scored predictions.

    python src/score_drafted_rules.py --report outputs/official_strict.json
    python src/score_drafted_rules.py --report outputs/full_run.json outputs/rerun_of_failures.json
    python src/score_drafted_rules.py --drafts
"""

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import paths  # noqa: F401  (makes the sub-packages importable)
from rule_authoring.drafts import AWAITING_CONFIRMATION
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.engine_core import load_jsonl, make_result, run_rule, validate_transport
from rule_engine.language import parse_spec
from rule_engine.spec_store import default_database
from rule_engine.validation import check_spec

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SPLITS = ("development", "validation", "stress")
RULEBOOK = [f"R{number:03d}" for number in range(1, 16)]
NOT_PRODUCED = "The AI could not produce this rule, so it was not deployed."


def deployed_specs(report: dict, fields: FieldCatalogue) -> dict:
    """rule_id -> spec, for the drafts the admin would have confirmed."""
    specs = {}
    for result in report["results"]:
        if result["item_id"] not in RULEBOOK or result["final_state"] != AWAITING_CONFIRMATION:
            continue
        spec = parse_spec(result["proposal"])
        if check_spec(spec, fields):  # never the case for a draft at confirmation; kept as a guard
            continue
        specs[result["item_id"]] = spec
    return specs


def waiting_drafts(rules_db: Path) -> dict:
    """The AI-drafted rules in the rule database, as benchmark-style results: the confirmed
    ones (active, origin "agent"), then the drafts awaiting confirmation, which are newer.
    A rule still running its hand-written spec is not an AI rule and is left out."""
    connection = sqlite3.connect(f"file:{rules_db.as_posix()}?mode=ro", uri=True)
    try:
        active = connection.execute(
            "SELECT r.rule_id, r.spec FROM active_rule_specs a JOIN rule_spec_revisions r "
            "ON r.rule_id = a.rule_id AND r.revision = a.revision WHERE r.origin = 'agent'").fetchall()
        rows = connection.execute("SELECT record FROM rule_drafts WHERE state = ? ORDER BY created_at",
                                  (AWAITING_CONFIRMATION,)).fetchall()
    finally:
        connection.close()
    results = {rule_id: {"item_id": rule_id, "final_state": AWAITING_CONFIRMATION, "proposal": json.loads(spec)}
               for rule_id, spec in active}
    for (record,) in rows:
        draft = json.loads(record)
        if draft.get("proposal"):
            results[draft["rule_id"]] = {"item_id": draft["rule_id"], "final_state": draft["state"],
                                         "proposal": draft["proposal"]["spec"]}
    return {"results": list(results.values())}


def predict(split: str, specs: dict, catalogue: dict, reference: ReferenceData, out: Path) -> Path:
    claims = load_jsonl(BACKEND_ROOT / "data" / split / "claims.jsonl")
    path = out / f"{split}.predictions.jsonl"
    with path.open("w", encoding="utf-8") as stream:
        for claim in claims:
            validate_transport(claim)
            for rule_id in RULEBOOK:
                rule = catalogue[rule_id]
                if rule_id in specs:
                    result = run_rule(claim, rule, specs[rule_id], reference)
                else:
                    result = make_result(claim, rule, "NOT_IMPLEMENTED", [], NOT_PRODUCED)
                stream.write(json.dumps(result, ensure_ascii=False) + "\n")
    return path


def official_score(split: str, predictions: Path, out: Path) -> dict:
    """Run the official scorer exactly as a participant would."""
    score_path = out / f"{split}.score.json"
    data = BACKEND_ROOT / "data" / split
    command = [sys.executable, str(BACKEND_ROOT / "src" / "evaluate.py"), "--gold", str(data / "expected_results.jsonl"),
               "--pred", str(predictions), "--claims", str(data / "claims.jsonl"), "--output", str(score_path)]
    finished = subprocess.run(command, capture_output=True, text=True)
    if finished.returncode != 0:
        raise SystemExit(f"the official scorer rejected the {split} predictions: {finished.stderr.strip()}")
    return json.loads(score_path.read_text(encoding="utf-8"))


def combine(metrics: list[dict]) -> dict:
    """F1 and accuracy over several groups of results, from their counts."""
    tp, fp, fn, tn = (sum(m[key] for m in metrics) for key in ("tp", "fp", "fn", "tn"))
    count = sum(m["count"] for m in metrics)
    correct = sum(m["status_accuracy"] * m["count"] for m in metrics)
    return {
        "results": count,
        "issue_f1": round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else None,
        "precision": round(tp / (tp + fp), 4) if tp + fp else None,
        "recall": round(tp / (tp + fn), 4) if tp + fn else None,
        "false_alarm_rate": round(fp / (fp + tn), 4) if fp + tn else None,
        "status_accuracy": round(correct / count, 4) if count else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--report", type=Path, nargs="+",
                        help="run_rule_benchmark.py reports over R001-R015; for a rule in several, the last one counts "
                             "(e.g. a full run, then a re-run of the rules that failed)")
    source.add_argument("--drafts", action="store_true",
                        help="score the AI-drafted rules in the rule database, confirmed or awaiting "
                             "confirmation (read only)")
    parser.add_argument("--out", type=Path, help="folder for predictions and scores (default: next to the last report)")
    parser.add_argument("--splits", default=",".join(SPLITS),
                        help="splits to score, e.g. validation,stress when the drafter was given development "
                             "claims as examples (it must be scored on claims it never saw)")
    args = parser.parse_args()

    if args.drafts:
        rules_db = Path(default_database(BACKEND_ROOT))
        report = waiting_drafts(rules_db)
        sources = [str(rules_db)]
        out = args.out or BACKEND_ROOT / "outputs" / "drafted_rules_score"
    else:
        merged: dict[str, dict] = {}
        for path in args.report:
            for result in json.loads(path.read_text(encoding="utf-8"))["results"]:
                merged[result["item_id"]] = result
        report = {"results": list(merged.values())}
        sources = [str(path) for path in args.report]
        out = args.out or args.report[-1].with_suffix("")
    out.mkdir(parents=True, exist_ok=True)
    fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
    reference = ReferenceData.load(BACKEND_ROOT / "rules")
    catalogue = {rule["rule_id"]: rule for rule in json.loads((BACKEND_ROOT / "rules" / "rules.json").read_text(encoding="utf-8"))}
    specs = deployed_specs(report, fields)

    splits = [split.strip() for split in args.splits.split(",") if split.strip()]
    unknown = set(splits) - set(SPLITS)
    if unknown or not splits:
        parser.error(f"--splits takes some of: {', '.join(SPLITS)}")
    scores = {split: official_score(split, predict(split, specs, catalogue, reference, out), out) for split in splits}
    every_rule = {split: score["overall"] for split, score in scores.items()}
    produced = combine([score["by_rule"][rule_id] for score in scores.values() for rule_id in specs])
    by_rule = {
        rule_id: ("not produced" if rule_id not in specs else
                  combine([score["by_rule"][rule_id] for score in scores.values()])["status_accuracy"])
        for rule_id in RULEBOOK
    }
    summary = {
        "reports": sources,
        "rules_deployed": f"{len(specs)} of 15",
        "deployed": sorted(specs),
        "all_15_rules": {"per_split": every_rule, "combined": combine(list(every_rule.values()))},
        "deployed_rules_only": produced,
        "status_accuracy_by_rule": by_rule,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Rules the AI produced and the admin would confirm: {len(specs)} of 15 {sorted(specs)}")
    def show(value):
        return "-" if value is None else value

    print(f"{'':28} {'F1':>7} {'precision':>10} {'recall':>7} {'false alarms':>13} {'status acc.':>12}")
    rows = [(f"all 15 rules, {split}", combine([m])) for split, m in every_rule.items()]
    rows += [("all 15 rules, total", summary["all_15_rules"]["combined"]), ("produced rules only", produced)]
    for label, m in rows:
        print(f"{label:28} {show(m['issue_f1']):>7} {show(m['precision']):>10} {show(m['recall']):>7} "
              f"{show(m['false_alarm_rate']):>13} {show(m['status_accuracy']):>12}")
    print("Status accuracy by rule: " + ", ".join(f"{rule}={value}" for rule, value in by_rule.items()))
    print(f"Predictions, official scores and summary: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
