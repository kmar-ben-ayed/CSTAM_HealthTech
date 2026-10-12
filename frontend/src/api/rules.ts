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
  /** 'situation': what missing or unknown data gives, one outcome for several test claims (or "It depends").
   *  'choice': drafting stopped; use a draft that passed every check, keep drafting, or cancel. */
  kind: 'clarification' | 'case' | 'example' | 'situation' | 'choice';
  text: string;
  /** For a clarification, a situation or a choice: the answers to pick from, each complete on its own. */
  options?: string[];
  /** For a choice: what each option does, in the same order. */
  choice?: null | { action: 'use' | 'more' | 'examples' | 'cancel'; draft?: number }[];
  /** For a situation: the test claims one answer covers, and what the draft gives each. */
  situation?: null | {
    text: string;
    cases: { description: string; claim: Record<string, unknown>; drafted_rule_says: Outcome }[];
  };
  case: null | {
    description: string;
    claim: Record<string, unknown>;
    /** A disagreement with the independent reading (second model). */
    drafted_rule_says?: Outcome;
    independent_reading_says?: Outcome | null;
    independent_reading_reason?: string;
    /** A disagreement between independent drafts: outcome -> how many drafts give it. */
    drafts_say?: Partial<Record<Outcome, number>>;
    options: Outcome[];
  };
  answer: string | null;
  answered_by: string | null;
}

export interface CheckReport {
  passed: boolean;
  /** Every code check passed; only the independent reading (advice) may differ. */
  code_checks_passed?: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  readback: string;
  cases: {
    case_id: string;
    description: string;
    spec_status: string;
    oracle_status: string | null;
    oracle_reason: string;
    /** False when no second reading was made; oracle_status then holds the author's own verdict, if any. */
    oracle_used?: boolean;
  }[];
  disagreements: CheckReport['cases'];
  example_mismatches: string[];
  impact: { claims?: number; errors?: number; statuses?: Record<string, number> };
  /** Advice for the author, e.g. a value the rule names that the draft never uses. Never blocks. */
  notes?: string[];
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

/** The author's verdicts on test claims. Any change sends the draft back to the drafter. */
export const correctDraft = (draftId: string, corrections: { case_id: string; expected_status: Outcome }[]) =>
  post<Draft>(`/api/v1/rules/drafts/${draftId}/corrections`, { corrections });

export const cancelDraft = (draftId: string) => post<Draft>(`/api/v1/rules/drafts/${draftId}/cancel`);

export const deactivateRule = (ruleId: string) =>
  post<{ rule_id: string; status: string }>(`/api/v1/rules/${ruleId}/deactivate`);
