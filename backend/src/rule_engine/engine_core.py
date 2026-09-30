"""Shared transport, evidence and deterministic baseline; standard library only."""
from pathlib import Path
import json
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

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
def config(root):
    return {n:json.loads((Path(root)/'rules'/f'{n}.json').read_text(encoding='utf-8')) for n in ['rules','policies','services']}
def make_result(c,r,status,paths,message,line_ids=None):
    return {'claim_id':c['claim_id'],'rule_id':r['rule_id'],'rule_version':r['version'],
            'status':status,'severity':r['severity'],'affected_line_ids':line_ids or [],
            'evidence':[{'path':p,'value':pointer(c,p)} for p in dict.fromkeys(paths)],
            'rule_source':r['source'],'explanation':message,
            'corrective_action':r['corrective_action'] if status in ('FAIL','UNABLE_TO_ASSESS') else '',
            'confidence':CONFIDENCE.get(status),'confidence_kind':'uncalibrated' if status in CONFIDENCE else 'not_probabilistic',
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
        failed = False
        unknown = False
        error_msg = ""

        for i, l in enumerate(c["lines"]):
            if empty(l['service_date']) or not valid_date(l['service_date']):
                paths.append(f"/lines/{i}/service_date")
                paths.append("/submission_date")
                ids.append(l["line_id"])
                unknown = True
                if not failed:
                    error_msg = f"Service date in line {i} is missing or invalid."

            elif empty(c["submission_date"]) or not valid_date(c["submission_date"]):
                paths.append("/submission_date")
                error_msg = "Submission date is missing or invalid."
                unknown = True

            elif valid_date(l["service_date"]) > valid_date(c["submission_date"]):
                paths.append("/submission_date")
                paths.append(f"/lines/{i}/service_date")
                ids.append(l["line_id"])
                error_msg = f"Service date in line {i} is after submission date."
                failed = True

        status = "FAIL" if failed else "UNABLE_TO_ASSESS" if unknown else "PASS"
        return make_result(
            c,
            r,
            status,
            paths or ["/submission_date", "/lines"],
            error_msg if paths else "All service dates are on or before the submission date.",
            sorted(set(ids)))

    
    if rid=='R003':
        cv=c['coverage'];start=valid_date(cv.get('start_date'));end=valid_date(cv.get('end_date'))
        paths=['/coverage/status','/coverage/start_date','/coverage/end_date'];failed=[]
        if empty(cv.get('status')):unknown.append('coverage status')
        elif cv.get('status')!='active':failed.append('coverage status is not active')
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

        elif c["policy_id"] not in cfg["policies"]:
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
        policy_id=c['policy_id']
        policy=cfg['policies'][policy_id] if policy_id in cfg['policies'] else None
        if not policy or not isinstance(policy.get('auth_required_services'),list):
            return make_result(c,r,'UNABLE_TO_ASSESS',['/policy_id'],'Policy or required authorization services are unavailable.')

        required=set(policy['auth_required_services'])
        if not required:
            paths=[f'/lines/{i}/{k}' for i in range(len(c['lines'])) for k in ('service_code','authorization_id')]
            return make_result(c,r,'NOT_APPLICABLE',paths or ['/lines'],'Rule does not apply to the supplied claim.')

        failed=False
        unknown=False
        applicable=False
        for i,l in enumerate(c['lines']):
            service_path=f'/lines/{i}/service_code'
            authorization_path=f'/lines/{i}/authorization_id'
            service_code=l['service_code']
            if empty(service_code) or service_code not in cfg['services']:
                paths.append(service_path)
                unknown=True
                continue
            if service_code in required:
                applicable=True
                paths.extend([service_path,authorization_path])
                if empty(l['authorization_id']):
                    failed=True
                    ids.append(l['line_id'])

        if failed:
            status='FAIL'
            message='Required authorization reference is missing for some lines.'
        elif unknown:
            status='UNABLE_TO_ASSESS'
            message='Unknown or missing service codes prevent a complete authorization reference check.'
        elif not applicable:
            status='NOT_APPLICABLE'
            message='No supplied lines require authorization under the policy.'
        else:
            status='PASS'
            message='All authorization-required services have nonempty authorization references.'
        return make_result(c,r,status,paths or ['/lines'],message,sorted(set(ids)))

    if rid=='R009':
        policy=cfg['policies'].get(c['policy_id'])
        if not policy or not isinstance(policy.get('auth_required_services'),list):
            return make_result(c,r,'UNABLE_TO_ASSESS',['/policy_id'],'Policy or required authorization services are unavailable.')
        required=set(policy['auth_required_services'])
        if not required:
            return make_result(c,r,'NOT_APPLICABLE',['/lines'],'Rule does not apply to the supplied claim.')

        authorization_by_id={a.get('authorization_id'): (i,a) for i,a in enumerate(c['authorizations'])}
        quantities={}
        failed=False
        unknown=False
        applicable=False
        for i,line in enumerate(c['lines']):
            service_code=line['service_code']
            if empty(service_code):
                unknown=True
                paths.append(f'/lines/{i}/service_code')
                continue
            if service_code not in cfg['services']:
                unknown=True
                paths.append(f'/lines/{i}/service_code')
                continue
            if service_code not in required:
                continue
            applicable=True
            line_paths=[f'/lines/{i}/service_code',f'/lines/{i}/service_date',f'/lines/{i}/authorization_id']
            paths.extend(line_paths)
            authorization_id=line['authorization_id']
            if empty(authorization_id):
                unknown=True
                continue
            found=authorization_by_id.get(authorization_id)
            if not found:
                failed=True
                ids.append(line['line_id'])
                continue
            authorization_index,authorization=found
            auth_prefix=f'/authorizations/{authorization_index}'
            paths.extend(f'{auth_prefix}/{key}' for key in ('authorization_id','patient_id','service_code','status','valid_from','valid_to','max_quantity'))

            if empty(c['patient_id']) or empty(authorization.get('patient_id')):
                unknown=True
            elif c['patient_id'] != authorization['patient_id']:
                failed=True
                ids.append(line['line_id'])
            if empty(authorization.get('service_code')):
                unknown=True
            elif authorization['service_code'] != service_code:
                failed=True
                ids.append(line['line_id'])
            if empty(authorization.get('status')):
                unknown=True
            elif authorization['status'] != 'approved':
                failed=True
                ids.append(line['line_id'])

            service_date=valid_date(line['service_date'])
            valid_from=valid_date(authorization.get('valid_from'))
            valid_to=valid_date(authorization.get('valid_to'))
            if not service_date or not valid_from or not valid_to:
                unknown=True
            elif service_date < valid_from or service_date > valid_to:
                failed=True
                ids.append(line['line_id'])

            quantity=line['quantity']
            max_quantity=authorization.get('max_quantity')
            if quantity is None or max_quantity is None:
                unknown=True
            else:
                try:
                    quantities[authorization_id]=quantities.get(authorization_id,Decimal('0'))+Decimal(str(quantity))
                    if quantities[authorization_id] > Decimal(str(max_quantity)):
                        failed=True
                        ids.append(line['line_id'])
                except (ArithmeticError,ValueError):
                    unknown=True

        if failed:
            status='FAIL'
            message='Authorization records contain missing references or mismatched service, patient, status, dates, or quantity limits.'
        elif unknown:
            status='UNABLE_TO_ASSESS'
            message='Missing authorization information prevents a complete authorization record check.'
        elif not applicable:
            status='NOT_APPLICABLE'
            message='No supplied lines require authorization under the policy.'
        else:
            status='PASS'
            message='Authorization records match the required services and claim lines.'
        return make_result(c,r,status,paths or ['/lines'],message,sorted(set(ids)))

    if rid=='R010':
        policy=cfg['policies'].get(c['policy_id'])
        if not policy or not isinstance(policy.get('required_documents'),dict):
            return make_result(c,r,'UNABLE_TO_ASSESS',['/policy_id'],'Policy or required document mappings are unavailable.')
        failed=False
        unknown=False
        applicable=False
        for i,line in enumerate(c['lines']):
            service_code=line['service_code']
            if empty(service_code) or service_code not in cfg['services']:
                unknown=True
                paths.append(f'/lines/{i}/service_code')
                continue
            required_type=policy['required_documents'].get(service_code)
            if required_type is None:
                continue
            applicable=True
            service_date=valid_date(line['service_date'])
            if not service_date:
                unknown=True
                paths.append(f'/lines/{i}/service_date')
                continue
            line_paths=[f'/lines/{i}/service_code',f'/lines/{i}/service_date']
            paths.extend(line_paths)
            matches=[]
            for attachment_index,attachment in enumerate(c['attachments']):
                attachment_prefix=f'/attachments/{attachment_index}'
                if attachment.get('type') != required_type:
                    continue
                if attachment.get('patient_id') != c['patient_id']:
                    continue
                if attachment.get('service_code') != service_code:
                    continue
                if valid_date(attachment.get('service_date')) != service_date:
                    continue
                matches.append((attachment_index,attachment))
            if not matches:
                failed=True
                ids.append(line['line_id'])
                continue
            for attachment_index,_ in matches:
                paths.extend(f'/attachments/{attachment_index}/{key}' for key in ('type','patient_id','service_code','service_date','document_status'))
            if not any(attachment.get('document_status') == 'final' for _,attachment in matches):
                unknown=True
        if failed:
            status='FAIL'
            message='Required supporting documentation is absent or does not match some lines.'
        elif unknown:
            status='UNABLE_TO_ASSESS'
            message='Matching supporting documents are present but none is confirmed final, or required comparison data is unavailable.'
        elif not applicable:
            status='NOT_APPLICABLE'
            message='No supplied lines require supporting documentation under the policy.'
        else:
            status='PASS'
            message='All required supporting documents match and are final.'
        return make_result(c,r,status,paths or ['/lines'],message,sorted(set(ids)))

    if rid=='R011':
        failed=False
        unknown=False
        for i,line in enumerate(c['lines']):
            service_code=line['service_code']
            path=f'/lines/{i}/service_code'
            if empty(service_code):
                unknown=True
                paths.append(path)
            elif service_code not in cfg['services']:
                failed=True
                paths.append(path)
                ids.append(line['line_id'])
        status='FAIL' if failed else 'UNABLE_TO_ASSESS' if unknown else 'PASS'
        message='Unknown service codes are present.' if failed else 'Missing service codes prevent a complete catalogue check.' if unknown else 'All service codes are in the fictional catalogue.'
        return make_result(c,r,status,paths or ['/lines'],message,sorted(set(ids)))

    if rid=='R012':
        if c['total_amount'] is None:
            return make_result(c,r,'UNABLE_TO_ASSESS',['/total_amount'],'Claim total is missing.',[])
        missing=False
        total=Decimal('0')
        paths=['/total_amount']
        for i,line in enumerate(c['lines']):
            paths.append(f'/lines/{i}/net_amount')
            if line['net_amount'] is None:
                missing=True
                continue
            total += Decimal(str(line['net_amount']))
        if missing:
            return make_result(c,r,'UNABLE_TO_ASSESS',paths,'Missing line amounts prevent a complete claim total check.')
        expected=money(total)
        actual=money(c['total_amount'])
        status='PASS' if abs(expected-actual) <= Decimal('.01') else 'FAIL'
        message='Claim total equals the sum of line amounts.' if status=='PASS' else 'Claim total does not equal the sum of line amounts.'
        return make_result(c,r,status,paths,message)

    if rid=='R013':
        policy=cfg['policies'].get(c['policy_id'])
        if not policy:
            return make_result(c,r,'UNABLE_TO_ASSESS',['/policy_id'],'Policy is unavailable.')
        failed=False
        unknown=False
        for i,line in enumerate(c['lines']):
            service_code=line['service_code']
            line_paths=[f'/lines/{i}/service_code',f'/lines/{i}/quantity',f'/lines/{i}/unit_price']
            paths.extend(line_paths)
            if empty(service_code) or service_code not in cfg['services']:
                unknown=True
                continue
            max_price=policy.get('max_unit_price',{}).get(service_code)
            max_quantity=policy.get('max_quantity_per_line',{}).get(service_code)
            quantity=line['quantity']
            unit_price=line['unit_price']
            if quantity is None or unit_price is None or max_price is None or max_quantity is None:
                unknown=True
                continue
            try:
                valid_quantity=Decimal(str(quantity)) > 0 and Decimal(str(quantity)) == Decimal(str(quantity)).to_integral_value()
                valid_price=Decimal(str(unit_price)) > 0 and Decimal(str(unit_price)) <= Decimal(str(max_price))
                within_quantity=Decimal(str(quantity)) <= Decimal(str(max_quantity))
            except (ArithmeticError,ValueError):
                unknown=True
                continue
            if not (valid_quantity and valid_price and within_quantity):
                failed=True
                ids.append(line['line_id'])
        status='FAIL' if failed else 'UNABLE_TO_ASSESS' if unknown else 'PASS'
        message='Quantity or unit price limits are violated.' if failed else 'Missing inputs prevent a complete quantity and price limit check.' if unknown else 'All quantities and unit prices are within policy limits.'
        return make_result(c,r,status,paths or ['/lines'],message,sorted(set(ids)))

    if rid=='R014':
        policy=cfg['policies'].get(c['policy_id'])
        if not policy or policy.get('submission_window_days') is None:
            return make_result(c,r,'UNABLE_TO_ASSESS',['/policy_id'],'Policy or submission window is unavailable.')
        submission_date=valid_date(c['submission_date'])
        service_dates=[]
        unknown=False
        paths=['/submission_date']
        for i,line in enumerate(c['lines']):
            paths.append(f'/lines/{i}/service_date')
            service_date=valid_date(line['service_date'])
            if not service_date:
                unknown=True
            else:
                service_dates.append(service_date)
        if not submission_date or unknown or not service_dates:
            return make_result(c,r,'UNABLE_TO_ASSESS',paths,'Missing or invalid dates prevent a submission window check.')
        latest=max(service_dates)
        lag=(submission_date-latest).days
        if lag < 0:
            return make_result(c,r,'NOT_APPLICABLE',paths,'Submission precedes the latest service date; chronology is handled by R002.')
        if lag > policy['submission_window_days']:
            return make_result(c,r,'FAIL',paths,'The claim was submitted outside the policy submission window.')
        return make_result(c,r,'PASS',paths,'The claim was submitted within the policy submission window.')

    if rid=='R015':
        policy=cfg['policies'].get(c['policy_id'])
        if not policy or policy.get('currency') is None:
            return make_result(c,r,'UNABLE_TO_ASSESS',['/policy_id','/currency'],'Policy or currency is unavailable.')
        if empty(c['currency']):
            return make_result(c,r,'UNABLE_TO_ASSESS',['/currency'],'Currency is missing.')
        if c['currency'] != policy['currency']:
            return make_result(c,r,'FAIL',['/currency','/policy_id'],'Declared currency does not match policy currency.')
        return make_result(c,r,'PASS',['/currency','/policy_id'],'Declared currency matches policy currency.')

    

    

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
