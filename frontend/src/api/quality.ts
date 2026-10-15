import { apiFetch } from './client';

/** Scores for one group of (claim, rule) results; a FAIL is the positive class. */
export interface QualityMetrics {
  count: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  issue_precision: number | null;
  issue_recall: number | null;
  issue_f1: number | null;
  false_alarm_rate: number | null;
  status_accuracy: number | null;
  false_abstentions: number;
  missed_abstentions: number;
  missing_predictions: number;
}

export interface QualityReport {
  dataset: string;
  claims: number;
  overall: QualityMetrics;
  by_rule: Record<string, QualityMetrics>;
  confusion: Array<{ expected: string; predicted: string; count: number }>;
  /** Active rules the ground truth has no labels for. */
  unscored_rules: string[];
  note: string;
}

/** The current engine scored live against a dataset's expected results. */
export function getQuality(split = 'development', signal?: AbortSignal): Promise<QualityReport> {
  return apiFetch<QualityReport>(`/api/v1/quality/${encodeURIComponent(split)}`, { signal });
}
