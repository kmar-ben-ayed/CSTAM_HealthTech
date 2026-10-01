import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';
import { ApiError } from '../api/client';
import { datasetToClaimRows, getDataset, getIngestedClaims, type ClaimRow } from '../api/claims';

interface ClaimsProps {
  onNavigate: (page: string, claimId?: string) => void;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  pass: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass)', border: 'var(--status-pass-border)', dot: 'var(--status-pass)', label: 'Passed' },
  fail: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail)', border: 'var(--status-fail-border)', dot: 'var(--status-fail)', label: 'Failed' },
  review: { bg: 'var(--status-review-bg)', text: 'var(--status-review)', border: 'var(--status-review-border)', dot: 'var(--status-review)', label: 'Needs Review' },
  uncertain: { bg: 'var(--status-uta-bg)', text: 'var(--status-uta)', border: 'var(--status-uta-border)', dot: 'var(--status-uta)', label: 'Unable to Assess' },
};

const TABS = [
  { key: 'all', label: 'All claims' },
  { key: 'review', label: 'Needs Review' },
  { key: 'pass', label: 'Passed' },
  { key: 'fail', label: 'Failed' },
  { key: 'uncertain', label: 'Unable to Assess' },
];

export default function Claims({ onNavigate }: ClaimsProps) {
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getIngestedClaims(undefined, controller.signal)
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) return getDataset('development', 500, controller.signal);
        throw cause;
      })
      .then((dataset) => {
        setClaims(datasetToClaimRows(dataset));
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof ApiError ? cause.message : 'The claims service is unavailable.');
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const filtered = claims.filter(c => {
    const matchTab = activeTab === 'all' || c.status === activeTab;
    const matchSearch = !search || c.id.toLowerCase().includes(search.toLowerCase()) || c.provider.toLowerCase().includes(search.toLowerCase()) || c.member.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !selectedStatus || c.status === selectedStatus;
    const matchProvider = !selectedProvider || c.provider === selectedProvider;
    return matchTab && matchSearch && matchStatus && matchProvider;
  });

  const providers = Array.from(new Set(claims.map(c => c.provider)));
  const tabCounts = Object.fromEntries(TABS.map((tab) => [
    tab.key,
    tab.key === 'all' ? claims.length : claims.filter((claim) => claim.status === tab.key).length,
  ]));

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#0f172a', marginBottom: 4 }}>
            Claims
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>
            {loading ? 'Loading claims…' : `${claims.length} total · ${tabCounts.review || 0} need review`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 7,
            padding: '8px 14px',
            fontSize: '0.875rem',
            color: '#475569',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Export
          </button>
          <button style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 7,
            padding: '8px 16px',
            color: '#fff',
            fontSize: '0.875rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New run
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search by claim ID, provider, member..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 7,
              padding: '8px 12px 8px 36px',
              fontSize: '0.875rem',
              color: '#0f172a',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>

        <select
          value={selectedStatus}
          onChange={e => setSelectedStatus(e.target.value)}
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 7,
            padding: '8px 12px',
            fontSize: '0.875rem',
            color: selectedStatus ? '#0f172a' : '#94a3b8',
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">All statuses</option>
          <option value="pass">Passed</option>
          <option value="fail">Failed</option>
          <option value="review">Needs Review</option>
          <option value="uncertain">Unable to Assess</option>
        </select>

        <select
          value={selectedProvider}
          onChange={e => setSelectedProvider(e.target.value)}
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 7,
            padding: '8px 12px',
            fontSize: '0.875rem',
            color: selectedProvider ? '#0f172a' : '#94a3b8',
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">All providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {(search || selectedStatus || selectedProvider) && (
          <button
            onClick={() => { setSearch(''); setSelectedStatus(''); setSelectedProvider(''); }}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '0.8125rem',
              color: '#94a3b8',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: '4px 8px',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
              padding: '10px 16px',
              fontSize: '0.875rem',
              color: activeTab === tab.key ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: activeTab === tab.key ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              transition: 'all 0.15s ease',
              marginBottom: -1,
            }}
          >
            {tab.label}
            <span style={{
              background: activeTab === tab.key ? 'var(--accent)' : 'var(--canvas-bg)',
              color: activeTab === tab.key ? '#fff' : '#94a3b8',
              borderRadius: 20,
              padding: '1px 7px',
              fontSize: '0.6875rem',
              fontWeight: 700,
              fontFamily: "var(--font-sans)",
            }}>
              {tabCounts[tab.key] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: 'var(--card-shadow)',
      }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Claim ID</th>
              <th>Member</th>
              <th>Provider</th>
              <th>Service date</th>
              <th>Amount</th>
              <th>Findings</th>
              <th>Rule(s)</th>
              <th>Status</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>Loading claims from the API…</td></tr>
            ) : error ? (
              <tr><td colSpan={10} style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ color: '#8c322f', fontWeight: 600, marginBottom: 8 }}>Unable to load claims</div>
                <div style={{ color: '#64748b', fontSize: '0.875rem' }}>{error}</div>
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <Sentinel state="idle" size={48} />
                    <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#334155' }}>No claims found</div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Try adjusting your search or filters</div>
                  </div>
                </td>
              </tr>
            ) : filtered.map(claim => {
              const sc = STATUS_CONFIG[claim.status];
              return (
                <tr
                  key={claim.id}
                  onClick={() => onNavigate('claim-review', claim.id)}
                  onMouseEnter={() => setHoveredRow(claim.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sentinel state={claim.sentinel} size={20} />
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a' }}>
                        {claim.id}
                      </span>
                    </div>
                  </td>
                  <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{claim.member}</span></td>
                  <td><span style={{ fontSize: '0.8125rem', color: '#64748b' }}>{claim.provider}</span></td>
                  <td>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', color: '#64748b' }}>
                      {claim.dos}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                      {claim.amount}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: claim.findings > 0 ? 'var(--status-fail)' : 'var(--text-secondary)',
                    }}>
                      {claim.findings}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.75rem', color: '#94a3b8' }}>
                      {claim.rule}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      background: sc.bg,
                      color: sc.text,
                      border: `1px solid ${sc.border}`,
                      borderRadius: 20,
                      padding: '3px 10px',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      whiteSpace: 'nowrap',
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot, display: 'inline-block' }} />
                      {sc.label}
                    </span>
                  </td>
                  <td><span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{claim.updated}</span></td>
                  <td>
                    <button
                      onClick={e => { e.stopPropagation(); onNavigate('claim-review', claim.id); }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: 600,
                        fontSize: '0.8125rem',
                        padding: '4px 8px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      Review
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderTop: '1px solid #f1f5f9',
          background: '#fafafa',
        }}>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
            Showing {filtered.length} of {claims.length} claims
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {['←', '1', '2', '3', '→'].map((p, i) => (
              <button
                key={i}
                style={{
                  background: p === '1' ? '#0f172a' : '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 5,
                  width: 32,
                  height: 32,
                  fontSize: '0.8125rem',
                  color: p === '1' ? '#fff' : '#475569',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: p === '1' ? 600 : 400,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
