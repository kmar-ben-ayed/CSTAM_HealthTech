// Synthetic sample data shaped like the ClaimGuard backend responses.
// Rule IDs, titles and severities mirror backend/rules/rules.json.

export type Status = 'PASS' | 'FAIL' | 'UTA' | 'NA';
export type Severity = 'high' | 'medium';

export interface Rule {
  id: string;
  title: string;
  short: string; // plain-language "reference range"
  severity: Severity;
}

export const RULES: Rule[] = [
  { id: 'R001', title: 'Required claim information', short: 'all required fields present', severity: 'high' },
  { id: 'R002', title: 'Service and submission chronology', short: 'service ≤ submission date', severity: 'high' },
  { id: 'R003', title: 'Coverage active on service date', short: 'active, in period', severity: 'high' },
  { id: 'R004', title: 'Member and beneficiary consistency', short: 'IDs match coverage', severity: 'high' },
  { id: 'R005', title: 'Provider in the supplied network', short: 'in allowed_providers', severity: 'high' },
  { id: 'R006', title: 'Possible duplicate service lines', short: 'no repeated lines', severity: 'medium' },
  { id: 'R007', title: 'Line arithmetic', short: 'qty × unit = net', severity: 'high' },
  { id: 'R008', title: 'Required authorization reference', short: 'auth id when required', severity: 'high' },
  { id: 'R009', title: 'Authorization record matches service', short: 'auth covers service', severity: 'high' },
  { id: 'R010', title: 'Required supporting document', short: 'document attached', severity: 'medium' },
  { id: 'R011', title: 'Service code in catalogue', short: 'known service code', severity: 'high' },
  { id: 'R012', title: 'Claim total equals line amounts', short: 'Σ lines = total', severity: 'high' },
  { id: 'R013', title: 'Quantity and price limits', short: '≤ policy maximums', severity: 'medium' },
  { id: 'R014', title: 'Submission window', short: '≤ 30 days after service', severity: 'medium' },
  { id: 'R015', title: 'Currency matches policy', short: 'SAR', severity: 'high' },
];

export interface Finding {
  status: Status;
  result: string; // what the claim actually contains
  lines?: string[];
  evidence?: [string, string][];
  note?: string; // assistant explanation
  grounding?: string;
}

export interface Line {
  id: string;
  code: string;
  label: string;
  date: string;
  qty: number;
  unit: number;
  net: number;
  auth: string | null;
}

export interface Claim {
  id: string;
  provider: string;
  member: string;
  patient: string;
  policy: string;
  dx: string;
  submitted: string;
  amount: number;
  daysWaiting: number;
  source: 'CSV' | 'JSONL' | 'FHIR';
  complaint: string; // plain-language "chief complaint"
  findings: Record<string, Finding>;
  lines: Line[];
}

const pass = (result = 'within range'): Finding => ({ status: 'PASS', result });

function baseFindings(overrides: Record<string, Finding>): Record<string, Finding> {
  const out: Record<string, Finding> = {};
  for (const r of RULES) out[r.id] = overrides[r.id] ?? pass();
  return out;
}

const FEATURED: Claim = {
  id: 'CG-2D966B65D1A1',
  provider: 'EDU-PROV-02',
  member: 'MEM-0520B2415D',
  patient: 'PAT-0520B2415D',
  policy: 'EDU-BASIC',
  dx: 'DX-EDU-04',
  submitted: '2026-04-02',
  amount: 570,
  daysWaiting: 5,
  source: 'CSV',
  complaint: 'MRI without authorization; total short by 40.00',
  lines: [
    { id: 'L1', code: 'SVC-MRI', label: 'MRI', date: '2026-03-28', qty: 1, unit: 380, net: 380, auth: null },
    { id: 'L2', code: 'SVC-CONSULT', label: 'Consultation', date: '2026-03-28', qty: 1, unit: 190, net: 190, auth: null },
    { id: 'L3', code: 'SVC-LAB', label: 'Lab panel', date: '2026-03-28', qty: 1, unit: 40, net: 40, auth: null },
  ],
  findings: baseFindings({
    R001: pass('all present'),
    R002: pass('03-28 ≤ 04-02'),
    R003: pass('active · in period'),
    R004: pass('match'),
    R005: pass('EDU-PROV-02 listed'),
    R006: pass('none'),
    R007: pass('3/3 lines'),
    R008: {
      status: 'FAIL',
      result: 'L1 auth = null',
      lines: ['L1'],
      evidence: [
        ['lines[L1].service_code', 'SVC-MRI'],
        ['lines[L1].authorization_id', 'null'],
        ['policy.auth_required_services', '[…, SVC-MRI]'],
      ],
      note: 'EDU-BASIC requires prior authorization for MRI. No authorization is referenced on line L1 or in the claim’s authorization records.',
      grounding: 'Assistant · cites 3 fields · not a probability',
    },
    R009: { status: 'NA', result: 'no auth records' },
    R010: {
      status: 'UTA',
      result: 'attachments = []',
      lines: ['L1'],
      evidence: [
        ['attachments', '[]'],
        ['ingest source', 'CSV pack (no attachments)'],
      ],
      note: 'An imaging report is required for MRI. None is attached, but CSV uploads never carry attachments, so absence is not proof.',
      grounding: 'Escalated · evidence incomplete',
    },
    R011: pass('3/3 known'),
    R012: {
      status: 'FAIL',
      result: '610.00 ≠ 570.00',
      evidence: [
        ['total_amount', '570.00'],
        ['Σ lines[*].net_amount', '610.00'],
        ['difference', '40.00 = L3'],
      ],
      note: 'The stated total is 40.00 short — exactly the lab line. The line was likely added after the total was calculated.',
      grounding: 'Deterministic · no assistant needed',
    },
    R013: pass('≤ max'),
    R014: pass('5 days'),
    R015: pass('SAR'),
  }),
};

function mk(
  id: string, provider: string, amount: number, days: number, complaint: string,
  bad: Record<string, Status>, source: Claim['source'] = 'JSONL',
): Claim {
  const ov: Record<string, Finding> = {};
  for (const [k, s] of Object.entries(bad)) ov[k] = { status: s, result: s === 'FAIL' ? 'out of range' : s === 'UTA' ? 'insufficient data' : '—' };
  return {
    ...FEATURED,
    id, provider, amount, daysWaiting: days, complaint, source,
    member: 'MEM-' + id.slice(3, 13), patient: 'PAT-' + id.slice(3, 13),
    findings: baseFindings(ov),
  };
}

export const CLAIMS: Claim[] = [
  FEATURED,
  mk('CG-C7E2905F1B38', 'EDU-PROV-03', 2010, 6, 'Out-of-network provider; arithmetic errors on 2 lines', { R005: 'FAIL', R007: 'FAIL', R012: 'FAIL' }),
  mk('CG-8F01C3D2A4E7', 'EDU-PROV-05', 1240, 2, 'Physiotherapy billed 14 sessions (max 10)', { R013: 'FAIL' }),
  mk('CG-6E39A1C04D2B', 'EDU-PROV-04', 760, 3, 'Submitted 41 days after service', { R014: 'FAIL' }, 'FHIR'),
  mk('CG-41AA0B9E6C12', 'EDU-PROV-01', 95, 1, 'Coverage end date missing', { R003: 'UTA' }, 'CSV'),
  mk('CG-0B5D7716E9F0', 'EDU-PROV-02', 330, 4, 'Member ID unreadable; referral letter absent', { R004: 'UTA', R010: 'UTA' }, 'CSV'),
  mk('CG-93D0A7F2B615', 'EDU-PROV-03', 215, 1, 'Same consult billed twice on 06-11', { R006: 'FAIL' }),
  mk('CG-E40B62D17A9C', 'EDU-PROV-01', 140, 0, 'Billed in USD under a SAR policy', { R015: 'FAIL' }),
  mk('CG-1F7C9E05B3A2', 'EDU-PROV-05', 420, 2, 'Unknown service code SVC-XRAY-9', { R011: 'FAIL' }, 'FHIR'),
  mk('CG-5A1E8C3B90D4', 'EDU-PROV-04', 880, 3, 'Authorization covers a different service', { R009: 'UTA' }),
  mk('CG-B8236D4F0E71', 'EDU-PROV-02', 60, 0, 'One service date blank', { R002: 'UTA' }, 'CSV'),
  mk('CG-7D5F01A9C3E8', 'EDU-PROV-03', 190, 1, 'Diagnosis code missing', { R001: 'FAIL' }),
  mk('CG-27BFD8541DEB', 'EDU-PROV-03', 330, 0, 'Clean — spot-check sample', {}),
  mk('CG-0C9A3E6B27F5', 'EDU-PROV-01', 510, 0, 'Clean', {}, 'FHIR'),
];

/** ESI-style triage level (1 = most urgent). */
export function triage(c: Claim): 1 | 2 | 3 | 4 | 5 {
  const sev = (id: string) => RULES.find((r) => r.id === id)!.severity;
  const f = Object.entries(c.findings);
  const highFails = f.filter(([id, x]) => x.status === 'FAIL' && sev(id) === 'high').length;
  const medFails = f.filter(([id, x]) => x.status === 'FAIL' && sev(id) === 'medium').length;
  const uta = f.filter(([, x]) => x.status === 'UTA').length;
  if (highFails >= 2) return 1;
  if (highFails === 1) return 2;
  if (medFails > 0) return 3;
  if (uta > 0) return 4;
  return 5;
}

export const ESI_LABEL: Record<number, string> = {
  1: 'Resuscitate',
  2: 'Emergent',
  3: 'Urgent',
  4: 'Less urgent',
  5: 'Routine',
};

export function counts(c: Claim) {
  const v = Object.values(c.findings);
  return {
    fail: v.filter((x) => x.status === 'FAIL').length,
    uta: v.filter((x) => x.status === 'UTA').length,
    pass: v.filter((x) => x.status === 'PASS').length,
    na: v.filter((x) => x.status === 'NA').length,
  };
}

export const fmt = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
