import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';
import { evaluationToReviewRules, getDataset, getExplanation, postReview, type BackendClaim, type ReviewAction } from '../api/claims';

interface ClaimReviewProps {
  claimId: string;
  onNavigate: (page: string) => void;
}

type RuleStatus = 'PASS' | 'FAIL' | 'UNABLE_TO_ASSESS' | 'NOT_APPLICABLE' | 'NOT_IMPLEMENTED';

interface Rule {
  id: string;
  name: string;
  status: RuleStatus;
  finding: string;
  evidencePaths: string[];
  observed?: string;
  expected?: string;
  aiExplanation: string;
  category: string;
}

const RULES: Rule[] = [
  { id: 'R001', name: 'Member eligibility', category: 'Eligibility', status: 'PASS', finding: 'Member is eligible for the service date.', evidencePaths: ['/member/id', '/member/eligibility/effective_date', '/member/eligibility/termination_date'], observed: '"2023-01-01" → "2027-12-31"', aiExplanation: 'The member\'s eligibility period (2023-01-01 to 2027-12-31) fully encompasses the service date (2026-09-15). The eligibility status field confirms active enrollment.', },
  { id: 'R002', name: 'Provider enrollment', category: 'Provider', status: 'PASS', finding: 'Billing provider is enrolled with the payer.', evidencePaths: ['/billing_provider/npi', '/billing_provider/enrollment_status'], observed: '"ACTIVE"', aiExplanation: 'The billing provider NPI 1234567890 has an active enrollment status with this payer. The enrollment has no restrictions that would affect this claim type.', },
  { id: 'R003', name: 'Service date validity', category: 'Temporal', status: 'PASS', finding: 'Service date is within valid range.', evidencePaths: ['/lines/0/service_date', '/submission_date'], observed: '"2026-09-15" < "2026-09-25"', aiExplanation: 'The service date (2026-09-15) is in the past relative to the submission date (2026-09-25), which satisfies the temporal validity requirement. The 10-day gap is within the standard filing window.', },
  { id: 'R004', name: 'Benefit coverage', category: 'Coverage', status: 'PASS', finding: 'Service code is covered under the member benefit plan.', evidencePaths: ['/lines/0/service_code', '/member/plan_id', '/benefit_catalog/99213'], observed: '"COVERED"', aiExplanation: 'Service code 99213 (Office visit, established patient) is listed as a covered benefit under the member\'s plan (PLAN-7829). No exclusions or limitations apply to this service for this member.', },
  { id: 'R005', name: 'Duplicate claim check', category: 'Integrity', status: 'PASS', finding: 'No duplicate claim detected.', evidencePaths: ['/claim_id', '/member/id', '/lines/0/service_date', '/lines/0/service_code'], observed: 'No match in 90-day window', aiExplanation: 'No claim with matching member ID, service date, service code, and provider NPI was found within the 90-day lookback window. This claim appears to be a first submission.', },
  { id: 'R006', name: 'Diagnosis validity', category: 'Clinical', status: 'PASS', finding: 'Diagnosis codes are valid ICD-10-CM codes.', evidencePaths: ['/diagnoses/0/code', '/diagnoses/1/code'], observed: '"J06.9", "Z23"', aiExplanation: 'Both diagnosis codes (J06.9 — Acute upper respiratory infection, unspecified; Z23 — Encounter for immunization) are valid ICD-10-CM codes effective for the service date. Neither code has been retired or invalidated as of 2026-09-15.', },
  { id: 'R007', name: 'Service code validity', category: 'Clinical', status: 'PASS', finding: 'Service code is a valid CPT code.', evidencePaths: ['/lines/0/service_code'], observed: '"99213"', aiExplanation: 'CPT code 99213 is a valid, active procedure code. It has not been deleted, bundled, or replaced as of the service date.', },
  {
    id: 'R008',
    name: 'Authorization reference',
    category: 'Authorization',
    status: 'FAIL',
    finding: 'Required authorization reference is missing.',
    evidencePaths: ['/lines/0/service_code', '/lines/0/authorization_reference'],
    observed: 'null',
    expected: 'Non-null string (prior authorization number)',
    aiExplanation: 'The service code (99213) is flagged as requiring prior authorization under the member\'s benefit plan. The authorization_reference field for line 0 is null, indicating no prior authorization number was provided. Because the reference is absent, the authorization requirement cannot be verified. This constitutes a failure of the authorization reference rule.',
  },
  {
    id: 'R009',
    name: 'Authorization validity',
    category: 'Authorization',
    status: 'UNABLE_TO_ASSESS',
    finding: 'Authorization validity cannot be established because the required authorization reference is unavailable.',
    evidencePaths: ['/lines/0/authorization_reference', '/authorization_registry'],
    observed: 'null',
    aiExplanation: 'This rule requires an authorization reference number to look up the authorization record in the registry. Because the authorization reference (R008) is null, no lookup can be performed. The validity of any authorization cannot be assessed. This is not a failure — it is a consequence of the missing input from R008. Assessing this rule would require fabricating an assumption, which is not permitted.',
  },
  { id: 'R010', name: 'Place of service', category: 'Facility', status: 'PASS', finding: 'Place of service code is valid for the service type.', evidencePaths: ['/lines/0/place_of_service', '/lines/0/service_code'], observed: '"11" (Office)', aiExplanation: 'Place of service code 11 (Physician\'s office) is appropriate for CPT 99213. The combination of service code and place of service is a permitted pairing under the payer rules.', },
  { id: 'R011', name: 'Billing provider NPI', category: 'Provider', status: 'PASS', finding: 'Billing provider NPI is valid and active.', evidencePaths: ['/billing_provider/npi'], observed: '"1234567890"', aiExplanation: 'The billing provider NPI (1234567890) is a valid, 10-digit NPI that is active in the National Plan and Provider Enumeration System (NPPES) as of the service date.', },
  { id: 'R012', name: 'Rendering provider NPI', category: 'Provider', status: 'PASS', finding: 'Rendering provider NPI is valid and active.', evidencePaths: ['/rendering_provider/npi'], observed: '"9876543210"', aiExplanation: 'The rendering provider NPI (9876543210) is valid and active in NPPES. The rendering provider is associated with the billing provider\'s group practice, which satisfies the credentialing requirement.', },
  { id: 'R013', name: 'Diagnosis–procedure alignment', category: 'Clinical', status: 'PASS', finding: 'Diagnosis codes support the billed procedure.', evidencePaths: ['/lines/0/service_code', '/diagnoses/0/code'], observed: '99213 ↔ J06.9', aiExplanation: 'CPT 99213 (office visit) is clinically appropriate for the principal diagnosis J06.9 (acute upper respiratory infection). The ICD-10/CPT alignment check confirms this combination is valid and does not trigger any MUE or NCCI edit.', },
  { id: 'R014', name: 'Age & gender appropriateness', category: 'Clinical', status: 'PASS', finding: 'Service is appropriate for member age and gender.', evidencePaths: ['/member/date_of_birth', '/member/gender', '/lines/0/service_code'], observed: 'Age: 34 · Gender: F', aiExplanation: 'CPT 99213 has no age or gender restrictions. The member\'s age (34) and gender (Female) are within the permissible range for this service code. No age/gender-based edit applies.', },
  { id: 'R015', name: 'Coordination of benefits', category: 'Coverage', status: 'NOT_APPLICABLE', finding: 'Member has no secondary insurance. COB check is not applicable.', evidencePaths: ['/member/secondary_insurance'], observed: 'null', aiExplanation: 'The member has no secondary insurance plan on file. Coordination of benefits is not applicable for single-coverage members. This rule is correctly marked as not applicable.', },
];

const STATUS_LABEL: Record<RuleStatus, string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNABLE_TO_ASSESS: 'UNABLE TO ASSESS',
  NOT_APPLICABLE: 'N/A',
  NOT_IMPLEMENTED: 'NOT IMPLEMENTED',
};

const STATUS_SENTINEL: Record<RuleStatus, SentinelState> = {
  PASS: 'pass',
  FAIL: 'fail',
  UNABLE_TO_ASSESS: 'uncertain',
  NOT_APPLICABLE: 'idle',
  NOT_IMPLEMENTED: 'idle',
};

const STATUS_STYLE: Record<RuleStatus, { bg: string; text: string; border: string; leftBorder: string }> = {
  PASS: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass)', border: 'var(--status-pass-border)', leftBorder: 'var(--status-pass)' },
  FAIL: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail)', border: 'var(--status-fail-border)', leftBorder: 'var(--status-fail)' },
  UNABLE_TO_ASSESS: { bg: 'var(--status-uta-bg)', text: 'var(--status-uta)', border: 'var(--status-uta-border)', leftBorder: 'var(--status-uta)' },
  NOT_APPLICABLE: { bg: 'var(--status-na-bg)', text: 'var(--status-na)', border: 'var(--status-na-border)', leftBorder: 'var(--status-na)' },
  NOT_IMPLEMENTED: { bg: 'var(--status-na-bg)', text: 'var(--status-na)', border: 'var(--status-na-border)', leftBorder: 'var(--status-na)' },
};

const CATEGORY_COLORS: Record<string, string> = {
  'Eligibility': '#287a5f', 'Provider': '#315e8a', 'Temporal': '#9a6415',
  'Coverage': '#10b981', 'Integrity': '#f43f5e', 'Clinical': '#3b82f6',
  'Authorization': '#f97316', 'Facility': '#84cc16',
};

export default function ClaimReview({ claimId, onNavigate }: ClaimReviewProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [claim, setClaim] = useState<BackendClaim | null>(null);
  const [selectedRule, setSelectedRule] = useState<Rule>(RULES[0]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [aiFallback, setAiFallback] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [expandedFilter, setExpandedFilter] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getDataset('development', 500, controller.signal)
      .then((dataset) => {
        const selectedClaim = dataset.claims.find((item) => item.claim_id === claimId);
        const result = evaluationToReviewRules(dataset.evaluations[claimId]);
        if (!selectedClaim || !result.length) {
          setLoadError('This claim was not found in the development dataset.');
          return;
        }
        setClaim(selectedClaim);
        setRules(result);
        setSelectedRule(result.find((rule) => rule.status === 'FAIL') || result[0]);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError('The claim evaluation could not be loaded.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [claimId]);

  useEffect(() => {
    if (!claim || !rules.some((rule) => rule.id === selectedRule.id)) return;

    const controller = new AbortController();
    setAiLoading(true);
    setAiExplanation(null);
    setAiProvider(null);
    setAiFallback(false);
    getExplanation(claim, selectedRule.id, 'openai', controller.signal)
      .then((response) => {
        setAiExplanation(response.explanation);
        setAiProvider(response.provider);
        setAiFallback(response.fallback_used);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
      })
      .finally(() => setAiLoading(false));

    return () => controller.abort();
  }, [claim, rules, selectedRule.id]);

  const passingRules = rules.filter(r => r.status === 'PASS').length;
  const failingRules = rules.filter(r => r.status === 'FAIL').length;
  const utaRules = rules.filter(r => r.status === 'UNABLE_TO_ASSESS').length;

  const ss = STATUS_STYLE[selectedRule.status];

  const handleConfirm = async () => {
    if (!reviewAction || reviewSubmitting) return;

    const actionMap: Record<string, ReviewAction> = {
      confirm: 'confirm_issue',
      dismiss: 'dismiss_with_reason',
      'request-info': 'request_information',
      'correct-recheck': 'mark_corrected_for_recheck',
    };
    const originalStatus = selectedRule.status === 'NOT_IMPLEMENTED' ? 'UNABLE_TO_ASSESS' : selectedRule.status;
    const reason = reviewNote.trim() || reviewReason || 'Decision recorded from Claim Review.';

    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await postReview(claimId, selectedRule.id, actionMap[reviewAction], reason, originalStatus);
      setConfirmed(true);
      setReviewAction(null);
    } catch {
      setReviewError('The decision could not be recorded. The rule result remains unchanged.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div className="claim-review-shell" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Header bar */}
      <div style={{
        background: 'var(--card-bg)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }} className="claim-review-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => onNavigate('claims')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '4px 8px',
              borderRadius: 5,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Claims
          </button>
          <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em' }}>
              {claimId}
            </span>
            {!confirmed ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--status-review-bg)',
                color: 'var(--status-review)',
                border: '1px solid var(--status-review-border)',
                borderRadius: 4,
                padding: '3px 10px',
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--status-review)' }} />
                Needs Review
              </span>
            ) : (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--status-pass-bg)',
                color: 'var(--status-pass)',
                border: '1px solid var(--status-pass-border)',
                borderRadius: 4,
                padding: '3px 10px',
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--status-pass)' }} />
                Reviewed
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="claim-review-actions" style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setReviewAction('request-info')}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            Request info
          </button>
          <button
            onClick={() => setReviewAction('correct-recheck')}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            Correct & Recheck
          </button>
          <button
            onClick={() => setReviewAction('dismiss')}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            Dismiss
          </button>
          <button
            onClick={() => setReviewAction('confirm')}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 4,
              padding: '6px 16px',
              fontSize: '0.8125rem',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            Confirm decision
          </button>
        </div>
      </div>

      {/* 3-panel layout */}
      <div className="claim-review-panels">

        {/* LEFT: Claim information */}
        <div style={{
          borderRight: '1px solid var(--border)',
          background: 'var(--card-bg)',
          overflow: 'auto',
          padding: '20px',
        }} className="claim-review-claim-panel">
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12 }}>
              Claim information
            </div>

            {[
              { label: 'Claim ID', value: claimId, mono: true },
              { label: 'Member', value: 'James Chen' },
              { label: 'Member ID', value: 'MEM-482910', mono: true },
              { label: 'Provider', value: 'Meridian Health Group' },
              { label: 'Billing NPI', value: '1234567890', mono: true },
              { label: 'Rendering NPI', value: '9876543210', mono: true },
              { label: 'Service date', value: 'Sep 15, 2026', mono: true },
              { label: 'Submission date', value: 'Sep 25, 2026', mono: true },
              { label: 'Total amount', value: '$2,840.00', mono: true },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.6875rem', color: '#94a3b8', marginBottom: 2, fontWeight: 500 }}>{f.label}</div>
                <div style={{
                  fontSize: '0.8125rem',
                  color: '#0f172a',
                  fontFamily: f.mono ? "'JetBrains Mono', monospace" : 'inherit',
                  fontWeight: f.mono ? 500 : 400,
                }}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: '#f1f5f9', margin: '16px 0' }} />

          {/* Service lines */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12 }}>
              Service lines
            </div>
            {[
              { line: 0, code: '99213', desc: 'Office visit, estab. patient', amount: '$150.00', auth: null },
              { line: 1, code: '90686', desc: 'Influenza vaccine, quad.', amount: '$25.00', auth: 'AUTH-8821' },
            ].map(line => (
              <div
                key={line.line}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a' }}>{line.code}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a' }}>{line.amount}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 4 }}>{line.desc}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>Auth:</span>
                  {line.auth ? (
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: '#10b981' }}>{line.auth}</span>
                  ) : (
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: '#f43f5e', fontStyle: 'italic' }}>null</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: '#f1f5f9', margin: '16px 0' }} />

          {/* Diagnoses */}
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12 }}>
              Diagnoses
            </div>
            {[
              { code: 'J06.9', desc: 'Acute upper respiratory infection' },
              { code: 'Z23', desc: 'Encounter for immunization' },
            ].map(d => (
              <div key={d.code} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, minWidth: 48 }}>{d.code}</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>{d.desc}</span>
              </div>
            ))}
          </div>

          {/* Run info */}
          <div style={{ height: 1, background: '#f1f5f9', margin: '16px 0' }} />
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12 }}>
              Run metadata
            </div>
            {[
              { label: 'Run ID', value: 'RUN-4821', mono: true },
              { label: 'Ruleset', value: 'v2.4.1' },
              { label: 'AI model', value: 'CGM-3.1' },
              { label: 'Evaluated', value: '10:31:03' },
              { label: 'Duration', value: '1.2s' },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{f.label}</div>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#334155',
                  fontFamily: f.mono ? "'JetBrains Mono', monospace" : 'inherit',
                  fontWeight: f.mono ? 500 : 400,
                }}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER: Validation findings */}
        <div style={{ overflow: 'auto', background: 'var(--canvas-bg)', padding: '20px' }} className="claim-review-findings-panel">
          {/* Summary row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Pass', count: passingRules, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
              { label: 'Fail', count: failingRules, color: '#f43f5e', bg: '#fff1f2', border: '#fecdd3' },
              { label: 'Unable to assess', count: utaRules, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
              { label: 'Not applicable', count: 1, color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' },
            ].map(s => (
              <div key={s.label} style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderRadius: 8,
                padding: '10px 14px',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.125rem', fontWeight: 700, color: s.color }}>{s.count}</span>
                <span style={{ fontSize: '0.75rem', color: s.color, fontWeight: 500 }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Rule cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map(rule => {
              const st = STATUS_STYLE[rule.status];
              const isSelected = selectedRule.id === rule.id;
              const catColor = CATEGORY_COLORS[rule.category] || '#94a3b8';

              return (
                <div
                  key={rule.id}
                  onClick={() => setSelectedRule(rule)}
                  style={{
                    background: '#fff',
                    border: `1px solid ${isSelected ? st.leftBorder : '#e2e8f0'}`,
                    borderLeft: `3px solid ${st.leftBorder}`,
                    borderRadius: 8,
                    padding: '14px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? `0 0 0 2px color-mix(in srgb, ${st.leftBorder} 12%, transparent)` : 'none',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = `color-mix(in srgb, ${st.leftBorder} 60%, transparent)`; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = '#e2e8f0'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'var(--accent)',
                        letterSpacing: '0.04em',
                        minWidth: 36,
                      }}>
                        {rule.id}
                      </span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em' }}>
                        {rule.name}
                      </span>
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        color: catColor,
                        background: `${catColor}14`,
                        border: `1px solid ${catColor}25`,
                        borderRadius: 4,
                        padding: '1px 6px',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}>
                        {rule.category}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sentinel state={STATUS_SENTINEL[rule.status]} size={20} />
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        color: st.text,
                        background: st.bg,
                        border: `1px solid ${st.border}`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        letterSpacing: '0.06em',
                        whiteSpace: 'nowrap',
                      }}>
                        {STATUS_LABEL[rule.status]}
                      </span>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                    {rule.finding}
                  </p>

                  {(rule.status === 'FAIL' || rule.status === 'UNABLE_TO_ASSESS') && rule.observed && (
                    <div style={{ marginTop: 10 }}>
                      <div className="evidence-block">
                        <span className="ev-path">{rule.evidencePaths[rule.evidencePaths.length - 1]}</span>
                        {' = '}
                        <span className={rule.observed === 'null' ? 'ev-null' : 'ev-value'}>{rule.observed}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Evidence + AI explanation */}
        <div style={{
          borderLeft: '1px solid var(--border)',
          background: 'var(--card-bg)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }} className="claim-review-explanation-panel">
          {/* Finding header */}
          <div style={{
            padding: '18px 20px',
            borderBottom: '1px solid #f1f5f9',
            background: ss.bg,
            borderLeft: `3px solid ${ss.leftBorder}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sentinel state={STATUS_SENTINEL[selectedRule.status]} size={32} />
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent)' }}>
                    {selectedRule.id}
                  </div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em' }}>
                    {selectedRule.name}
                  </div>
                </div>
              </div>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.6875rem',
                fontWeight: 700,
                color: ss.text,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                {STATUS_LABEL[selectedRule.status]}
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.5 }}>
              {selectedRule.finding}
            </p>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {/* Deterministic section */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              marginBottom: 16,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '10px 14px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f1f5f9',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1l5 9H1L6 1z" stroke="#0f172a" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', color: '#0f172a', textTransform: 'uppercase' }}>
                    Deterministic finding
                  </span>
                </div>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  color: ss.text,
                  background: ss.bg,
                  border: `1px solid ${ss.border}`,
                  borderRadius: 3,
                  padding: '1px 6px',
                }}>
                  {STATUS_LABEL[selectedRule.status]}
                </span>
              </div>
              <div style={{ padding: '14px' }}>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Rule
                </div>
                <p style={{ fontSize: '0.8125rem', color: '#334155', lineHeight: 1.6, marginBottom: 14 }}>
                  {selectedRule.finding}
                </p>

                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Evidence paths
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                  {selectedRule.evidencePaths.map(path => (
                    <div key={path} className="evidence-block" style={{ padding: '5px 10px' }}>
                      <span className="ev-path">{path}</span>
                    </div>
                  ))}
                </div>

                {selectedRule.observed !== undefined && (
                  <>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Observed
                    </div>
                    <div className="evidence-block">
                      <span className="ev-path">{selectedRule.evidencePaths[selectedRule.evidencePaths.length - 1]}</span>
                      {' = '}
                      <span className={selectedRule.observed === 'null' ? 'ev-null' : 'ev-value'}>
                        {selectedRule.observed}
                      </span>
                    </div>
                  </>
                )}

                {selectedRule.expected && (
                  <>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '10px 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Expected
                    </div>
                    <div className="evidence-block">
                      <span style={{ color: '#10b981', fontStyle: 'italic' }}>{selectedRule.expected}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* AI explanation */}
            <div style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              marginBottom: 16,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '10px 14px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#fafafa',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="var(--accent)" strokeWidth="1.2"/>
                    <circle cx="6" cy="6" r="2" fill="var(--accent)"/>
                  </svg>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                    AI-assisted explanation
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    color: 'var(--accent)',
                    background: 'var(--accent-subtle)',
                    border: '1px solid var(--status-pass-border)',
                    borderRadius: 3,
                    padding: '1px 6px',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>
                    Grounded
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.625rem',
                    color: '#94a3b8',
                  }}>
                    {aiProvider || 'pending'}{aiFallback ? ' · fallback' : ''}
                  </span>
                </div>
              </div>
              <div style={{ padding: '8px 14px', background: 'var(--canvas-bg)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.6875rem', lineHeight: 1.45 }}>
                Context only. The deterministic rule result above remains authoritative.
              </div>
              <div style={{ padding: '14px' }}>
                {aiLoading ? (
                  <div style={{ color: '#64748b', fontSize: '0.875rem', lineHeight: 1.7 }}>
                    Generating a grounded explanation…
                  </div>
                ) : !aiExplanation ? (
                  <div style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 6,
                    padding: '12px',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                  }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M8 2l6 11H2L8 2z" stroke="#f59e0b" strokeWidth="1.3" strokeLinejoin="round"/>
                      <path d="M8 6v4M8 11.5v.5" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    <div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                        AI explanation unavailable
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#b45309', lineHeight: 1.5 }}>
                        The deterministic finding remains available. You may proceed with review based on the rule result and evidence above.
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.7, marginBottom: 14 }}>
                      {aiExplanation}
                    </p>

                    {/* Citations */}
                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                      <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                        Citations
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {selectedRule.evidencePaths.map(p => (
                          <span
                            key={p}
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: '0.6875rem',
                              color: 'var(--status-review)',
                              background: 'var(--status-review-bg)',
                              border: '1px solid var(--status-review-border)',
                              borderRadius: 4,
                              padding: '2px 8px',
                            }}
                          >
                            {p}
                          </span>
                        ))}
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '0.6875rem',
                          color: 'var(--accent)',
                          background: 'var(--accent-subtle)',
                          border: '1px solid var(--status-pass-border)',
                          borderRadius: 4,
                          padding: '2px 8px',
                        }}>
                          {selectedRule.id}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Human review panel */}
            {!confirmed ? (
              <div style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #e2e8f0',
                  background: '#fafafa',
                }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', color: '#0f172a', textTransform: 'uppercase' }}>
                    Human review
                  </span>
                </div>
                <div style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {[
                      { key: 'confirm', label: 'Confirm issue', desc: 'Issue is valid', color: '#f43f5e', bg: '#fff1f2', border: '#fecdd3' },
                      { key: 'request-info', label: 'Request information', desc: 'More info needed', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
                      { key: 'dismiss', label: 'Dismiss', desc: 'Issue is not valid', color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' },
                    ].map(action => (
                      <button
                        key={action.key}
                        onClick={() => setReviewAction(action.key)}
                        style={{
                          background: reviewAction === action.key ? action.bg : '#f8fafc',
                          border: `1px solid ${reviewAction === action.key ? action.border : '#e2e8f0'}`,
                          borderRadius: 7,
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: reviewAction === action.key ? action.color : '#334155' }}>{action.label}</div>
                          <div style={{ fontSize: '0.6875rem', color: '#94a3b8', marginTop: 1 }}>{action.desc}</div>
                        </div>
                        {reviewAction === action.key && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2 7l4 4 6-7" stroke={action.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>

                  {reviewAction && (
                    <>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
                          Reason
                        </label>
                        <select
                          value={reviewReason}
                          onChange={e => setReviewReason(e.target.value)}
                          style={{
                            width: '100%',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            padding: '7px 10px',
                            fontSize: '0.8125rem',
                            color: '#0f172a',
                            fontFamily: 'inherit',
                            outline: 'none',
                          }}
                        >
                          <option value="">Select reason...</option>
                          <option>Authorization reference was subsequently provided</option>
                          <option>Provider submitted corrected claim</option>
                          <option>Rule does not apply to this payer contract</option>
                          <option>Evidence was available in separate document</option>
                          <option>Other (see note)</option>
                        </select>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
                          Reviewer note
                        </label>
                        <textarea
                          value={reviewNote}
                          onChange={e => setReviewNote(e.target.value)}
                          placeholder="Optional: add a note for the audit record..."
                          rows={3}
                          style={{
                            width: '100%',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            padding: '8px 10px',
                            fontSize: '0.8125rem',
                            color: '#0f172a',
                            fontFamily: 'inherit',
                            outline: 'none',
                            resize: 'vertical',
                          }}
                        />
                      </div>

                      <button
                        onClick={handleConfirm}
                        disabled={reviewSubmitting}
                        style={{
                          width: '100%',
                          background: '#0f172a',
                          border: 'none',
                          borderRadius: 7,
                          padding: '10px',
                          color: '#fff',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          letterSpacing: '-0.01em',
                          opacity: reviewSubmitting ? 0.65 : 1,
                        }}
                      >
                        {reviewSubmitting ? 'Recording decision…' : 'Submit decision → record to audit'}
                      </button>
                      {reviewError && (
                        <p style={{ fontSize: '0.75rem', color: '#be123c', marginTop: 8, lineHeight: 1.4 }}>
                          {reviewError}
                        </p>
                      )}
                      <p style={{ fontSize: '0.6875rem', color: '#94a3b8', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
                        This action will be recorded in the immutable audit trail.
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 8,
                padding: '16px',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="9" cy="9" r="8" fill="#10b981"/>
                  <path d="M5 9l3 3 5-6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#065f46', marginBottom: 4 }}>
                    Decision recorded
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#047857', lineHeight: 1.5 }}>
                    Reviewed by Aya Gaha · {new Date().toLocaleTimeString()} · Recorded to audit trail
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Review action modal */}
      {reviewAction && !confirmed && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setReviewAction(null)}
        >
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '24px',
              width: 440,
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              animation: 'fade-in-up 0.2s ease-out',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>
                {reviewAction === 'confirm' ? 'Confirm issue' :
                 reviewAction === 'request-info' ? 'Request information' :
                 reviewAction === 'dismiss' ? 'Dismiss finding' :
                 'Correct & Recheck'}
              </h3>
              <button
                onClick={() => setReviewAction(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 7,
                padding: '10px 12px',
                marginBottom: 14,
                display: 'flex',
                gap: 8,
              }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>{selectedRule.id}</span>
                <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{selectedRule.name}</span>
              </div>

              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                Reason
              </label>
              <select
                value={reviewReason}
                onChange={e => setReviewReason(e.target.value)}
                style={{
                  width: '100%',
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 7,
                  padding: '9px 12px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  marginBottom: 14,
                  outline: 'none',
                  color: '#0f172a',
                }}
              >
                <option value="">Select a reason...</option>
                <option>Authorization reference was subsequently provided</option>
                <option>Provider submitted corrected claim</option>
                <option>Rule does not apply to this payer contract</option>
                <option>Evidence was available in separate document</option>
                <option>Other (see note)</option>
              </select>

              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                Note (optional)
              </label>
              <textarea
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                placeholder="Add context for the audit record..."
                rows={3}
                style={{
                  width: '100%',
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 7,
                  padding: '9px 12px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                  resize: 'vertical',
                  color: '#0f172a',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setReviewAction(null)}
                style={{
                  flex: 1,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 7,
                  padding: '10px',
                  fontSize: '0.875rem',
                  color: '#475569',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  flex: 2,
                  background: '#0f172a',
                  border: 'none',
                  borderRadius: 7,
                  padding: '10px',
                  color: '#fff',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                }}
              >
                Submit · Record to audit trail
              </button>
            </div>

            <p style={{ fontSize: '0.6875rem', color: '#94a3b8', marginTop: 10, textAlign: 'center' }}>
              This action is permanent and will be recorded in the immutable audit chain.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
