"""Losslessly rebuild this pack's normalized JSONL from its relational CSV export."""
from pathlib import Path
from io import StringIO
import csv,json,argparse,math

def read(path):
    with open(path,newline='',encoding='utf-8') as f:return list(csv.DictReader(f))

def read_text(text):
    return list(csv.DictReader(StringIO(text)))

def number(v):
    if v.strip()=='':return None
    n=float(v)
    if not math.isfinite(n):raise ValueError('CSV numeric values must be finite')
    return int(n) if n.is_integer() else n

def convert_files(files):
    required={'claims.csv','lines.csv','coverage.csv','authorizations.csv','attachments.csv'}
    missing=required-set(files)
    if missing:raise ValueError('Missing CSV files: '+', '.join(sorted(missing)))
    extra=set(files)-required
    if extra:raise ValueError('Unexpected CSV files: '+', '.join(sorted(extra)))
    claims=read_text(files['claims.csv']);by={}
    for c in claims:
        claim_id=c.get('claim_id')
        if not claim_id:raise ValueError('claims.csv requires claim_id')
        if claim_id in by:raise ValueError('Duplicate claim_id in claims.csv')
        by[claim_id]=c
        for k,v in c.items():
            if v=='':c[k]=None
        c['total_amount']=number(c['total_amount']) if c.get('total_amount') is not None else None
        c.update(coverage=None,lines=[],authorizations=[],attachments=[])
    if not claims:raise ValueError('claims.csv must contain at least one claim')
    nums={'lines':{'quantity','unit_price','net_amount'},'authorizations':{'max_quantity'},'coverage':set(),'attachments':set()}
    for name in nums:
        for row in read_text(files[name+'.csv']):
            cid=row.pop('claim_id',None)
            if cid not in by:raise ValueError(f'{name}.csv references an unknown claim_id')
            for k,v in row.items():row[k]=number(v) if k in nums[name] else None if v=='' else v
            if name=='coverage':
                if by[cid][name] is not None:raise ValueError('Duplicate coverage row')
                by[cid][name]=row
            else:by[cid][name].append(row)
    return claims

def convert(folder):
    d=Path(folder)
    files={f'{name}.csv':(d/f'{name}.csv').read_text(encoding='utf-8') for name in ('claims','lines','coverage','authorizations','attachments')}
    return convert_files(files)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--folder',required=True);p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);rows=convert(a.folder);out.write_text(''.join(json.dumps(c,ensure_ascii=False)+'\n' for c in rows),encoding='utf-8');print('Rebuilt',len(rows),'claims')
