import { useEffect, useMemo, useState } from 'react';
import ClaimCard, { ClaimCardGrid } from '../components/ClaimCard';
import ShieldLoader from '../components/ShieldLoader';
import { ApiError } from '../api/client';
import { getDataset, getIngestedClaims, type DatasetResponse } from '../api/claims';
import { loadCardContext, toClaimCardData, type ClaimCardData, type ClaimStatus } from '../api/claimCards';
import '../styles/claims-page.css';

interface ClaimsProps {
  onNavigate: (page: string, claimId?: string) => void;
}

type Filter = 'all' | ClaimStatus;

const FILTERS: Filter[] = ['all', 'Passed', 'Failed', 'Needs review', 'Unable to assess'];

interface LoadedClaims {
  cards: ClaimCardData[];
  /** Where the claims come from: the ingested batch, or the sample dataset. */
  source: string;
}

async function loadClaims(signal: AbortSignal): Promise<LoadedClaims> {
  const [dataset, context] = await Promise.all([
    getIngestedClaims(undefined, signal).catch((cause: unknown) => {
      // Nothing ingested yet: show the development dataset instead.
      if (cause instanceof ApiError && cause.status === 404) return getDataset('development', 500, signal);
      throw cause;
    }),
    loadCardContext(signal),
  ]);
  const batch = (dataset as DatasetResponse & { batch_id?: string }).batch_id;
  return {
    cards: dataset.claims.map((claim) => toClaimCardData(claim, dataset.evaluations[claim.claim_id] ?? [], context)),
    source: batch ? `batch ${batch.slice(0, 8)}` : `the ${dataset.name || dataset.dataset} dataset`,
  };
}

function matches(card: ClaimCardData, needle: string): boolean {
  if (!needle) return true;
  return [card.claimId, card.patientId, card.diagnosis, card.providerName, card.providerId, card.serviceCode]
    .some((value) => value.toLowerCase().includes(needle));
}

export default function Claims({ onNavigate }: ClaimsProps) {
  const [loaded, setLoaded] = useState<LoadedClaims | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadClaims(controller.signal)
      .then(setLoaded)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof ApiError ? cause.message : 'The claims service is unavailable.');
      });
    return () => controller.abort();
  }, []);

  const cards = useMemo(() => loaded?.cards ?? [], [loaded]);
  const providers = useMemo(
    () => Array.from(new Set(cards.map((card) => card.providerName))).sort((a, b) => a.localeCompare(b)),
    [cards],
  );
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: cards.length, Passed: 0, Failed: 0, 'Needs review': 0, 'Unable to assess': 0 };
    for (const card of cards) result[card.status] += 1;
    return result;
  }, [cards]);

  const needle = search.trim().toLowerCase();
  const visible = cards.filter((card) =>
    (filter === 'all' || card.status === filter)
    && (!provider || card.providerName === provider)
    && matches(card, needle));

  return (
    <div className="claims-page">
      <header className="claims-page-header">
        <div>
          <h1>Claims</h1>
          <p>
            {loaded
              ? `${visible.length} of ${cards.length} claims from ${loaded.source}`
              : error ? 'Claims could not be loaded' : 'Loading claims…'}
          </p>
        </div>
        <button type="button" className="claims-page-primary" onClick={() => onNavigate('ingest')}>
          Ingest claims
        </button>
      </header>

      {/* Filters and search stay in reach while the cards scroll under them. */}
      <div className="claims-page-controls">
        <div className="claims-page-filters" role="group" aria-label="Filter by status">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {key === 'all' ? 'All' : key}
              <span className="claims-page-count">{counts[key]}</span>
            </button>
          ))}
        </div>

        <div className="claims-page-toolbar">
          <label className="claims-page-search">
            <span className="visually-hidden">Search claims</span>
            <input
              type="search"
              placeholder="Search claim ID, patient, diagnosis or provider"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="claims-page-provider">
            <span className="visually-hidden">Provider</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">All providers</option>
              {providers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p className="claims-page-message" role="alert">{error}</p>
      ) : !loaded ? (
        <ShieldLoader label="Loading claims…" />
      ) : visible.length === 0 ? (
        <p className="claims-page-message">No claims match these filters.</p>
      ) : (
        <ClaimCardGrid>
          {visible.map((card) => (
            <ClaimCard key={card.claimId} claim={card} to={`/app/claims/${encodeURIComponent(card.claimId)}`} />
          ))}
        </ClaimCardGrid>
      )}
    </div>
  );
}
