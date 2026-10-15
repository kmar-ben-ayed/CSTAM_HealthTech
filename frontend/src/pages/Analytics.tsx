import { useEffect, useMemo, useState } from 'react';
import ShieldLoader from '../components/ShieldLoader';
import { ApiError } from '../api/client';
import { getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { getDataset, getIngestedClaims, type BackendClaim, type DatasetResponse, type RuleResult } from '../api/claims';
import { claimStatus, displayName, loadCardContext, timeAgo, type ClaimStatus } from '../api/claimCards';
import { getQuality, type QualityMetrics, type QualityReport } from '../api/quality';
import { onlyActive } from '../api/reviewQueue';
import { listRules } from '../api/rules';
import '../styles/analytics.css';

// ── Analytics ──────────────────────────────────────────────────────────────
// Everything here is counted from the ingested claims and their rule results
// (active rules only), the audit trail, and a live score of the engine against
// the development ground truth. Period, policy and provider narrow the claims;
// the quality section is a fixed benchmark and ignores them.

interface AnalyticsProps {
  onNavigate: (page: string) => void;
}

interface Loaded {
  claims: BackendClaim[];
  results: Map<string, RuleResult[]>;
  ruleTitles: Map<string, string>;
  providerNames: Map<string, string>;
  audit: BackendAuditEvent[];
  auditTotal: number;
}

const ALL = 'all';
const STATUS_ORDER: ClaimStatus[] = ['Passed', 'Failed', 'Unable to assess', 'Needs review'];
const STATUS_CLASS: Record<ClaimStatus, string> = {
  Passed: 'is-pass',
  Failed: 'is-fail',
  'Unable to assess': 'is-unable',
  'Needs review': 'is-review',
};
const OUTCOMES = [
  { status: 'PASS', label: 'Pass', className: 'is-pass' },
  { status: 'FAIL', label: 'Fail', className: 'is-fail' },
  { status: 'UNABLE_TO_ASSESS', label: 'Unable to assess', className: 'is-unable' },
  { status: 'NOT_APPLICABLE', label: 'Not applicable', className: 'is-na' },
  { status: 'NOT_IMPLEMENTED', label: 'Not run', className: 'is-na' },
] as const;
const ACTIONS: Array<{ key: string; label: string; className: string }> = [
  { key: 'confirm_issue', label: 'Confirmed', className: 'is-fail' },
  { key: 'dismiss_with_reason', label: 'Dismissed', className: 'is-pass' },
  { key: 'request_information', label: 'Info requested', className: 'is-unable' },
  { key: 'mark_corrected_for_recheck', label: 'Corrected', className: 'is-review' },
];

async function loadAnalytics(signal: AbortSignal): Promise<Loaded> {
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
  return {
    claims: dataset.claims,
    results: new Map(dataset.claims.map((claim) => [claim.claim_id, onlyActive(dataset.evaluations[claim.claim_id] ?? [], active)])),
    ruleTitles: new Map(rules.map((rule) => [rule.rule_id, rule.title])),
    providerNames: context.providerNames,
    audit: audit.events,
    auditTotal: audit.total_count,
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────
const count = (value: number) => value.toLocaleString('en');
const share = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** Monday of the week a date falls in, as YYYY-MM-DD. */
function weekOf(date: string): string {
  const day = new Date(`${date}T00:00:00`);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** Evidence paths for the same field on different lines count as one field. */
function fieldOf(path: string): string {
  return path.replace(/\/\d+(?=\/|$)/g, '/*');
}

const isMissing = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

// ── Small pieces ────────────────────────────────────────────────────────────
function Card({ title, note, action, children, className = '' }: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`an-card ${className}`} aria-label={title}>
      <header className="an-card-head">
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Meter({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <span className="an-meter" aria-hidden="true">
      <span className={className} style={{ transform: `scaleX(${max ? value / max : 0})` }} />
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="an-empty">{children}</p>;
}

/** Claims per submission week, stacked: passed below, needing a decision above. */
function WeeklyChart({ weeks }: { weeks: Array<{ week: string; passed: number; waiting: number }> }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 720;
  const height = 200;
  const pad = { top: 12, right: 8, bottom: 26, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...weeks.map((week) => week.passed + week.waiting));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const slot = plotW / weeks.length;
  const barW = Math.min(36, slot * 0.64);
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const labelEvery = Math.ceil(weeks.length / 8);
  const shown = active !== null ? weeks[active] : null;

  return (
    <div className="an-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Claims per submission week">
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="an-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="an-axis" x={pad.left - 8} y={y(tick) + 4} textAnchor="end">{count(tick)}</text>
          </g>
        ))}
        {weeks.map((week, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2;
          const label = new Date(`${week.week}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          return (
            <g
              key={week.week}
              className={`an-bar${active === index ? ' is-active' : ''}`}
              tabIndex={0}
              role="img"
              aria-label={`Week of ${label}: ${week.passed} passed, ${week.waiting} need a decision`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <rect className="an-bar-hit" x={pad.left + index * slot} y={pad.top} width={slot} height={plotH} />
              <rect className="is-pass" x={x} y={y(week.passed)} width={barW} height={y(0) - y(week.passed)} rx="2" />
              <rect className="is-waiting" x={x} y={y(week.passed + week.waiting)} width={barW} height={y(week.passed) - y(week.passed + week.waiting)} rx="2" />
              {index % labelEvery === 0 && (
                <text className="an-axis" x={x + barW / 2} y={height - 6} textAnchor="middle">{label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="an-chart-foot">
        <span className="an-key"><i className="is-pass" />Passed every rule</span>
        <span className="an-key"><i className="is-waiting" />Needs a decision</span>
        <span className="an-chart-readout" aria-live="polite">
          {shown
            ? `Week of ${new Date(`${shown.week}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${shown.passed} passed · ${shown.waiting} need a decision`
            : 'Hover or focus a week for its numbers'}
        </span>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Analytics({ onNavigate }: AnalyticsProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(ALL);
  const [policy, setPolicy] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  // Scoring re-runs the engine on the labelled claims (a few seconds), so it
  // loads on its own and never holds up the rest of the page.
  const [quality, setQuality] = useState<{ state: 'loading' | 'ready' | 'error'; report?: QualityReport }>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    loadAnalytics(controller.signal)
      .then(setLoaded)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('Analytics could not be loaded.');
      });
    getQuality('development', controller.signal)
      .then((report) => setQuality({ state: 'ready', report }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setQuality({ state: 'error' });
      });
    return () => controller.abort();
  }, []);

  const options = useMemo(() => {
    if (!loaded) return null;
    const months = new Set<string>();
    const policies = new Set<string>();
    const providers = new Set<string>();
    for (const claim of loaded.claims) {
      if (claim.submission_date) months.add(claim.submission_date.slice(0, 7));
      if (claim.policy_id) policies.add(claim.policy_id);
      if (claim.provider_id) providers.add(claim.provider_id);
    }
    return {
      months: [...months].sort().reverse(),
      policies: [...policies].sort(),
      providers: [...providers].sort(),
    };
  }, [loaded]);

  const view = useMemo(() => {
    if (!loaded) return null;
    const claims = loaded.claims.filter((claim) =>
      (period === ALL || claim.submission_date?.startsWith(period))
      && (policy === ALL || claim.policy_id === policy)
      && (provider === ALL || claim.provider_id === provider));
    const inScope = new Set(claims.map((claim) => claim.claim_id));

    const statusOf = new Map<string, ClaimStatus>();
    const byStatus: Record<ClaimStatus, number> = { Passed: 0, Failed: 0, 'Unable to assess': 0, 'Needs review': 0 };
    const outcomes: Record<string, number> = {};
    const rules = new Map<string, { fail: number; unable: number; failedClaims: number }>();
    const missing = new Map<string, number>();
    const weeks = new Map<string, { passed: number; waiting: number }>();
    let totalResults = 0;
    let unableResults = 0;

    for (const claim of claims) {
      const results = loaded.results.get(claim.claim_id) ?? [];
      const status = claimStatus(results);
      statusOf.set(claim.claim_id, status);
      byStatus[status] += 1;
      if (claim.submission_date) {
        const week = weeks.get(weekOf(claim.submission_date)) ?? { passed: 0, waiting: 0 };
        if (status === 'Passed') week.passed += 1;
        else week.waiting += 1;
        weeks.set(weekOf(claim.submission_date), week);
      }
      const failedHere = new Set<string>();
      for (const result of results) {
        totalResults += 1;
        outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
        const rule = rules.get(result.rule_id) ?? { fail: 0, unable: 0, failedClaims: 0 };
        if (result.status === 'FAIL') {
          rule.fail += 1;
          failedHere.add(result.rule_id);
        }
        if (result.status === 'UNABLE_TO_ASSESS') {
          rule.unable += 1;
          unableResults += 1;
          const evidence = Array.isArray(result.evidence) ? (result.evidence as Array<{ path?: unknown; value?: unknown }>) : [];
          const fields = new Set(evidence.filter((item) => typeof item?.path === 'string' && isMissing(item.value)).map((item) => fieldOf(item.path as string)));
          for (const field of fields) missing.set(field, (missing.get(field) ?? 0) + 1);
        }
        rules.set(result.rule_id, rule);
      }
      for (const ruleId of failedHere) rules.get(ruleId)!.failedClaims += 1;
    }

    // Review activity on the claims in scope, newest first.
    const events = loaded.audit.filter((event) =>
      event.claim_id && inScope.has(event.claim_id) && (event.event_type === 'human_decision' || event.event_type === 'claim_decision'));
    const actions: Record<string, number> = {};
    const reviewedClaims = new Set<string>();
    const decisions = new Map<string, string>(); // latest claim decision per claim
    const reviewers = new Map<string, { actions: number; decisions: number; claims: Set<string>; last: string }>();
    for (const event of [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
      const person = reviewers.get(event.actor) ?? { actions: 0, decisions: 0, claims: new Set<string>(), last: event.timestamp };
      person.last = event.timestamp;
      person.claims.add(event.claim_id!);
      if (event.event_type === 'human_decision') {
        const action = String(event.payload.action);
        actions[action] = (actions[action] ?? 0) + 1;
        reviewedClaims.add(event.claim_id!);
        person.actions += 1;
      } else {
        const decision = String(event.payload.decision);
        if (decision === 'reopen') decisions.delete(event.claim_id!);
        else decisions.set(event.claim_id!, decision);
        person.decisions += 1;
      }
      reviewers.set(event.actor, person);
    }
    const decided = [...decisions.values()];
    const waiting = claims.length - byStatus.Passed;
    const undecided = claims.filter((claim) => statusOf.get(claim.claim_id) !== 'Passed' && !decisions.has(claim.claim_id)).length;

    // Actions per day over the last 14 days with activity in scope.
    const days = new Map<string, number>();
    for (const event of events) days.set(event.timestamp.slice(0, 10), (days.get(event.timestamp.slice(0, 10)) ?? 0) + 1);

    return {
      claims,
      byStatus,
      waiting,
      outcomes,
      totalResults,
      unableResults,
      rules: [...rules.entries()]
        .filter(([, rule]) => rule.fail + rule.unable > 0)
        .sort((a, b) => b[1].fail - a[1].fail || b[1].unable - a[1].unable),
      unableRules: [...rules.entries()].filter(([, rule]) => rule.unable > 0).sort((a, b) => b[1].unable - a[1].unable),
      missing: [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      weeks: [...weeks.entries()].sort().map(([week, value]) => ({ week, ...value })),
      actions,
      reviewedClaims: reviewedClaims.size,
      approved: decided.filter((decision) => decision === 'approve').length,
      rejected: decided.filter((decision) => decision === 'reject').length,
      undecided,
      reviewers: [...reviewers.entries()].sort((a, b) => b[1].actions + b[1].decisions - (a[1].actions + a[1].decisions)),
      days: [...days.entries()].sort().slice(-14),
    };
  }, [loaded, period, policy, provider]);

  const ruleTitle = (rule: string) => loaded?.ruleTitles.get(rule) ?? 'Untitled rule';
  const filtered = period !== ALL || policy !== ALL || provider !== ALL;

  if (error) {
    return (
      <div className="page-shell an-page">
        <h1>Analytics</h1>
        <p className="an-error" role="alert">{error}</p>
      </div>
    );
  }
  if (!loaded || !view || !options) {
    return (
      <div className="page-shell an-page">
        <ShieldLoader label="Counting claims and rule results…" />
      </div>
    );
  }

  const totalActions = ACTIONS.reduce((sum, action) => sum + (view.actions[action.key] ?? 0), 0);
  const maxRuleFail = Math.max(1, ...view.rules.map(([, rule]) => rule.fail));
  const maxDay = Math.max(1, ...view.days.map(([, n]) => n));
  const report = quality.report;

  return (
    <div className="page-shell an-page">
      <header className="an-head">
        <div>
          <h1>Analytics</h1>
          <p>Claim outcomes, rule findings and review work, counted from the ingested claims and the audit trail.</p>
        </div>
      </header>

      <div className="an-filters" role="group" aria-label="Filter claims">
        <label>
          <span>Period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value={ALL}>All submission dates</option>
            {options.months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
          </select>
        </label>
        <label>
          <span>Policy</span>
          <select value={policy} onChange={(event) => setPolicy(event.target.value)}>
            <option value={ALL}>All policies</option>
            {options.policies.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label>
          <span>Provider</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value={ALL}>All providers</option>
            {options.providers.map((id) => (
              <option key={id} value={id}>{loaded.providerNames.get(id) ? `${loaded.providerNames.get(id)} (${id})` : id}</option>
            ))}
          </select>
        </label>
        <p className="an-scope" aria-live="polite">
          <strong>{count(view.claims.length)}</strong> of {count(loaded.claims.length)} claims
          {filtered && (
            <button
              type="button"
              className="an-link"
              onClick={() => {
                setPeriod(ALL);
                setPolicy(ALL);
                setProvider(ALL);
              }}
            >
              Clear filters
            </button>
          )}
        </p>
      </div>

      {view.claims.length === 0 ? (
        <Empty>No claims match these filters.</Empty>
      ) : (
        <>
          <div className="an-kpis">
            <div className="an-kpi">
              <span className="an-kpi-label">Claims</span>
              <span className="an-kpi-value">{count(view.claims.length)}</span>
              <span className="an-kpi-sub">{count(view.totalResults)} rule checks</span>
            </div>
            <div className="an-kpi">
              <span className="an-kpi-label">Passed every rule</span>
              <span className="an-kpi-value is-pass">{share(view.byStatus.Passed, view.claims.length)}</span>
              <span className="an-kpi-sub">{count(view.byStatus.Passed)} claims</span>
            </div>
            <button type="button" className="an-kpi is-link" onClick={() => onNavigate('review-queue')}>
              <span className="an-kpi-label">Need a decision</span>
              <span className="an-kpi-value is-fail">{count(view.waiting)}</span>
              <span className="an-kpi-sub">{share(view.waiting, view.claims.length)} of claims · open the queue</span>
            </button>
            <div className="an-kpi">
              <span className="an-kpi-label">Unable to assess</span>
              <span className="an-kpi-value is-unable">{count(view.byStatus['Unable to assess'])}</span>
              <span className="an-kpi-sub">{share(view.byStatus['Unable to assess'], view.claims.length)} of claims</span>
            </div>
          </div>

          <Card title="Claims by submission week" note="Each bar is the claims submitted that week, split by whether they still need a reviewer.">
            {view.weeks.length ? <WeeklyChart weeks={view.weeks} /> : <Empty>These claims have no submission dates.</Empty>}
          </Card>

          <div className="an-grid-2">
            <Card title="Claim status" note={`${count(view.claims.length)} claims`}>
              <ul className="an-rows">
                {STATUS_ORDER.map((status) => (
                  <li key={status}>
                    <span className={`an-word ${STATUS_CLASS[status]}`}>{status}</span>
                    <Meter value={view.byStatus[status]} max={view.claims.length} className={STATUS_CLASS[status]} />
                    <span className="an-num">{count(view.byStatus[status])}</span>
                    <span className="an-share">{share(view.byStatus[status], view.claims.length)}</span>
                  </li>
                ))}
              </ul>
              <h3 className="an-subhead">Rule results</h3>
              <ul className="an-rows">
                {OUTCOMES.filter((o) => o.status !== 'NOT_IMPLEMENTED' || view.outcomes[o.status]).map((outcome) => (
                  <li key={outcome.status}>
                    <span className={`an-word ${outcome.className}`}>{outcome.label}</span>
                    <Meter value={view.outcomes[outcome.status] ?? 0} max={view.totalResults} className={outcome.className} />
                    <span className="an-num">{count(view.outcomes[outcome.status] ?? 0)}</span>
                    <span className="an-share">{share(view.outcomes[outcome.status] ?? 0, view.totalResults)}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Review workload"
              note={loaded.auditTotal > loaded.audit.length ? `From the latest ${count(loaded.audit.length)} audit events` : 'From the audit trail'}
              action={<button type="button" className="an-button" onClick={() => onNavigate('review-queue')}>Review queue</button>}
            >
              <dl className="an-facts">
                <div><dt>Waiting for a decision</dt><dd>{count(view.undecided)}</dd></div>
                <div><dt>Claims approved</dt><dd className="is-pass">{count(view.approved)}</dd></div>
                <div><dt>Claims rejected</dt><dd className="is-fail">{count(view.rejected)}</dd></div>
                <div><dt>Claims with a rule reviewed</dt><dd>{count(view.reviewedClaims)}</dd></div>
              </dl>
              <h3 className="an-subhead">Rule review actions · {count(totalActions)}</h3>
              {totalActions === 0 ? (
                <Empty>No reviewer has acted on these claims yet.</Empty>
              ) : (
                <ul className="an-rows">
                  {ACTIONS.map((action) => (
                    <li key={action.key}>
                      <span className={`an-word ${action.className}`}>{action.label}</span>
                      <Meter value={view.actions[action.key] ?? 0} max={totalActions} className={action.className} />
                      <span className="an-num">{count(view.actions[action.key] ?? 0)}</span>
                      <span className="an-share">{share(view.actions[action.key] ?? 0, totalActions)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card
            title="Findings by rule"
            note="Failures and unassessable results per rule, most failures first."
            action={<button type="button" className="an-button" onClick={() => onNavigate('rules')}>Rules</button>}
          >
            {view.rules.length === 0 ? (
              <Empty>Every rule passed on these claims.</Empty>
            ) : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col" className="an-col-bar">Failures</th>
                    <th scope="col" className="an-right">Failed</th>
                    <th scope="col" className="an-right">Unable</th>
                    <th scope="col" className="an-right">Claims failing</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rules.map(([ruleId, rule]) => (
                    <tr key={ruleId}>
                      <th scope="row">
                        <span className="an-rule-id">{ruleId}</span> {ruleTitle(ruleId)}
                      </th>
                      <td className="an-col-bar"><Meter value={rule.fail} max={maxRuleFail} className="is-fail" /></td>
                      <td className="an-right an-num">{count(rule.fail)}</td>
                      <td className="an-right an-num">{count(rule.unable)}</td>
                      <td className="an-right an-share">{share(rule.failedClaims, view.claims.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div className="an-grid-2">
            <Card title="Unable to assess" note={`${count(view.unableResults)} rule results could not be decided from the claim's data.`}>
              {view.unableResults === 0 ? (
                <Empty>Every rule could be assessed on these claims.</Empty>
              ) : (
                <>
                  <h3 className="an-subhead">By rule</h3>
                  <ul className="an-rows">
                    {view.unableRules.slice(0, 5).map(([ruleId, rule]) => (
                      <li key={ruleId}>
                        <span className="an-label"><span className="an-rule-id">{ruleId}</span> {ruleTitle(ruleId)}</span>
                        <Meter value={rule.unable} max={view.unableRules[0][1].unable} className="is-unable" />
                        <span className="an-num">{count(rule.unable)}</span>
                      </li>
                    ))}
                  </ul>
                  <h3 className="an-subhead">Fields most often missing</h3>
                  {view.missing.length === 0 ? (
                    <Empty>The evidence doesn't point at a missing field.</Empty>
                  ) : (
                    <ul className="an-rows">
                      {view.missing.map(([field, n]) => (
                        <li key={field}>
                          <span className="an-label an-mono">{field}</span>
                          <Meter value={n} max={view.missing[0][1]} className="is-unable" />
                          <span className="an-num">{count(n)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>

            <Card title="Reviewer activity" note="Rule actions and claim decisions on these claims.">
              {view.reviewers.length === 0 ? (
                <Empty>No reviewer activity on these claims yet.</Empty>
              ) : (
                <>
                  <table className="an-table is-compact">
                    <thead>
                      <tr>
                        <th scope="col">Reviewer</th>
                        <th scope="col" className="an-right">Rule actions</th>
                        <th scope="col" className="an-right">Decisions</th>
                        <th scope="col" className="an-right">Claims</th>
                        <th scope="col" className="an-right">Last active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.reviewers.map(([actor, person]) => (
                        <tr key={actor}>
                          <th scope="row">{displayName(actor)}</th>
                          <td className="an-right an-num">{count(person.actions)}</td>
                          <td className="an-right an-num">{count(person.decisions)}</td>
                          <td className="an-right an-num">{count(person.claims.size)}</td>
                          <td className="an-right an-share">{timeAgo(new Date(person.last))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3 className="an-subhead">Actions per day</h3>
                  <ul className="an-days">
                    {view.days.map(([day, n]) => (
                      <li key={day} title={`${day}: ${n} actions`}>
                        <span className="an-day-bar" style={{ transform: `scaleY(${n / maxDay})` }} aria-hidden="true" />
                        <span className="an-day-n">{n}</span>
                        <span className="an-day-label">{new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>
        </>
      )}

      <Card
        title="Validation quality"
        className="an-quality"
        note={report
          ? `The current engine scored live against ${count(report.claims)} labelled development claims (${count(report.overall.count)} rule checks). A failed rule is a positive. The filters above don't apply here.`
          : 'The current engine scored live against the labelled development claims.'}
      >
        {quality.state === 'loading' ? (
          <ShieldLoader label="Scoring the rules against the ground truth…" />
        ) : !report ? (
          <Empty>The quality score is unavailable: the scoring service did not respond.</Empty>
        ) : (
          <>
            <div className="an-quality-top">
              <div className="an-f1">
                <span className="an-f1-label">F1 score</span>
                <span className="an-f1-value">{percent(report.overall.issue_f1)}</span>
                <span className="an-f1-sub">Balance of precision and recall on failed rules</span>
              </div>
              <dl className="an-facts is-quality">
                <QualityFact label="Precision" value={report.overall.issue_precision} hint="Flags that were right" />
                <QualityFact label="Recall" value={report.overall.issue_recall} hint="Real failures caught" />
                <QualityFact label="Status accuracy" value={report.overall.status_accuracy} hint="Exact status match" />
                <QualityFact label="False alarm rate" value={report.overall.false_alarm_rate} hint="Flags on clean results" lowerIsBetter />
              </dl>
            </div>
            <p className="an-confusion">
              <span><strong>{count(report.overall.tp)}</strong> true flags</span>
              <span><strong>{count(report.overall.fp)}</strong> false flags</span>
              <span><strong>{count(report.overall.fn)}</strong> missed</span>
              <span><strong>{count(report.overall.false_abstentions)}</strong> needless "unable"</span>
              <span><strong>{count(report.overall.missed_abstentions)}</strong> missed "unable"</span>
            </p>
            <table className="an-table is-compact an-quality-table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col" className="an-right">Checks</th>
                  <th scope="col" className="an-right">True flags</th>
                  <th scope="col" className="an-right">False flags</th>
                  <th scope="col" className="an-right">Missed</th>
                  <th scope="col" className="an-right">Precision</th>
                  <th scope="col" className="an-right">Recall</th>
                  <th scope="col" className="an-right">F1</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.by_rule).map(([ruleId, metrics]) => (
                  <QualityRow key={ruleId} ruleId={ruleId} title={ruleTitle(ruleId)} metrics={metrics} />
                ))}
              </tbody>
            </table>
            {report.unscored_rules.length > 0 && (
              <p className="an-footnote">
                Not scored (no ground truth yet): {report.unscored_rules.map((rule) => `${rule} ${ruleTitle(rule)}`).join(', ')}.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function QualityFact({ label, value, hint, lowerIsBetter = false }: { label: string; value: number | null; hint: string; lowerIsBetter?: boolean }) {
  const good = value !== null && (lowerIsBetter ? value <= 0.02 : value >= 0.95);
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value === null ? '' : good ? 'is-pass' : 'is-unable'}>{percent(value)}</dd>
      <span>{hint}</span>
    </div>
  );
}

function QualityRow({ ruleId, title, metrics }: { ruleId: string; title: string; metrics: QualityMetrics }) {
  const weak = metrics.issue_f1 !== null && metrics.issue_f1 < 0.95;
  return (
    <tr className={weak ? 'is-weak' : undefined}>
      <th scope="row"><span className="an-rule-id">{ruleId}</span> {title}</th>
      <td className="an-right an-num">{count(metrics.count)}</td>
      <td className="an-right an-num">{count(metrics.tp)}</td>
      <td className={`an-right an-num${metrics.fp ? ' is-fail' : ''}`}>{count(metrics.fp)}</td>
      <td className={`an-right an-num${metrics.fn ? ' is-fail' : ''}`}>{count(metrics.fn)}</td>
      <td className="an-right an-num">{percent(metrics.issue_precision)}</td>
      <td className="an-right an-num">{percent(metrics.issue_recall)}</td>
      <td className="an-right an-num"><strong>{percent(metrics.issue_f1)}</strong>{weak && <span className="an-flag"> · check</span>}</td>
    </tr>
  );
}
