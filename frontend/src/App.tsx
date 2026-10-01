import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sentinel from './components/Sentinel';
import SearchModal from './components/SearchModal';
import { useTheme, type ThemeMode } from './hooks/useTheme';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Claims from './pages/Claims';
import ReviewQueue from './pages/ReviewQueue';
import ClaimReview from './pages/ClaimReview';
import Runs from './pages/Runs';
import AuditTrail from './pages/AuditTrail';
import Rules from './pages/Rules';
import Ingest from './pages/Ingest';
import Analytics from './pages/Analytics';
import { getIngestedClaims } from './api/claims';

type Page =
  | 'landing'
  | 'dashboard'
  | 'claims'
  | 'claim-review'
  | 'review-queue'
  | 'runs'
  | 'audit'
  | 'ingest'
  | 'rules'
  | 'analytics'
  | 'profile';

interface NavItem {
  key: Page;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}
interface NavSection {
  label?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'WORKSPACE',
    items: [
      {
        key: 'dashboard',
        label: 'Overview',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ),
      },
      {
        key: 'claims',
        label: 'Claims',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        key: 'review-queue',
        label: 'Review Queue',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'WORKFLOW',
    items: [
      {
        key: 'runs',
        label: 'Runs',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 5.5l5 2.5-5 2.5V5.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        key: 'audit',
        label: 'Audit Trail',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1l7 3v4.5C15 12.5 12 15 8 16 4 15 1 12.5 1 8.5V4L8 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        key: 'ingest',
        label: 'Ingest Data',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v9M5 8l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'CONFIGURE',
    items: [
      {
        key: 'rules',
        label: 'Policy & Rules',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4.5h12M2 8h8M2 11.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="13" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
      {
        key: 'analytics',
        label: 'Analytics',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 13l3-4 3 2 3-5 3 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
];

const BREADCRUMB_LABELS: Partial<Record<Page, string>> = {
  dashboard: 'Overview',
  claims: 'Claims',
  'claim-review': 'Claim Review',
  'review-queue': 'Review Queue',
  runs: 'Runs',
  audit: 'Audit Trail',
  ingest: 'Ingest Data',
  rules: 'Policy & Rules',
  analytics: 'Analytics',
  profile: 'Profile & Preferences',
};

// ── Notifications ──────────────────────────────────────────────────────────
const NOTIFICATIONS = [
  {
    id: 1,
    title: 'New high-priority claim assigned to you',
    body: 'CLM-10480 — Valley Behavioral Sciences',
    time: '2 min ago',
    read: false,
    icon: 'alert',
  },
  {
    id: 2,
    title: 'Claim requires review',
    body: 'CLM-10479 — Summit Psychiatry Clinic flagged by RUN-4821',
    time: '8 min ago',
    read: false,
    icon: 'review',
  },
  {
    id: 3,
    title: 'Re-check completed',
    body: 'CLM-10475 — records corrected, ready for re-check',
    time: '14 min ago',
    read: false,
    icon: 'recheck',
  },
  {
    id: 4,
    title: 'Ingestion completed — 10 claims processed',
    body: 'Run RUN-4821 created · 8 passed · 2 need review',
    time: '21 min ago',
    read: true,
    icon: 'ingest',
  },
  {
    id: 5,
    title: 'Validation run completed',
    body: 'RUN-4820 — 47 claims processed, pass rate 74.5%',
    time: '1h ago',
    read: true,
    icon: 'run',
  },
];

function NotifIcon({ type }: { type: string }) {
  const MAP: Record<string, [React.ReactNode, string]> = {
    alert: [
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2a4 4 0 00-4 4v3L1.5 11h11L11 9V6a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.2" /><path d="M5.5 11.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.2" /></svg>,
      'var(--status-fail)',
    ],
    review: [
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.2" /><path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
      'var(--status-review)',
    ],
    recheck: [
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 1010 0H10M9 4.5L12 7l-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
      'var(--accent)',
    ],
    ingest: [
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4.5 6.5L7 9l2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 11h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
      'var(--status-pass)',
    ],
    run: [
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" /><path d="M5.5 4.5l4 2.5-4 2.5V4.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" /></svg>,
      'var(--status-uta)',
    ],
  };
  const [icon, color] = MAP[type] ?? MAP.run;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: `color-mix(in srgb, ${color} 9%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 16%, transparent)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({
  currentPage,
  onNavigate,
  theme,
  onSetTheme,
  onSignOut,
}: {
  currentPage: Page;
  onNavigate: (p: Page) => void;
  theme: ThemeMode;
  onSetTheme: (m: ThemeMode) => void;
  onSignOut: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    getIngestedClaims(undefined, controller.signal).then((response) => {
      const count = Object.values(response.evaluations).filter((results) =>
        results.some((result) => result.status === 'FAIL' || result.status === 'UNABLE_TO_ASSESS' || result.requires_human_review),
      ).length;
      setReviewCount(count);
    }).catch(() => setReviewCount(0));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
        setShowAppearance(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <aside
      style={{
        width: 224,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '18px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
        }}
        onClick={() => onNavigate('dashboard')}
      >
        <Sentinel state="idle" size={28} />
        <div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            ClaimGuard
          </div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--sidebar-accent)', letterSpacing: '0.02em' }}>
            AI
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflow: 'auto' }} className="sidebar-scroll">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} style={{ marginBottom: 18 }}>
            {section.label && (
              <div
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  color: 'rgba(148,163,184,0.45)',
                  textTransform: 'uppercase',
                  padding: '0 6px',
                  marginBottom: 4,
                  marginTop: si > 0 ? 2 : 0,
                }}
              >
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const isActive = currentPage === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="nav-icon" style={{ opacity: isActive ? 1 : 0.6, display: 'flex' }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </div>
                  {item.key === 'review-queue' && reviewCount > 0 && (
                    <span
                      style={{
                        background: 'rgba(244,63,94,0.15)',
                        color: '#c25554',
                        border: '1px solid rgba(244,63,94,0.25)',
                        borderRadius: 10,
                        padding: '1px 7px',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      {reviewCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Profile */}
      <div
        ref={profileRef}
        style={{ padding: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}
      >
        {/* Profile popover */}
        {profileOpen && (
          <div
            className="popover-panel"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 10,
              right: 10,
              background: 'var(--sidebar-bg)',
              border: '1px solid var(--sidebar-border)',
              borderRadius: 6,
              overflow: 'hidden',
              boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
              zIndex: 1000,
            }}
          >
            {showAppearance ? (
              <div style={{ padding: 12 }}>
                <button
                  onClick={() => setShowAppearance(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#94a3b8',
                    fontSize: '0.8125rem',
                    fontFamily: 'inherit',
                    padding: '0 0 8px',
                    width: '100%',
                  }}
                >
                  ← Appearance
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => { onSetTheme(m); }}
                      style={{
                        background: theme === m ? 'var(--sidebar-active-bg)' : 'transparent',
                        border: theme === m ? '1px solid color-mix(in srgb, var(--sidebar-accent) 32%, transparent)' : '1px solid transparent',
                        borderRadius: 4,
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: theme === m ? 'var(--sidebar-accent)' : 'var(--sidebar-text)',
                        width: '100%',
                      }}
                    >
                      <span style={{ textTransform: 'capitalize' }}>{m}</span>
                      {theme === m && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7l3.5 3.5 6.5-7" stroke="var(--sidebar-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--sidebar-text-active)' }}>Aya Gaha</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sidebar-text)', marginTop: 2 }}>aya.gaha@healthcorp.org</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sidebar-text)', marginTop: 1 }}>Senior Reviewer · HealthCorp</div>
                </div>
                {[
                  { label: 'Profile', action: () => { onNavigate('profile'); setProfileOpen(false); } },
                  { label: 'Preferences', action: () => { onNavigate('profile'); setProfileOpen(false); } },
                  { label: 'Appearance', action: () => setShowAppearance(true) },
                  { label: 'Keyboard shortcuts', action: () => {} },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    style={{
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.875rem',
                      color: 'var(--sidebar-text)',
                      padding: '9px 14px',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'background 0.1s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    {item.label}
                    {item.label === 'Appearance' && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    onClick={onSignOut}
                    style={{
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.875rem',
                      color: 'var(--sidebar-danger)',
                      padding: '9px 14px',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--sidebar-danger) 12%, transparent)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div
          onClick={() => { setProfileOpen(!profileOpen); setShowAppearance(false); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 6px',
            borderRadius: 8,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            background: profileOpen ? 'var(--sidebar-hover)' : 'transparent',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = profileOpen ? 'var(--sidebar-hover)' : 'transparent')}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            AG
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--sidebar-text-active)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Aya Gaha
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--sidebar-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Senior Reviewer
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--sidebar-text)', flexShrink: 0, transform: profileOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
            <path d="M3 5.5l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </aside>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────
function TopBar({
  page,
  claimId,
  onNavigate,
  onSearchOpen,
}: {
  page: Page;
  claimId?: string;
  onNavigate: (p: Page) => void;
  onSearchOpen: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<'all' | 'unread'>('all');
  const [readIds, setReadIds] = useState<number[]>([]);
  const [helpExpanded, setHelpExpanded] = useState<string | null>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = NOTIFICATIONS.filter((n) => !n.read && !readIds.includes(n.id)).length;
  const crumbs: Array<{ label: string; page: Page }> = (() => {
    if (page === 'claim-review') return [{ label: 'Claims', page: 'claims' }, { label: claimId || 'Review', page: 'claim-review' }];
    const label = BREADCRUMB_LABELS[page];
    return label ? [{ label, page }] : [{ label: 'Overview', page: 'dashboard' }];
  })();

  const HOW_IT_WORKS = [
    { num: '01', title: 'Claim ingestion', desc: 'CSV, JSON, or FHIR files are uploaded and normalized into structured records.' },
    { num: '02', title: 'Deterministic validation', desc: 'Each claim is evaluated against 15 configurable rules with binary pass/fail/UTA outcomes.' },
    { num: '03', title: 'Evidence inspection', desc: 'Rule findings link to exact evidence paths in the claim payload.' },
    { num: '04', title: 'AI-assisted explanation', desc: 'The AI model provides an explanation for each finding, grounded in retrieved evidence.' },
    { num: '05', title: 'Human review', desc: 'Reviewers confirm, override, or request information via the Review Queue.' },
    { num: '06', title: 'Re-check', desc: 'Corrected claims are re-validated in a new run, preserving the prior findings.' },
    { num: '07', title: 'Audit trail', desc: 'Every action is recorded with actor identity, timestamp, and hash-chain integrity.' },
  ];

  return (
    <header
      style={{
        background: 'var(--topbar-bg)',
        borderBottom: '1px solid var(--topbar-border)',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 16,
        flexShrink: 0,
        zIndex: 20,
        position: 'relative',
      }}
    >
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        {crumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i < crumbs.length - 1 ? (
              <>
                <button onClick={() => onNavigate(crumb.page)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', padding: 0, fontWeight: 500 }}>
                  {crumb.label}
                </button>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2l4 4-4 4" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            ) : (
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{crumb.label}</span>
            )}
          </span>
        ))}
      </div>

      {/* Search bar */}
      <button
        onClick={onSearchOpen}
        style={{
          width: 260,
          background: 'var(--canvas-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 7,
          padding: '6px 12px 6px 10px',
          fontSize: '0.8125rem',
          color: 'var(--text-tertiary)',
          fontFamily: 'inherit',
          cursor: 'text',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          transition: 'border-color 0.15s ease',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--card-border)')}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, textAlign: 'left' }}>Quick search...</span>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.625rem', color: 'var(--text-tertiary)', fontWeight: 600, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 4, padding: '1px 5px' }}>
          ⌘K
        </span>
      </button>

      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => { setNotifOpen(!notifOpen); setHelpOpen(false); }}
            style={{
              background: notifOpen ? 'var(--canvas-bg)' : 'transparent',
              border: notifOpen ? '1px solid var(--card-border)' : '1px solid transparent',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              position: 'relative',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { if (!notifOpen) e.currentTarget.style.background = 'var(--canvas-bg)'; }}
            onMouseLeave={(e) => { if (!notifOpen) e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2a5 5 0 00-5 5v3L2.5 12.5h13L14 10V7a5 5 0 00-5-5z" stroke="currentColor" strokeWidth="1.3" />
              <path d="M7 14a2 2 0 004 0" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            {unreadCount > 0 && (
              <div style={{ position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: '50%', background: '#b4403f', border: '1.5px solid var(--topbar-bg)' }} />
            )}
          </button>

          {notifOpen && (
            <div
              className="popover-panel"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 340,
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: 12,
                boxShadow: 'var(--card-shadow-md)',
                zIndex: 1000,
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
                <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</div>
                <button
                  onClick={() => setReadIds(NOTIFICATIONS.map((n) => n.id))}
                  style={{ background: 'none', border: 'none', fontSize: '0.8125rem', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
                >
                  Mark all as read
                </button>
              </div>
              <div style={{ display: 'flex', gap: 2, padding: '0 16px 10px' }}>
                {(['all', 'unread'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setNotifTab(t)}
                    style={{
                      background: notifTab === t ? 'var(--canvas-bg)' : 'transparent',
                      border: notifTab === t ? '1px solid var(--card-border)' : '1px solid transparent',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: '0.8125rem',
                      fontWeight: notifTab === t ? 600 : 400,
                      color: notifTab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textTransform: 'capitalize',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {NOTIFICATIONS
                  .filter((n) => notifTab === 'all' ? true : (!n.read && !readIds.includes(n.id)))
                  .map((n) => {
                    const isRead = n.read || readIds.includes(n.id);
                    return (
                      <div
                        key={n.id}
                        style={{
                          display: 'flex',
                          gap: 12,
                          padding: '10px 16px',
                          background: isRead ? 'transparent' : 'rgba(15,122,130,0.03)',
                          borderBottom: '1px solid var(--card-border)',
                          cursor: 'pointer',
                          transition: 'background 0.1s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--canvas-bg)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = isRead ? 'transparent' : 'rgba(15,122,130,0.03)')}
                        onClick={() => setReadIds((prev) => [...prev, n.id])}
                      >
                        <NotifIcon type={n.icon} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontSize: '0.8125rem', fontWeight: isRead ? 500 : 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                              {n.title}
                            </div>
                            {!isRead && (
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 4 }} />
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                            {n.body}
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{n.time}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Help */}
        <div ref={helpRef} style={{ position: 'relative' }}>
          <button
            onClick={() => { setHelpOpen(!helpOpen); setNotifOpen(false); }}
            style={{
              background: helpOpen ? 'var(--canvas-bg)' : 'transparent',
              border: helpOpen ? '1px solid var(--card-border)' : '1px solid transparent',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { if (!helpOpen) e.currentTarget.style.background = 'var(--canvas-bg)'; }}
            onMouseLeave={(e) => { if (!helpOpen) e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.3" />
              <path d="M7 7.5a2 2 0 014 0c0 1.5-2 2-2 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="9" cy="13" r=".75" fill="currentColor" />
            </svg>
          </button>

          {helpOpen && (
            <div
              className="popover-panel"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 300,
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: 12,
                boxShadow: 'var(--card-shadow-md)',
                zIndex: 1000,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '14px 16px 10px' }}>
                <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Help</div>
                {[
                  { label: 'Help & Documentation', action: null },
                  { label: 'Keyboard shortcuts', action: null },
                  { label: 'Contact / Support', action: null },
                ].map((item) => (
                  <button
                    key={item.label}
                    style={{
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.875rem',
                      color: 'var(--text-primary)',
                      padding: '8px 10px',
                      textAlign: 'left',
                      borderRadius: 7,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      transition: 'background 0.1s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--canvas-bg)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--card-border)', padding: '10px 16px 14px' }}>
                <button
                  onClick={() => setHelpExpanded(helpExpanded === 'how' ? null : 'how')}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    padding: '0 0 8px',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  How ClaimGuard works
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: helpExpanded === 'how' ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {helpExpanded === 'how' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {HOW_IT_WORKS.map((step) => (
                      <div key={step.num} style={{ display: 'flex', gap: 10 }}>
                        <div style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', fontWeight: 700, color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}>
                          {step.num}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{step.title}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--card-border)' }} />

        {/* Profile chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 7, cursor: 'pointer' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>
            AG
          </div>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Aya Gaha</span>
        </div>
      </div>
    </header>
  );
}

// ── Profile page ───────────────────────────────────────────────────────────
function ProfilePage({ theme, onSetTheme }: { theme: ThemeMode; onSetTheme: (m: ThemeMode) => void }) {
  return (
    <div style={{ padding: '28px 32px', maxWidth: 720 }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.025em', marginBottom: 4 }}>
        Profile & Preferences
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 28 }}>
        Manage your account information and application preferences.
      </p>

      {/* Profile section */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20, boxShadow: 'var(--card-shadow)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--card-border)', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
          Account Information
        </div>
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 24 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
              AG
            </div>
            <div>
              <div style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Aya Gaha</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 2 }}>aya.gaha@healthcorp.org</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Full name', value: 'Aya Gaha' },
              { label: 'Role', value: 'Senior Reviewer' },
              { label: 'Email', value: 'aya.gaha@healthcorp.org' },
              { label: 'Organization', value: 'HealthCorp' },
              { label: 'Department', value: 'Claims Review' },
              { label: 'Member since', value: 'January 2025' },
            ].map((field) => (
              <div key={field.label}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                  {field.label}
                </div>
                <div style={{ fontSize: '0.9375rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {field.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--card-border)', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
          Appearance
        </div>
        <div style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
            Choose your preferred color scheme for the application interface.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onSetTheme(m)}
                style={{
                  flex: 1,
                  background: theme === m ? 'var(--accent-subtle)' : 'var(--canvas-bg)',
                  border: theme === m ? '2px solid var(--accent)' : '2px solid var(--card-border)',
                  borderRadius: 6,
                  padding: '14px 12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', width: 28, height: 18, margin: '0 auto 8px', overflow: 'hidden', borderRadius: 3, border: '1px solid var(--card-border)' }}>
                  {(m === 'dark' ? ['#0f1f2e'] : m === 'light' ? ['#f4f7f9'] : ['#f4f7f9', '#0f1f2e']).map((color) => (
                    <span key={color} style={{ flex: 1, background: color }} />
                  ))}
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: theme === m ? 'var(--accent)' : 'var(--text-primary)', textTransform: 'capitalize' }}>
                  {m}
                </div>
                {theme === m && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: 2, fontWeight: 500 }}>Active</div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PAGE_PATHS: Partial<Record<Page, string>> = {
  dashboard: '/app/dashboard',
  claims: '/app/claims',
  'review-queue': '/app/review-queue',
  runs: '/app/runs',
  audit: '/app/audit',
  ingest: '/app/ingest',
  rules: '/app/rules',
  analytics: '/app/analytics',
  profile: '/app/profile',
};

function pagePath(page: string, claimId?: string): string {
  if (page === 'claim-review') {
    return claimId ? `/app/claims/${encodeURIComponent(claimId)}` : '/app/claims';
  }
  if (page === 'landing') return '/';
  return PAGE_PATHS[page as Page] || '/app/dashboard';
}

function pageFromPath(pathname: string): Page {
  if (/^\/app\/claims\/[^/]+/.test(pathname)) return 'claim-review';
  const pathPage = pathname.split('/')[2] as Page | undefined;
  return pathPage && PAGE_PATHS[pathPage] ? pathPage : 'dashboard';
}

function ClaimReviewRoute({ onNavigate }: { onNavigate: (page: string, claimId?: string) => void }) {
  const { claimId } = useParams();
  if (!claimId || claimId.startsWith('CLM-')) {
    return <Claims onNavigate={onNavigate} />;
  }
  return <ClaimReview claimId={claimId} onNavigate={(page) => onNavigate(page)} />;
}

function WorkspaceLayout({
  currentPage,
  onNavigate,
  onSignOut,
  theme,
  onSetTheme,
}: {
  currentPage: Page;
  onNavigate: (page: string, claimId?: string) => void;
  onSignOut: () => void;
  theme: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const claimId = location.pathname.match(/^\/app\/claims\/([^/]+)/)?.[1];

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={onNavigate} />
      <div
        className={currentPage === 'claim-review' ? 'workspace-shell claim-review-workspace' : 'workspace-shell'}
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          fontFamily: 'var(--font-sans)',
          background: 'var(--canvas-bg)',
        }}
      >
        <Sidebar
          currentPage={currentPage}
          onNavigate={(page) => onNavigate(page)}
          theme={theme}
          onSetTheme={onSetTheme}
          onSignOut={onSignOut}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {currentPage !== 'claim-review' && (
            <TopBar
              page={currentPage}
              claimId={claimId}
              onNavigate={(page) => onNavigate(page)}
              onSearchOpen={() => setSearchOpen(true)}
            />
          )}
          <main style={{ flex: 1, overflow: 'auto', background: 'var(--canvas-bg)' }}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}

function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <main className="page-shell">
      <h1>Page not found</h1>
      <p>The address may be incorrect or the page may have moved.</p>
      <button type="button" onClick={onHome}>Return to ClaimGuard</button>
    </main>
  );
}

function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => sessionStorage.getItem('claimguard-demo-authenticated') === 'true',
  );
  const { mode: theme, setMode: setTheme } = useTheme();
  const navigatePage = (page: string, claimId?: string) => navigate(pagePath(page, claimId));
  const requestedPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  const handleLogin = (email: string) => {
    sessionStorage.setItem('claimguard-demo-authenticated', 'true');
    sessionStorage.setItem('claimguard-demo-actor', email);
    setIsAuthenticated(true);
    navigate(requestedPath || '/app/dashboard', { replace: true });
  };

  const handleSignOut = () => {
    sessionStorage.removeItem('claimguard-demo-authenticated');
    setIsAuthenticated(false);
    navigate('/login', { replace: true });
  };

  return (
    <Routes>
      <Route path="/" element={<Landing onEnterApp={() => navigate('/login')} />} />
      <Route
        path="/login"
        element={isAuthenticated
          ? <Navigate to={requestedPath || '/app/dashboard'} replace />
          : <Login onLogin={handleLogin} />}
      />
      <Route
        path="/app"
        element={isAuthenticated
          ? <WorkspaceLayout
              currentPage={pageFromPath(location.pathname)}
              onNavigate={navigatePage}
              onSignOut={handleSignOut}
              theme={theme}
              onSetTheme={setTheme}
            />
          : <Navigate to="/login" state={{ from: location }} replace />}
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard onNavigate={navigatePage} />} />
        <Route path="claims" element={<Claims onNavigate={navigatePage} />} />
        <Route path="claims/:claimId" element={<ClaimReviewRoute onNavigate={navigatePage} />} />
        <Route path="review-queue" element={<ReviewQueue onNavigate={navigatePage} />} />
        <Route path="runs" element={<Runs />} />
        <Route path="audit" element={<AuditTrail />} />
        <Route path="ingest" element={<Ingest onNavigate={navigatePage} />} />
        <Route path="rules" element={<Rules onNavigate={navigatePage} />} />
        <Route path="analytics" element={<Analytics onNavigate={navigatePage} />} />
        <Route path="profile" element={<ProfilePage theme={theme} onSetTheme={setTheme} />} />
        <Route path="*" element={<NotFound onHome={() => navigate('/app/dashboard')} />} />
      </Route>
      <Route path="*" element={<NotFound onHome={() => navigate('/')} />} />
    </Routes>
  );
}

export default function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return (
    <BrowserRouter basename={basename}>
      <AppRoutes />
    </BrowserRouter>
  );
}
