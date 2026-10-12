import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sentinel from './components/Sentinel';
import SearchModal from './components/SearchModal';
import Dock, { DockIcons, type DockItem } from './components/Dock';
import ClaimGuardCursor from './components/ClaimGuardCursor';
import NotificationsMenu from './components/NotificationsMenu';
import ShieldLoader from './components/ShieldLoader';
import { useTheme, type ThemeMode } from './hooks/useTheme';
import { getIngestedClaims } from './api/claims';

const Login = lazy(() => import('./pages/Login'));
const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Claims = lazy(() => import('./pages/Claims'));
const ReviewQueue = lazy(() => import('./pages/ReviewQueue'));
const ClaimReview = lazy(() => import('./pages/ClaimReview'));
const Runs = lazy(() => import('./pages/Runs'));
const AuditTrail = lazy(() => import('./pages/AuditTrail'));
const Rules = lazy(() => import('./pages/Rules'));
const Ingest = lazy(() => import('./pages/Ingest'));
const Analytics = lazy(() => import('./pages/Analytics'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));

function PageLoading() {
  return <ShieldLoader label="Opening the page…" />;
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

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
  | 'admin'
  | 'analytics'
  | 'profile';

// Dock items, top to bottom; a separator is drawn between groups.
const DOCK_GROUPS: DockItem[][] = [
  [
    { key: 'dashboard', label: 'Overview', icon: DockIcons.home },
    { key: 'claims', label: 'Claims', icon: DockIcons.file },
    { key: 'review-queue', label: 'Review Queue', icon: DockIcons.task },
  ],
  [
    { key: 'runs', label: 'Runs', icon: DockIcons.play },
    { key: 'audit', label: 'Audit Trail', icon: DockIcons.shield },
    { key: 'ingest', label: 'Ingest Data', icon: DockIcons.cloud },
  ],
  [
    { key: 'rules', label: 'Policy & Rules', icon: DockIcons.book },
    { key: 'admin', label: 'System Admin', icon: DockIcons.gear },
    { key: 'analytics', label: 'Analytics', icon: DockIcons.chart },
  ],
];

// The group each page belongs to, shown first in the breadcrumb ("Workspace / Claims").
const BREADCRUMB_ROOTS: Partial<Record<Page, string>> = {
  dashboard: 'Workspace',
  claims: 'Workspace',
  'claim-review': 'Workspace',
  'review-queue': 'Workspace',
  runs: 'Workflow',
  audit: 'Workflow',
  ingest: 'Workflow',
  rules: 'Configure',
  admin: 'Configure',
  analytics: 'Configure',
  profile: 'Account',
};

const BREADCRUMB_LABELS: Partial<Record<Page, string>> = {
  dashboard: 'Overview',
  claims: 'Claims',
  'claim-review': 'Claim review',
  'review-queue': 'Review queue',
  runs: 'Runs',
  audit: 'Audit trail',
  ingest: 'Ingest data',
  rules: 'Policy & rules',
  admin: 'System admin',
  analytics: 'Analytics',
  profile: 'Profile & preferences',
};

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpExpanded, setHelpExpanded] = useState<string | null>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const crumbs: Array<{ label: string; page: Page }> = (() => {
    if (page === 'claim-review') return [{ label: 'Claims', page: 'claims' }, { label: claimId || 'Review', page: 'claim-review' }];
    const label = BREADCRUMB_LABELS[page];
    return label ? [{ label, page }] : [{ label: 'Overview', page: 'dashboard' }];
  })();

  const HOW_IT_WORKS = [
    { num: '01', title: 'Claim ingestion', desc: 'CSV, JSON, or FHIR files are uploaded and normalized into structured records.' },
    { num: '02', title: 'Deterministic validation', desc: 'Each claim is evaluated against the active rules; each returns pass, fail, unable to assess or not applicable.' },
    { num: '03', title: 'Evidence inspection', desc: 'Rule findings link to exact evidence paths in the claim payload.' },
    { num: '04', title: 'AI-assisted explanation', desc: 'The AI model provides an explanation for each finding, grounded in retrieved evidence.' },
    { num: '05', title: 'Human review', desc: 'Reviewers confirm, override, or request information via the Review Queue.' },
    { num: '06', title: 'Re-check', desc: 'Corrected claims are re-validated in a new run, preserving the prior findings.' },
    { num: '07', title: 'Audit trail', desc: 'Every action is recorded with actor identity, timestamp, and hash-chain integrity.' },
  ];

  return (
    <header
      className="app-topbar"
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 16,
        flexShrink: 0,
        zIndex: 20,
        position: 'relative',
      }}
    >
      {/* Breadcrumb: group / page */}
      <nav aria-label="Breadcrumb" className="topbar-crumbs" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        <span className="crumb-root">{BREADCRUMB_ROOTS[page] ?? 'Workspace'}</span>
        <span className="crumb-root" aria-hidden="true">/</span>
        {crumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i < crumbs.length - 1 ? (
              <>
                <button onClick={() => onNavigate(crumb.page)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', padding: 0, fontWeight: 500 }}>
                  {crumb.label}
                </button>
                <span className="crumb-root" aria-hidden="true">/</span>
              </>
            ) : (
              <span aria-current="page" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Search bar */}
      <button
        onClick={onSearchOpen}
        className="topbar-search"
        style={{
          width: 280,
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="search-label" style={{ flex: 1, textAlign: 'left' }}>Search claims, rules, runs…</span>
        <kbd>⌘K</kbd>
      </button>

      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <NotificationsMenu onOpenAudit={() => onNavigate('audit')} />

        {/* Help */}
        <div ref={helpRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="topbar-icon-button"
            aria-label="Help"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen(!helpOpen)}
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
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700, color: 'var(--card-bg)' }}>
              MA
            </div>
            <div>
              <div style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>Marwen Agrebi</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 2 }}>marwen.agrebi@healthcorp.org</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Full name', value: 'Marwen Agrebi' },
              { label: 'Role', value: 'Senior Reviewer' },
              { label: 'Email', value: 'marwen.agrebi@healthcorp.org' },
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
  admin: '/app/admin',
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
  const [reviewCount, setReviewCount] = useState(0);
  const location = useLocation();
  const claimId = location.pathname.match(/^\/app\/claims\/([^/]+)/)?.[1];
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const accountEmail = sessionStorage.getItem('claimguard-demo-actor') || 'reviewer';

  // Claims that need a reviewer: any FAIL, UNABLE_TO_ASSESS or flagged result.
  useEffect(() => {
    const controller = new AbortController();
    getIngestedClaims(undefined, controller.signal)
      .then((response) => {
        const count = Object.values(response.evaluations).filter((results) =>
          results.some((result) => result.status === 'FAIL' || result.status === 'UNABLE_TO_ASSESS' || result.requires_human_review),
        ).length;
        setReviewCount(count);
      })
      .catch(() => setReviewCount(0));
    return () => controller.abort();
  }, []);

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
        style={{ height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-sans)', background: 'var(--canvas-atmosphere)' }}
      >
        <Dock
          groups={DOCK_GROUPS}
          currentKey={currentPage === 'claim-review' ? 'claims' : currentPage}
          onNavigate={(key) => onNavigate(key)}
          reviewCount={reviewCount}
          accountEmail={accountEmail}
          isDark={isDark}
          onSetTheme={onSetTheme}
          onOpenProfile={() => onNavigate('profile')}
          onSignOut={onSignOut}
          hrefFor={(key) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${pagePath(key)}`}
        />
        {/* The content column scrolls as one, so pages pass under the glass top bar. */}
        <div className="workspace-content" style={{ flex: 1, height: '100%', overflowY: 'auto', minWidth: 0 }}>
          {currentPage !== 'claim-review' && (
            <TopBar
              page={currentPage}
              claimId={claimId}
              onNavigate={(page) => onNavigate(page)}
              onSearchOpen={() => setSearchOpen(true)}
            />
          )}
          <main>
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
      <Route path="/" element={<LazyPage><Landing onEnterApp={() => navigate('/login')} /></LazyPage>} />
      <Route
        path="/login"
        element={
          isAuthenticated
            ? <Navigate to={requestedPath || '/app/dashboard'} replace />
            : <LazyPage><Login onLogin={handleLogin} /></LazyPage>
        }
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
        <Route path="dashboard" element={<LazyPage><Dashboard onNavigate={navigatePage} /></LazyPage>} />
        <Route path="claims" element={<LazyPage><Claims onNavigate={navigatePage} /></LazyPage>} />
        <Route path="claims/:claimId" element={<LazyPage><ClaimReviewRoute onNavigate={navigatePage} /></LazyPage>} />
        <Route path="review-queue" element={<LazyPage><ReviewQueue onNavigate={navigatePage} /></LazyPage>} />
        <Route path="runs" element={<LazyPage><Runs /></LazyPage>} />
        <Route path="audit" element={<LazyPage><AuditTrail /></LazyPage>} />
        <Route path="ingest" element={<LazyPage><Ingest onNavigate={navigatePage} /></LazyPage>} />
        <Route path="rules" element={<LazyPage><Rules onNavigate={navigatePage} /></LazyPage>} />
        <Route path="admin" element={<LazyPage><AdminPanel /></LazyPage>} />
        <Route path="analytics" element={<LazyPage><Analytics onNavigate={navigatePage} /></LazyPage>} />
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
      <ClaimGuardCursor />
      <AppRoutes />
    </BrowserRouter>
  );
}
