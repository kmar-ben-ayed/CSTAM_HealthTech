import { useState, useEffect, useRef } from 'react';
import { getDataset, getIngestedClaims } from '../api/claims';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string, id?: string) => void;
}

type ResultCategory = 'Claims' | 'Rules' | 'Runs' | 'Audit Events';

interface SearchResult {
  id: string;
  label: string;
  subtitle: string;
  category: ResultCategory;
  page: string;
  navId?: string;
}

const ALL_RESULTS: SearchResult[] = [
  // Rules
  { id: 'R001', label: 'R001 — Enrollment Verification', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R002', label: 'R002 — Coverage Window', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R003', label: 'R003 — Session Count Limits', subtitle: 'Active · MEDIUM severity', category: 'Rules', page: 'rules' },
  { id: 'R004', label: 'R004 — Diagnosis Code Validation', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R005', label: 'R005 — Provider NPI Enrollment', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R006', label: 'R006 — Rendering vs. Billing Provider', subtitle: 'Active · MEDIUM severity', category: 'Rules', page: 'rules' },
  { id: 'R007', label: 'R007 — Place of Service Validation', subtitle: 'Active · MEDIUM severity', category: 'Rules', page: 'rules' },
  { id: 'R008', label: 'R008 — Authorization Reference', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R009', label: 'R009 — Modifier Applicability', subtitle: 'Active · MEDIUM severity', category: 'Rules', page: 'rules' },
  { id: 'R010', label: 'R010 — Duplicate Claim Detection', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R011', label: 'R011 — Units per Session', subtitle: 'Active · LOW severity', category: 'Rules', page: 'rules' },
  { id: 'R012', label: 'R012 — Service Line Consistency', subtitle: 'Active · MEDIUM severity', category: 'Rules', page: 'rules' },
  { id: 'R013', label: 'R013 — Timely Filing Compliance', subtitle: 'Active · HIGH severity', category: 'Rules', page: 'rules' },
  { id: 'R014', label: 'R014 — Coordination of Benefits', subtitle: 'Active · MEDIUM severity', category: 'Rules', page: 'rules' },
  { id: 'R015', label: 'R015 — Telehealth Eligibility', subtitle: 'Active · LOW severity', category: 'Rules', page: 'rules' },
  // Runs
  { id: 'RUN-4817', label: 'RUN-4817', subtitle: 'Completed · Sep 15, 2026 · 41 claims', category: 'Runs', page: 'runs' },
  { id: 'RUN-4818', label: 'RUN-4818', subtitle: 'Completed · Sep 17, 2026 · 38 claims', category: 'Runs', page: 'runs' },
  { id: 'RUN-4819', label: 'RUN-4819', subtitle: 'Completed · Sep 20, 2026 · 52 claims', category: 'Runs', page: 'runs' },
  { id: 'RUN-4820', label: 'RUN-4820', subtitle: 'Completed · Sep 24, 2026 · 47 claims', category: 'Runs', page: 'runs' },
  { id: 'RUN-4821', label: 'RUN-4821', subtitle: 'Completed · Sep 28, 2026 · 63 claims', category: 'Runs', page: 'runs' },
  // Audit
  { id: 'EVT-001', label: 'Claim validated — CLM-10482', subtitle: 'Sep 28, 2026 · System', category: 'Audit Events', page: 'audit' },
  { id: 'EVT-002', label: 'Human review completed — CLM-10479', subtitle: 'Sep 27, 2026 · Marwen Agrebi', category: 'Audit Events', page: 'audit' },
  { id: 'EVT-003', label: 'Ingestion completed — 10 claims', subtitle: 'Sep 27, 2026 · System', category: 'Audit Events', page: 'audit' },
];

const CATEGORY_ICONS: Record<ResultCategory, React.ReactNode> = {
  Claims: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5h6M4 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  Rules: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  Runs: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 4.5l4 2.5-4 2.5V4.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  ),
  'Audit Events': (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1l6 2.5v4C13 11 10.5 13.5 7 14 3.5 13.5 1 11 1 7.5V3.5L7 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
};

const CATEGORY_COLOR: Record<ResultCategory, string> = {
  Claims: 'var(--accent-ink)',
  Rules: 'var(--status-uta)',
  Runs: 'var(--status-pass)',
  'Audit Events': 'var(--status-uta)',
};

export default function SearchModal({ open, onClose, onNavigate }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [claimResults, setClaimResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      const controller = new AbortController();
      getIngestedClaims(undefined, controller.signal)
        .catch((error: unknown) => {
          if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) {
            return getDataset('development', 500, controller.signal);
          }
          throw error;
        })
        .then((dataset) => {
          setClaimResults(dataset.claims.map((claim) => ({
            id: claim.claim_id,
            label: claim.claim_id,
            subtitle: `${claim.provider_id || 'Unknown provider'} · ${claim.currency || ''} ${claim.total_amount ?? 'amount unavailable'}`,
            category: 'Claims',
            page: 'claim-review',
            navId: claim.claim_id,
          })));
        })
        .catch(() => setClaimResults([]));
      return () => controller.abort();
    }
  }, [open]);

  const searchableResults = [...claimResults, ...ALL_RESULTS];
  const results = query.trim().length < 1
    ? []
    : searchableResults.filter((r) => {
        const q = query.toLowerCase();
        return (
          r.id.toLowerCase().includes(q) ||
          r.label.toLowerCase().includes(q) ||
          r.subtitle.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q)
        );
      }).slice(0, 8);

  // Group results
  const grouped = results.reduce<Partial<Record<ResultCategory, SearchResult[]>>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category]!.push(r);
    return acc;
  }, {});

  const flatResults = results;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && flatResults[selected]) {
      const r = flatResults[selected];
      onNavigate(r.page, r.navId);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(15,23,42,0.45)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 580,
          background: 'var(--card-bg)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
          overflow: 'hidden',
          animation: 'fade-in-up 0.15s ease-out',
          margin: '0 16px',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: query.trim() ? '1px solid var(--border)' : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKey}
            placeholder="Quick search — claims, rules, runs, audit events..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '1rem',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              background: 'transparent',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'var(--canvas-bg-secondary)',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            >
              Clear
            </button>
          )}
          <span
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: '0.6875rem',
              color: 'var(--text-tertiary)',
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            Esc
          </span>
        </div>

        {/* Results */}
        {query.trim() ? (
          <div ref={listRef} style={{ maxHeight: 360, overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                No results for &ldquo;{query}&rdquo;
              </div>
            ) : (
              (Object.entries(grouped) as [ResultCategory, SearchResult[]][]).map(([cat, items]) => (
                <div key={cat}>
                  <div
                    style={{
                      padding: '8px 18px 4px',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {cat}
                  </div>
                  {items.map((r) => {
                    const globalIdx = flatResults.indexOf(r);
                    const isSelected = globalIdx === selected;
                    return (
                      <div
                        key={r.id}
                        onClick={() => { onNavigate(r.page, r.navId); onClose(); }}
                        onMouseEnter={() => setSelected(globalIdx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '9px 18px',
                          cursor: 'pointer',
                          background: isSelected ? 'var(--accent-subtle)' : 'transparent',
                          borderLeft: isSelected ? '2px solid var(--accent-ink)' : '2px solid transparent',
                          transition: 'background 0.1s ease',
                        }}
                      >
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 7,
                            background: `color-mix(in srgb, ${CATEGORY_COLOR[cat]} 8%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${CATEGORY_COLOR[cat]} 15%, transparent)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: CATEGORY_COLOR[cat],
                            flexShrink: 0,
                          }}
                        >
                          {CATEGORY_ICONS[cat]}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.875rem',
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              fontFamily:
                                cat === 'Claims' || cat === 'Runs'
                                  ? "var(--font-sans)"
                                  : 'inherit',
                            }}
                          >
                            {r.label}
                          </div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                              marginTop: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.subtitle}
                          </div>
                        </div>
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--text-tertiary)' }}>
                            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        ) : (
          /* Empty / hint state */
          <div style={{ padding: '16px 18px 18px' }}>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}
            >
              Quick access
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { label: 'Claims', hint: 'CLM-...', cat: 'Claims' },
                { label: 'Rules', hint: 'R001–R015', cat: 'Rules' },
                { label: 'Runs', hint: 'RUN-...', cat: 'Runs' },
                { label: 'Audit events', hint: 'EVT-...', cat: 'Audit Events' },
              ].map((s) => (
                <button
                  key={s.label}
                  onClick={() => setQuery(s.hint.replace('...', ''))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 7,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8125rem',
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                  }}
                >
                  <span style={{ color: CATEGORY_COLOR[s.cat as ResultCategory] }}>
                    {CATEGORY_ICONS[s.cat as ResultCategory]}
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        {results.length > 0 && (
          <div
            style={{
              padding: '8px 18px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 16,
              alignItems: 'center',
            }}
          >
            {[
              ['↑↓', 'Navigate'],
              ['↵', 'Open'],
              ['Esc', 'Close'],
            ].map(([key, action]) => (
              <div key={action} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <kbd
                  style={{
                    background: 'var(--canvas-bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: '0.6875rem',
                    color: 'var(--text-secondary)',
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                  }}
                >
                  {key}
                </kbd>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
