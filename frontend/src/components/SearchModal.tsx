import { useState, useEffect, useRef } from 'react';
import { getDataset, getIngestedClaims } from '../api/claims';
import { getAuditEvents } from '../api/audit';
import { getRuns } from '../api/runs';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string, id?: string) => void;
}

type ResultCategory = 'Claims' | 'Runs' | 'Audit Events';

interface SearchResult {
  id: string;
  label: string;
  subtitle: string;
  category: ResultCategory;
  page: string;
  navId?: string;
}

const CATEGORY_ICONS: Record<ResultCategory, React.ReactNode> = {
  Claims: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5h6M4 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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
  Claims: '#1d5c8a',
  Runs: '#1f7a5c',
  'Audit Events': '#96650f',
};

export default function SearchModal({ open, onClose, onNavigate }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [dataResults, setDataResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      const controller = new AbortController();
      Promise.all([
        Promise.all([
          getDataset('development', 500, controller.signal),
          getDataset('validation', 500, controller.signal),
          getDataset('stress', 500, controller.signal),
        ]),
        getIngestedClaims(500, controller.signal).catch((error: unknown) => {
          if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) return null;
          throw error;
        }),
        getRuns(100, controller.signal).catch(() => ({ total_count: 0, runs: [] })),
        getAuditEvents(100, 0, controller.signal).catch(() => ({ total_count: 0, offset: 0, events: [] })),
      ])
        .then(([datasets, ingested, runs, audit]) => {
          const claims = [
            ...datasets.flatMap((dataset) => dataset.claims.map((claim) => ({ claim, source: `${dataset.dataset} synthetic` }))),
            ...(ingested?.claims || []).map((claim) => ({ claim, source: 'latest ingested batch' })),
          ];
          const uniqueClaims = new Map(claims.map((item) => [item.claim.claim_id, item]));
          const claimResults: SearchResult[] = Array.from(uniqueClaims.values()).map(({ claim, source }) => ({
            id: claim.claim_id,
            label: claim.claim_id,
            subtitle: `${claim.provider_id || 'Unknown provider'} · ${source}`,
            category: 'Claims',
            page: 'claim-review',
            navId: claim.claim_id,
          }));
          const runResults: SearchResult[] = runs.runs.map((run) => ({
            id: run.run_id,
            label: `Run ${run.run_id.slice(0, 12)}`,
            subtitle: `${run.source.split} synthetic · ${run.claim_count} claims · ${run.status}`,
            category: 'Runs',
            page: 'runs',
          }));
          const auditResults: SearchResult[] = audit.events.map((event) => ({
            id: `AUD-${event.index}`,
            label: `${event.event_type.replaceAll('_', ' ')}${event.claim_id ? ` · ${event.claim_id}` : ''}`,
            subtitle: `${new Date(event.timestamp).toLocaleString()} · ${event.actor}`,
            category: 'Audit Events',
            page: 'audit',
          }));
          setDataResults([...claimResults, ...runResults, ...auditResults]);
        })
        .catch(() => setDataResults([]));
      return () => controller.abort();
    }
  }, [open]);

  const searchableResults = dataResults;
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
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
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
            borderBottom: query.trim() ? '1px solid #f1f5f9' : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: '#94a3b8', flexShrink: 0 }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKey}
            placeholder="Search claims, runs, and audit events..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '1rem',
              color: '#0f172a',
              fontFamily: 'inherit',
              background: 'transparent',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: '#f1f5f9',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: '0.75rem',
                color: '#64748b',
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
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: '0.6875rem',
              color: '#94a3b8',
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
              <div style={{ padding: '28px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
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
                      color: '#94a3b8',
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
                          background: isSelected ? '#e8f1f7' : 'transparent',
                          borderLeft: isSelected ? '2px solid #1d5c8a' : '2px solid transparent',
                          transition: 'background 0.1s ease',
                        }}
                      >
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 7,
                            background: `${CATEGORY_COLOR[cat]}15`,
                            border: `1px solid ${CATEGORY_COLOR[cat]}25`,
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
                              color: '#0f172a',
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
                              color: '#64748b',
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
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#94a3b8' }}>
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
                color: '#94a3b8',
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
                    background: '#f8fafc',
                    border: '1px solid #e8eaed',
                    borderRadius: 7,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8125rem',
                    color: '#334155',
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
              borderTop: '1px solid #f1f5f9',
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
                    background: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: '0.6875rem',
                    color: '#475569',
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                  }}
                >
                  {key}
                </kbd>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
