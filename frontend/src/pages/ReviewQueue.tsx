import { useEffect, useMemo, useState } from 'react';
import ShieldLoader from '../components/ShieldLoader';
import { ApiError } from '../api/client';
import { getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { getDataset, getIngestedClaims, type DatasetResponse } from '../api/claims';
import { displayName, loadCardContext, timeAgo, toClaimCardData } from '../api/claimCards';
import { onlyActive } from '../api/reviewQueue';
import { listRules } from '../api/rules';
import '../styles/review-queue.css';

// ── Review queue ───────────────────────────────────────────────────────────
// Claims that need a reviewer, from the ingested claims (active rules only).
// Where each claim stands comes from the audit trail: the latest action on
// each of its rules, and any decision on the claim as a whole.

interface ReviewQueueProps {
  onNavigate: (page: string, claimId?: string) => void;
}

type Stage = 'not-started' | 'in-progress' | 'waiting' | 'recheck' | 'decided';
type Tab = 'open' | 'waiting' | 'recheck' | 'decided';
type Sort = 'priority' | 'oldest' | 'recent';
type Priority = 'High' | 'Medium' | 'Low';

interface QueueItem {
  claimId: string;
  provider: string;
  submitted: string;
  fail: number;
  unable: number;
  priority: Priority;
  topFinding: { ruleId: string; title: string } | null;
  stage: Stage;
  decision: 'approved' | 'rejected' | null;
  lastEvent: BackendAuditEvent | null;
}

const PAGE_SIZE = 25;

const STAGE_LABEL: Record<Stage, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  waiting: 'Waiting for info',
  recheck: 'Ready for re-check',
  decided: 'Decided',
};

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting for info' },
  { key: 'recheck', label: 'Ready for re-check' },
  { key: 'decided', label: 'Decided' },
];

const ACTION_VERB: Record<string, string> = {
  confirm_issue: 'confirmed',
  dismiss_with_reason: 'dismissed',
  request_information: 'requested information on',
  mark_corrected_for_recheck: 'marked corrected',
};

async function loadQueue(signal: AbortSignal): Promise<QueueItem[]> {
  const [dataset, context, rules, audit] = await Promise.all([
    getIngestedClaims(undefined, signal).catch((cause: unknown): Promise<DatasetResponse> => {
      if (cause instanceof ApiError && cause.status === 404) return getDataset('development', 500, signal);
      throw cause;
    }),
    loadCardContext(signal),
    listRules(signal).catch(() => []),
    getAuditEvents(500, signal).catch(() => ({ total_count: 0, events: [] })),
  ]);
  const active = new Set(rules.filter((rule) => rule.status === 'active').map((rule) => rule.rule_id));
  const titles = new Map(rules.map((rule) => [rule.rule_id, rule.title]));

  // Oldest first, so the last write wins for each rule and each claim.
  const events = audit.events
    .filter((event) => event.event_type === 'human_decision' || event.event_type === 'claim_decision')
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const ruleActions = new Map<string, Map<string, string>>();
  const decisions = new Map<string, 'approved' | 'rejected'>();
  const lastEvent = new Map<string, BackendAuditEvent>();
  for (const event of events) {
    if (!event.claim_id) continue;
    lastEvent.set(event.claim_id, event);
    if (event.event_type === 'human_decision') {
      const actions = ruleActions.get(event.claim_id) ?? new Map<string, string>();
      actions.set(String(event.payload.rule_id), String(event.payload.action));
      ruleActions.set(event.claim_id, actions);
    } else if (event.payload.decision === 'reopen') {
      decisions.delete(event.claim_id);
    } else {
      decisions.set(event.claim_id, event.payload.decision === 'approve' ? 'approved' : 'rejected');
    }
  }

  return dataset.claims.flatMap((claim) => {
    const results = onlyActive(dataset.evaluations[claim.claim_id] ?? [], active);
    const card = toClaimCardData(claim, results, context);
    if (card.status === 'Passed') return [];
    const unable = results.filter((result) => result.status === 'UNABLE_TO_ASSESS').length;
    const top = card.findings[0];
    const actions = [...(ruleActions.get(claim.claim_id)?.values() ?? [])];
    const decision = decisions.get(claim.claim_id) ?? null;
    const stage: Stage = decision
      ? 'decided'
      : actions.includes('request_information')
        ? 'waiting'
        : actions.includes('mark_corrected_for_recheck')
          ? 'recheck'
          : actions.length
            ? 'in-progress'
            : 'not-started';
    return [{
      claimId: claim.claim_id,
      provider: card.providerName,
      submitted: claim.submission_date ?? '',
      fail: card.failedCount,
      unable,
      priority: card.failedCount >= 3 ? 'High' : card.failedCount > 0 ? 'Medium' : 'Low',
      topFinding: top ? { ruleId: top.ruleId, title: titles.get(top.ruleId) ?? top.text } : null,
      stage,
      decision,
      lastEvent: lastEvent.get(claim.claim_id) ?? null,
    }];
  });
}

function lastActionText(event: BackendAuditEvent | null): string {
  if (!event) return 'No action yet';
  const who = displayName(event.actor);
  if (event.event_type === 'claim_decision') {
    const decision = String(event.payload.decision);
    return `${who} ${decision === 'approve' ? 'approved the claim' : decision === 'reject' ? 'rejected the claim' : 'reopened the claim'}`;
  }
  return `${who} ${ACTION_VERB[String(event.payload.action)] ?? 'reviewed'} ${String(event.payload.rule_id ?? '')}`.trim();
}

const formatDate = (date: string) =>
  date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function ReviewQueue({ onNavigate }: ReviewQueueProps) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [sort, setSort] = useState<Sort>('priority');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadQueue(controller.signal)
      .then(setItems)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('The review queue could not be loaded.');
      });
    return () => controller.abort();
  }, []);

  // Any change to what is shown starts again at the first page.
  useEffect(() => setPage(0), [tab, sort, query]);

  const counts = useMemo(() => {
    const all = items ?? [];
    return {
      open: all.filter((item) => item.stage !== 'decided').length,
      waiting: all.filter((item) => item.stage === 'waiting').length,
      recheck: all.filter((item) => item.stage === 'recheck').length,
      decided: all.filter((item) => item.stage === 'decided').length,
      high: all.filter((item) => item.stage !== 'decided' && item.priority === 'High').length,
      started: all.filter((item) => item.stage !== 'decided' && item.stage !== 'not-started').length,
    };
  }, [items]);

  const shown = useMemo(() => {
    if (!items) return [];
    const needle = query.trim().toLowerCase();
    const inTab = items.filter((item) =>
      tab === 'open' ? item.stage !== 'decided' : tab === 'decided' ? item.stage === 'decided' : item.stage === tab);
    const matching = needle
      ? inTab.filter((item) => item.claimId.toLowerCase().includes(needle) || item.provider.toLowerCase().includes(needle))
      : inTab;
    const lastAt = (item: QueueItem) => (item.lastEvent ? Date.parse(item.lastEvent.timestamp) : 0);
    return [...matching].sort((a, b) =>
      sort === 'oldest'
        ? a.submitted.localeCompare(b.submitted) || b.fail - a.fail
        : sort === 'recent'
          ? lastAt(b) - lastAt(a) || b.fail - a.fail
          : b.fail * 100 + b.unable - (a.fail * 100 + a.unable) || a.submitted.localeCompare(b.submitted));
  }, [items, tab, sort, query]);

  if (error) {
    return (
      <div className="page-shell rq-page">
        <h1>Review queue</h1>
        <p className="rq-error" role="alert">{error}</p>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="page-shell rq-page">
        <ShieldLoader label="Building the review queue…" />
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const open = (claimId: string) => onNavigate('claim-review', claimId);

  return (
    <div className="page-shell rq-page">
      <header className="rq-head">
        <div>
          <h1>Review queue</h1>
          <p>
            {counts.open === 0
              ? 'No claims are waiting for a decision.'
              : `${counts.open.toLocaleString('en')} claim${counts.open === 1 ? '' : 's'} waiting for a decision, most failed rules first.`}
          </p>
        </div>
        {counts.open > 0 && (
          <button
            type="button"
            className="rq-primary"
            onClick={() => {
              // Always the most urgent open claim, whatever tab or sort is showing.
              const next = items
                .filter((item) => item.stage !== 'decided')
                .sort((a, b) => b.fail * 100 + b.unable - (a.fail * 100 + a.unable))[0];
              if (next) open(next.claimId);
            }}
          >
            Start reviewing
          </button>
        )}
      </header>

      <dl className="rq-summary">
        <div><dt>High priority</dt><dd className="is-fail">{counts.high.toLocaleString('en')}</dd><span>3 or more failed rules</span></div>
        <div><dt>Started</dt><dd>{counts.started.toLocaleString('en')}</dd><span>At least one rule reviewed</span></div>
        <div><dt>Waiting for info</dt><dd className="is-unable">{counts.waiting.toLocaleString('en')}</dd><span>Information requested</span></div>
        <div><dt>Decided</dt><dd className="is-pass">{counts.decided.toLocaleString('en')}</dd><span>Approved or rejected</span></div>
      </dl>

      <div className="rq-toolbar">
        <div className="rq-tabs" role="group" aria-label="Queue view">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              className="rq-tab"
              onClick={() => setTab(key)}
            >
              {label} <span className="rq-tab-count">{counts[key].toLocaleString('en')}</span>
            </button>
          ))}
        </div>
        <div className="rq-tools">
          <label className="rq-search">
            <span className="visually-hidden">Search by claim ID or provider</span>
            <input type="search" placeholder="Claim ID or provider" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="rq-sort">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="priority">Most failed rules</option>
              <option value="oldest">Oldest submission</option>
              <option value="recent">Recently worked on</option>
            </select>
          </label>
        </div>
      </div>

      <section className="rq-card" aria-label="Claims">
        {rows.length === 0 ? (
          <p className="rq-empty">
            {query
              ? 'No claims match this search.'
              : tab === 'open'
                ? 'Every claim has a decision. Nothing is waiting.'
                : tab === 'waiting'
                  ? 'No claim is waiting for information.'
                  : tab === 'recheck'
                    ? 'No claim is ready for a re-check.'
                    : 'No claim has been approved or rejected yet.'}
          </p>
        ) : (
          <div className="rq-scroll">
            <table className="rq-table">
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Findings</th>
                  <th scope="col">Top finding</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Last action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.claimId} onClick={() => open(item.claimId)}>
                    <th scope="row">
                      {/* The row is clickable for the mouse; this button is the keyboard and screen-reader target. */}
                      <button type="button" className="rq-claim" onClick={(event) => { event.stopPropagation(); open(item.claimId); }}>
                        {item.claimId}
                      </button>
                      <span className={`rq-priority is-${item.priority.toLowerCase()}`}>{item.priority}</span>
                    </th>
                    <td className="rq-provider">{item.provider}</td>
                    <td className="rq-findings">
                      {item.fail > 0 && <span className="is-fail">{item.fail} failed</span>}
                      {item.fail > 0 && item.unable > 0 && ' · '}
                      {item.unable > 0 && <span className="is-unable">{item.unable} unable</span>}
                      {item.fail === 0 && item.unable === 0 && <span>Flagged for review</span>}
                    </td>
                    <td className="rq-top">
                      {item.topFinding ? (
                        <><span className="rq-rule">{item.topFinding.ruleId}</span> {item.topFinding.title}</>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`rq-stage is-${item.stage}`}>
                        {item.decision ? `Claim ${item.decision}` : STAGE_LABEL[item.stage]}
                      </span>
                    </td>
                    <td className="rq-date">{formatDate(item.submitted)}</td>
                    <td className="rq-last">
                      {lastActionText(item.lastEvent)}
                      {item.lastEvent && <span>{timeAgo(new Date(item.lastEvent.timestamp))}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {shown.length > 0 && (
          <footer className="rq-foot">
            <span>
              {(current * PAGE_SIZE + 1).toLocaleString('en')}–{Math.min(shown.length, (current + 1) * PAGE_SIZE).toLocaleString('en')} of {shown.length.toLocaleString('en')}
            </span>
            {pages > 1 && (
              <div className="rq-pager">
                <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
                <span aria-live="polite">Page {current + 1} of {pages}</span>
                <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
              </div>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
