import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import StatusShield, { SHIELD_FOR_STATUS, type ShieldState } from '../components/StatusShield';
import { ApiError } from '../api/client';
import { describeAuditEvent, getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { getDataset, getIngestedClaims, type DatasetResponse, type RuleResult } from '../api/claims';
import { displayName, loadCardContext, personName, timeAgo, toClaimCardData, type ClaimCardData } from '../api/claimCards';
import { listRules } from '../api/rules';
import { getIngestionRuns, type IngestionRun } from '../api/runs';
import '../styles/dashboard.css';

// ── Overview ───────────────────────────────────────────────────────────────
// What needs a decision today, read from the ingested claims, the latest
// ingestion run, the rule catalogue and the audit log. Every number on the
// page is counted from that data.

interface DashboardProps {
  onNavigate: (page: string, claimId?: string) => void;
}

interface Overview {
  cards: ClaimCardData[];
  results: RuleResult[];
  ruleTitles: Map<string, string>;
  latestRun: IngestionRun | null;
  activity: BackendAuditEvent[];
}

const OUTCOMES = [
  { status: 'PASS', label: 'Pass', className: 'is-pass' },
  { status: 'FAIL', label: 'Fail', className: 'is-fail' },
  { status: 'UNABLE_TO_ASSESS', label: 'Unable', className: 'is-unable' },
  { status: 'NOT_APPLICABLE', label: 'N/A', className: 'is-na' },
  { status: 'NOT_IMPLEMENTED', label: 'Not run', className: 'is-other' },
] as const;

async function loadOverview(signal: AbortSignal): Promise<Overview> {
  const [dataset, context, rules, runs, audit] = await Promise.all([
    getIngestedClaims(undefined, signal).catch((cause: unknown): Promise<DatasetResponse> => {
      if (cause instanceof ApiError && cause.status === 404) return getDataset('development', 500, signal);
      throw cause;
    }),
    loadCardContext(signal),
    listRules(signal).catch(() => []),
    getIngestionRuns(signal).then((response) => response.runs).catch(() => []),
    getAuditEvents(200, signal).then((response) => response.events).catch(() => []),
  ]);
  return {
    cards: dataset.claims.map((claim) => toClaimCardData(claim, dataset.evaluations[claim.claim_id] ?? [], context)),
    results: Object.values(dataset.evaluations).flat(),
    ruleTitles: new Map(rules.map((rule) => [rule.rule_id, rule.title])),
    latestRun: runs.length ? runs[runs.length - 1] : null,
    activity: audit
      .filter((event) => event.event_type !== 'rule_execution')
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 6),
  };
}

// "Marwen A. confirmed the issue on R004", read as a sentence after the actor.
function activityVerb(event: BackendAuditEvent): string {
  const rule = typeof event.payload.rule_id === 'string' ? event.payload.rule_id : '';
  const on = rule ? ` ${rule}` : '';
  if (event.event_type === 'human_decision') {
    const verbs: Record<string, string> = {
      confirm_issue: 'confirmed',
      dismiss_with_reason: 'dismissed',
      request_information: 'requested information on',
      mark_corrected_for_recheck: 'marked corrected',
    };
    return `${verbs[String(event.payload.action)] ?? 'reviewed'}${on}`;
  }
  if (event.event_type === 'ai_decision') return `explained${on}`;
  return describeAuditEvent(event).toLowerCase();
}

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// Most urgent first: more failed rules, then more unassessable ones.
function priority(card: ClaimCardData): number {
  const unable = card.findings.filter((finding) => finding.result === 'UNABLE').length;
  return card.failedCount * 100 + unable;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const actor = sessionStorage.getItem('claimguard-demo-actor') || '';
  const firstName = personName(actor)?.split(' ')[0] ?? '';

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(controller.signal)
      .then(setOverview)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('The overview could not be loaded.');
      });
    return () => controller.abort();
  }, []);

  const stats = useMemo(() => {
    if (!overview) return null;
    const { cards, results } = overview;
    const counts: Record<string, number> = {};
    const failsByRule = new Map<string, number>();
    for (const result of results) {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      if (result.status === 'FAIL') failsByRule.set(result.rule_id, (failsByRule.get(result.rule_id) ?? 0) + 1);
    }
    const allRules = new Set(results.map((result) => result.rule_id));
    return {
      counts,
      totalResults: results.length,
      needDecision: cards.filter((card) => card.status !== 'Passed').length,
      unable: cards.filter((card) => card.status === 'Unable to assess').length,
      failedClaims: cards.filter((card) => card.status === 'Failed').length,
      rulesWithFails: failsByRule.size,
      ruleCount: allRules.size,
      hotspots: [...failsByRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      priority: [...cards].filter((card) => card.status !== 'Passed').sort((a, b) => priority(b) - priority(a)).slice(0, 6),
    };
  }, [overview]);

  // The header shield shows the queue: waiting on a reviewer, clear, or still loading.
  const queueState: ShieldState = !stats ? 'scanning' : stats.needDecision > 0 ? 'review' : 'pass';

  return (
    <div className="ov-page">
      <header className="ov-header">
        <StatusShield state={queueState} size={76} label={stats ? (stats.needDecision ? 'Claims are waiting on a reviewer' : 'No claims waiting') : 'Loading'} />
        <div className="ov-header-text">
          <h1>{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="ov-lede">
            <span className="ov-date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            {stats
              ? stats.needDecision
                ? `${stats.needDecision} claim${stats.needDecision === 1 ? '' : 's'} need a decision.`
                : 'Every claim passed. Nothing is waiting on you.'
              : error ?? 'Reading the latest claims…'}
          </p>
        </div>
        <div className="ov-actions">
          <button type="button" className="ov-button" onClick={() => onNavigate('ingest')}>Ingest data</button>
          <button type="button" className="ov-button is-primary" onClick={() => onNavigate('review-queue')}>Open review queue</button>
        </div>
      </header>

      {stats && overview && (
        <>
          {/* The day in four figures, as a ledger rather than boxed tiles. */}
          <dl className="ov-ledger">
            <div>
              <dt>Claims processed</dt>
              <dd>{overview.cards.length.toLocaleString('en')}</dd>
              <span>{overview.latestRun ? `${overview.latestRun.source} batch ${overview.latestRun.run_id.slice(0, 8)}` : 'Development dataset'}</span>
            </div>
            <div>
              <dt>Need a decision</dt>
              <dd>{stats.needDecision.toLocaleString('en')}</dd>
              <span>{stats.failedClaims} failed, the rest uncertain</span>
            </div>
            <div>
              <dt>Unable to assess</dt>
              <dd className="is-unable">{stats.unable.toLocaleString('en')}</dd>
              <span>Missing evidence on the claim</span>
            </div>
            <div>
              <dt>Issues detected</dt>
              <dd className="is-fail">{(stats.counts.FAIL ?? 0).toLocaleString('en')}</dd>
              <span>Across {stats.rulesWithFails} of {stats.ruleCount} rules</span>
            </div>
          </dl>

          <section className="ov-panel" aria-labelledby="ov-priority">
            <div className="ov-panel-head">
              <div>
                <h2 id="ov-priority">Priority review</h2>
                <p>Most failed rules first</p>
              </div>
              <Link to="/app/claims" className="ov-link">View all claims</Link>
            </div>
            {stats.priority.length === 0 ? (
              <p className="ov-empty">No claims need a decision.</p>
            ) : (
              <table className="ov-table">
                <thead>
                  <tr>
                    <th scope="col">Claim</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Service date</th>
                    <th scope="col">Findings</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.priority.map((card) => {
                    const unable = card.findings.filter((finding) => finding.result === 'UNABLE').length;
                    return (
                      <tr key={card.claimId}>
                        <td>
                          <span className="ov-claim">
                            <StatusShield state={SHIELD_FOR_STATUS[card.status]} size={30} animated={false} />
                            <span className="mono">{card.claimId}</span>
                          </span>
                        </td>
                        <td>{card.providerName}</td>
                        <td className="mono">{card.serviceDate}</td>
                        <td>
                          <span className="is-fail-text">{card.failedCount}</span> fail · <span className="is-unable-text">{unable}</span> unable
                        </td>
                        <td><span className={`ov-status ${SHIELD_FOR_STATUS[card.status]}`}>{card.status}</span></td>
                        <td className="ov-cell-action">
                          <Link to={`/app/claims/${encodeURIComponent(card.claimId)}`} className="ov-button is-small">Review</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <div className="ov-columns">
            <section className="ov-panel" aria-labelledby="ov-evaluation">
              <div className="ov-panel-head">
                <h2 id="ov-evaluation">Latest evaluation</h2>
              </div>
              {overview.latestRun ? (
                <dl className="ov-facts">
                  <div><dt>Run</dt><dd className="mono">{overview.latestRun.run_id.slice(0, 12)}</dd></div>
                  <div><dt>Source</dt><dd>{overview.latestRun.source}</dd></div>
                  <div><dt>Accepted</dt><dd className="mono">{overview.latestRun.accepted_claims}</dd></div>
                  <div><dt>Rejected</dt><dd className="mono">{overview.latestRun.rejected_records}</dd></div>
                </dl>
              ) : (
                <p className="ov-empty">No ingestion run yet; showing the development dataset.</p>
              )}
              <div className="ov-distribution">
                <div className="ov-distribution-label">Rule outcomes · {stats.totalResults.toLocaleString('en')} results</div>
                <div className="ov-bar" role="img" aria-label={OUTCOMES.map((o) => `${o.label} ${stats.counts[o.status] ?? 0}`).join(', ')}>
                  {OUTCOMES.map((outcome) => {
                    const share = (stats.counts[outcome.status] ?? 0) / Math.max(1, stats.totalResults);
                    return share > 0 ? <span key={outcome.status} className={outcome.className} style={{ flexGrow: share }} /> : null;
                  })}
                </div>
                <ul className="ov-legend">
                  {OUTCOMES.map((outcome) => {
                    const count = stats.counts[outcome.status] ?? 0;
                    if (count === 0 && outcome.status === 'NOT_IMPLEMENTED') return null;
                    return (
                      <li key={outcome.status}>
                        <span className={`ov-legend-word ${outcome.className}`}>{outcome.label}</span>
                        <span className="mono">{Math.round((count / Math.max(1, stats.totalResults)) * 100)}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            <section className="ov-panel" aria-labelledby="ov-hotspots">
              <div className="ov-panel-head">
                <h2 id="ov-hotspots">Rules failing most</h2>
                <Link to="/app/rules" className="ov-link">Rules</Link>
              </div>
              {stats.hotspots.length === 0 ? (
                <p className="ov-empty">No rule has failed.</p>
              ) : (
                <ol className="ov-hotspots">
                  {stats.hotspots.map(([ruleId, fails]) => (
                    <li key={ruleId}>
                      <span className="mono ov-rule-id">{ruleId}</span>
                      <span className="ov-rule-title">{overview.ruleTitles.get(ruleId) ?? 'Untitled rule'}</span>
                      <span className="ov-dots" aria-hidden="true" />
                      <span className="ov-rule-count">{fails}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="ov-panel" aria-labelledby="ov-activity">
              <div className="ov-panel-head">
                <h2 id="ov-activity">Recent activity</h2>
                <Link to="/app/audit" className="ov-link">Audit trail</Link>
              </div>
              {overview.activity.length === 0 ? (
                <p className="ov-empty">No reviewer or AI activity yet.</p>
              ) : (
                <ul className="ov-activity">
                  {overview.activity.map((event) => (
                    <li key={event.index}>
                      <span className="mono ov-activity-time">{timeAgo(new Date(event.timestamp))}</span>
                      <span>
                        <strong>{displayName(event.actor)}</strong> {activityVerb(event)}
                        {event.claim_id && <>, claim <Link to={`/app/claims/${encodeURIComponent(event.claim_id)}`} className="mono ov-link">{event.claim_id}</Link></>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
