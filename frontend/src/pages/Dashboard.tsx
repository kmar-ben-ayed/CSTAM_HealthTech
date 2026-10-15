import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ClaimOrbit, { type OrbitClaim } from '../components/ClaimOrbit';
import { ApiError } from '../api/client';
import { describeAuditEvent, getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { getDataset, getIngestedClaims, type DatasetResponse, type RuleResult } from '../api/claims';
import { displayName, loadCardContext, personName, timeAgo, toClaimCardData, type ClaimCardData } from '../api/claimCards';
import { listRules } from '../api/rules';
import { onlyActive } from '../api/reviewQueue';
import { chronological, getIngestionRuns, type IngestionRun } from '../api/runs';
import '../styles/dashboard.css';

// ── Overview ───────────────────────────────────────────────────────────────
// The review queue as an orbit around the status shield, with the day's
// figures, recent activity and where failures cluster across runs. Every
// number is counted from the ingested claims, the ingestion runs, the rule
// catalogue and the audit log, refreshed every 30 seconds.

interface DashboardProps {
  onNavigate: (page: string, claimId?: string) => void;
}

interface Overview {
  cards: ClaimCardData[];
  results: RuleResult[];
  ruleTitles: Map<string, string>;
  runs: IngestionRun[];
  activity: BackendAuditEvent[];
}

const REFRESH_MS = 30_000;
// More dots than this turns the orbit into noise; the rest are in the claims list.
const ORBIT_LIMIT = 24;
const HEAT_RUNS = 7;
const HEAT_RULES = 4;

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
  // Stored evaluations can still hold results from rules that were since removed
  // or deactivated; only active rules count. Without a catalogue, keep everything.
  const active = new Set(rules.filter((rule) => rule.status === 'active').map((rule) => rule.rule_id));
  const current = (results: RuleResult[]) => onlyActive(results, active);
  return {
    cards: dataset.claims.map((claim) => toClaimCardData(claim, current(dataset.evaluations[claim.claim_id] ?? []), context)),
    results: current(Object.values(dataset.evaluations).flat()),
    ruleTitles: new Map(rules.map((rule) => [rule.rule_id, rule.title])),
    runs,
    activity: audit
      .filter((event) => event.event_type !== 'rule_execution')
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 4),
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

type ActivityKind = 'confirm' | 'dismiss' | 'ai' | 'other';
function activityKind(event: BackendAuditEvent): ActivityKind {
  if (event.event_type === 'ai_decision') return 'ai';
  if (event.event_type !== 'human_decision') return 'other';
  return event.payload.action === 'confirm_issue' ? 'confirm' : 'dismiss';
}
const ACTIVITY_ICON: Record<ActivityKind, string> = {
  confirm: 'M12 6v8M12 18v.5',
  dismiss: 'M5 12l4 4 10-10',
  ai: 'M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z',
  other: 'M5 12h14M13 6l6 6-6 6',
};

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function toOrbitClaim(card: ClaimCardData, ruleTitles: Map<string, string>): OrbitClaim {
  const seen = new Set<string>();
  const rules = card.findings
    .filter((finding) => finding.result !== 'PASS' && finding.result !== 'NA')
    .filter((finding) => !seen.has(finding.ruleId) && !!seen.add(finding.ruleId))
    .map((finding) => ({ id: finding.ruleId, title: ruleTitles.get(finding.ruleId) ?? finding.text }));
  return {
    id: card.claimId,
    fail: card.failedCount,
    unable: card.findings.filter((finding) => finding.result === 'UNABLE').length,
    provider: card.providerName,
    serviceDate: card.serviceDate,
    rules,
  };
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [ping, setPing] = useState<{ id: string; n: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const actor = sessionStorage.getItem('claimguard-demo-actor') || '';
  const firstName = personName(actor)?.split(' ')[0] ?? '';

  // Load now, then refresh on a timer (only while the tab is visible).
  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      loadOverview(controller.signal)
        .then((next) => {
          setOverview(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError('The overview could not be loaded.');
        });
    };
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, []);

  const stats = useMemo(() => {
    if (!overview) return null;
    const { cards, results, ruleTitles, runs } = overview;
    const counts: Record<string, number> = {};
    const failsByRule = new Map<string, number>();
    for (const result of results) {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      if (result.status === 'FAIL') failsByRule.set(result.rule_id, (failsByRule.get(result.rule_id) ?? 0) + 1);
    }
    const waiting = cards
      .filter((card) => card.status !== 'Passed')
      .map((card) => toOrbitClaim(card, ruleTitles))
      .sort((a, b) => b.fail * 100 + b.unable - (a.fail * 100 + a.unable));
    const hotspots = [...failsByRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, HEAT_RULES).map(([id]) => id);

    // Heatmap columns: the latest runs that report per-rule counts; else today's results.
    // A rule a run didn't check is null ("not run"), not zero failures.
    const ordered = chronological(runs);
    const runIndex = new Map(ordered.map((run, index) => [run.run_id, run.sequence ?? index + 1]));
    const counted = ordered.filter((run) => run.rule_counts && Object.keys(run.rule_counts).length).slice(-HEAT_RUNS);
    const columns: { label: string; title: string; fails: (rule: string) => number | null }[] = counted.length
      ? counted.map((run) => ({
          label: `#${runIndex.get(run.run_id)}`,
          title: `Run ${run.run_id.slice(0, 8)} (${run.source})`,
          // A rule the run didn't check, or whose results were all outside the status contract
          // (see invalid_results on the Runs page), is "not run" rather than zero failures.
          fails: (rule: string) => {
            const counts = run.rule_counts?.[rule];
            const valid = counts ? (counts.PASS ?? 0) + (counts.FAIL ?? 0) + (counts.UNABLE_TO_ASSESS ?? 0) + (counts.NOT_APPLICABLE ?? 0) : 0;
            return counts && valid > 0 ? (counts.FAIL ?? 0) : null;
          },
        }))
      : [{ label: 'Now', title: 'Current results', fails: (rule: string) => failsByRule.get(rule) ?? 0 }];

    return {
      counts,
      totalResults: results.length,
      waiting,
      unable: cards.filter((card) => card.status === 'Unable to assess').length,
      passShare: Math.round(((counts.PASS ?? 0) / Math.max(1, results.length)) * 100),
      hotspots,
      columns,
      heat: hotspots.map((rule) => columns.map((column) => column.fails(rule))),
    };
  }, [overview]);

  const ruleTitle = (rule: string) => overview?.ruleTitles.get(rule) ?? 'Untitled rule';
  // The most urgent claims of each ring, so a long queue doesn't pile onto the inner ring.
  const orbitClaims = useMemo(() => {
    if (!stats) return [];
    const rings = [
      { take: 8, test: (c: OrbitClaim) => c.fail >= 3 },
      { take: 8, test: (c: OrbitClaim) => c.fail > 0 && c.fail < 3 },
      { take: ORBIT_LIMIT - 16, test: (c: OrbitClaim) => c.fail === 0 },
    ];
    const picked = rings.flatMap((ring) => stats.waiting.filter(ring.test).slice(0, ring.take));
    // Hand unused slots (an empty ring) to the most urgent claims not yet shown.
    const shown = new Set(picked.map((c) => c.id));
    return [...picked, ...stats.waiting.filter((c) => !shown.has(c.id)).slice(0, ORBIT_LIMIT - picked.length)];
  }, [stats]);

  const chooseRule = (rule: string) => {
    const next = filter === rule ? null : rule;
    setFilter(next);
    if (next && stats) {
      const tied = stats.waiting.filter((claim) => claim.rules.some((r) => r.id === next)).length;
      setAnnouncement(`${tied} waiting claims tied to ${ruleTitle(next)} highlighted`);
    } else setAnnouncement('Highlight cleared');
  };

  // The rule that moved most in the latest run, or the selected one.
  const insight = useMemo(() => {
    if (!stats || !stats.hotspots.length) return null;
    // Compare each rule's most recent run that checked it against its earlier runs.
    const rows = stats.hotspots.map((rule, index) => {
      const ran = stats.heat[index].filter((fails): fails is number => fails !== null);
      const latest = ran.length ? ran[ran.length - 1] : 0;
      const earlier = ran.slice(0, -1);
      const average = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : null;
      return { rule, latest, average };
    });
    const change = (row: (typeof rows)[number]) => (row.average === null ? 0 : Math.abs(row.latest - row.average));
    const pick = filter ? rows.find((row) => row.rule === filter) : rows.reduce((best, row) => (change(row) > change(best) ? row : best));
    if (!pick) return null;
    const open = stats.waiting.filter((claim) => claim.rules.some((r) => r.id === pick.rule)).length;
    return { ...pick, open, selected: !!filter };
  }, [stats, filter]);

  const heatMax = stats ? Math.max(1, ...stats.heat.flat().map((fails) => fails ?? 0)) : 1;

  return (
    <div className="ov-page">
      <header className="ov-top">
        <div>
          <div className="ov-eyebrow">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting(now)}{firstName ? `, ${firstName}` : ''}.</h1>
          {error && <p className="ov-error" role="alert">{error}</p>}
        </div>
        <button type="button" className="ov-btn is-ghost is-small" onClick={() => onNavigate('ingest')}>Ingest data</button>
      </header>

      {/* The day's figures in one slim strip, each with its own small planet. */}
      <dl className="ov-strip">
          {[
            { label: 'Claims processed', value: stats ? overview!.cards.length.toLocaleString('en') : '…', tone: 'accent', speed: '6s' },
            { label: 'Issues detected', value: stats ? (stats.counts.FAIL ?? 0).toLocaleString('en') : '…', tone: 'fail', speed: '3s' },
            { label: 'Unable to assess', value: stats ? stats.unable.toLocaleString('en') : '…', tone: 'unable', speed: '4.5s' },
            { label: 'Rule checks passed', value: stats ? `${stats.passShare}%` : '…', tone: 'pass', speed: '8s' },
          ].map((stat) => (
            <div key={stat.label} className={`ov-planet is-${stat.tone}`} style={{ '--moon': stat.speed } as React.CSSProperties}>
              <span className="ov-orb" aria-hidden="true" />
              <div>
                <dd className="ov-planet-value">{stat.value}</dd>
                <dt className="ov-eyebrow">{stat.label}</dt>
              </div>
            </div>
          ))}
      </dl>

      <section className="ov-stage">
        <div className="ov-orbit-col">
          <ClaimOrbit
            claims={orbitClaims}
            total={stats?.waiting.length ?? 0}
            loading={!stats}
            highlightRule={filter}
            ping={ping}
            onOpen={(claimId) => navigate(`/app/claims/${encodeURIComponent(claimId)}`)}
          />
          <div className="ov-orbit-foot">
            {/* Rule filters live on the heatmap rows; this only shows and clears the active one. */}
            {filter && (
              <span className="ov-active-filter">
                Highlighting <span className="mono">{filter}</span> {ruleTitle(filter)}
                <button type="button" className="ov-link" onClick={() => chooseRule(filter)}>Clear</button>
              </span>
            )}
            <button type="button" className="ov-link" aria-expanded={legendOpen} aria-controls="ov-legend" onClick={() => setLegendOpen((open) => !open)}>
              {legendOpen ? 'Hide the key' : 'How to read this'}
            </button>
          </div>
          {legendOpen && (
            <div className="ov-legend" id="ov-legend">
              <span><i className="is-filled" />Failed rules, bigger = more</span>
              <span><i className="is-hollow" />Unable to assess only</span>
              <span>Inner ring = most urgent</span>
              {stats && stats.waiting.length > ORBIT_LIMIT && <span>Showing the most urgent {ORBIT_LIMIT} of {stats.waiting.length.toLocaleString('en')}</span>}
              <span>Filter by rule from the heatmap below</span>
            </div>
          )}
        </div>

        <div className="ov-col ov-side">
        {stats && stats.hotspots.length > 0 && (
          <section className="ov-card ov-heatcard" aria-labelledby="ov-heat">
            <div>
              <div className="ov-card-head">
                <h2 id="ov-heat">Where failures cluster</h2>
                <span className="ov-eyebrow">
                  {stats.columns.length > 1 ? `last ${stats.columns.length} runs` : 'current results'} · pick a rule
                </span>
              </div>
              <div className="ov-heat" style={{ '--cols': stats.columns.length } as React.CSSProperties}>
                <span />
                {stats.columns.map((column) => (
                  <span key={column.label} className="ov-heat-col" title={column.title}>{column.label}</span>
                ))}
                {stats.hotspots.map((rule, row) => (
                  <div key={rule} className="ov-heat-row">
                    <button type="button" className="ov-heat-rule mono" aria-pressed={filter === rule} title={ruleTitle(rule)} onClick={() => chooseRule(rule)}>
                      {rule}
                    </button>
                    {stats.heat[row].map((fails, column) => {
                      const strength = fails === null ? 0 : 0.1 + (fails / heatMax) * 0.9;
                      return (
                        <span
                          key={column}
                          className={`ov-heat-cell${strength > 0.55 ? ' is-strong' : ''}${fails === null ? ' is-not-run' : ''}${filter && filter !== rule ? ' is-dim' : ''}`}
                          style={{ '--o': strength.toFixed(2), '--delay': `${(row * stats.columns.length + column) * 22}ms` } as React.CSSProperties}
                          title={`${rule} ${ruleTitle(rule)}, ${stats.columns[column].title}: ${fails === null ? 'not run' : `${fails} failures`}`}
                        >
                          <b>{fails === null ? '–' : fails || ''}</b>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            {insight && (
              <div className="ov-insight">
                <div className="ov-eyebrow">{insight.selected ? 'Selected rule' : insight.average === null ? 'Failing most' : 'Biggest mover'}</div>
                <h2><span className="mono">{insight.rule}</span> {ruleTitle(insight.rule)}</h2>
                <p>
                  {insight.latest} failures in {stats.columns.length > 1 ? 'the latest run that checked it' : 'the current results'}
                  {insight.average !== null && <> vs. {insight.average.toFixed(1)} on average</>}
                  {insight.average !== null && insight.average >= 3 && (
                    <> (<b>{insight.latest >= insight.average ? '+' : ''}{Math.round(((insight.latest - insight.average) / insight.average) * 100)}%</b>)</>
                  )}
                  . {insight.open} waiting {insight.open === 1 ? 'claim is' : 'claims are'} tied to it.
                </p>
              </div>
            )}
          </section>
        )}
          <section className="ov-card" aria-labelledby="ov-activity">
            <div className="ov-card-head">
              <h2 id="ov-activity">Recent activity</h2>
              <Link to="/app/audit" className="ov-link">Audit trail</Link>
            </div>
            {!overview ? (
              <p className="ov-empty">Reading the audit log…</p>
            ) : overview.activity.length === 0 ? (
              <p className="ov-empty">No reviewer or AI activity yet.</p>
            ) : (
              <ul className="ov-feed">
                {overview.activity.map((event) => {
                  const kind = activityKind(event);
                  const claimId = event.claim_id ?? null;
                  return (
                    <li
                      key={event.index}
                      onMouseEnter={claimId ? () => setPing((current) => ({ id: claimId, n: (current?.n ?? 0) + 1 })) : undefined}
                    >
                      <span className={`ov-feed-icon is-${kind}`} aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d={ACTIVITY_ICON[kind]} /></svg>
                      </span>
                      <div>
                        <strong>{displayName(event.actor)}</strong> {activityVerb(event)}
                        {claimId && (
                          <>
                            {' '}on <Link to={`/app/claims/${encodeURIComponent(claimId)}`} className="mono ov-link">{claimId}</Link>
                          </>
                        )}
                        <time dateTime={event.timestamp}>{timeAgo(new Date(event.timestamp))}</time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <button type="button" className="ov-btn" onClick={() => onNavigate('review-queue')}>Open review queue</button>
        </div>
      </section>


      <div className="visually-hidden" aria-live="polite">{announcement}</div>
    </div>
  );
}
