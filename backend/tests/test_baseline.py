import unittest,sys,json,copy,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'));import paths
from src.rule_engine.engine_core import config,load_jsonl,baseline,validate_transport
from src.evaluate import score
from src.audit.audit import append,verify
from src.AI_agent.llm_adapter import MockExplanationProvider,validate_explanation

class StarterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg=config(ROOT)
        cls.example=load_jsonl(ROOT/'data'/'development'/'claims.jsonl')[0]
    def setUp(self):self.c=copy.deepcopy(self.example)
    def result(self,rid):return next(r for r in baseline(self.c,self.cfg) if r['rule_id']==rid)
    def test_required_null(self):
        self.c['invoice_number']=None;self.assertEqual(self.result('R001')['status'],'FAIL')
    def test_coverage_boundary(self):
        day=self.c['lines'][0]['service_date'];self.c['coverage']['start_date']=day;self.c['coverage']['end_date']=day
        self.assertEqual(self.result('R003')['status'],'PASS')
    def test_unknown_coverage_is_not_pass(self):
        self.c['coverage']['end_date']=None;self.assertEqual(self.result('R003')['status'],'UNABLE_TO_ASSESS')
    def test_known_failure_dominates_unknown(self):
        self.c['coverage']['end_date']=None;self.c['coverage']['status']='cancelled';self.assertEqual(self.result('R003')['status'],'FAIL')
    def test_duplicate_and_modifier(self):
        other=copy.deepcopy(self.c['lines'][0]);other['line_id']='L99';self.c['lines'].append(other)
        self.assertEqual(self.result('R006')['status'],'FAIL');other['modifier']='EDU-SEPARATE';self.assertEqual(self.result('R006')['status'],'PASS')
    def test_arithmetic_missing_input_is_unable_to_assess(self):
        self.c['lines'][0]['unit_price']=None
        self.assertEqual(self.result('R007')['status'],'UNABLE_TO_ASSESS')
    def test_arithmetic_uses_rounding_and_tolerance(self):
        self.c['lines'][0].update(quantity=3,unit_price=0.335,net_amount=1.01)
        self.assertEqual(self.result('R007')['status'],'PASS')
        self.c['lines'][0]['net_amount']=1.03
        self.assertEqual(self.result('R007')['status'],'FAIL')
    def test_arithmetic_failure_dominates_missing_input(self):
        self.c['lines'][0]['unit_price']=None
        self.c['lines'][1]['net_amount']=0
        self.assertEqual(self.result('R007')['status'],'FAIL')
    def test_all_rules_are_implemented(self):self.assertEqual(sum(r['status']=='NOT_IMPLEMENTED' for r in baseline(self.c,self.cfg)),0)

    def test_authorization_and_document_rules(self):
        line=self.c['lines'][0]
        line.update(service_code='SVC-IMAGE',authorization_id='AUTH-1')
        self.c['authorizations']=[{
            'authorization_id':'AUTH-1','patient_id':self.c['patient_id'],'service_code':'SVC-IMAGE',
            'status':'approved','valid_from':'2026-01-01','valid_to':'2026-12-31','max_quantity':1}]
        self.c['attachments']=[{
            'attachment_id':'DOC-1','type':'imaging-report','patient_id':self.c['patient_id'],
            'service_code':'SVC-IMAGE','service_date':line['service_date'],'document_status':'final','text':'untrusted'}]
        self.assertEqual(self.result('R008')['status'],'PASS')
        self.assertEqual(self.result('R009')['status'],'PASS')
        self.assertEqual(self.result('R010')['status'],'PASS')
        self.c['authorizations'][0]['status']='denied'
        self.assertEqual(self.result('R009')['status'],'FAIL')

    def test_catalogue_total_limits_window_and_currency_rules(self):
        self.c['lines'][0]['service_code']='SVC-UNKNOWN'
        self.assertEqual(self.result('R011')['status'],'FAIL')
        self.c['lines'][0]['service_code']='SVC-LAB'
        self.c['total_amount']=0
        self.assertEqual(self.result('R012')['status'],'FAIL')
        self.c['lines'][0]['quantity']=0
        self.assertEqual(self.result('R013')['status'],'FAIL')
        self.c['submission_date']='2026-08-06'
        self.assertEqual(self.result('R014')['status'],'FAIL')
        self.c['currency']='USD'
        self.assertEqual(self.result('R015')['status'],'FAIL')
    def test_rules_without_an_active_spec_are_not_evaluated(self):
        rule_ids = [result["rule_id"] for result in baseline(self.c, self.cfg)]
        self.assertNotIn("R016", rule_ids)
        self.assertNotIn("R017", rule_ids)
        self.assertEqual(self.cfg["inactive"]["R017"], "no active implementation")
    def test_scorer_rejects_missing_pair(self):
        claims = load_jsonl(ROOT/'data'/'development'/'claims.jsonl')[:10]
        gold = load_jsonl(ROOT/'data'/'development'/'expected_results.jsonl')[:10]
        claims_by_id = {c['claim_id']: c for c in claims}
        with self.assertRaises(ValueError):score(gold,gold[:-1],claims_by_id)
    def test_scorer_rejects_duplicate(self):
        claims = load_jsonl(ROOT/'data'/'development'/'claims.jsonl')[:10]
        gold = load_jsonl(ROOT/'data'/'development'/'expected_results.jsonl')[:10]
        claims_by_id = {c['claim_id']: c for c in claims}
        with self.assertRaises(ValueError):score(gold,gold+[gold[0]],claims_by_id)
    def test_scorer_rejects_fabricated_evidence(self):
        claims = load_jsonl(ROOT/'data'/'development'/'claims.jsonl')[:10]
        gold = load_jsonl(ROOT/'data'/'development'/'expected_results.jsonl')[:10]
        pred = copy.deepcopy(gold)
        pred[0]['evidence'][0]['value'] = 'INVENTED'
        claims_by_id = {c['claim_id']: c for c in claims}
        with self.assertRaises(ValueError):score(gold,pred,claims_by_id)
    def test_audit_detects_edit(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'audit.jsonl';append(p,[dict(claim_id='CG-X',rule_id='R001',action='request_information',actor='tester',reason='Need source invoice')]);self.assertEqual(verify(p)[1],1)
            self.assertNotIn('Need source invoice',p.read_text())
            p.write_text(p.read_text().replace('CG-X','CG-Y'))
            with self.assertRaises(ValueError):verify(p)
    def test_validate_transport_rejects_duplicate_line_ids(self):
        claim=copy.deepcopy(self.example)
        claim['lines'][1]['line_id']=claim['lines'][0]['line_id']
        with self.assertRaises(ValueError):
            validate_transport(claim)
    def test_mock_explanation_validates(self):
        self.c['invoice_number']=None
        r=self.result('R001');out=MockExplanationProvider().explain(r,{});self.assertIn('recommendation', out)
        self.assertIn('missing', out['recommendation'].lower())
        self.assertEqual(validate_explanation(out,r),out)

        self.c['lines'][0]['service_date']='2026-07-10'
        self.c['submission_date']='2026-07-01'
        r2=self.result('R002');out2=MockExplanationProvider().explain(r2,{});self.assertNotEqual(out['recommendation'], out2['recommendation'])
        self.assertNotIn('verify the missing or incorrect evidence', out2['recommendation'].lower())

        out['cited_rule_ids']=['R999']
        with self.assertRaises(ValueError):validate_explanation(out,r)
        del out['recommendation']
        with self.assertRaises(ValueError):validate_explanation(out,r)
if __name__=='__main__':unittest.main()
