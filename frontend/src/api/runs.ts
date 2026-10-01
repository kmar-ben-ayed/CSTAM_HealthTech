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
}

export function getIngestionRuns(signal?: AbortSignal): Promise<{ runs: IngestionRun[] }> {
  return apiFetch<{ runs: IngestionRun[] }>('/api/v1/runs', { signal });
}
