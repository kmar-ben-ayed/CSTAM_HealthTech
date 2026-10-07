import { useState } from 'react';
import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';

interface LandingProps {
  onEnterApp: () => void;
}

const WORKFLOW_STEPS = [
  { id: 1, label: 'Claim received', detail: 'Structured claim data' },
  { id: 2, label: 'Rules evaluated', detail: 'Deterministic outcomes' },
  { id: 3, label: 'Evidence inspected', detail: 'Source paths preserved' },
  { id: 4, label: 'Reviewer decides', detail: 'Action recorded to audit' },
];

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="16" height="14" rx="2" stroke="var(--accent-ink)" strokeWidth="1.5" />
        <path d="M6 8h8M6 12h5" stroke="var(--accent-ink)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Deterministic Rules',
    desc: 'A rule engine that always returns the same result for the same input. No probabilistic decisions. The engine is authoritative.',
    tag: 'AUTHORITATIVE',
    tone: 'review' as const,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="var(--status-pass)" strokeWidth="1.5" />
        <path d="M10 6v4l3 2" stroke="var(--status-pass)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Grounded AI',
    desc: 'AI explanations are anchored to deterministic findings and extracted evidence. The AI never decides — it explains.',
    tag: 'EXPLAINABLE',
    tone: 'pass' as const,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="7" r="3" stroke="var(--status-uta)" strokeWidth="1.5" />
        <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="var(--status-uta)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Human Oversight',
    desc: 'Every claim passes through a structured human review step. Humans confirm, dismiss, or request additional information.',
    tag: 'HUMAN-IN-LOOP',
    tone: 'uta' as const,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2l2 6h6l-5 3.6 2 6-5-3.6-5 3.6 2-6L2 8h6l2-6z" stroke="var(--accent-ink)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Auditability',
    desc: 'Every system action and human decision is recorded in a cryptographically-chained audit log. Nothing is lost.',
    tag: 'TRACEABLE',
    tone: 'review' as const,
  },
];

/* Pills used to derive their tint by appending an alpha pair to a hex string
   (`${color}14`). That silently broke the moment the colours became tokens —
   `var(--status-uta)14` is not a colour — so the pills lost their fill and
   border entirely. Explicit tokens instead. */
const TONE = {
  pass: { ink: 'var(--status-pass-ink)', bg: 'var(--status-pass-bg)', border: 'var(--status-pass-border)', hue: 'var(--status-pass)' },
  uta: { ink: 'var(--status-uta-ink)', bg: 'var(--status-uta-bg)', border: 'var(--status-uta-border)', hue: 'var(--status-uta)' },
  fail: { ink: 'var(--status-fail-ink)', bg: 'var(--status-fail-bg)', border: 'var(--status-fail-border)', hue: 'var(--status-fail)' },
  review: { ink: 'var(--accent-subtle-ink)', bg: 'var(--accent-subtle)', border: 'var(--status-review-border)', hue: 'var(--status-review)' },
  na: { ink: 'var(--status-na-ink)', bg: 'var(--status-na-bg)', border: 'var(--status-na-border)', hue: 'var(--status-na)' },
} as const;

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
    color: 'var(--status-pass-ink)',
    dot: 'var(--status-pass)',
    desc: 'All evidence present. Rule requirements met.',
  },
  {
    status: 'FAIL',
    sentinelState: 'fail' as SentinelState,
    color: 'var(--status-fail-ink)',
    dot: 'var(--status-fail)',
    desc: 'Evidence confirms rule requirements are not met.',
  },
  {
    status: 'UNABLE TO ASSESS',
    sentinelState: 'uncertain' as SentinelState,
    color: 'var(--status-uta-ink)',
    dot: 'var(--status-uta)',
    desc: 'Required evidence is absent. Assessment withheld.',
  },
  {
    status: 'NOT APPLICABLE',
    sentinelState: 'idle' as SentinelState,
    color: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
    desc: 'Rule does not apply to this claim type.',
  },
];

const NAV_LINKS = [
  { id: 'top', label: 'Home' },
  { id: 'principles', label: 'Principles' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'rules', label: 'Rules' },
  { id: 'trust', label: 'Trust' },
];

/* Reviewer avatars. Solid fills rather than gradients: white initials on the
   bright end of a cyan gradient land around 1.3:1, which is unreadable. */
const AVATARS = [
  { initials: 'MA', fill: 'var(--accent)' },
  { initials: 'JP', fill: 'var(--status-review-ink)' },
  { initials: 'SC', fill: 'var(--status-pass-ink)' },
];

export default function Landing({ onEnterApp }: LandingProps) {
  const [activeNav, setActiveNav] = useState('top');
  const activeStep = 2;

  /* Categories map to a *tone*, not a raw colour: the pills need an ink for
     the label plus a bg and border, and the old `${color}14` trick cannot
     produce those from a token. */
  const categoryTone: Record<string, keyof typeof TONE> = {
    'Eligibility': 'review',
    'Provider': 'uta',
    'Temporal': 'na',
    'Coverage': 'pass',
    'Integrity': 'fail',
    'Clinical': 'review',
    'Authorization': 'uta',
    'Facility': 'na',
  };

  const scrollTo = (id: string) => {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div
      className="landing-shell sc-canvas"
      style={{ minHeight: '100vh', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}
    >
      {/* ── Ambient background: watermark + fluid ribbon ─────────────────── */}
      <div className="sc-bg" aria-hidden="true">
        <div className="sc-watermark">FUTURE MEDICINE</div>
        <svg className="sc-ribbon" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,80 Q30,40 50,70 T100,30 L100,100 L0,100 Z" fill="url(#cg-landing-ribbon)" />
          <defs>
            <linearGradient id="cg-landing-ribbon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00F2FE" />
              <stop offset="50%" stopColor="#4FACFE" />
              <stop offset="100%" stopColor="var(--status-pass)" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Viewport frame */}
      <div className="sc-frame" aria-hidden="true" />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav
        className="landing-nav"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: 68,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          background: 'var(--topbar-bg)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'var(--text-primary)',
              padding: 5,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 3,
              boxShadow: '0 4px 12px rgba(15,23,42,0.18)',
            }}
          >
            <span style={{ background: 'linear-gradient(135deg,#00f2fe,#4facfe)', borderRadius: 3 }} />
            <span style={{ background: '#4facfe', borderRadius: 3 }} />
            <span style={{ background: 'var(--status-pass)', borderRadius: 3 }} />
            <span style={{ background: 'var(--card-bg)', borderRadius: 3 }} />
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <span style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.03em', display: 'block' }}>
              ClaimGuard
            </span>
            <span
              style={{
                fontSize: '0.5625rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              AI Analytics
            </span>
          </div>
        </div>

        {/* Floating pill navigation */}
        <div className="sc-pill-nav landing-pill-nav">
          {NAV_LINKS.map(link => (
            <button
              key={link.id}
              className={`sc-pill-link${activeNav === link.id ? ' active' : ''}`}
              onClick={() => scrollTo(link.id)}
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="landing-nav-signin"
            onClick={onEnterApp}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '8px 16px',
              color: 'var(--text-secondary)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            Sign in
          </button>
          <button className="sc-cta" onClick={onEnterApp}>
            <span className="sc-cta-orb">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 12L12 4M12 4H6M12 4v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>Open Workspace</span>
            <span className="sc-cta-chevrons">&gt;&gt;&gt;</span>
          </button>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section id="top" style={{ maxWidth: 1200, margin: '0 auto' }} className="landing-hero">
        <div style={{ display: 'grid', alignItems: 'start' }} className="landing-hero-grid">
          {/* Left: headline + copy + CTAs */}
          <div style={{ animation: 'fade-in-up 0.6s ease-out both' }}>
            <span className="sc-eyebrow" style={{ marginBottom: 26 }}>
              <span className="sc-dot" />
              Claims operations · Evidence-led review
              <span className="sc-dot" />
            </span>

            <h1
              className="sc-title-caps"
              style={{
                fontSize: 'clamp(2.1rem, 4.4vw, 3.4rem)',
                lineHeight: 1.08,
                marginBottom: 24,
                textShadow: '0 0 44px rgba(0,242,254,0.22)',
              }}
            >
              Make every{' '}
              <span className="sc-inline-pill" aria-hidden="true">
                <span className="sc-avatar-stack">
                  {AVATARS.map(a => (
                    <span key={a.initials} className="sc-avatar-fallback" style={{ background: a.fill }}>
                      {a.initials}
                    </span>
                  ))}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #00f2fe, #4facfe)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                    <path d="M10 2l6 2.2v5.3c0 3.6-2.5 6.6-6 7.5-3.5-.9-6-3.9-6-7.5V4.2L10 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="M7.2 10l1.9 1.9L13 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
              claim finding inspectable.
            </h1>

            <div
              style={{
                display: 'flex',
                gap: 26,
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 30,
              }}
            >
              <p
                style={{
                  fontSize: '1.0625rem',
                  lineHeight: 1.7,
                  color: 'var(--text-secondary)',
                  maxWidth: 440,
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                Rules determine the outcome. Source evidence shows why. AI helps explain the finding,
                while the reviewer keeps the decision.
              </p>

              {/* Rotating circular badge */}
              <div
                className="sc-spin-badge"
                style={{ width: 116, height: 116, flexShrink: 0 }}
                onClick={onEnterApp}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onEnterApp()}
                aria-label="Open workspace"
              >
                <svg className="sc-spin-ring" viewBox="0 0 100 100">
                  <defs>
                    <path id="cg-spin-path" d="M 50,50 m -37,0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0" />
                  </defs>
                  <text
                    style={{
                      fontSize: '8.5px',
                      fontWeight: 700,
                      letterSpacing: '2.6px',
                      fill: 'var(--text-secondary)',
                    }}
                  >
                    <textPath href="#cg-spin-path">
                      DETERMINISTIC • EXPLAINABLE • AUDITABLE •
                    </textPath>
                  </text>
                </svg>
                <span
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'var(--text-primary)',
                    color: 'var(--card-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.3s ease',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 12h6M4 12V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>

            {/* Sub-CTA tag */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
                padding: '9px 16px 9px 10px',
                borderRadius: 999,
                marginBottom: 28,
                maxWidth: '100%',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: 'var(--card-bg)',
                  flexShrink: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 7.2v3.4M8 5.2v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent)' }}>
                15 deterministic rules active · every outcome linked to evidence
              </span>
            </div>

            {/* CTAs */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="sc-cta" onClick={onEnterApp}>
                <span className="sc-cta-orb">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>Open Review Workspace</span>
                <span className="sc-cta-chevrons">&gt;&gt;&gt;</span>
              </button>
              <button
                onClick={() => scrollTo('review-example')}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '13px 24px',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  backdropFilter: 'blur(12px)',
                }}
              >
                Explore how it works
              </button>
            </div>

            {/* Trust indicators */}
            <div
              style={{
                display: 'flex',
                gap: 26,
                marginTop: 34,
                paddingTop: 22,
                borderTop: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}
            >
              {[
                { label: 'Deterministic', icon: '◆', desc: 'Rule engine' },
                { label: 'Grounded', icon: '◎', desc: 'AI explanations' },
                { label: 'Auditable', icon: '▣', desc: 'Every decision' },
              ].map(t => (
                <div key={t.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--accent)', fontSize: '0.625rem' }}>{t.icon}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                      {t.label}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.desc}</span>
                </div>
              ))}
            </div>

            {/* KPI glass cards */}
            <div className="landing-kpi-grid" style={{ marginTop: 30 }}>
              <div className="sc-glass-card sc-float-slow" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                      <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M6.5 7h7M6.5 10.5h7M6.5 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                      15 Validation Rules
                    </div>
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                      Eligibility, coding, authorization and integrity checks — one authoritative engine.
                    </p>
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="sc-badge" style={{ fontSize: '0.5625rem', padding: '3px 9px' }}>
                        v2.4.1 ACTIVE
                      </span>
                      <span
                        className="sc-badge"
                        style={{
                          fontSize: '0.625rem',
                          padding: '3px 9px',
                          color: 'var(--status-pass-ink)',
                          background: 'var(--status-pass-bg)',
                          borderColor: 'var(--status-pass-border)',
                        }}
                      >
                        DETERMINISTIC
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="sc-glass-card sc-float-fast" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: 'var(--status-fail-bg)',
                      color: 'var(--status-fail)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M10 6.4v4.2M10 13.2v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                      4 Outcome States
                    </div>
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                      Pass, fail, unable to assess, not applicable — no forced binary answers.
                    </p>
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span
                        className="sc-badge"
                        style={{ fontSize: '0.625rem', padding: '3px 9px', color: 'var(--status-fail-ink)', background: 'var(--status-fail-bg)', borderColor: 'var(--status-fail-border)' }}
                      >
                        EVIDENCE-LINKED
                      </span>
                      <span
                        className="sc-badge"
                        style={{ fontSize: '0.5625rem', padding: '3px 9px', color: 'var(--status-uta-ink)', background: 'var(--status-uta-bg)', borderColor: 'var(--status-uta-border)' }}
                      >
                        NEVER HALLUCINATES
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: claim review preview + stacked navigation */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Claim flow visualization */}
            <div
              id="review-example"
              className="sc-glass-card"
              style={{ padding: 24, width: '100%' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Sentinel state="review" size={40} />
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                      Claim under review
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      CLM-10482
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                      Meridian Health Group · Sep 15, 2026
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--status-review-ink)',
                    background: 'var(--status-review-bg)',
                    border: '1px solid var(--status-review-border)',
                    borderRadius: 999,
                    padding: '4px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Needs review
                </span>
              </div>
              <div style={{ padding: '18px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    R008 · Authorization reference
                  </div>
                  <span
                    style={{
                      color: 'var(--status-fail-ink)',
                      background: 'var(--status-fail-bg)',
                      border: '1px solid var(--status-fail-border)',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.625rem',
                      fontWeight: 700,
                    }}
                  >
                    FAIL
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px' }}>
                  Required authorization reference is missing from the claim line.
                </p>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    background: 'color-mix(in srgb, var(--canvas-bg) 70%, var(--card-bg))',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    color: 'var(--accent)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  /lines/0/authorization_reference <span style={{ color: 'var(--text-tertiary)' }}>=</span>{' '}
                  <span style={{ color: 'var(--status-fail-ink)' }}>null</span>
                </div>
              </div>
              <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: 1.4 }}>
                  Evidence-linked rule result · reviewer decision pending
                </span>
                <button
                  onClick={onEnterApp}
                  style={{
                    flexShrink: 0,
                    background: 'var(--text-primary)',
                    color: 'var(--card-bg)',
                    border: 0,
                    borderRadius: 999,
                    padding: '9px 16px',
                    font: '700 0.75rem var(--font-sans)',
                    cursor: 'pointer',
                  }}
                >
                  Review claim
                </button>
              </div>
            </div>

            {/* Stacked navigation */}
            <div className="sc-glass-card" style={{ padding: 8 }}>
              {[
                { label: 'Review Queue', num: '01', dots: '• • •', active: false },
                { label: 'Validation Rules', num: '02', dots: '● ● •', active: true },
                { label: 'Audit Trail', num: '03', dots: '• • •', active: false },
              ].map(row => (
                <button
                  key={row.num}
                  onClick={onEnterApp}
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '13px 14px',
                    borderRadius: 14,
                    border: '1px solid transparent',
                    background: row.active ? 'color-mix(in srgb, var(--accent) 8%, var(--card-bg))' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: row.active ? 800 : 600,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {row.label}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 500, marginLeft: 6 }}>
                      / {row.num}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.16em',
                        color: row.active ? 'var(--accent)' : 'var(--text-tertiary)',
                      }}
                    >
                      {row.dots}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: row.active ? 'var(--text-primary)' : 'var(--card-bg)',
                        border: row.active ? '1px solid var(--text-primary)' : '1px solid var(--border)',
                        color: row.active ? 'var(--card-bg)' : 'var(--text-primary)',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features section ─────────────────────────────────────────────── */}
      <section id="principles" style={{ padding: '80px 48px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 12 }}>
            Core principles
          </p>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 16 }}>
            Built around trust,
            <br />
            not black-box decisions.
          </h2>
          <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
            Every finding is deterministic. Every explanation is grounded. Every decision is recorded.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 16 }} className="landing-feature-grid">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="sc-glass-card"
              style={{ padding: 24, transition: 'transform 0.2s ease, box-shadow 0.2s ease', cursor: 'default', animationDelay: `${i * 80}ms` }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 16px 36px rgba(15,23,42,0.10)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '';
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 13,
                  background: TONE[f.tone].bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                {f.icon}
              </div>
              <div
                style={{
                  display: 'inline-block',
                  fontSize: '0.625rem',
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: TONE[f.tone].ink,
                  background: TONE[f.tone].bg,
                  border: `1px solid ${TONE[f.tone].border}`,
                  borderRadius: 999,
                  padding: '3px 10px',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {f.tag}
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', marginBottom: 8 }}>
                {f.title}
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Workflow section ─────────────────────────────────────────────── */}
      <section id="workflow" style={{ padding: '80px 48px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 12 }}>
              Workflow
            </p>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              From claim to decision
            </h2>
          </div>

          <div style={{ display: 'grid', gap: 0, position: 'relative' }} className="landing-workflow-grid">
            {/* Connecting line */}
            <div
              style={{
                position: 'absolute',
                top: 28,
                bottom: 28,
                left: 27,
                width: 1,
                background:
                  'linear-gradient(180deg, transparent, color-mix(in srgb, var(--accent) 40%, transparent) 12%, color-mix(in srgb, var(--accent) 40%, transparent) 88%, transparent)',
              }}
            />

            {WORKFLOW_STEPS.map((step, i) => (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  position: 'relative',
                  zIndex: 1,
                  padding: '11px 0',
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background:
                      i <= activeStep
                        ? 'color-mix(in srgb, var(--accent) 12%, var(--card-bg))'
                        : 'var(--card-bg)',
                    border: `1.5px solid ${i <= activeStep ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 6px 16px rgba(15,23,42,0.06)',
                    transition: 'all 0.3s ease',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 800,
                      color: i <= activeStep ? 'var(--accent)' : 'var(--text-tertiary)',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {String(step.id).padStart(2, '0')}
                  </span>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '0.9375rem',
                      fontWeight: 700,
                      color: i <= activeStep ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      letterSpacing: '-0.01em',
                      marginBottom: 2,
                      transition: 'color 0.3s ease',
                    }}
                  >
                    {step.label}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Rules grid ───────────────────────────────────────────────────── */}
      <section id="rules" style={{ padding: '80px 48px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40, gap: 16, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 12 }}>
                Validation engine
              </p>
              <h2 style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                15 validation rules
              </h2>
            </div>
            <span
              className="sc-badge"
              style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
            >
              <span className="sc-dot" style={{ background: 'var(--accent)' }} />
              v2.4.1 · ACTIVE
            </span>
          </div>

          <div style={{ display: 'grid', gap: 10 }} className="landing-rule-grid">
            {RULE_EXAMPLES.slice(0, 5).map(rule => {
              const tone = TONE[categoryTone[rule.category] ?? 'na'];
              return (
                <div
                  key={rule.id}
                  className="sc-glass-card"
                  style={{
                    padding: '14px 16px',
                    cursor: 'default',
                    transition: 'all 0.15s ease',
                    borderRadius: 16,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = tone.border;
                    e.currentTarget.style.transform = 'translateX(4px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 10 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        color: 'var(--accent)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {rule.id}
                    </span>
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 700,
                        color: tone.ink,
                        background: tone.bg,
                        border: `1px solid ${tone.border}`,
                        borderRadius: 999,
                        padding: '3px 8px',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {rule.category}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {rule.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Uncertainty section ──────────────────────────────────────────── */}
      <section id="trust" style={{ padding: '80px 48px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'grid', gap: 48, alignItems: 'center' }} className="landing-uncertainty-grid">
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 12 }}>
                Epistemic integrity
              </p>
              <h2 style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 20 }}>
                Designed for uncertainty
              </h2>
              <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
                Missing evidence must not become fabricated certainty. ClaimGuard AI distinguishes between
                what it knows, what it can't determine, and what doesn't apply.
              </p>
              <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                When evidence is absent, the system returns{' '}
                <strong style={{ color: 'var(--status-uta-ink)', fontFamily: 'var(--font-sans)', fontSize: '0.875rem' }}>
                  UNABLE TO ASSESS
                </strong>{' '}
                rather than forcing a binary outcome. The AI will never invent information to fill a gap.
              </p>
            </div>

            <div style={{ display: 'grid', gap: 12 }} className="landing-state-grid">
              {UNCERTAINTY_STATES.map(s => (
                <div
                  key={s.status}
                  className="sc-glass-card"
                  style={{
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    alignItems: 'center',
                    textAlign: 'center',
                    transition: 'all 0.2s ease',
                    border: `1px solid color-mix(in srgb, ${s.dot} 26%, transparent)`,
                  }}
                >
                  <Sentinel state={s.sentinelState} size={52} />
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: '0.6875rem',
                        fontWeight: 800,
                        color: s.color,
                        letterSpacing: '0.06em',
                        marginBottom: 6,
                        textTransform: 'uppercase',
                      }}
                    >
                      {s.status}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Human-in-the-loop section ────────────────────────────────────── */}
      <section id="oversight" style={{ padding: '80px 48px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--status-uta-ink)', textTransform: 'uppercase', marginBottom: 12 }}>
            Human oversight
          </p>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 16 }}>
            Human-in-the-loop by design
          </h2>
          <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', maxWidth: 560, margin: '0 auto 48px', lineHeight: 1.7 }}>
            Every claim requiring a decision goes through structured human review. Reviewers see exactly
            what the system found, the evidence it found, and what the AI explained.
          </p>

          {/* Mini workspace preview */}
          <div className="sc-glass-card" style={{ padding: 24, maxWidth: 800, margin: '0 auto', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--accent)', fontWeight: 700 }}>
                  CLM-10482
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  Meridian Health Group · Dr. Sarah Chen
                </div>
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  background: 'var(--status-review-bg)',
                  border: '1px solid var(--status-review-border)',
                  borderRadius: 999,
                  padding: '5px 13px',
                }}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-review)' }} />
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--status-review-ink)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Needs Review
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12 }} className="landing-preview-grid">
              {[
                { rule: 'R001', name: 'Member eligibility', status: 'PASS', color: 'var(--status-pass-ink)', dot: 'var(--status-pass)' },
                { rule: 'R008', name: 'Authorization reference', status: 'FAIL', color: 'var(--status-fail-ink)', dot: 'var(--status-fail)' },
                { rule: 'R009', name: 'Authorization validity', status: 'UNABLE TO ASSESS', color: 'var(--status-uta-ink)', dot: 'var(--status-uta)' },
                { rule: 'R015', name: 'Coordination of benefits', status: 'NOT APPLICABLE', color: 'var(--text-secondary)', dot: 'var(--text-tertiary)' },
              ].map(r => (
                <div
                  key={r.rule}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'color-mix(in srgb, var(--canvas-bg) 60%, var(--card-bg))',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${r.dot}`,
                    borderRadius: 12,
                    padding: '11px 14px',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent)', fontWeight: 700, minWidth: 36 }}>
                    {r.rule}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', flex: 1 }}>{r.name}</span>
                  <span
                    style={{
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      color: r.color,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {['Confirm issue', 'Request info', 'Dismiss', 'Add note'].map((action, i) => (
                <button
                  key={action}
                  onClick={onEnterApp}
                  style={{
                    background: i === 0 ? 'var(--text-primary)' : 'var(--card-bg)',
                    border: `1px solid ${i === 0 ? 'var(--text-primary)' : 'var(--border)'}`,
                    borderRadius: 999,
                    padding: '8px 16px',
                    fontSize: '0.8125rem',
                    color: i === 0 ? 'var(--card-bg)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 600,
                  }}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '32px 48px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Sentinel state="idle" size={22} />
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>ClaimGuard AI</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['X', 'in', 'gh'].map(social => (
              <button key={social} className="sc-ghost-btn" style={{ width: 34, height: 34, fontSize: '0.6875rem', fontWeight: 800 }} aria-label={social}>
                {social}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => scrollTo('principles')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'transform 0.3s ease',
          }}
        >
          <span style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Discover more
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              animation: 'sc-bounce-down 1.6s ease-in-out infinite',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {['Privacy', 'Terms', 'Security', 'Status'].map(link => (
            <span key={link} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {link}
            </span>
          ))}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
            ClaimGuard AI • v1.0.2
          </span>
        </div>
      </footer>
    </div>
  );
}
