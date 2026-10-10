"""Claim transport checks, rule results, and running the active rules on a claim.

Rules run from data: each active rule has a spec in the rule database
(rule_engine.spec_store) that rule_engine.interpreter evaluates. See docs/RULE_ENGINE.md.
"""
import json
import logging
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from .catalogue import FieldCatalogue, ReferenceData
from .interpreter import Outcome, evaluate_rule
from .spec_store import SpecStore, default_database, reference_seed_file

logger = logging.getLogger(__name__)

# Rule-certainty heuristic (NOT a calibrated probability): exact checks on present data are
# near-certain; UNABLE_TO_ASSESS means inputs are missing, so confidence is low -> human review.
CONFIDENCE={'PASS':0.98,'FAIL':0.98,'NOT_APPLICABLE':0.98,'UNABLE_TO_ASSESS':0.40}
STATUSES={'PASS','FAIL','UNABLE_TO_ASSESS','NOT_APPLICABLE','NOT_IMPLEMENTED'}
def load_jsonl(path):
    with open(path,encoding='utf-8') as f:return [json.loads(line) for line in f if line.strip()]
def pointer(obj,path):
    for part in path.strip('/').split('/'):
        if path=='':return obj
        part=part.replace('~1','/').replace('~0','~')
        obj=obj[int(part)] if isinstance(obj,list) else obj[part]
    return obj
def valid_date(v):
    try:return date.fromisoformat(v)
    except (ValueError,TypeError):return None
def money(v):return Decimal(str(v)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
def empty(v):return v is None or (isinstance(v,str) and not v.strip())
def make_result(c,r,status,paths,message,line_ids=None):
    return {'claim_id':c['claim_id'],'rule_id':r['rule_id'],'rule_version':r['version'],
            'status':status,'severity':r['severity'],'affected_line_ids':line_ids or [],
            'evidence':[{'path':p,'value':pointer(c,p)} for p in dict.fromkeys(paths)],
            'rule_source':r['source'],'explanation':message,
            'corrective_action':r['corrective_action'] if status in ('FAIL','UNABLE_TO_ASSESS') else '',
            'confidence':CONFIDENCE.get(status),'confidence_kind':'uncalibrated' if status in CONFIDENCE else 'not_probabilistic',
            'requires_human_review':status in ('FAIL','UNABLE_TO_ASSESS'),
            'method':'deterministic','review_status':'unreviewed'}


# --------------------------------------------------------------------------
# Running rules
# --------------------------------------------------------------------------

RULE_ERROR_MESSAGE = "This rule could not be evaluated safely for this claim; manual review is required."


def config(root, rules_db=None):
    """Load everything rule evaluation needs, from a backend root directory.

    rules_db is the rule spec database (default: CLAIMGUARD_RULES_DB, else
    <root>/outputs/rules.sqlite3); the reference specs are seeded into it.

    Keys:
      rules     the full rule catalogue (rules.json), active or not
      policies  raw policies.json, services: raw services.json
      reference reference data in the form the interpreter reads it
      fields    the claim field catalogue (from claim.schema.json)
      specs     rule_id -> StoredSpec, for the rules that may run
      inactive  rule_id -> why a catalogue rule does not run
    """
    root = Path(root)
    rules = json.loads((root / "rules" / "rules.json").read_text(encoding="utf-8"))
    reference = ReferenceData.load(root / "rules")
    fields = FieldCatalogue.from_backend_root(root)
    with SpecStore(rules_db or default_database(root), reference_seed_file(root)) as store:
        loaded = store.load_active(rules, fields)
    return {
        "rules": rules,
        "policies": reference.policies,
        "services": reference.services,
        "reference": reference,
        "fields": fields,
        "specs": loaded.active,
        "inactive": loaded.inactive,
    }


def active_rules(cfg):
    return [rule for rule in cfg["rules"] if rule["rule_id"] in cfg["specs"]]


def baseline(c, cfg):
    """Evaluate every active rule on one claim. Inactive rules are skipped."""
    return [
        run_rule(c, rule, cfg["specs"][rule["rule_id"]].spec, cfg["reference"])
        for rule in active_rules(cfg)
    ]


def run_rule(claim, rule, spec, reference):
    """Evaluate one rule. Any failure becomes UNABLE_TO_ASSESS, never an exception."""
    try:
        outcome = evaluate_rule(spec, claim, reference)
    except Exception:  # one broken rule must never break the evaluation of a claim
        logger.exception("rule %s could not be evaluated", rule.get("rule_id"))
        outcome = Outcome(status="UNABLE_TO_ASSESS", message=RULE_ERROR_MESSAGE)
    result = make_result(claim, rule, outcome.status, [], outcome.message, outcome.affected_line_ids)
    evidence = outcome.evidence or [("/claim_id", claim["claim_id"])]
    result["evidence"] = [{"path": path, "value": value} for path, value in evidence]
    return result


def validate_transport(c):
    """Validate the documented teaching envelope, not clinical/FHIR conformity."""
    required=['schema_version','claim_id','invoice_number','patient_id','member_id','provider_id','payer_id','policy_id','diagnosis_code','submission_date','currency','total_amount','coverage','lines','authorizations','attachments','notes']
    if not isinstance(c,dict) or set(c)!=set(required):raise ValueError('Unexpected or missing envelope keys')
    for k in ('schema_version','claim_id','patient_id','provider_id','payer_id','policy_id','submission_date','currency','notes'):
        if not isinstance(c[k],str) or not c[k]:raise ValueError('Expected nonempty string: '+k)
    for k in ('invoice_number','member_id','diagnosis_code'):
        if c[k] is not None and not isinstance(c[k],str):raise ValueError(k)
    if not valid_date(c['submission_date']):raise ValueError('Invalid submission date')
    if not isinstance(c['lines'],list) or not c['lines']:raise ValueError('Expected nonempty lines')
    ids=[]
    for l in c['lines']:
        if set(l)!=set(('line_id','service_code','service_date','modifier','quantity','unit_price','net_amount','authorization_id')):raise ValueError('Line keys')
        if not isinstance(l['line_id'],str) or not l['line_id']:raise ValueError('line_id')
        ids.append(l['line_id'])
        for k in ('service_code','service_date','modifier','authorization_id'):
            if l[k] is not None and not isinstance(l[k],str):raise ValueError('Line string '+k)
        if l['service_date'] is not None and not valid_date(l['service_date']):raise ValueError('Invalid service date')
        for k in ('quantity','unit_price','net_amount'):
            if l[k] is not None and (isinstance(l[k],bool) or not isinstance(l[k],(int,float))):raise ValueError('Line number '+k)
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate line ID')
    if not isinstance(c['coverage'],dict) or not isinstance(c['authorizations'],list) or not isinstance(c['attachments'],list):raise ValueError('Expected context structures')
