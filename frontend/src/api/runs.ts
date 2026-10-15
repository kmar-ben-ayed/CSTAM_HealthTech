import { apiFetch } from './client';

export interface IngestionRun {
  run_id: string;
  source: 'JSONL' | 'CSV' | 'FHIR' | string;
  accepted_claims: number;
  rejected_records: number;
  total_records: number;
  status: 'completed' | string;
  status_counts?: Record<string, number>;
  rule_counts?: Record<string, Record<string, number>>;
  /** Position in time, 1 = the first run. The API lists runs newest first. */
  sequence?: number;
  /** Rejected records by reason, e.g. { ENVELOPE_INVALID: 150 }. */
  rejected_reasons?: Record<string, number>;
  /** Results per rule whose status is outside the contract (e.g. lowercase "fail"). */
  invalid_results?: Record<string, number>;
}

/** Oldest run first, by sequence when the API provides it (it lists newest first). */
export function chronological(runs: IngestionRun[]): IngestionRun[] {
  return runs.every((run) => typeof run.sequence === 'number')
    ? [...runs].sort((a, b) => a.sequence! - b.sequence!)
    : [...runs].reverse();
}

export function getIngestionRuns(signal?: AbortSignal): Promise<{ runs: IngestionRun[] }> {
  return apiFetch<{ runs: IngestionRun[] }>('/api/v1/runs', { signal });
}
