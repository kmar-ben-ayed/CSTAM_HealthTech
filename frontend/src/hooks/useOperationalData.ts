import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import {
  getDataset,
  getIngestedClaims,
  toClaimRow,
  type BackendClaim,
  type DatasetResponse,
  type RuleResult,
} from '../api/claims';

export const DATASET_SPLITS = ['development', 'validation', 'stress'] as const;
export type DatasetSplit = typeof DATASET_SPLITS[number];
export type DataSource = 'all' | DatasetSplit | 'ingested';

export interface OperationalClaim {
  claim: BackendClaim;
  results: RuleResult[];
  row: ReturnType<typeof toClaimRow>;
  source: DatasetSplit | 'ingested';
}

interface OperationalSnapshot {
  records: OperationalClaim[];
  counts: Record<DataSource, number>;
  loading: boolean;
  error: string | null;
}

const SOURCE_CHANGE_EVENT = 'claimguard-source-change';

function readSource(): DataSource {
  const stored = sessionStorage.getItem('claimguard-data-source');
  return stored === 'development' || stored === 'validation' || stored === 'stress' || stored === 'ingested'
    ? stored
    : 'all';
}

async function loadDataset(split: DatasetSplit): Promise<OperationalClaim[]> {
  const dataset: DatasetResponse = await getDataset(split, 500);
  return dataset.claims.map((claim) => ({
    claim,
    results: dataset.evaluations[claim.claim_id] || [],
    row: toClaimRow(claim, dataset.evaluations[claim.claim_id] || []),
    source: split,
  }));
}

export function useOperationalData() {
  const [source, setSourceState] = useState<DataSource>(readSource);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<OperationalSnapshot>({
    records: [],
    counts: { all: 0, development: 0, validation: 0, stress: 0, ingested: 0 },
    loading: true,
    error: null,
  });

  useEffect(() => {
    const syncSource = () => setSourceState(readSource());
    window.addEventListener(SOURCE_CHANGE_EVENT, syncSource);
    return () => window.removeEventListener(SOURCE_CHANGE_EVENT, syncSource);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot((current) => ({ ...current, loading: true, error: null }));

    Promise.all([
      ...DATASET_SPLITS.map((split) => getDataset(split, 500, controller.signal)),
      getIngestedClaims(500, controller.signal).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    ])
      .then((loaded) => {
        const datasets = loaded.slice(0, DATASET_SPLITS.length) as DatasetResponse[];
        const ingested = loaded[DATASET_SPLITS.length] as Awaited<ReturnType<typeof getIngestedClaims>> | null;
        const bySource = Object.fromEntries(DATASET_SPLITS.map((split, index) => [
          split,
          datasets[index].claims.map((claim) => {
            const results = datasets[index].evaluations[claim.claim_id] || [];
            return { claim, results, row: toClaimRow(claim, results), source: split } satisfies OperationalClaim;
          }),
        ])) as Record<DataSource, OperationalClaim[]>;
        bySource.ingested = ingested
          ? ingested.claims.map((claim) => {
              const results = ingested.evaluations[claim.claim_id] || [];
              return { claim, results, row: toClaimRow(claim, results), source: 'ingested' } satisfies OperationalClaim;
            })
          : [];
        const counts = {
          all: DATASET_SPLITS.reduce((sum, split) => sum + bySource[split].length, 0),
          development: bySource.development.length,
          validation: bySource.validation.length,
          stress: bySource.stress.length,
          ingested: bySource.ingested.length,
        };
        const records = source === 'all'
          ? DATASET_SPLITS.flatMap((split) => bySource[split])
          : bySource[source];
        setSnapshot({ records, counts, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSnapshot((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'The claims service is unavailable.',
        }));
      });

    return () => controller.abort();
  }, [source, revision]);

  const setSource = (nextSource: DataSource) => {
    sessionStorage.setItem('claimguard-data-source', nextSource);
    setSourceState(nextSource);
    window.dispatchEvent(new Event(SOURCE_CHANGE_EVENT));
  };

  return {
    ...snapshot,
    source,
    setSource,
    refresh: () => setRevision((value) => value + 1),
    sourceLabel: source === 'all'
      ? 'All synthetic datasets'
      : source === 'ingested'
        ? 'Latest ingested batch'
        : `${source[0].toUpperCase()}${source.slice(1)} synthetic dataset`,
  };
}
