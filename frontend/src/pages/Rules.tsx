import { useState, useRef, useEffect } from 'react';

interface RulesProps {
  onNavigate?: (page: string) => void;
}

type RuleSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
type RuleStatus = 'Active' | 'Draft' | 'Deprecated';

interface Rule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: RuleSeverity;
  status: RuleStatus;
  version: string;
  policyScope: string[];
  evidenceRequirement: string;
  expectedCondition: string;
  reviewerAction: string;
  lastUpdated: string;
}

const ALL_RULES: Rule[] = [
  { id: 'R001', name: 'Required claim information', description: 'All mandatory claim header fields must be present and non-empty. Includes member ID, billing provider NPI, and service date.', category: 'Claim completeness', severity: 'HIGH', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/member/id · /billing_provider/npi · /lines/0/service_date', expectedCondition: 'All required header fields are non-null and pass format validation.', reviewerAction: 'Request missing source information; never invent identifiers or diagnosis codes.', lastUpdated: '29 Sep 2026' },
  { id: 'R002', name: 'Provider eligibility', description: 'The billing provider must be enrolled and active with the payer on the service date.', category: 'Provider / network', severity: 'HIGH', status: 'Active', version: 'v1.1', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/billing_provider/npi · /billing_provider/enrollment_status', expectedCondition: 'Provider NPI resolves to an active enrollment record with no restrictions for this service type.', reviewerAction: 'Verify provider enrollment directly with the payer network registry.', lastUpdated: '29 Sep 2026' },
  { id: 'R003', name: 'Service date validity', description: 'The service date must fall within the allowed submission window defined by the applicable policy.', category: 'Chronology', severity: 'MEDIUM', status: 'Active', version: 'v1.2', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/0/service_date · /submission_date', expectedCondition: 'service_date ≤ submission_date AND (submission_date − service_date) ≤ policy.submission_window_days.', reviewerAction: 'Confirm whether a late submission waiver applies; request waiver documentation if so.', lastUpdated: '29 Sep 2026' },
  { id: 'R004', name: 'Benefit coverage', description: 'The billed service code must be covered under the member\'s active benefit plan on the service date.', category: 'Coverage', severity: 'HIGH', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/0/service_code · /member/plan_id · /benefit_catalog/{service_code}', expectedCondition: 'Service code appears in the benefit catalog for the member\'s plan with no applicable exclusions.', reviewerAction: 'Check member\'s benefit schedule; request plan documentation if exclusion is disputed.', lastUpdated: '29 Sep 2026' },
  { id: 'R005', name: 'Duplicate service check', description: 'No identical claim — same member, provider, service date, and service code — should have been processed within the 90-day lookback window.', category: 'Duplication', severity: 'HIGH', status: 'Active', version: 'v1.3', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/member/id · /lines/0/service_code · /lines/0/service_date · /billing_provider/npi', expectedCondition: 'No matching claim exists in the 90-day claim history for this member-provider-service-date combination.', reviewerAction: 'Confirm with provider whether this is a resubmission or a distinct encounter; request original claim ID if resubmission.', lastUpdated: '29 Sep 2026' },
  { id: 'R006', name: 'Diagnosis code validity', description: 'All diagnosis codes must be valid ICD-10-CM codes, active and not retired as of the service date.', category: 'Claim completeness', severity: 'MEDIUM', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/diagnoses/*/code', expectedCondition: 'Each diagnosis code is present in the ICD-10-CM reference for the service date year and is not marked retired.', reviewerAction: 'Request corrected diagnosis codes from the provider; do not suggest replacements.', lastUpdated: '29 Sep 2026' },
  { id: 'R007', name: 'Service code validity', description: 'All procedure/service codes must be valid CPT or HCPCS codes active on the service date.', category: 'Claim completeness', severity: 'MEDIUM', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/*/service_code', expectedCondition: 'Each service code resolves to an active CPT or HCPCS entry for the service date.', reviewerAction: 'Request the corrected code from the billing provider.', lastUpdated: '29 Sep 2026' },
  { id: 'R008', name: 'Authorization reference', description: 'When a service requires prior authorization under the applicable policy, the authorization reference number must be present on the claim line.', category: 'Authorization', severity: 'HIGH', status: 'Active', version: 'v1.3', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/*/service_code · /lines/*/authorization_reference', expectedCondition: 'authorization_reference is non-null for each service line that requires prior authorization under the active policy.', reviewerAction: 'Request the prior authorization number from the provider; do not proceed without it.', lastUpdated: '29 Sep 2026' },
  { id: 'R009', name: 'Authorization validity', description: 'When an authorization reference is present, the referenced authorization must exist in the registry and be valid for the service date, service code, and member.', category: 'Authorization', severity: 'HIGH', status: 'Active', version: 'v1.1', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/*/authorization_reference · /authorization_registry/{auth_ref}', expectedCondition: 'The referenced authorization is found, is active, covers the service code, and has not expired as of the service date.', reviewerAction: 'If authorization is expired or not found, request a new authorization or an extension letter from the provider.', lastUpdated: '29 Sep 2026' },
  { id: 'R010', name: 'Place of service', description: 'The place-of-service code must be appropriate for the billed service code and must not conflict with the rendering facility type.', category: 'Provider / network', severity: 'MEDIUM', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/*/place_of_service · /lines/*/service_code', expectedCondition: 'Place-of-service code and service code form a permitted combination per the payer\'s POS matrix.', reviewerAction: 'Request the correct place-of-service code or facility attestation from the provider.', lastUpdated: '29 Sep 2026' },
  { id: 'R011', name: 'Billing provider NPI', description: 'The billing provider NPI must be a valid, 10-digit NPI that is active in NPPES on the service date.', category: 'Provider / network', severity: 'HIGH', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/billing_provider/npi', expectedCondition: 'NPI is exactly 10 digits and resolves to an active Type 1 or Type 2 NPI in NPPES.', reviewerAction: 'Obtain the correct NPI from the provider; verify against NPPES directly.', lastUpdated: '29 Sep 2026' },
  { id: 'R012', name: 'Rendering provider NPI', description: 'When present, the rendering provider NPI must be valid and the rendering provider must be credentialed with the billing group.', category: 'Provider / network', severity: 'MEDIUM', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/rendering_provider/npi · /rendering_provider/credentialing_status', expectedCondition: 'Rendering NPI is valid and the provider\'s credentialing status is ACTIVE under the billing organization.', reviewerAction: 'Request credentialing confirmation from the provider\'s practice manager.', lastUpdated: '29 Sep 2026' },
  { id: 'R013', name: 'Diagnosis–procedure alignment', description: 'The principal diagnosis must support the billed procedure code according to clinical coding guidelines and must not trigger an active NCCI or MUE edit.', category: 'Member consistency', severity: 'MEDIUM', status: 'Active', version: 'v1.2', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/lines/*/service_code · /diagnoses/0/code', expectedCondition: 'The diagnosis-procedure pair passes ICD-CPT alignment check with no active MUE or NCCI bundling edit.', reviewerAction: 'Request clinical documentation supporting the diagnosis-procedure relationship.', lastUpdated: '29 Sep 2026' },
  { id: 'R014', name: 'Age & gender appropriateness', description: 'The billed service must be clinically appropriate for the member\'s age and gender as recorded in the member record.', category: 'Member consistency', severity: 'LOW', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/member/date_of_birth · /member/gender · /lines/*/service_code', expectedCondition: 'The service code has no age or gender restriction that conflicts with the member\'s recorded demographics.', reviewerAction: 'Request clinical documentation confirming appropriateness if a conflict exists.', lastUpdated: '29 Sep 2026' },
  { id: 'R015', name: 'Coordination of benefits', description: 'When the member has secondary insurance, a coordination of benefits check must be performed to determine payer order.', category: 'Financial validation', severity: 'LOW', status: 'Active', version: 'v1.0', policyScope: ['EDU-BASIC', 'EDU-PLUS'], evidenceRequirement: '/member/secondary_insurance', expectedCondition: 'If secondary insurance is present, primary payer liability is calculated before the secondary payer is billed.', reviewerAction: 'Request the primary payer\'s Explanation of Benefits (EOB) before secondary processing.', lastUpdated: '29 Sep 2026' },
];

const CATEGORIES = ['All categories', 'Claim completeness', 'Chronology', 'Coverage', 'Member consistency', 'Provider / network', 'Duplication', 'Authorization', 'Financial validation'];
const SEVERITIES = ['All severities', 'HIGH', 'MEDIUM', 'LOW'];
const POLICIES = ['All policies', 'EDU-BASIC', 'EDU-PLUS'];

const SEV_STYLE: Record<RuleSeverity, { bg: string; text: string; border: string }> = {
  HIGH:   { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' },
  MEDIUM: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  LOW:    { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
};

const STATUS_STYLE: Record<RuleStatus, { bg: string; text: string; border: string; dot: string }> = {
  Active:     { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0', dot: '#10b981' },
  Draft:      { bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd', dot: '#38bdf8' },
  Deprecated: { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0', dot: '#94a3b8' },
};

const POLICIES_DATA = [
  {
    id: 'EDU-BASIC',
    name: 'Education Basic',
    submissionWindow: '30 days',
    currency: 'SAR',
    network: ['EDU-PROV-01', 'EDU-PROV-02', 'EDU-PROV-03'],
    authRequired: ['SVC-IMAGE', 'SVC-THERAPY'],
    docsRequired: [{ svc: 'SVC-IMAGE', doc: 'imaging-report' }, { svc: 'SVC-DENTAL', doc: 'service-note' }],
    activeRules: 15,
    color: '#287a5f',
  },
  {
    id: 'EDU-PLUS',
    name: 'Education Plus',
    submissionWindow: '60 days',
    currency: 'SAR',
    network: ['EDU-PROV-01', 'EDU-PROV-02', 'EDU-PROV-03'],
    authRequired: ['SVC-IMAGE', 'SVC-THERAPY'],
    docsRequired: [{ svc: 'SVC-IMAGE', doc: 'imaging-report' }, { svc: 'SVC-DENTAL', doc: 'service-note' }],
    activeRules: 15,
    color: '#315e8a',
  },
];

const POLICY_FIELDS = [
  { key: 'submissionWindow', label: 'Submission window' },
  { key: 'currency', label: 'Currency' },
  { key: 'activeRules', label: 'Active rules' },
];

function Drawer({ rule, onClose, onNavigate }: { rule: Rule; onClose: () => void; onNavigate?: (page: string) => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const sev = SEV_STYLE[rule.severity];
  const st = STATUS_STYLE[rule.status];

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 40, backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 440,
        background: '#fff',
        borderLeft: '1px solid #e2e8f0',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.08)',
        animation: 'slide-in-right 0.22s ease-out',
      }}>
        {/* Drawer header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent)' }}>{rule.id}</span>
              <span style={{ ...sev, borderRadius: 4, padding: '2px 8px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', border: `1px solid ${sev.border}`, background: sev.bg, color: sev.text }}>{rule.severity}</span>
              <span style={{ ...st, borderRadius: 20, padding: '2px 10px', fontSize: '0.6875rem', fontWeight: 600, border: `1px solid ${st.border}`, background: st.bg, color: st.text, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} />
                {rule.status}
              </span>
            </div>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>{rule.name}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.25rem', lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>

        {/* Drawer body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Description */}
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Description</div>
            <p style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.65 }}>{rule.description}</p>
          </div>

          {/* Metadata grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
            {[
              { label: 'Version', value: rule.version, mono: true },
              { label: 'Category', value: rule.category },
              { label: 'Severity', value: rule.severity },
              { label: 'Status', value: rule.status },
              { label: 'Last updated', value: rule.lastUpdated },
              { label: 'Policy scope', value: rule.policyScope.join(' · '), mono: true },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{f.label}</div>
                <div style={{ fontSize: '0.8125rem', color: '#0f172a', fontFamily: f.mono ? "'JetBrains Mono', monospace" : 'inherit', fontWeight: f.mono ? 500 : 400 }}>{f.value}</div>
              </div>
            ))}
          </div>

          {/* Expected condition */}
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Expected condition</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px', lineHeight: 1.6 }}>
              {rule.expectedCondition}
            </div>
          </div>

          {/* Evidence */}
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Evidence paths</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {rule.evidenceRequirement.split(' · ').map(path => (
                <span key={path} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--status-review)', background: 'var(--status-review-bg)', border: '1px solid var(--status-review-border)', borderRadius: 4, padding: '3px 8px' }}>{path}</span>
              ))}
            </div>
          </div>

          {/* Reviewer action */}
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Reviewer action</div>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 12px' }}>
              <p style={{ fontSize: '0.875rem', color: '#92400e', lineHeight: 1.6 }}>{rule.reviewerAction}</p>
            </div>
          </div>
        </div>

        {/* Drawer footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8 }}>
          <button
            onClick={() => onNavigate?.('claims')}
            style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 14px', fontSize: '0.8125rem', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
          >
            View affected claims
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, background: '#0f172a', border: 'none', borderRadius: 7, padding: '8px 14px', fontSize: '0.8125rem', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}

export default function Rules({ onNavigate }: RulesProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [severity, setSeverity] = useState('All severities');
  const [policy, setPolicy] = useState('All policies');
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [hoveredPolicy, setHoveredPolicy] = useState<string | null>(null);

  const filtered = ALL_RULES.filter(r => {
    const q = search.toLowerCase();
    const matchQ = !search || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    const matchCat = category === 'All categories' || r.category === category;
    const matchSev = severity === 'All severities' || r.severity === severity;
    const matchPol = policy === 'All policies' || r.policyScope.includes(policy);
    return matchQ && matchCat && matchSev && matchPol;
  });

  const diffFields = compareMode ? POLICY_FIELDS.filter(f => {
    const a = POLICIES_DATA[0][f.key as keyof typeof POLICIES_DATA[0]];
    const b = POLICIES_DATA[1][f.key as keyof typeof POLICIES_DATA[0]];
    return String(a) !== String(b);
  }) : [];

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#0f172a', marginBottom: 4 }}>Policy & Rules</h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Review the policies, validation rules, versions, and evidence requirements used by ClaimGuard.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Ruleset version</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 700, color: '#06b6d4' }}>v1.0.0</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Last updated</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>29 Sep 2026</div>
            </div>
          </div>
        </div>
      </div>

      {/* Policy Matrix */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)', marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Policy Matrix</h2>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Policy-specific constraints applied during claim validation.</p>
          </div>
          <button
            onClick={() => setCompareMode(c => !c)}
            style={{
              background: compareMode ? '#0f172a' : '#f8fafc',
              border: `1px solid ${compareMode ? '#0f172a' : '#e2e8f0'}`,
              borderRadius: 7,
              padding: '6px 14px',
              fontSize: '0.8125rem',
              color: compareMode ? '#fff' : '#475569',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M5 4l-3 3 3 3M9 4l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {compareMode ? 'Show all fields' : 'Compare policies'}
          </button>
        </div>

        {compareMode && diffFields.length > 0 && (
          <div style={{ background: 'rgba(6,182,212,0.04)', borderBottom: '1px solid rgba(6,182,212,0.12)', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#06b6d4" strokeWidth="1.2"/><path d="M7 4v4M7 9.5v.5" stroke="#06b6d4" strokeWidth="1.2" strokeLinecap="round"/></svg>
            <span style={{ fontSize: '0.8125rem', color: '#06b6d4', fontWeight: 500 }}>
              {diffFields.length} field{diffFields.length > 1 ? 's' : ''} differ between policies — highlighted below.
            </span>
          </div>
        )}
        {compareMode && diffFields.length === 0 && (
          <div style={{ background: '#ecfdf5', borderBottom: '1px solid #a7f3d0', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="#10b981"/><path d="M4 7l2.5 2.5 4-4" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span style={{ fontSize: '0.8125rem', color: '#059669', fontWeight: 500 }}>Policies are identical on all compared fields.</span>
          </div>
        )}

        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {POLICIES_DATA.map(pol => (
            <div
              key={pol.id}
              style={{
                border: `1px solid ${hoveredPolicy === pol.id ? pol.color + '40' : '#e2e8f0'}`,
                borderRadius: 8,
                overflow: 'hidden',
                transition: 'border-color 0.15s ease',
              }}
              onMouseEnter={() => setHoveredPolicy(pol.id)}
              onMouseLeave={() => setHoveredPolicy(null)}
            >
              {/* Policy header */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 700, color: pol.color, letterSpacing: '0.04em' }}>{pol.id}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 1 }}>{pol.name}</div>
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, color: '#10b981', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 4, padding: '2px 8px' }}>
                  {pol.activeRules} rules
                </span>
              </div>

              {/* Fields */}
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Submission window', value: pol.submissionWindow, diff: compareMode && pol.submissionWindow !== POLICIES_DATA[POLICIES_DATA.indexOf(pol) === 0 ? 1 : 0].submissionWindow },
                  { label: 'Currency', value: pol.currency, diff: false },
                  { label: 'Network', value: null, list: pol.network, diff: false },
                  { label: 'Authorization required', value: null, list: pol.authRequired, diff: false },
                  { label: 'Documentation required', value: null, entries: pol.docsRequired, diff: false },
                ].map(f => (
                  <div key={f.label} style={{ background: f.diff ? 'rgba(6,182,212,0.06)' : 'transparent', borderRadius: f.diff ? 4 : 0, padding: f.diff ? '6px 8px' : 0, marginLeft: f.diff ? -8 : 0, marginRight: f.diff ? -8 : 0, transition: 'background 0.2s ease' }}>
                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: f.diff ? '#06b6d4' : '#94a3b8', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {f.diff && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#06b6d4', display: 'inline-block' }} />}
                      {f.label}
                    </div>
                    {f.value && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 600, color: f.diff ? '#06b6d4' : '#0f172a' }}>{f.value}</div>
                    )}
                    {f.list && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {f.list.map(item => (
                          <span key={item} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: '#475569', background: '#f1f5f9', borderRadius: 4, padding: '2px 7px' }}>{item}</span>
                        ))}
                      </div>
                    )}
                    {f.entries && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {f.entries.map(e => (
                          <div key={e.svc} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#64748b' }}>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#06b6d4' }}>{e.svc}</span>
                            <span style={{ color: '#cbd5e1' }}>→</span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.doc}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rule Catalog */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Validation Rules</h2>
              <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Deterministic checks executed during claim pre-validation. Showing {filtered.length} of {ALL_RULES.length} rules.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, color: '#10b981', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 4, padding: '3px 10px' }}>
                {ALL_RULES.filter(r => r.status === 'Active').length} active
              </span>
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="#94a3b8" strokeWidth="1.2"/>
                <path d="M9.5 9.5l3 3" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <input type="text" placeholder="Search rules..." value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '7px 12px 7px 32px', fontSize: '0.875rem', color: '#0f172a', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            {[
              { value: category, onChange: setCategory, options: CATEGORIES },
              { value: severity, onChange: setSeverity, options: SEVERITIES },
              { value: policy, onChange: setPolicy, options: POLICIES },
            ].map((s, i) => (
              <select key={i} value={s.value} onChange={e => s.onChange(e.target.value)}
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '7px 12px', fontSize: '0.875rem', color: '#0f172a', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
                {s.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
            {(search || category !== 'All categories' || severity !== 'All severities' || policy !== 'All policies') && (
              <button onClick={() => { setSearch(''); setCategory('All categories'); setSeverity('All severities'); setPolicy('All policies'); }}
                style={{ background: 'transparent', border: 'none', fontSize: '0.8125rem', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear
              </button>
            )}
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>ID</th>
              <th>Rule name</th>
              <th>Category</th>
              <th>Severity</th>
              <th>Version</th>
              <th>Policy scope</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '0.875rem' }}>No rules match your filters.</td></tr>
            ) : filtered.map(rule => {
              const sev = SEV_STYLE[rule.severity];
              const st = STATUS_STYLE[rule.status];
              return (
                <tr key={rule.id} onClick={() => setSelectedRule(rule)} style={{ cursor: 'pointer' }}>
                  <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 700, color: '#06b6d4' }}>{rule.id}</span></td>
                  <td>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{rule.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.description}</div>
                  </td>
                  <td><span style={{ fontSize: '0.8125rem', color: '#475569' }}>{rule.category}</span></td>
                  <td>
                    <span style={{ background: sev.bg, color: sev.text, border: `1px solid ${sev.border}`, borderRadius: 4, padding: '2px 8px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace" }}>
                      {rule.severity}
                    </span>
                  </td>
                  <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', color: '#64748b' }}>{rule.version}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {rule.policyScope.map(p => (
                        <span key={p} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', fontWeight: 700, color: p === 'EDU-BASIC' ? '#06b6d4' : '#8b5cf6', background: p === 'EDU-BASIC' ? 'rgba(6,182,212,0.08)' : 'rgba(139,92,246,0.08)', border: `1px solid ${p === 'EDU-BASIC' ? 'rgba(6,182,212,0.2)' : 'rgba(139,92,246,0.2)'}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.04em' }}>{p}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, borderRadius: 20, padding: '2px 10px', fontSize: '0.6875rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} />
                      {rule.status}
                    </span>
                  </td>
                  <td>
                    <button onClick={e => { e.stopPropagation(); setSelectedRule(rule); }}
                      style={{ background: 'transparent', border: 'none', color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.8125rem', padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      View
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Rule detail drawer */}
      {selectedRule && (
        <Drawer rule={selectedRule} onClose={() => setSelectedRule(null)} onNavigate={onNavigate} />
      )}
    </div>
  );
}
