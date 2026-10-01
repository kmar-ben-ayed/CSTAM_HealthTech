import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';

interface LandingProps {
  onEnterApp: () => void;
}

const WORKFLOW_STEPS = [
  { id: 1, label: 'Claim received', icon: '⬤', detail: 'Structured claim data' },
  { id: 2, label: 'Rules evaluated', icon: '⬤', detail: 'Deterministic outcomes' },
  { id: 3, label: 'Evidence inspected', icon: '⬤', detail: 'Source paths preserved' },
  { id: 4, label: 'Reviewer decides', icon: '⬤', detail: 'Action recorded to audit' },
];

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="16" height="14" rx="2" stroke="#06b6d4" strokeWidth="1.5"/>
        <path d="M6 8h8M6 12h5" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Deterministic Rules',
    desc: 'A rule engine that always returns the same result for the same input. No probabilistic decisions. The engine is authoritative.',
    tag: 'AUTHORITATIVE',
    tagColor: '#78b89b',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="#10b981" strokeWidth="1.5"/>
        <path d="M10 6v4l3 2" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Grounded AI',
    desc: 'AI explanations are anchored to deterministic findings and extracted evidence. The AI never decides — it explains.',
    tag: 'EXPLAINABLE',
    tagColor: '#7eb58b',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="7" r="3" stroke="#8b5cf6" strokeWidth="1.5"/>
        <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Human Oversight',
    desc: 'Every claim passes through a structured human review step. Humans confirm, dismiss, or request additional information.',
    tag: 'HUMAN-IN-LOOP',
    tagColor: '#8b5cf6',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2l2 6h6l-5 3.6 2 6-5-3.6-5 3.6 2-6L2 8h6l2-6z" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Auditability',
    desc: 'Every system action and human decision is recorded in a cryptographically-chained audit log. Nothing is lost.',
    tag: 'TRACEABLE',
    tagColor: '#f59e0b',
  },
];

const RULE_EXAMPLES = [
  { id: 'R001', name: 'Member eligibility', category: 'Eligibility' },
  { id: 'R002', name: 'Provider enrollment', category: 'Provider' },
  { id: 'R003', name: 'Service date validity', category: 'Temporal' },
  { id: 'R004', name: 'Benefit coverage', category: 'Coverage' },
  { id: 'R005', name: 'Duplicate claim check', category: 'Integrity' },
  { id: 'R006', name: 'Diagnosis validity', category: 'Clinical' },
  { id: 'R007', name: 'Service code validity', category: 'Clinical' },
  { id: 'R008', name: 'Authorization reference', category: 'Authorization' },
  { id: 'R009', name: 'Authorization validity', category: 'Authorization' },
  { id: 'R010', name: 'Place of service', category: 'Facility' },
  { id: 'R011', name: 'Billing provider NPI', category: 'Provider' },
  { id: 'R012', name: 'Rendering provider NPI', category: 'Provider' },
  { id: 'R013', name: 'Diagnosis-procedure alignment', category: 'Clinical' },
  { id: 'R014', name: 'Age & gender appropriateness', category: 'Clinical' },
  { id: 'R015', name: 'Coordination of benefits', category: 'Coverage' },
];

const UNCERTAINTY_STATES = [
  {
    status: 'PASS',
    sentinelState: 'pass' as SentinelState,
    color: '#10b981',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    desc: 'All evidence present. Rule requirements met.',
    icon: '✓',
  },
  {
    status: 'FAIL',
    sentinelState: 'fail' as SentinelState,
    color: '#f43f5e',
    bg: '#fff1f2',
    border: '#fecdd3',
    desc: 'Evidence confirms rule requirements are not met.',
    icon: '✗',
  },
  {
    status: 'UNABLE TO ASSESS',
    sentinelState: 'uncertain' as SentinelState,
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
    desc: 'Required evidence is absent. Assessment withheld.',
    icon: '~',
  },
  {
    status: 'NOT APPLICABLE',
    sentinelState: 'idle' as SentinelState,
    color: '#94a3b8',
    bg: '#f8fafc',
    border: '#e2e8f0',
    desc: 'Rule does not apply to this claim type.',
    icon: '–',
  },
];

export default function Landing({ onEnterApp }: LandingProps) {
  const activeStep = 2;

  const categoryColors: Record<string, string> = {
    'Eligibility': '#06b6d4',
    'Provider': '#8b5cf6',
    'Temporal': '#f59e0b',
    'Coverage': '#10b981',
    'Integrity': '#f43f5e',
    'Clinical': '#3b82f6',
    'Authorization': '#f97316',
    'Facility': '#84cc16',
  };

  return (
    <div className="landing-shell" style={{ background: '#17251f', minHeight: '100vh', color: '#f1f5f9', fontFamily: 'var(--font-sans)' }}>
      {/* Nav */}
      <nav style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        background: 'rgba(23,37,31,0.96)',
        backdropFilter: 'blur(12px)',
        zIndex: 50,
      }} className="landing-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sentinel state="idle" size={28} />
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em', color: '#f1f5f9' }}>
            ClaimGuard <span style={{ color: '#06b6d4' }}>AI</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onEnterApp}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              padding: '6px 14px',
              color: '#94a3b8',
              fontSize: '0.875rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            Sign in
          </button>
          <button
            onClick={onEnterApp}
            style={{
              background: '#287a5f',
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              color: '#fff',
              fontSize: '0.875rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            Open Workspace
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 1200, margin: '0 auto' }} className="landing-hero">
        <div style={{ display: 'grid', alignItems: 'center' }} className="landing-hero-grid">
          <div style={{ animation: 'fade-in-up 0.6s ease-out both' }}>
            {/* Eyebrow */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(120,184,155,0.1)',
              border: '1px solid rgba(120,184,155,0.25)',
              borderRadius: 4,
              padding: '4px 14px',
              marginBottom: 28,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#78b89b' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', color: '#a8d2ba', textTransform: 'uppercase' }}>
                Claims operations · Evidence-led review
              </span>
            </div>

            <h1 style={{
              fontSize: '3.5rem',
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.04em',
              marginBottom: 24,
              color: '#f8fafc',
            }}>
              Make every<br />
              claim finding<br />
              <span style={{ color: '#9bc9ac' }}>inspectable.</span>
            </h1>

            <p style={{
              fontSize: '1.125rem',
              lineHeight: 1.7,
              color: '#94a3b8',
              marginBottom: 40,
              maxWidth: 480,
              letterSpacing: '-0.01em',
            }}>
              Rules determine the outcome. Source evidence shows why. AI helps explain the finding, while the reviewer keeps the decision.
            </p>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                onClick={onEnterApp}
                style={{
                  background: '#287a5f',
                  border: 'none',
                  borderRadius: 8,
                  padding: '12px 24px',
                  color: '#fff',
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1b654c')}
                onMouseLeave={e => (e.currentTarget.style.background = '#287a5f')}
              >
                Open Review Workspace
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => document.getElementById('review-example')?.scrollIntoView({ behavior: 'smooth' })}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  padding: '12px 24px',
                  color: '#94a3b8',
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 500,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; e.currentTarget.style.color = '#f1f5f9'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#94a3b8'; }}
              >
                Explore how it works
              </button>
            </div>

            {/* Trust indicators */}
            <div style={{ display: 'flex', gap: 24, marginTop: 40, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { label: 'Deterministic', icon: '◆', desc: 'Rule engine' },
                { label: 'Grounded', icon: '◎', desc: 'AI explanations' },
                { label: 'Auditable', icon: '▣', desc: 'Every decision' },
              ].map(t => (
                <div key={t.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#9bc9ac', fontSize: '0.625rem' }}>{t.icon}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#e2e8f0', letterSpacing: '-0.01em' }}>{t.label}</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{t.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visualization */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Claim flow visualization */}
            <div id="review-example" style={{
              background: '#f7faf7',
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 8,
              padding: '24px',
              width: '100%',
              color: '#192620',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingBottom: 18, borderBottom: '1px solid #dce5df' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Sentinel state="review" size={40} />
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: '#74847c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Claim under review</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: '#192620' }}>CLM-10482</div>
                    <div style={{ fontSize: '0.75rem', color: '#50635a', marginTop: 3 }}>Meridian Health Group · Sep 15, 2026</div>
                  </div>
                </div>
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#315e8a', background: '#edf3f8', border: '1px solid #cad9e6', borderRadius: 4, padding: '4px 7px', whiteSpace: 'nowrap' }}>Needs review</span>
              </div>
              <div style={{ padding: '18px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 650, color: '#192620' }}>R008 · Authorization reference</div>
                  <span style={{ color: '#b33f47', background: '#fbefef', border: '1px solid #e8c7c8', borderRadius: 4, padding: '3px 7px', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', fontWeight: 600 }}>FAIL</span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: '#50635a', lineHeight: 1.5, marginBottom: 12 }}>Required authorization reference is missing from the claim line.</p>
                <div style={{ border: '1px solid #dce5df', borderRadius: 4, padding: '10px 12px', background: '#eef2ef', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#315e8a', overflowWrap: 'anywhere' }}>
                  /lines/0/authorization_reference <span style={{ color: '#74847c' }}>=</span> <span style={{ color: '#b33f47' }}>null</span>
                </div>
              </div>
              <div style={{ paddingTop: 14, borderTop: '1px solid #dce5df', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#50635a', fontSize: '0.75rem', lineHeight: 1.4 }}>Evidence-linked rule result · reviewer decision pending</span>
                <button onClick={onEnterApp} style={{ flexShrink: 0, background: '#176b52', color: '#fff', border: 0, borderRadius: 4, padding: '8px 12px', font: '600 0.75rem var(--font-sans)', cursor: 'pointer' }}>Review claim</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features section */}
      <section style={{ padding: '80px 48px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#06b6d4', textTransform: 'uppercase', marginBottom: 12 }}>
            Core principles
          </p>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#f8fafc', marginBottom: 16 }}>
            Built around trust,<br />not black-box decisions.
          </h2>
          <p style={{ fontSize: '1rem', color: '#64748b', maxWidth: 480, margin: '0 auto' }}>
            Every finding is deterministic. Every explanation is grounded. Every decision is recorded.
          </p>
        </div>

      <div style={{ display: 'grid', gap: 16 }} className="landing-feature-grid">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: '24px',
                transition: 'all 0.2s ease',
                cursor: 'default',
                animationDelay: `${i * 80}ms`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <div style={{ marginBottom: 16 }}>{f.icon}</div>
              <div style={{
                display: 'inline-block',
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: f.tagColor,
                background: `${f.tagColor}14`,
                border: `1px solid ${f.tagColor}30`,
                borderRadius: 4,
                padding: '2px 8px',
                marginBottom: 10,
                textTransform: 'uppercase',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {f.tag}
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0', letterSpacing: '-0.02em', marginBottom: 8 }}>
                {f.title}
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow section */}
      <section style={{ padding: '80px 48px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#06b6d4', textTransform: 'uppercase', marginBottom: 12 }}>
              Workflow
            </p>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#f8fafc' }}>
              From claim to decision
            </h2>
          </div>

          <div style={{ display: 'grid', gap: 0, position: 'relative' }} className="landing-workflow-grid">
            {/* Connecting line */}
            <div style={{
              position: 'absolute',
              top: 28,
              left: '6.25%',
              right: '6.25%',
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.3) 20%, rgba(6,182,212,0.3) 80%, transparent)',
            }} />

            {WORKFLOW_STEPS.map((step, i) => (
              <div key={step.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: i <= activeStep ? 'rgba(6,182,212,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${i <= activeStep ? 'rgba(6,182,212,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: 1,
                  transition: 'all 0.3s ease',
                }}>
                  <span style={{
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    color: i <= activeStep ? '#06b6d4' : '#334155',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {String(step.id).padStart(2, '0')}
                  </span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: i <= activeStep ? '#e2e8f0' : '#475569', letterSpacing: '-0.01em', marginBottom: 2, transition: 'color 0.3s ease' }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: '#334155' }}>{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Rules grid */}
      <section style={{ padding: '80px 48px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40 }}>
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#06b6d4', textTransform: 'uppercase', marginBottom: 12 }}>
                Validation engine
              </p>
              <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#f8fafc' }}>
                15 validation rules
              </h2>
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.6875rem',
              color: '#06b6d4',
              background: 'rgba(6,182,212,0.08)',
              border: '1px solid rgba(6,182,212,0.2)',
              borderRadius: 6,
              padding: '6px 12px',
              letterSpacing: '0.04em',
            }}>
              v2.4.1 · ACTIVE
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }} className="landing-rule-grid">
            {RULE_EXAMPLES.slice(0, 5).map((rule, i) => {
              const color = categoryColors[rule.category] || '#94a3b8';
              return (
                <div
                  key={rule.id}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    cursor: 'default',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = `${color}30`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      color: '#06b6d4',
                      letterSpacing: '0.04em',
                    }}>
                      {rule.id}
                    </span>
                    <span style={{
                      fontSize: '0.6rem',
                      fontWeight: 600,
                      color,
                      background: `${color}14`,
                      borderRadius: 4,
                      padding: '2px 6px',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}>
                      {rule.category}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#94a3b8', lineHeight: 1.4 }}>
                    {rule.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Uncertainty section */}
      <section style={{ padding: '80px 48px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'grid', gap: 48, alignItems: 'center' }} className="landing-uncertainty-grid">
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#06b6d4', textTransform: 'uppercase', marginBottom: 12 }}>
                Epistemic integrity
              </p>
              <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#f8fafc', marginBottom: 20 }}>
                Designed for uncertainty
              </h2>
              <p style={{ fontSize: '1rem', color: '#64748b', lineHeight: 1.7, marginBottom: 24 }}>
                Missing evidence must not become fabricated certainty. ClaimGuard AI distinguishes between what it knows, what it can't determine, and what doesn't apply.
              </p>
              <p style={{ fontSize: '0.9375rem', color: '#475569', lineHeight: 1.7 }}>
                When evidence is absent, the system returns <strong style={{ color: '#f59e0b', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem' }}>UNABLE TO ASSESS</strong> rather than forcing a binary outcome. The AI will never invent information to fill a gap.
              </p>
            </div>

            <div style={{ display: 'grid', gap: 12 }} className="landing-state-grid">
              {UNCERTAINTY_STATES.map(s => (
                <div
                  key={s.status}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${s.color}20`,
                    borderRadius: 10,
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    alignItems: 'center',
                    textAlign: 'center',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Sentinel state={s.sentinelState} size={52} />
                  <div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: s.color,
                      letterSpacing: '0.06em',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                    }}>
                      {s.status}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
                      {s.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Human-in-the-loop section */}
      <section style={{ padding: '80px 48px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', color: '#8b5cf6', textTransform: 'uppercase', marginBottom: 12 }}>
            Human oversight
          </p>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#f8fafc', marginBottom: 16 }}>
            Human-in-the-loop by design
          </h2>
          <p style={{ fontSize: '1rem', color: '#64748b', maxWidth: 560, margin: '0 auto 48px', lineHeight: 1.7 }}>
            Every claim requiring a decision goes through structured human review. Reviewers see exactly what the system found, the evidence it found, and what the AI explained.
          </p>

          {/* Mini workspace preview */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            padding: 24,
            maxWidth: 800,
            margin: '0 auto',
            textAlign: 'left',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', color: '#06b6d4', fontWeight: 600 }}>CLM-10482</div>
                <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 2 }}>Meridian Health Group · Dr. Sarah Chen</div>
              </div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(139,92,246,0.1)',
                border: '1px solid rgba(139,92,246,0.2)',
                borderRadius: 20,
                padding: '4px 12px',
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#8b5cf6' }} />
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Needs Review</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12 }} className="landing-preview-grid">
              {[
                { rule: 'R001', name: 'Member eligibility', status: 'PASS', color: '#10b981' },
                { rule: 'R008', name: 'Authorization reference', status: 'FAIL', color: '#f43f5e' },
                { rule: 'R009', name: 'Authorization validity', status: 'UNABLE TO ASSESS', color: '#f59e0b' },
                { rule: 'R015', name: 'Coordination of benefits', status: 'NOT APPLICABLE', color: '#94a3b8' },
              ].map(r => (
                <div key={r.rule} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${r.color}20`,
                  borderLeft: `3px solid ${r.color}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: '#06b6d4', fontWeight: 600, minWidth: 36 }}>{r.rule}</span>
                  <span style={{ fontSize: '0.8125rem', color: '#94a3b8', flex: 1 }}>{r.name}</span>
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, color: r.color, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{r.status}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              {['Confirm issue', 'Request info', 'Dismiss', 'Add note'].map((action, i) => (
                <button
                  key={action}
                  style={{
                    background: i === 0 ? '#06b6d4' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${i === 0 ? '#06b6d4' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 6,
                    padding: '7px 14px',
                    fontSize: '0.8125rem',
                    color: i === 0 ? '#fff' : '#64748b',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 500,
                  }}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '32px 48px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sentinel state="idle" size={20} />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>ClaimGuard AI</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#334155' }}>
          Deterministic checks · Evidence-linked findings · Human decisions
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {['Privacy', 'Terms', 'Security', 'Status'].map(link => (
            <span key={link} style={{ fontSize: '0.75rem', color: '#475569', cursor: 'pointer' }}>{link}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
