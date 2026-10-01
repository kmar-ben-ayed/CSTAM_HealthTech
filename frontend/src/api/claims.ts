import { apiFetch } from './client';
import type { SentinelState } from '../components/Sentinel';

export type EvaluationStatus = 'PASS' | 'FAIL' | 'UNABLE_TO_ASSESS' | 'NOT_APPLICABLE' | 'NOT_IMPLEMENTED';

export interface BackendClaim {
  claim_id: string;
  member_id?: string;
  provider_id?: string;
  payer_id?: string;
  policy_id?: string;
  submission_date?: string;
  currency?: string;
  total_amount?: number;
  lines?: Array<{ line_id?: string; service_date?: string; net_amount?: number; service_code?: string; authorization_id?: string | null }>;
  [key: string]: unknown;
}

export type FhirPayload = Record<string, unknown>;

export interface RuleResult {
  rule_id: string;
  status: EvaluationStatus;
  severity?: string;
  requires_human_review?: boolean;
  [key: string]: unknown;
}

export interface DatasetResponse {
  dataset: string;
  name: string;
  claims: BackendClaim[];
  evaluations: Record<string, RuleResult[]>;
}

export interface ExplanationResponse {
  explanation: string;
  cited_evidence_paths: string[];
  cited_rule_ids: string[];
  needs_human_review: boolean;
  recommendation: string;
  provider: string;
  fallback_used: boolean;
}

export type ReviewAction = 'confirm_issue' | 'dismiss_with_reason' | 'request_information' | 'mark_corrected_for_recheck';

export interface ReviewResponse {
  audit_index: number;
  entry_hash: string;
}

export interface ClaimRow {
  id: string;
  provider: string;
  member: string;
  dos: string;
  findings: number;
  status: 'review' | 'pass' | 'fail' | 'uncertain';
  sentinel: SentinelState;
  amount: string;
  rule: string;
  updated: string;
}

export interface ReviewRule {
  id: string;
  name: string;
  status: EvaluationStatus;
  finding: string;
  evidence: ReviewEvidence[];
  evidencePaths: string[];
  observed?: string;
  expected?: string;
  aiExplanation: string;
  category: string;
}

export interface ReviewEvidence {
  path: string;
  value: unknown;
}

export async function getDataset(split = 'development', limit = 500, signal?: AbortSignal): Promise<DatasetResponse> {
  return apiFetch<DatasetResponse>(`/api/v1/datasets/${split}?limit=${limit}`, { signal });
}

export async function exportFhirPayload(claim: BackendClaim, signal?: AbortSignal): Promise<FhirPayload> {
  return apiFetch<FhirPayload>('/api/v1/fhir/export', {
    method: 'POST',
    body: JSON.stringify({ claim }),
    signal,
  });
}

export async function getExplanation(
  claim: BackendClaim,
  ruleId: string,
  provider: 'openai' | 'mock' = 'openai',
  signal?: AbortSignal,
): Promise<ExplanationResponse> {
  return apiFetch<ExplanationResponse>('/api/v1/explanations', {
    method: 'POST',
    body: JSON.stringify({ claim, rule_id: ruleId, provider }),
    signal,
  });
}

export async function postReview(
  claimId: string,
  ruleId: string,
  action: ReviewAction,
  reason: string,
  originalStatus: Exclude<EvaluationStatus, 'NOT_IMPLEMENTED'>,
  signal?: AbortSignal,
): Promise<ReviewResponse> {
  return apiFetch<ReviewResponse>('/api/v1/reviews', {
    method: 'POST',
    body: JSON.stringify({
      claim_id: claimId,
      rule_id: ruleId,
      action,
      actor: 'Aya Gaha',
      reason,
      created_at: new Date().toISOString(),
      original_status: originalStatus,
    }),
    signal,
  });
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatAmount(amount: number | undefined, currency = 'SAR'): string {
  if (amount === undefined) return '—';
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

function mapStatus(results: RuleResult[]): ClaimRow['status'] {
  if (results.some((result) => result.status === 'FAIL')) return 'fail';
  if (results.some((result) => result.status === 'UNABLE_TO_ASSESS')) return 'uncertain';
  if (results.some((result) => result.requires_human_review)) return 'review';
  return 'pass';
}

export function toClaimRow(claim: BackendClaim, results: RuleResult[] = []): ClaimRow {
  const status = mapStatus(results);
  const failedRules = results.filter((result) => result.status !== 'PASS' && result.status !== 'NOT_APPLICABLE');

  return {
    id: claim.claim_id,
    provider: claim.provider_id || 'Unknown provider',
    member: claim.member_id || (typeof claim.patient_id === 'string' ? claim.patient_id : 'Unknown member'),
    dos: formatDate(claim.lines?.[0]?.service_date),
    findings: failedRules.length,
    status,
    sentinel: status,
    amount: formatAmount(claim.total_amount, claim.currency),
    rule: failedRules.length ? failedRules.map((result) => result.rule_id).join(', ') : '—',
    updated: formatDate(claim.submission_date),
  };
}

export function datasetToClaimRows(dataset: DatasetResponse): ClaimRow[] {
  return dataset.claims.map((claim) => toClaimRow(claim, dataset.evaluations[claim.claim_id]));
}

export function evaluationToReviewRules(results: RuleResult[] = []): ReviewRule[] {
  return results.map((result) => {
    const evidence = Array.isArray(result.evidence)
      ? (result.evidence as Array<{ path?: string; value?: unknown }>)
        .filter((item): item is { path: string; value?: unknown } => typeof item?.path === 'string' && item.path.length > 0)
        .map((item) => ({ path: item.path, value: item.value }))
      : [];
    const explanation = typeof result.explanation === 'string' ? result.explanation : 'No explanation was returned for this result.';
    return {
      id: result.rule_id,
      name: `Rule ${result.rule_id}`,
      status: result.status,
      finding: explanation,
      evidence,
      evidencePaths: evidence.map((item) => item.path),
      observed: evidence.length ? JSON.stringify(evidence[0].value) : undefined,
      expected: typeof result.corrective_action === 'string' && result.corrective_action ? result.corrective_action : undefined,
      aiExplanation: explanation,
      category: result.severity || 'Validation',
    };
  });
}
