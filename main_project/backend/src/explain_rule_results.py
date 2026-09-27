import argparse
import json
import os
from pathlib import Path

from openai import OpenAI
from llm_adapter import GroundedExplanationAgent, MockExplanationProvider, OpenAIExplanationProvider, load_project_env


def load_jsonl(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def make_finding(result: dict) -> dict:
    return {
        "claim_id": result.get("claim_id"),
        "rule_id": result.get("rule_id"),
        "status": result.get("status"),
        "severity": result.get("severity"),
        "explanation": result.get("explanation", ""),
        "corrective_action": result.get("corrective_action", ""),
        "requires_human_review": bool(result.get("requires_human_review", False)),
        "evidence": result.get("evidence", []),
    }


def make_rule(result: dict) -> dict:
    return {
        "rule_id": result.get("rule_id"),
        "version": result.get("rule_version"),
        "source": result.get("rule_source"),
        "severity": result.get("severity"),
    }


def build_agent():
    load_project_env()
    api_key = os.environ.get("OPENAI_API_KEY")

    if not api_key:
        return GroundedExplanationAgent(MockExplanationProvider())

    client = OpenAI(
        api_key=api_key,
        base_url="https://integrate.api.nvidia.com/v1",
        timeout=20.0,
        max_retries=0,
    )
    provider = OpenAIExplanationProvider(client, model_name="meta/llama-3.1-8b-instruct", timeout_seconds=20.0)
    return GroundedExplanationAgent(provider)


def main():
    p = argparse.ArgumentParser(description="Generate AI explanations from rule-engine results.")
    p.add_argument("--input", required=True, help="JSONL file with rule-engine results")
    p.add_argument("--output", required=True, help="JSONL file to write explanations to")
    p.add_argument("--claim-id", help="Optional claim id filter")
    p.add_argument("--rule-id", help="Optional rule id filter")
    args = p.parse_args()

    results = load_jsonl(args.input)
    if args.claim_id:
        results = [r for r in results if r.get("claim_id") == args.claim_id]
    if args.rule_id:
        results = [r for r in results if r.get("rule_id") == args.rule_id]

    if not results:
        raise ValueError("No rule-engine result matched the filters.")

    agent = build_agent()
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with out_path.open("w", encoding="utf-8") as out_file:
        for item in results:
            finding = make_finding(item)
            rule = make_rule(item)
            explanation = agent.explain(finding, rule)
            out_file.write(json.dumps(explanation, ensure_ascii=False) + "\n")

    print(f"Processed {len(results)} rule result(s). Output: {out_path}")


if __name__ == "__main__":
    pass
