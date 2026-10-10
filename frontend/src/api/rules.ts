import { adminHeaders } from './admin';
import { apiFetch } from './client';

export type Outcome = 'PASS' | 'FAIL' | 'UNABLE_TO_ASSESS' | 'NOT_APPLICABLE';
export const OUTCOMES: Outcome[] = ['PASS', 'FAIL', 'UNABLE_TO_ASSESS', 'NOT_APPLICABLE'];

export type DraftState =
  | 'queued'
  | 'drafting'
  | 'checking'
  | 'awaiting_author'
  | 'awaiting_confirmation'
  | 'active'
  | 'rejected'
  | 'cancelled';

export const RUNNING_STATES: DraftState[] = ['queued', 'drafting', 'checking'];

export interface RuleSummary {
  rule_id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  version: string;
  logic: string;
  status: 'active' | 'inactive';
  inactive_reason: string | null;
  revision: number | null;
  origin: 'reference' | 'agent' | null;
  open_draft_id: string | null;
}

export interface RuleDetail {
  rule: { rule_id: string; title: string; severity: string; logic: string; corrective_action: string; version: string; source: string };
  active: null | {
    revision: number;
    origin: string;
    activated_at: string;
    activated_by: string;
    spec_sha256: string;
    readback: string;
    spec: unknown;
    provenance: Record<string, unknown>;
  };
  inactive_reason: string | null;
  history: { revision: number; origin: string; activated_at: string; activated_by: string; spec_sha256: string }[];
}

export interface RuleText {
  title: string;
  severity: 'low' | 'medium' | 'high';
  logic: string;
  corrective_action: string;
}

export interface Question {
  question_id: string;
  kind: 'clarification' | 'case';
  text: string;
  case: null | {
    description: string;
    claim: Record<string, unknown>;
    drafted_rule_says: Outcome;
    independent_reading_says: Outcome | null;
    independent_reading_reason: string;
    options: Outcome[];
  };
  answer: string | null;
  answered_by: string | null;
}

export interface CheckReport {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  readback: string;
  cases: { case_id: string; description: string; spec_status: string; oracle_status: string | null; oracle_reason: string }[];
  disagreements: CheckReport['cases'];
  example_mismatches: string[];
  impact: { claims?: number; errors?: number; statuses?: Record<string, number> };
}

export interface Draft {
  draft_id: string;
  rule_id: string;
  kind: 'new' | 'revision';
  rule: RuleText;
  author: string;
  state: DraftState;
  created_at: string;
  updated_at: string;
  rounds: number;
  questions: Question[];
  author_answers: { question: string; answer: string }[];
  examples: { description: string; expected_status: Outcome }[];
  proposal: null | { spec: unknown; intent: string; assumptions: string[] };
  report: CheckReport | null;
  outcome_reason: string;
  provenance: Record<string, unknown>;
  events: { at: string; event: string; detail: string }[];
}

const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: adminHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const listRules = (signal?: AbortSignal) =>
  apiFetch<{ rules: RuleSummary[] }>('/api/v1/rules', { signal }).then(response => response.rules);

export const getRule = (ruleId: string, signal?: AbortSignal) =>
  apiFetch<RuleDetail>(`/api/v1/rules/${ruleId}`, { signal });

export const getDraft = (draftId: string, signal?: AbortSignal) =>
  apiFetch<Draft>(`/api/v1/rules/drafts/${draftId}`, { signal, headers: adminHeaders() });

export const submitDraft = (rule: RuleText, ruleId?: string) =>
  post<Draft>('/api/v1/rules/drafts', ruleId ? { ...rule, rule_id: ruleId } : rule);

export const answerQuestion = (draftId: string, questionId: string, answer: string) =>
  post<Draft>(`/api/v1/rules/drafts/${draftId}/answers`, { question_id: questionId, answer });

export const confirmDraft = (draftId: string) => post<Draft>(`/api/v1/rules/drafts/${draftId}/confirm`);

export const cancelDraft = (draftId: string) => post<Draft>(`/api/v1/rules/drafts/${draftId}/cancel`);

export const deactivateRule = (ruleId: string) =>
  post<{ rule_id: string; status: string }>(`/api/v1/rules/${ruleId}/deactivate`);
