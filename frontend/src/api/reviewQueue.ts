import { ApiError } from './client';
import { getDataset, getIngestedClaims, type DatasetResponse, type RuleResult } from './claims';
import { listRules } from './rules';

// ── Review queue order ─────────────────────────────────────────────────────
// Which rules are active, and the order a reviewer works through waiting
// claims (most failed rules first, then most unassessable). Shared by the
// claim review page for previous/next navigation.

/** Results from rules that are no longer active don't count. Without a catalogue, keep everything. */
export function onlyActive(results: RuleResult[], active: Set<string>): RuleResult[] {
  return active.size ? results.filter((result) => active.has(result.rule_id)) : results;
}

export async function loadActiveRuleIds(signal?: AbortSignal): Promise<Set<string>> {
  const rules = await listRules(signal).catch(() => []);
  return new Set(rules.filter((rule) => rule.status === 'active').map((rule) => rule.rule_id));
}

let cached: { at: number; ids: string[] } | null = null;
const CACHE_MS = 30_000;

/** Claim IDs that still need a decision, most urgent first. */
export async function loadReviewQueue(signal?: AbortSignal): Promise<string[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ids;
  const [dataset, active] = await Promise.all([
    getIngestedClaims(undefined, signal).catch((cause: unknown): Promise<DatasetResponse> => {
      if (cause instanceof ApiError && cause.status === 404) return getDataset('development', 500, signal);
      throw cause;
    }),
    loadActiveRuleIds(signal),
  ]);
  const ranked = dataset.claims
    .map((claim) => {
      const results = onlyActive(dataset.evaluations[claim.claim_id] ?? [], active);
      const fail = results.filter((result) => result.status === 'FAIL').length;
      const unable = results.filter((result) => result.status === 'UNABLE_TO_ASSESS').length;
      const flagged = results.some((result) => result.requires_human_review);
      return { id: claim.claim_id, fail, unable, waiting: fail > 0 || unable > 0 || flagged };
    })
    .filter((claim) => claim.waiting)
    .sort((a, b) => b.fail * 100 + b.unable - (a.fail * 100 + a.unable));
  cached = { at: Date.now(), ids: ranked.map((claim) => claim.id) };
  return cached.ids;
}
