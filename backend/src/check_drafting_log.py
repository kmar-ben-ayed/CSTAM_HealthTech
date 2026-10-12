"""What happened while a rule was drafted, and where our code steered the model: a check of a log.

    python src/check_drafting_log.py outputs/hard_v11_R009.replies.jsonl
    python src/check_drafting_log.py outputs/regenerate_X.replies.jsonl --rule R008

Reads a log written by the benchmark or the regeneration script. Since 2026-10-12 it holds
both sides, in time order: every model call (the message our code sent before it, and the
model's reply) and what the pipeline did (checks passed or failed and why, the questions the
admin was asked and the answers, the admin's corrections and confirmations).

The report has three parts:

1. A summary: how long, how many drafting sessions and model calls, the questions and
   corrections, how it ended, and (for an official rule) its best draft and its last one,
   scored on the official development claims as the deployment gate scores them.
2. The story, session by session: why each session started (the first draft, the admin's
   answers or corrections, failed checks), what we sent and what the model did each turn.
3. Warnings, where our code may have steered the model wrong:
   - a message of ours that came back 3 or more times in a row while the model kept making
     the mistake: it does not tell the model what to do (R008 got "use it inside count" 9
     times when its field was inside count already);
   - a draft that got worse right after something we sent, with what we sent: a correction,
     an answer or a problem that pushed the model the wrong way (R009 was right on all 400
     claims, was corrected on a duplicated record the text never mentions, and broke 159).

A warning names a message, never a rule: the fix it calls for is a better message for every
rule. Logs written before 2026-10-12 have only the model's side.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import paths  # noqa: F401  (makes the sub-packages importable)
from rule_authoring.drafter import _lift_misplaced_fields, lift_wildcard_paths, normalise_values
from rule_authoring.sheet import SheetError, compile_sheet, is_sheet
from rule_benchmark.official import DECIDE_ON, expected_outcomes, official_claims, score
from rule_engine.catalogue import FieldCatalogue, ReferenceData
from rule_engine.language import SpecError, parse_spec

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPEATED = 3  # the same problem this many times in a row is a message the model cannot act on
# Pipeline notes that the log's own records say better ("asked", "admin answered", "admin review").
COVERED = {"question", "answered", "corrected", "cases confirmed"}


@dataclass
class Call:
    """A model call: what our code sent, and what the model replied."""

    minute: float
    rule_id: str
    turn: int
    sent: Any  # None when the log predates recording our side
    reply: dict[str, Any] | None
    error: str = ""
    wrong: int | None = None  # official development claims the reply's draft gets wrong
    compile_problems: list[str] = field(default_factory=list)
    raw: str = ""  # the model's text when it could not be read as one JSON object
    seconds: float | None = None  # how long the call took, retries and timeouts included
    requests: list[dict[str, Any]] = field(default_factory=list)  # each request: budget, end, tokens

    @property
    def starts_session(self) -> bool:
        return self.turn == 2


@dataclass
class Event:
    """Something the pipeline did: a check, a question, an answer, a correction."""

    minute: float
    rule_id: str
    name: str
    data: dict[str, Any]


def read_rows(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_inputs(path: Path) -> list[dict[str, Any]]:
    """The model's instructions and the task's unchanging parts (written once per log)."""
    return [row for row in read_rows(path) if "system_prompt" in row]


def read_log(path: Path) -> list[Call | Event]:
    rows = [row for row in read_rows(path) if "system_prompt" not in row]
    if not rows:
        return []
    start = min(row["time"] for row in rows)
    items: list[Call | Event] = []
    for row in sorted(rows, key=lambda row: row["time"]):
        rule_id, _, role = row["call"].partition("/")
        if not role and row.get("rule"):
            # The regeneration script labels a model call "drafter" and names the rule apart.
            rule_id, role = row["rule"], row["call"]
        minute = round((row["time"] - start) / 60, 1)
        if role == "pipeline":
            items.append(Event(minute, rule_id, row["event"], row))
        elif role.startswith("drafter"):
            items.append(Call(minute, rule_id, row["turn"], row.get("sent"), row.get("reply"), row.get("error", ""),
                              raw=row.get("raw", ""), seconds=row.get("seconds"), requests=row.get("requests") or []))
    return items


def draft_of(reply: dict[str, Any] | None) -> Any:
    """The sheet or spec in a reply, after the same repairs the drafter applies."""
    if not isinstance(reply, dict):
        return None
    draft = _lift_misplaced_fields(reply).get("spec")
    return draft if isinstance(draft, dict) else None


def compile_draft(draft: dict[str, Any], fields: FieldCatalogue):
    if is_sheet(draft):
        return parse_spec(compile_sheet(draft, fields))
    return parse_spec(normalise_values(lift_wildcard_paths(draft)))


def score_calls(calls: list[Call]) -> None:
    fields = FieldCatalogue.from_backend_root(BACKEND_ROOT)
    reference = ReferenceData.load(BACKEND_ROOT / "rules")
    claims, expected = official_claims(BACKEND_ROOT), expected_outcomes(BACKEND_ROOT)
    for call in calls:
        draft = draft_of(call.reply)
        if draft is None or call.rule_id not in expected:
            continue
        try:
            spec = compile_draft(draft, fields)
        except (SheetError, SpecError) as error:
            call.compile_problems = list(error.problems)
            continue
        result = score(spec, expected[call.rule_id], claims, reference, DECIDE_ON)
        call.wrong = result["claims"] - result["agree"]


# ------------------------------------------------------------------ describing

def describe_sent(sent: Any) -> str:
    if sent is None:
        return "(not recorded)"
    if isinstance(sent, dict) and "rule" in sent:
        parts = [f"the task: {len(sent.get('author_examples', []))} outcomes to reproduce, "
                 f"{len(sent.get('author_confirmed', []))} confirmed outcomes to keep, "
                 f"{'its last draft to start from' if sent.get('your_last_draft') else 'no earlier draft'}"]
        for answer in sent.get("author_answers", []):
            parts.append(f'admin\'s answer "{answer["answer"]}" to "{answer["question"][:110]}"')
        if sent.get("feedback_from_previous_attempt"):
            parts.append("feedback: " + "; ".join(sent["feedback_from_previous_attempt"])[:240])
        return "\n                  ".join(parts)
    if isinstance(sent, dict) and "tool_result" in sent:
        result = sent["tool_result"]
        if result.get("problems"):
            return "problems: " + " || ".join(result["problems"])[:300]
        if "generated_cases" in result:
            outcomes = Counter(case["outcome"] for case in result["generated_cases"])
            missed = [example for example in result.get("author_examples", []) if example["outcome"] != example["expected"]]
            changed = result.get("author_confirmed_changed", [])
            return (f"try results: {len(result['generated_cases'])} test claims {dict(outcomes)}; "
                    f"admin outcomes missed {len(missed)}, confirmed outcomes changed {len(changed)}")
        return "ok, no problems" + (f" ({result['notice']})" if result.get("notice") else "")
    return str(sent)[:200]


def describe_reply(call: Call) -> str:
    if call.error:
        return f"error: {call.error[:120]}"
    action = (call.reply or {}).get("action", "?")
    if call.wrong is not None:
        return f"{action}: a draft with {call.wrong}/400 development claims wrong"
    if call.compile_problems:
        return f"{action}: a draft that does not compile ({call.compile_problems[0][:100]})"
    if action == "ask_author":
        return f"ask_author: {(call.reply.get('question') or '')[:140]}"
    if action == "unsupported":
        return f"unsupported: {(call.reply.get('reason') or '')[:140]}"
    return action


def describe_event(event: Event) -> str | None:
    data = event.data
    if event.name in COVERED:
        return None
    if event.name == "asked":
        claims = data.get("claims") or []
        drafted = Counter(claim["drafted"] for claim in claims)
        return (f"ADMIN ASKED ({data['kind']}): {data['text'][:220]}"
                + (f"\n                  covers {_count(len(claims), 'test claim')}, the draft gives {dict(drafted)}"
                   if claims else ""))
    if event.name == "admin answered":
        return f"ADMIN ANSWERED ({data['kind']}): {data['answer'][:160]}"
    if event.name == "admin review":
        lines = [f"ADMIN REVIEW: {len(data['corrections'])} corrected, {data['confirmed']} confirmed"]
        lines += [f'  "{c["description"][:110]}": {c["drafted"]} -> {c["right"]}' for c in data["corrections"][:6]]
        return "\n                  ".join(lines)
    if event.name == "ready for review":
        return f"TEST CLAIMS for the admin's review: {data.get('outcomes')}"
    if event.name == "finished":
        return f"FINISHED: {data['state']}" + (f" ({data['reason'][:160]})" if data.get("reason") else "")
    detail = data.get("detail", "")
    return f"{event.name.upper()}" + (f": {detail[:260]}" if detail else "")


def _count(number: int, noun: str) -> str:
    return f"{number} {noun}" + ("" if number == 1 else "s")


def session_reason(previous: list[Event]) -> str:
    """Why a drafting session started, from the pipeline's events just before it."""
    names = [event.name for event in previous]
    if "admin review" in names:
        return "after the admin's corrections"
    if "admin answered" in names or "answered" in names:
        return "after the admin's answers"
    if "checks failed" in names:
        return "after the checks failed"
    if "examples given" in names:
        return "after the admin gave example claims"
    if "submitted" in names:
        return "the first draft"
    return "a new session"


# ------------------------------------------------------------------ warnings

def repeated_problems(calls: list[Call]) -> list[tuple[str, int]]:
    """Problems we sent in REPEATED or more tool results in a row, with the longest run."""
    longest: Counter = Counter()
    run: Counter = Counter()
    for call in calls:
        sent = call.sent if isinstance(call.sent, dict) else {}
        problems = set(sent.get("tool_result", {}).get("problems", [])) if "tool_result" in sent else set()
        if call.starts_session:
            run = Counter()
        run = Counter({problem: run[problem] + 1 for problem in problems})
        for problem, count in run.items():
            longest[problem] = max(longest[problem], count)
    return [(problem, count) for problem, count in longest.most_common() if count >= REPEATED]


def regressions(items: list[Call | Event]) -> list[tuple[Call, Call, list[Call | Event]]]:
    """Each scored draft worse than the scored draft before it, with what happened in between."""
    found, previous, between = [], None, []
    for item in items:
        if isinstance(item, Call) and item.wrong is not None:
            if previous is not None and item.wrong > previous.wrong:
                found.append((previous, item, between + [item]))
            previous, between = item, []
        else:
            between.append(item)
    return found


def describe_item(item: Call | Event) -> str | None:
    return describe_event(item) if isinstance(item, Event) else describe_sent(item.sent)


# ------------------------------------------------------------------ report

def _block(value: Any, indent: str = "           | ") -> str:
    """A full input or output, indented under its line."""
    text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False)
    return "\n".join(indent + line for line in text.splitlines())


def report(items: list[Call | Event], inputs: list[dict[str, Any]] | None = None, full: bool = False) -> list[str]:
    calls = [item for item in items if isinstance(item, Call)]
    events = [item for item in items if isinstance(item, Event)]
    out: list[str] = []
    rules = sorted({item.rule_id for item in items})
    scored = [call for call in calls if call.wrong is not None]
    asked = Counter(event.data["kind"] for event in events if event.name == "asked")
    reviews = [event for event in events if event.name == "admin review"]
    finished = next((event for event in reversed(events) if event.name == "finished"), None)
    out.append(f"Summary ({', '.join(rules)})")
    out.append(f"  {items[-1].minute if items else 0} minutes, {sum(call.starts_session for call in calls)} drafting "
               f"sessions, {len(calls)} model calls ({sum(bool(call.error) for call in calls)} unreadable)")
    out.append(f"  questions to the admin: {dict(asked) or 'none'}; corrections: "
               f"{sum(len(event.data['corrections']) for event in reviews)} in {len(reviews)} reviews")
    if scored:
        best = min(scored, key=lambda call: call.wrong)
        out.append(f"  best draft: {best.wrong}/400 wrong at minute {best.minute}; last draft: "
                   f"{scored[-1].wrong}/400 wrong at minute {scored[-1].minute}")
    timed = [call for call in calls if call.seconds is not None]
    if timed:
        slowest = max(timed, key=lambda call: call.seconds)
        out.append(f"  model time: {sum(call.seconds for call in timed) / 60:.1f} minutes in all; slowest call "
                   f"{slowest.seconds:.0f}s at minute {slowest.minute}")
    out.append(f"  ended: {finished.data['state'] + (' - ' + finished.data['reason'][:140] if finished.data.get('reason') else '') if finished else 'still running, or stopped'}")
    recorded_side = sum(call.sent is not None for call in calls)
    out.append(f"  recorded: what we sent for {recorded_side} of {len(calls)} calls, the model's reply for all; "
               + (f"the model's instructions and the task's unchanging parts ({len(inputs)} version"
                  f"{'' if len(inputs) == 1 else 's'}, system prompt {len(inputs[0]['system_prompt'])} characters)"
                  if inputs else "the model's instructions not recorded"))
    if full and inputs:
        for version in inputs:
            out.append(f"\nWhat every session starts with (inputs {version['inputs']})")
            out.append("  the system prompt:")
            out.append(_block(version["system_prompt"]))
            out.append("  the task's unchanging parts:")
            out.append(_block(version["task_unchanging_parts"]))

    out.append("\nThe story")
    pending: list[Event] = []
    for item in items:
        if isinstance(item, Event):
            pending.append(item)
            text = describe_event(item)
            if text:
                out.append(f"  {item.minute:5.1f}  {text}")
            continue
        if item.starts_session:
            out.append(f"\n  --- drafting session at minute {item.minute}: {session_reason(pending)}")
            pending = []
        out.append(f"  {item.minute:5.1f}  we sent: {describe_sent(item.sent)}")
        if full and item.sent is not None:
            out.append(_block(item.sent))
        took = f" ({item.seconds:.0f}s{describe_requests(item.requests)})" if item.seconds is not None else ""
        out.append(f"         model{took}: {describe_reply(item)}")
        if full:
            out.append(_block(item.reply if item.reply is not None else (item.raw or item.error)))

    out.append("\nWarnings (each names a message, so its fix is for every rule)")
    repeats = repeated_problems(calls)
    for problem, count in repeats:
        out.append(f"- we sent this {count} times in a row, and the model kept making the mistake:\n    {problem[:300]}")
    worse = regressions(items)
    for before, after, between in worse:
        out.append(f"- a draft got worse, {before.wrong} -> {after.wrong} wrong (minute {before.minute} -> {after.minute}), after:")
        for item in between:
            text = describe_item(item)
            if text and text != "(not recorded)":
                out.append(f"    {item.minute:5.1f}  {text[:300]}")
    if not repeats and not worse:
        out.append("- none")
    if any(call.sent is None for call in calls):
        out.append("(this log predates recording our side: what we sent is missing)")
    return out


# ------------------------------------------------------------------ patterns across rules

def message_template(problem: str) -> str:
    """A problem message without its particulars (quoted values, numbers), so the same message
    about different fields or rules counts as one."""
    return re.sub(r"\d+", "N", re.sub(r'"[^"]*"', '"..."', problem))


def describe_requests(requests: list[dict[str, Any]]) -> str:
    """", 2 requests: 8000 tokens cut off, then 16000; 9100 tokens thinking" - why a call was slow."""
    if not requests:
        return ""
    thinking = sum(request.get("reasoning_tokens") or 0 for request in requests)
    tokens = sum(request.get("completion_tokens") or 0 for request in requests)
    parts = [f"{len(requests)} requests: " + ", then ".join(
        f"{request['max_tokens']} tokens" + (" cut off" if request.get("finish_reason") == "length" else "")
        for request in requests)] if len(requests) > 1 else []
    if tokens:
        parts.append(f"{tokens} tokens out" + (f", {thinking} thinking" if thinking else ""))
    return "".join(f", {part}" for part in parts)


def edit_kinds(before: Any, after: Any) -> list[str]:
    """What the model changed between two drafts, in words."""
    if not (isinstance(before, dict) and isinstance(after, dict) and is_sheet(before) and is_sheet(after)):
        return ["rewrote the full spec"]
    kinds = [f"changed {part}" for part in ("outcomes", "needs", "applies_if") if (before.get(part) or []) != (after.get(part) or [])]
    old, new = before.get("checks") or [], after.get("checks") or []
    if len(new) > len(old):
        kinds.append("added a check")
    elif len(new) < len(old):
        kinds.append("removed a check")
    elif old != new:
        kinds.append("changed a check")

    def placed(checks: list[Any], part: str) -> set[str]:
        return {json.dumps(item, sort_keys=True) for check in checks if isinstance(check, dict)
                for item in check.get(part) or []}
    moved_in = placed(new, "where") & placed(old, "then")
    moved_out = placed(new, "then") & placed(old, "where")
    if moved_in or moved_out:
        kinds.append("moved conditions between then and where")
    return kinds or ["no change to the draft"]


def trigger(between: list[Call | Event]) -> str:
    """The last thing that happened before a draft got worse."""
    for item in reversed(between[:-1] + [between[-1]] if between else []):
        if isinstance(item, Event) and item.name == "admin review":
            return "after the admin's corrections"
        if isinstance(item, Event) and item.name == "admin answered":
            return "after the admin's answers"
        if isinstance(item, Call) and isinstance(item.sent, dict):
            result = item.sent.get("tool_result")
            if result is None:
                return "at the start of a session"
            if result.get("problems"):
                return "after a problem message"
            if "generated_cases" in result:
                return "after its own test results"
            return "after an ok"
    return "unknown (not recorded)"


def patterns(logs: dict[str, list[Call | Event]]) -> list[str]:
    out = ["Rules", f"  {'rule':6} {'min':>5} {'sessions':>8} {'calls':>5} {'best':>9} {'last':>5}  ended"]
    messages: dict[str, Counter] = {}
    edits: Counter = Counter()
    triggers: Counter = Counter()
    for name, items in logs.items():
        calls = [item for item in items if isinstance(item, Call)]
        events = [item for item in items if isinstance(item, Event)]
        scored = [call for call in calls if call.wrong is not None]
        finished = next((event for event in reversed(events) if event.name == "finished"), None)
        best = min(scored, key=lambda call: call.wrong) if scored else None
        rule = calls[0].rule_id if calls else name
        out.append(f"  {rule:6} {items[-1].minute if items else 0:5.0f} {sum(c.starts_session for c in calls):8} {len(calls):5} "
                   f"{(str(best.wrong) + '@' + str(round(best.minute))) if best else '-':>9} "
                   f"{scored[-1].wrong if scored else '-':>5}  {finished.data['state'] if finished else 'not finished'}")
        streaks = dict(repeated_problems(calls))
        regressed = regressions(items)
        for call in calls:
            result = call.sent.get("tool_result", {}) if isinstance(call.sent, dict) else {}
            for problem in result.get("problems", []):
                entry = messages.setdefault(message_template(problem), Counter())
                entry["sent"] += 1
                entry[f"rule:{rule}"] = 1
        for problem, streak in streaks.items():
            messages[message_template(problem)]["repeated"] += 1
        for before, after, between in regressed:
            for kind in edit_kinds(draft_of(before.reply), draft_of(after.reply)):
                edits[kind] += 1
            triggers[trigger(between)] += 1
            for item in between:
                result = item.sent.get("tool_result", {}) if isinstance(item, Call) and isinstance(item.sent, dict) else {}
                for problem in result.get("problems", []):
                    messages[message_template(problem)]["before a worse draft"] += 1

    def rules_of(entry: Counter) -> int:
        return sum(1 for key in entry if key.startswith("rule:"))

    out.append("\nOur messages, most suspicious first (repeated without effect, or right before a worse draft)")
    ranked = sorted(messages.items(), key=lambda item: (-(item[1]["repeated"] + item[1]["before a worse draft"]),
                                                       -rules_of(item[1]), -item[1]["sent"]))
    for template, entry in ranked[:15]:
        out.append(f"  sent {entry['sent']:3}x in {rules_of(entry)} rule(s), repeated {entry['repeated']}, "
                   f"before a worse draft {entry['before a worse draft']}: {template[:200]}")
    out.append("\nWhen drafts got worse: what came just before")
    out += [f"  {count:3}  {name}" for name, count in triggers.most_common()] or ["  never"]
    out.append("\nWhen drafts got worse: what the model changed")
    out += [f"  {count:3}  {name}" for name, count in edits.most_common()] or ["  never"]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("log", type=Path, nargs="+",
                        help="a .replies.jsonl file; several (or --patterns) for the patterns across rules")
    parser.add_argument("--patterns", action="store_true",
                        help="the patterns across the logs: a line per rule, our messages ranked by how often they "
                             "came before a worse draft or repeated without effect, and what preceded each worse draft")
    parser.add_argument("--rule", help="only this rule (a log can hold several)")
    parser.add_argument("--full", action="store_true",
                        help="print every input and output in full: the system prompt and the task once, then "
                             "for each call what we sent and what the model replied")
    parser.add_argument("--out", type=Path, help="write the report to this file instead of the screen")
    args = parser.parse_args()
    if args.patterns or len(args.log) > 1:
        logs = {}
        for path in args.log:
            items = [item for item in read_log(path) if not args.rule or item.rule_id == args.rule]
            score_calls([item for item in items if isinstance(item, Call)])
            logs[path.name] = items
        text = "\n".join(patterns(logs))
    else:
        items = [item for item in read_log(args.log[0]) if not args.rule or item.rule_id == args.rule]
        score_calls([item for item in items if isinstance(item, Call)])
        text = "\n".join(report(items, read_inputs(args.log[0]), full=args.full))
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
        print(f"Report: {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
