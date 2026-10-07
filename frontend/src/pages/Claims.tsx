import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
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

const FILTERS = [
  { key: 'all', label: 'All claims' },
  { key: 'review', label: 'Needs Review' },
  { key: 'pass', label: 'Passed' },
  { key: 'fail', label: 'Failed' },
  { key: 'uncertain', label: 'Unable to Assess' },
];

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'fail' | 'pass' }) {
  return (
    <div className="claim-fact">
      <span>{label}</span>
      <strong className={tone ? `claim-fact-value-${tone}` : undefined} title={value}>{value}</strong>
    </div>
  );
}

export default function Claims({ onNavigate }: ClaimsProps) {
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
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

  const filtered = claims.filter((c) => {
    const matchFilter = activeFilter === 'all' || c.status === activeFilter;
    const needle = search.trim().toLowerCase();
    const matchSearch = !needle
      || c.id.toLowerCase().includes(needle)
      || c.provider.toLowerCase().includes(needle)
      || c.member.toLowerCase().includes(needle)
      || (c.diagnosis ?? '').toLowerCase().includes(needle)
      || (c.serviceCode ?? '').toLowerCase().includes(needle);
    const matchProvider = !selectedProvider || c.provider === selectedProvider;
    return matchFilter && matchSearch && matchProvider;
  });

  const providers = Array.from(new Set(claims.map((c) => c.provider)));
  const counts = Object.fromEntries(FILTERS.map((filter) => [
    filter.key,
    filter.key === 'all' ? claims.length : claims.filter((claim) => claim.status === filter.key).length,
  ]));
  const hasFilters = Boolean(search || selectedProvider || activeFilter !== 'all');

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="claims-topbar">
        <div>
          <span className="sc-eyebrow"> Claims workspace</span>
          <h1 className="sc-title-caps claims-title">Claims</h1>
          <p className="claims-subtitle">
            {loading ? 'Loading claims…' : `${claims.length} total · ${counts.review || 0} need review · ${counts.fail || 0} failed`}
          </p>
        </div>
        <div className="claims-actions">
          <button className="btn btn-secondary">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Export
          </button>
          <button className="btn btn-primary">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New run
          </button>
        </div>
      </div>

      {/* Quick status filters */}
      <div className="claims-filters" role="group" aria-label="Filter claims by status">
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.key;
          const tone = STATUS_CONFIG[filter.key];
          return (
            <button
              key={filter.key}
              className={`claims-filter ${isActive ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter.key)}
              aria-pressed={isActive}
            >
              <span
                className="claims-filter-dot"
                style={{ background: filter.key === 'all' ? 'var(--accent)' : tone.dot }}
              />
              {filter.label}
              <span className="counts">{counts[filter.key] || 0}</span>
            </button>
          );
        })}
      </div>

      {/* Search and filters */}
      <div className="claims-toolbar">
        <div className="claims-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search by claim ID, provider, member, diagnosis…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="form-select claims-select"
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
          aria-label="Filter by provider"
        >
          <option value="">All providers</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <span className="claims-result-count">
          {loading ? '…' : `${filtered.length} of ${claims.length} claims`}
        </span>

        {hasFilters && !loading && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSearch(''); setSelectedProvider(''); setActiveFilter('all'); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Cards view */}
      <div className="claims-card-grid">
        {loading ? (
          <>
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="claims-card-state claims-card-skeleton" />)}
          </>
        ) : error ? (
          <div className="claims-card-state claims-card-state-error">
            <strong>Unable to load claims</strong>
            <span>{error}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="claims-card-state">
            <Sentinel state="idle" size={48} />
            <strong>No claims found</strong>
            <span>Try adjusting your search or filters</span>
          </div>
        ) : (
          filtered.map((claim) => {
            const sc = STATUS_CONFIG[claim.status];
            const total = claim.totalRules ?? 0;
            const passed = claim.passedRules ?? 0;
            const progress = total > 0 ? Math.round((passed / total) * 100) : 0;
            const ruleIds = claim.ruleIds ?? (claim.rule === '—' ? [] : claim.rule.split(', '));

            return (
              <article
                key={claim.id}
                className={`claim-card claim-card-${claim.status}`}
                onClick={() => onNavigate('claim-review', claim.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onNavigate('claim-review', claim.id);
                  }
                }}
              >
                <div className="claim-card-header">
                  <div className="claim-card-id">
                    <Sentinel state={claim.sentinel} size={24} />
                    <span>{claim.id}</span>
                  </div>
                  <span
                    className="claim-card-status"
                    style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}
                  >
                    <span style={{ background: sc.dot }} />
                    {sc.label}
                  </span>
                </div>

                <div className="claim-card-provider">{claim.provider}</div>
                <div className="claim-card-member">
                  Member <strong>{claim.member}</strong>
                  {(claim.payer && claim.payer !== '—') && <> · Payer <strong>{claim.payer}</strong></>}
                </div>

                <div className="claim-card-facts claim-card-facts-grid">
                  <Fact label="Service date" value={claim.dos} />
                  <Fact label="Billed amount" value={claim.amount} />
                  <Fact label="Findings" value={String(claim.findings)} tone={claim.findings ? 'fail' : 'pass'} />
                  <Fact label="Diagnosis" value={claim.diagnosis ?? '—'} />
                  <Fact label="Service code" value={claim.serviceCode ?? '—'} />
                  <Fact label="Invoice" value={claim.invoice ?? '—'} />
                  <Fact label="Policy" value={claim.policy ?? '—'} />
                  <Fact label="Claim lines" value={String(claim.lineCount ?? 0)} />
                  <Fact label="Submitted" value={claim.updated} />
                </div>

                <div className="claim-card-progress">
                  <div className="claim-card-progress-head">
                    <span>Rules passed</span>
                    <strong>{passed}/{total || '—'}</strong>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${progress}%`,
                        background: claim.status === 'fail'
                          ? 'linear-gradient(135deg, #ef4444, #f97316)'
                          : claim.status === 'pass'
                            ? 'linear-gradient(135deg, #10b981, #34d399)'
                            : 'var(--accent-gradient)',
                      }}
                    />
                  </div>
                </div>

                {(claim.severity && claim.severity !== 'None') && (
                  <div className="claim-card-meta">
                    <span className={`claim-severity claim-severity-${claim.severity.toLowerCase()}`}>
                      {claim.severity} severity
                    </span>
                    {claim.humanReview && <span className="claim-meta-tag">Human review flagged</span>}
                    {(claim.lineCount ?? 0) > 0 && <span className="claim-meta-tag">{claim.lineCount} line item{(claim.lineCount ?? 0) > 1 ? 's' : ''}</span>}
                  </div>
                )}

                <div className="claim-card-rules">
                  {ruleIds.length ? ruleIds.slice(0, 4).map((id) => (
                    <span key={id} className="claim-rule-chip">{id}</span>
                  )) : <span className="claim-rule-chip claim-rule-chip-pass">No rule findings</span>}
                  {ruleIds.length > 4 && <span className="claim-rule-chip">+{ruleIds.length - 4}</span>}
                </div>

                <div className="claim-card-footer">
                  <span>Updated {claim.updated}</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onNavigate('claim-review', claim.id);
                    }}
                  >
                    Review <span aria-hidden="true">→</span>
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
