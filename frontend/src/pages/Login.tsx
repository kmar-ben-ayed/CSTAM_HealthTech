import { useState } from 'react';
import Sentinel from '../components/Sentinel';

type LoginState = 'idle' | 'loading' | 'error' | 'forgot' | 'forgot-loading';

interface LoginProps {
  onLogin: (email: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loginState, setLoginState] = useState<LoginState>('idle');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoginState('loading');
    setTimeout(() => {
      if (password === 'wrong') {
        setLoginState('error');
      } else {
        onLogin(email);
      }
    }, 1200);
  };

  const handleForgot = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginState('forgot-loading');
    setTimeout(() => {
      setForgotSent(true);
      setLoginState('idle');
    }, 1000);
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
      }}
      className="auth-shell"
    >
      {/* Left — branding panel */}
      <div
        style={{
          width: '43%',
          background: 'var(--sidebar-bg)',
          display: 'flex',
          flexDirection: 'column',
          padding: '40px clamp(28px, 4vw, 56px)',
          position: 'relative',
          overflow: 'hidden',
        }}
        className="auth-brand"
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          <Sentinel state="idle" size={36} />
          <div>
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: 'var(--sidebar-text-active)',
                lineHeight: 1,
              }}
            >
              ClaimGuard
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--sidebar-accent)',
                textTransform: 'uppercase',
              }}
            >
              AI
            </div>
          </div>
        </div>

        {/* Center content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 40,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Sentinel state="idle" size={72} showLabel={false} />
            <div
              style={{
                marginTop: 32,
                fontSize: '1.75rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.03em',
                lineHeight: 1.2,
              }}
            >
              Evidence before
              <br />
              decisions.
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: '0.9375rem',
                color: 'rgba(148,163,184,0.8)',
                lineHeight: 1.6,
                maxWidth: 340,
              }}
            >
              Deterministic checks surface the finding. Source evidence
              explains why. A reviewer remains responsible for the decision.
            </div>
          </div>

          {/* Feature bullets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 360 }}>
            {[
              '15 deterministic validation rules',
              'Evidence paths preserved for review',
              'Reviewer actions recorded to audit',
            ].map((label) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'var(--sidebar-active-bg)',
                    border: '1px solid var(--sidebar-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5 3.5-4" stroke="var(--sidebar-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span style={{ fontSize: '0.875rem', color: 'var(--sidebar-text)', fontWeight: 500 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ fontSize: '0.75rem', color: 'rgba(71,85,105,0.7)', letterSpacing: '0.02em' }}>
            © 2026 ClaimGuard AI · Enterprise Edition
          </p>
        </div>
      </div>

      {/* Right — form panel */}
      <div
        style={{
          flex: 1,
          background: 'var(--canvas-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 48,
        }}
        className="auth-form-panel"
      >
        <div style={{ width: '100%', maxWidth: 420 }} className="auth-content">
          {loginState !== 'forgot' && loginState !== 'forgot-loading' && !forgotSent ? (
            <>
              <div style={{ marginBottom: 36 }}>
                <h1
                  style={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.03em',
                    marginBottom: 8,
                  }}
                >
                  Welcome back
                </h1>
                <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
                  Sign in to ClaimGuard AI
                </p>
              </div>

              {/* Error */}
              {loginState === 'error' && (
                <div
                  style={{
                    background: 'var(--status-fail-bg)',
                    border: '1px solid var(--status-fail-border)',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    animation: 'shake 0.3s ease',
                  }}
                  className="auth-error"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="var(--status-fail)" strokeWidth="1.2" />
                    <path d="M8 5v3.5M8 10.5v.5" stroke="var(--status-fail)" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: '0.875rem', color: 'var(--status-fail-ink)', fontWeight: 500 }}>
                    Invalid email or password.
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Email */}
                <div>
                  <label
                    style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}
                  >
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@organization.com"
                    required
                    style={{
                      width: '100%',
                      background: 'var(--card-bg)',
                      border: `1px solid ${loginState === 'error' ? 'var(--status-fail-border)' : 'var(--border)'}`,
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: '0.9375rem',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      outline: 'none',
                      transition: 'border-color 0.15s ease',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent-ink)')}
                    onBlur={(e) => (e.target.style.borderColor = loginState === 'error' ? 'var(--status-fail-border)' : 'var(--border)')}
                  />
                </div>

                {/* Password */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setLoginState('forgot')}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.8125rem',
                        color: 'var(--accent)',
                        fontFamily: 'inherit',
                        padding: 0,
                        fontWeight: 500,
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{
                      width: '100%',
                      background: 'var(--card-bg)',
                      border: `1px solid ${loginState === 'error' ? 'var(--status-fail-border)' : 'var(--border)'}`,
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: '0.9375rem',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent-ink)')}
                    onBlur={(e) => (e.target.style.borderColor = loginState === 'error' ? 'var(--status-fail-border)' : 'var(--border)')}
                  />
                </div>

                {/* Remember me */}
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                >
                  <div
                    onClick={() => setRemember(!remember)}
                    style={{
                      width: 18,
                      height: 18,
                      border: `2px solid ${remember ? 'var(--accent)' : 'var(--border-strong)'}`,
                      borderRadius: 4,
                      background: remember ? 'var(--accent)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                    }}
                  >
                    {remember && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="var(--card-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Remember me</span>
                </label>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loginState === 'loading'}
                  style={{
                    width: '100%',
                    background: loginState === 'loading' ? 'var(--accent-hover)' : 'var(--accent-ink)',
                    border: 'none',
                    borderRadius: 8,
                    padding: '11px 0',
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: 'var(--card-bg)',
                    cursor: loginState === 'loading' ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (loginState !== 'loading') (e.currentTarget.style.background = 'var(--accent-hover)');
                  }}
                  onMouseLeave={(e) => {
                    if (loginState !== 'loading') (e.currentTarget.style.background = 'var(--accent-ink)');
                  }}
                >
                  {loginState === 'loading' ? (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        style={{ animation: 'sentinel-orbit 0.7s linear infinite' }}
                      >
                        <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                        <path d="M8 2a6 6 0 016 6" stroke="var(--card-bg)" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Signing in...
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>

                {/* Divider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--canvas-bg-secondary)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>or</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--canvas-bg-secondary)' }} />
                </div>

                {/* SSO */}
                <button
                  type="button"
                  style={{
                    width: '100%',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 0',
                    fontSize: '0.9375rem',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--canvas-bg-secondary)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--card-bg)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="2" width="5.5" height="5.5" rx="1" fill="#4285F4" />
                    <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" fill="#EA4335" />
                    <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" fill="#34A853" />
                    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" fill="#FBBC04" />
                  </svg>
                  Continue with SSO
                </button>
              </form>

              <p
                style={{
                  marginTop: 32,
                  fontSize: '0.8125rem',
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                  lineHeight: 1.5,
                }}
              >
                Access is provisioned by your organization's administrator.
                <br />
                Contact IT for account setup.
              </p>
            </>
          ) : loginState === 'forgot' || loginState === 'forgot-loading' ? (
            /* Forgot password view */
            <>
              <button
                onClick={() => setLoginState('idle')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  padding: 0,
                  marginBottom: 28,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back to sign in
              </button>

              <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 8 }}>
                  Reset your password
                </h1>
                <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
                  Enter your email and we'll send a reset link.
                </p>
              </div>

              <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@organization.com"
                    required
                    style={{
                      width: '100%',
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: '0.9375rem',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent-ink)')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loginState === 'forgot-loading'}
                  style={{
                    width: '100%',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '11px 0',
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: 'var(--card-bg)',
                    cursor: loginState === 'forgot-loading' ? 'wait' : 'pointer',
                    opacity: loginState === 'forgot-loading' ? 0.75 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  {loginState === 'forgot-loading' ? 'Sending reset link...' : 'Send reset link'}
                </button>
              </form>
            </>
          ) : (
            /* Reset sent */
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: 'var(--status-pass-bg)',
                  border: '1px solid var(--status-pass-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12l4 4 10-10" stroke="var(--status-pass-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                Check your email
              </h2>
              <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                We sent a password reset link to{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{forgotEmail}</strong>
              </p>
              <button
                onClick={() => { setLoginState('idle'); setForgotSent(false); setForgotEmail(''); }}
                style={{
                  marginTop: 28,
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 24px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
