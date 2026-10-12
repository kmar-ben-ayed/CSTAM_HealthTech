import { getAuditEvents } from './audit';
import { getConfig, type ConfigProvider, type ConfigServices } from './config';
import type { BackendClaim, RuleResult } from './claims';

// ── Claim card data ────────────────────────────────────────────────────────
// Everything a ClaimCard shows, derived from the claim, its rule results,
// the reference files and the audit log. Nothing is invented: a value the
// data does not have is shown as missing.

export type CardRuleResult = 'FAIL' | 'UNABLE' | 'REVIEW' | 'PASS' | 'NA';
export type ClaimStatus = 'Passed' | 'Failed' | 'Needs review' | 'Unable to assess';

export interface CardFinding {
  ruleId: string;
  text: string;
  result: CardRuleResult;
}

export interface ClaimCardData {
  claimId: string;
  patientId: string;
  providerId: string;
  providerName: string;
  service: string;
  serviceCode: string;
  serviceDate: string;
  diagnosis: string;
  status: ClaimStatus;
  /** Last person who recorded a review action on this claim, if anyone did. */
  reviewer: string | null;
  /** When the claim last changed: the latest audit event, else its submission. */
  updatedLabel: string;
  /** Every non-passing result, most severe first. Cards show the first three. */
  findings: CardFinding[];
  failedCount: number;
}

/** Reference data shared by every card on a page. */
export interface CardContext {
  providerNames: Map<string, string>;
  serviceNames: Map<string, string>;
  reviewers: Map<string, string>;
  lastActivity: Map<string, Date>;
}

// Severity rank used when sorting findings (most severe first).
export const RESULT_RANK: Record<CardRuleResult, number> = { FAIL: 0, UNABLE: 1, REVIEW: 2, PASS: 3, NA: 4 };

export function cardResult(result: RuleResult): CardRuleResult {
  if (result.status === 'FAIL') return 'FAIL';
  if (result.status === 'UNABLE_TO_ASSESS') return 'UNABLE';
  if (result.requires_human_review) return 'REVIEW';
  if (result.status === 'PASS') return 'PASS';
  return 'NA';
}

export function claimStatus(results: RuleResult[]): ClaimStatus {
  const outcomes = results.map(cardResult);
  if (outcomes.includes('FAIL')) return 'Failed';
  if (outcomes.includes('UNABLE')) return 'Unable to assess';
  if (outcomes.includes('REVIEW')) return 'Needs review';
  return 'Passed';
}

/**
 * Loads provider names, service descriptions and review history. Each source
 * is optional: if one cannot be loaded the cards fall back to the raw IDs.
 */
export async function loadCardContext(signal?: AbortSignal): Promise<CardContext> {
  const [providers, services, audit] = await Promise.all([
    getConfig<ConfigProvider[]>('providers.json', signal).catch(() => []),
    getConfig<ConfigServices>('services.json', signal).catch(() => ({} as ConfigServices)),
    getAuditEvents(500, signal).catch(() => ({ total_count: 0, events: [] })),
  ]);

  // Keep the latest event per claim, whatever order the log returns them in.
  const reviewers = new Map<string, string>();
  const lastActivity = new Map<string, Date>();
  const lastReview = new Map<string, number>();
  for (const event of audit.events) {
    if (!event.claim_id) continue;
    const at = new Date(event.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    if (at > (lastActivity.get(event.claim_id) ?? new Date(0))) lastActivity.set(event.claim_id, at);
    if (event.event_type === 'human_decision' && at.getTime() > (lastReview.get(event.claim_id) ?? 0)) {
      lastReview.set(event.claim_id, at.getTime());
      reviewers.set(event.claim_id, event.actor);
    }
  }

  return {
    providerNames: new Map(providers.map((provider) => [provider.provider_id, provider.display])),
    serviceNames: new Map(Object.entries(services).map(([code, service]) => [code, service.description])),
    reviewers,
    lastActivity,
  };
}

export function toClaimCardData(claim: BackendClaim, results: RuleResult[], context: CardContext): ClaimCardData {
  const firstLine = Array.isArray(claim.lines) ? claim.lines[0] : undefined;
  const serviceCode = firstLine?.service_code || '';
  const reviewer = context.reviewers.get(claim.claim_id);
  const findings = results
    .map((result) => ({
      ruleId: result.rule_id,
      text: typeof result.explanation === 'string' ? result.explanation : '',
      result: cardResult(result),
    }))
    .filter((finding) => finding.result !== 'PASS' && finding.result !== 'NA')
    .sort((a, b) => RESULT_RANK[a.result] - RESULT_RANK[b.result]);

  return {
    claimId: claim.claim_id,
    patientId: claim.patient_id || '—',
    providerId: claim.provider_id || '—',
    providerName: context.providerNames.get(claim.provider_id || '') || claim.provider_id || 'Unknown provider',
    service: context.serviceNames.get(serviceCode) || 'Service not on file',
    serviceCode: serviceCode || '—',
    serviceDate: firstLine?.service_date || '—',
    diagnosis: claim.diagnosis_code || '—',
    status: claimStatus(results),
    reviewer: reviewer ? displayName(reviewer) : null,
    updatedLabel: updatedLabel(context.lastActivity.get(claim.claim_id), claim.submission_date),
    findings,
    failedCount: results.filter((result) => result.status === 'FAIL').length,
  };
}

// Service actors recorded in the audit log.
const SERVICE_ACTORS: Record<string, string> = { ai: 'AI', system: 'System' };

function signedInActor(): string {
  try {
    return sessionStorage.getItem('claimguard-demo-actor') || '';
  } catch {
    return '';
  }
}

/**
 * A person's name from a sign-in like "marwen.agrebi@org" ("Marwen A."), or
 * null when the sign-in is a handle ("user2007") that should not be shown.
 */
export function personName(actor: string): string | null {
  const words = actor.split('@')[0].split(/[._\-\s]+/).filter(Boolean);
  if (words.length < 2 || words.some((word) => /\d/.test(word))) return null;
  const first = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  return `${first} ${words[1].charAt(0).toUpperCase()}.`;
}

/** How an audit actor is shown: "You", a service, a person's name, or "A reviewer". Never a raw handle. */
export function displayName(actor: string): string {
  const service = SERVICE_ACTORS[actor.toLowerCase()];
  if (service) return service;
  if (actor && actor === signedInActor()) return 'You';
  return personName(actor) ?? 'A reviewer';
}

function updatedLabel(lastActivity: Date | undefined, submissionDate?: string): string {
  if (lastActivity) return `Updated ${timeAgo(lastActivity)}`;
  return submissionDate ? `Submitted ${submissionDate}` : 'Submission date unknown';
}

export function timeAgo(date: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
