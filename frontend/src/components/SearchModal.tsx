import { useEffect, useRef, useState } from 'react';
import ShieldLoader from './ShieldLoader';
import { getDataset, getIngestedClaims } from '../api/claims';
import { listRules } from '../api/rules';
import { getIngestionRuns } from '../api/runs';
import { getAuditEvents } from '../api/audit';
import { displayName } from '../api/claimCards';
import { ApiError } from '../api/client';
import '../styles/search.css';

// ── Search ─────────────────────────────────────────────────────────────────
// A ⌘K palette over real data: claims, rules, ingestion runs and audit
// events. It opens instantly, with no animation, because it is used often.

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string, id?: string) => void;
}

type ResultCategory = 'Claims' | 'Rules' | 'Runs' | 'Audit events';

interface SearchResult {
  id: string;
  label: string;
  subtitle: string;
  category: ResultCategory;
  page: string;
  navId?: string;
}

const MAX_RESULTS = 8;
const CATEGORIES: ResultCategory[] = ['Claims', 'Rules', 'Runs', 'Audit events'];

async function loadIndex(signal: AbortSignal): Promise<SearchResult[]> {
  const ignore = <T,>(fallback: T) => (cause: unknown): T => {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return fallback;
  };
  const [claims, rules, runs, audit] = await Promise.all([
    getIngestedClaims(undefined, signal)
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) return getDataset('development', 500, signal);
        throw cause;
      })
      .then((dataset) => dataset.claims)
      .catch(ignore([])),
    listRules(signal).catch(ignore([])),
    getIngestionRuns(signal).then((response) => response.runs).catch(ignore([])),
    getAuditEvents(200, signal).then((response) => response.events).catch(ignore([])),
  ]);

  return [
    ...claims.map((claim): SearchResult => ({
      id: claim.claim_id,
      label: claim.claim_id,
      subtitle: [claim.provider_id, claim.patient_id, claim.diagnosis_code].filter(Boolean).join(' · '),
      category: 'Claims',
      page: 'claim-review',
      navId: claim.claim_id,
    })),
    ...rules.map((rule): SearchResult => ({
      id: rule.rule_id,
      label: `${rule.rule_id} ${rule.title}`,
      subtitle: `${rule.status === 'active' ? 'Active' : 'Inactive'} · ${rule.severity} severity`,
      category: 'Rules',
      page: 'rules',
    })),
    ...runs.map((run): SearchResult => ({
      id: run.run_id,
      label: run.run_id,
      subtitle: `${run.source} · ${run.accepted_claims} accepted, ${run.rejected_records} rejected`,
      category: 'Runs',
      page: 'runs',
    })),
    ...audit
      .filter((event) => event.event_type !== 'rule_execution')
      .map((event): SearchResult => ({
        id: `AUD-${event.index}`,
        label: `${event.event_type.replaceAll('_', ' ')}${event.claim_id ? `, ${event.claim_id}` : ''}`,
        subtitle: `${new Date(event.timestamp).toLocaleString()} · ${displayName(event.actor)}`,
        category: 'Audit events',
        page: 'audit',
      })),
  ];
}

export default function SearchModal({ open, onClose, onNavigate }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [index, setIndex] = useState<SearchResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    inputRef.current?.focus();
    const controller = new AbortController();
    loadIndex(controller.signal)
      .then(setIndex)
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const results = !needle || !index
    ? []
    : index
      .filter((result) => [result.id, result.label, result.subtitle].some((value) => value.toLowerCase().includes(needle)))
      .slice(0, MAX_RESULTS);

  const go = (result: SearchResult) => {
    onNavigate(result.page, result.navId);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && results[selected]) {
      go(results[selected]);
    }
  };

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Search" onClick={(event) => event.stopPropagation()}>
        <div className="search-field">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search claims, rules, runs and audit events"
            aria-label="Search"
            aria-controls="search-results"
          />
          <kbd>Esc</kbd>
        </div>

        {needle && (
          <div id="search-results" className="search-results" role="listbox" aria-label="Results">
            {!index ? (
              <ShieldLoader label="Searching…" inline />
            ) : results.length === 0 ? (
              <p className="search-empty">No results for &ldquo;{query}&rdquo;</p>
            ) : (
              CATEGORIES.map((category) => {
                const items = results.filter((result) => result.category === category);
                if (items.length === 0) return null;
                return (
                  <div key={category} role="group" aria-label={category}>
                    <div className="search-category">{category}</div>
                    {items.map((result) => {
                      const position = results.indexOf(result);
                      return (
                        <div
                          key={`${category}-${result.id}`}
                          role="option"
                          aria-selected={position === selected}
                          className="search-result"
                          onClick={() => go(result)}
                          onMouseEnter={() => setSelected(position)}
                        >
                          <span className={category === 'Claims' || category === 'Runs' ? 'search-label mono' : 'search-label'}>{result.label}</span>
                          <span className="search-subtitle">{result.subtitle}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="search-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
            <span><kbd>Enter</kbd> Open</span>
            <span><kbd>Esc</kbd> Close</span>
          </div>
        )}
      </div>
    </div>
  );
}
