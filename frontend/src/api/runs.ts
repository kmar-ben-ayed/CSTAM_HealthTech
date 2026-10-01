import { apiFetch } from './client';
import type { DatasetSplit } from '../hooks/useOperationalData';

export interface BenchmarkMetrics {
  count: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  issue_precision: number | null;
  issue_recall: number | null;
  issue_f1: number | null;
  false_alarm_rate: number | null;
  status_accuracy: number;
  false_abstentions: number;
  missed_abstentions: number;
  not_implemented: number;
}

export interface DatasetRun {
  run_id: string;
  source: { type: 'dataset'; split: DatasetSplit; synthetic: true };
  status: 'completed';
  started_at: string;
  finished_at: string;
  claim_count: number;
  result_count: number;
  status_counts: Record<string, number>;
  rule_status_counts: Record<string, Record<string, number>>;
  benchmark: BenchmarkMetrics | null;
  benchmark_skipped_claims: number;
}

export interface RunsResponse {
  total_count: number;
  runs: DatasetRun[];
}

export function getRuns(limit = 100, signal?: AbortSignal): Promise<RunsResponse> {
  return apiFetch<RunsResponse>(`/api/v1/runs?limit=${limit}`, { signal });
}

export function getRun(runId: string, signal?: AbortSignal): Promise<DatasetRun> {
  return apiFetch<DatasetRun>(`/api/v1/runs/${encodeURIComponent(runId)}`, { signal });
}

export function createDatasetRun(split: DatasetSplit, signal?: AbortSignal): Promise<DatasetRun> {
  return apiFetch<DatasetRun>('/api/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ split }),
    signal,
  });
}
