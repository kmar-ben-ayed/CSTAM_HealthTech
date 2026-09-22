"""Shared transport, evidence and three-rule baseline; standard library only."""
from pathlib import Path
import json
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

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
def config(root):
    return {n:json.loads((Path(root)/'rules'/f'{n}.json').read_text(encoding='utf-8')) for n in ['rules','policies','services']}
def make_result(c,r,status,paths,message,line_ids=None):
    return {'claim_id':c['claim_id'],'rule_id':r['rule_id'],'rule_version':r['version'],
            'status':status,'severity':r['severity'],'affected_line_ids':line_ids or [],
            'evidence':[{'path':p,'value':pointer(c,p)} for p in dict.fromkeys(paths)],
            'rule_source':r['source'],'explanation':message,
            'corrective_action':r['corrective_action'] if status in ('FAIL','UNABLE_TO_ASSESS') else '',
            'confidence':None,'confidence_kind':'not_probabilistic',
            'requires_human_review':status in ('FAIL','UNABLE_TO_ASSESS'),
            'method':'deterministic','review_status':'unreviewed'}

def base_check(c,r,cfg):
    rid=r['rule_id'];paths=[];ids=[];unknown=[]
    if rid=='R001':
        for k in ['invoice_number','member_id','diagnosis_code']:
            if empty(c[k]):paths.append('/'+k)
        for i,l in enumerate(c['lines']):
            for k in ['service_date','service_code','quantity','unit_price','net_amount']:
                if empty(l[k]):paths.append(f'/lines/{i}/{k}');ids.append(l['line_id'])
        return make_result(c,r,'FAIL' if paths else 'PASS',paths or ['/invoice_number','/member_id','/diagnosis_code','/lines'], 'Required information is missing.' if paths else 'Required information is present.',sorted(set(ids)))

    if rid == "R002":
        status = "PASS"
        error_msg = ""

        for i, l in enumerate(c["lines"]):
            if empty(l['service_date']) or not valid_date(l['service_date']):
                paths.append(f"/lines/{i}/service_date")
                paths.append("/submission_date")
                ids.append(l["line_id"])
                status = "UNABLE_TO_ASSESS"
                error_msg = f"Service date in line {i} is missing or invalid."

            elif empty(c["submission_date"]) or not valid_date(c["submission_date"]):
                paths.append("/submission_date")
                error_msg = "Submission date is missing or invalid."
                status = "UNABLE_TO_ASSESS"

            elif valid_date(l["service_date"]) > valid_date(c["submission_date"]):
                paths.append("/submission_date")
                paths.append(f"/lines/{i}/service_date")
                ids.append(l["line_id"])
                error_msg = f"Service date in line {i} is after submission date."
                status = "FAIL"

        return make_result(
            c,
            r,
            status if paths else "PASS",
            paths or ["/submission_date", "/lines"],
            error_msg if paths else "All service dates are on or before the submission date.",
            sorted(set(ids)))

    
    if rid=='R003':
        cv=c['coverage'];start=valid_date(cv['start_date']);end=valid_date(cv['end_date'])
        paths=['/coverage/status','/coverage/start_date','/coverage/end_date'];failed=[]
        if empty(cv['status']):unknown.append('coverage status')
        elif cv['status']!='active':failed.append('coverage status is not active')
        if not start or not end:unknown.append('coverage period')
        for i,l in enumerate(c['lines']):
            paths.append(f'/lines/{i}/service_date');d=valid_date(l['service_date'])
            if not d:unknown.append('service date');continue
            if (start and d<start) or (end and d>end):failed.append('service outside coverage period');ids.append(l['line_id'])
        status='FAIL' if failed else 'UNABLE_TO_ASSESS' if unknown else 'PASS'
        msg='; '.join(sorted(set(failed)))+('; Additional unknown inputs: '+', '.join(sorted(set(unknown))) if unknown else '') if failed else '; '.join(sorted(set(unknown))) if unknown else 'All service dates are within active coverage, including boundaries.'
        return make_result(c,r,status,paths,msg,ids)


    if rid == "R004":
        status = "PASS"
        error_msg = ""

        if empty(c["member_id"]) or empty(c["coverage"]["member_id"]):
            paths.extend(["/member_id", "/coverage/member_id"])
            error_msg = "Member identifier is missing or unavailable."
            status = "UNABLE_TO_ASSESS"
        elif c["member_id"] != c["coverage"]["member_id"]:
            paths.extend(["/member_id", "/coverage/member_id"])
            error_msg = "Member ID does not match coverage member ID."
            status = "FAIL"

        elif empty(c["patient_id"]) or empty(c["coverage"]["beneficiary_patient_id"]):
            paths.extend(["/patient_id", "/coverage/beneficiary_patient_id"])
            if status != "FAIL":
                status = "UNABLE_TO_ASSESS"
                error_msg = "Patient identifier is missing or unavailable."
        elif c["patient_id"] != c["coverage"]["beneficiary_patient_id"]:
            paths.extend(["/patient_id", "/coverage/beneficiary_patient_id"])
            error_msg = "Patient ID does not match coverage beneficiary patient ID."
            status = "FAIL"

        return make_result(
            c,
            r,
            status if paths else "PASS",
            paths or ["/member_id", "/patient_id", "/coverage"],
            error_msg if paths else "Member and beneficiary identifiers match coverage.",
            sorted(set(ids))
        )


    if rid == "R005":
        provider_id = c["provider_id"]
        
        if empty(provider_id):
            paths.append("/provider_id")
            return make_result(c, r, "UNABLE_TO_ASSESS", paths, "Provider identifier is missing or unavailable.", sorted(set(ids)))

        elif c["policy_id"] not in ("EDU-BASIC", "EDU-PLUS"):
            paths.append("/policy_id")
            return make_result(c, r, "UNABLE_TO_ASSESS", paths, "Policy ID is missing or unavailable.", sorted(set(ids)))
        
        policy= cfg["policies"][c["policy_id"]]

        if provider_id not in policy["allowed_providers"]:
            paths.append("/provider_id")
            return make_result(c, r, "FAIL", paths, "Provider ID is not allowed.", sorted(set(ids)))

        return make_result(c, r, "PASS", paths or ["/provider_id", "/policy_id"], "Provider ID is allowed.", sorted(set(ids)))

        
    if rid=='R006':
        seen={};dups=[];missing=False
        for i,l in enumerate(c['lines']):
            if empty(l['service_code']) or not valid_date(l['service_date']):missing=True;continue
            k=(l['service_code'],l['service_date'],l['modifier'] or '')
            if k in seen:dups.extend([seen[k],i])
            else:seen[k]=i
        for i in sorted(set(dups)):
            ids.append(c['lines'][i]['line_id'])
            paths.extend(f'/lines/{i}/{k}' for k in ('service_code','service_date','modifier'))
        status='FAIL' if dups else 'UNABLE_TO_ASSESS' if missing else 'PASS'
        return make_result(c,r,status,paths or ['/lines'],('Possible duplicate lines require review.'+(' Additional lines have missing inputs.' if missing else '')) if dups else 'Missing inputs prevent a complete duplicate check.' if missing else 'No duplicate service/date/modifier combinations.',ids)


    if rid=='R007':
        missing=False   
        failed=False
        for i,l in enumerate(c['lines']):
            numeric_paths=[f'/lines/{i}/{k}' for k in ('quantity','unit_price','net_amount')]
            if any(l[k] is None for k in ('quantity','unit_price','net_amount')):
                missing=True
                paths.extend(path for k,path in zip(('quantity','unit_price','net_amount'),numeric_paths) if l[k] is None)
                continue

            expected=money(Decimal(str(l['quantity']))*Decimal(str(l['unit_price'])))
            actual=money(l['net_amount'])
            if abs(expected-actual)>Decimal('.01'):
                failed=True
                paths.append(f'/lines/{i}/net_amount')
                paths.append(f'/lines/{i}/quantity')
                paths.append(f'/lines/{i}/unit_price')
                ids.append(l['line_id'])

        status='FAIL' if failed else 'UNABLE_TO_ASSESS' if missing else 'PASS'
        message=('Net amount does not equal quantity * unit price for some lines.' if failed
                 else 'Missing numeric inputs prevent a complete arithmetic check.' if missing
                 else 'All net amounts are correct.')
        return make_result(c,r,status,paths or ['/lines'],message,sorted(set(ids)))

    if rid=='R008':
        



    return None

def baseline(c,cfg):
    return [base_check(c,r,cfg) or make_result(c,r,'NOT_IMPLEMENTED',[],'Student implementation required.') for r in cfg['rules']]

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
