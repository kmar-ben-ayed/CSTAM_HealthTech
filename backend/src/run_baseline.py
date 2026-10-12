"""Run the implemented baseline checks. Extend engine_core.baseline for your MVP."""
import argparse, json
from pathlib import Path
import paths
from rule_engine.engine_core import config, load_jsonl, baseline, validate_transport

# The official scorer (evaluate.py) accepts the challenge rulebook R001-R015 only.
# Rules added later through rule management run in the app but are left out here
# unless --all-rules is given, so adding a rule never breaks the official scoring.
RULEBOOK_SOURCE = 'fictional-rulebook/'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',default='data/development/claims.jsonl');p.add_argument('--output',default='outputs/predictions.jsonl');p.add_argument('--limit',type=int)
    p.add_argument('--all-rules',action='store_true',help='also output rules added after the challenge rulebook (R016 and later)')
    a=p.parse_args();cfg=config(Path(__file__).resolve().parents[1]);claims=load_jsonl(a.input)
    if a.limit is not None:claims=claims[:a.limit]
    out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('w',encoding='utf-8') as f:
        for c in claims:
            validate_transport(c)
            for result in baseline(c,cfg):
                if a.all_rules or result['rule_source'].startswith(RULEBOOK_SOURCE):
                    f.write(json.dumps(result,ensure_ascii=False)+'\n')
    rules='all active rules' if a.all_rules else 'R001-R015 (challenge rulebook)'
    print(f'Processed {len(claims)} claims. Rules: {rules}. Output: {out}')
if __name__=='__main__':main()
