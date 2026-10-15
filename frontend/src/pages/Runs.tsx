import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ShieldLoader from '../components/ShieldLoader';
import { chronological, getIngestionRuns, type IngestionRun } from '../api/runs';
import { listRules, type RuleSummary } from '../api/rules';
import '../styles/runs.css';

// ── Runs ───────────────────────────────────────────────────────────────────
// Every ingestion run as the backend stored it: records accepted and rejected
// (with why), and the rule results it produced. The list opens a run's detail
// at ?run=<id>, so a run can be linked to. Runs carry no timestamps, so they are
// numbered in the order they happened.

const STATUSES = [
  { key: 'PASS', label: 'Pass', className: 'is-pass' },
  { key: 'FAIL', label: 'Fail', className: 'is-fail' },
  { key: 'UNABLE_TO_ASSESS', label: 'Unable to assess', className: 'is-unable' },
  { key: 'NOT_APPLICABLE', label: 'Not applicable', className: 'is-na' },
  { key: 'NOT_IMPLEMENTED', label: 'Not run', className: 'is-na' },
] as const;
const KNOWN = new Set<string>(STATUSES.map((status) => status.key));

const REASON_LABEL: Record<string, string> = {
  ENVELOPE_INVALID: 'Record envelope invalid',
  INVALID_RECORD: 'Invalid record',
  DUPLICATE_CLAIM_ID: 'Duplicate claim ID',
  PARSE_ERROR: 'Not valid JSON',
};

const count = (value: number) => value.toLocaleString('en');
const share = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

interface RunStats {
  run: IngestionRun;
  number: number;
  checks: number;
  pass: number;
  fail: number;
  unable: number;
  invalid: number;
}

function statsOf(run: IngestionRun, number: number): RunStats {
  const counts = run.status_counts ?? {};
  const known = (key: string) => counts[key] ?? 0;
  const invalid = Object.entries(counts).filter(([key]) => !KNOWN.has(key)).reduce((sum, [, n]) => sum + n, 0);
  return {
    run,
    number,
    checks: Object.values(counts).reduce((sum, n) => sum + n, 0),
    pass: known('PASS'),
    fail: known('FAIL'),
    unable: known('UNABLE_TO_ASSESS'),
    invalid,
  };
}

function Meter({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <span className="rn-meter" aria-hidden="true">
      <span className={className} style={{ transform: `scaleX(${max ? value / max : 0})` }} />
    </span>
  );
}

export default function Runs() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState<IngestionRun[] | null>(null);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getIngestionRuns(controller.signal), listRules(controller.signal).catch(() => [])])
      .then(([response, catalogue]) => {
        setRuns(response.runs);
        setRules(catalogue);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('The runs could not be loaded.');
      });
    return () => controller.abort();
  }, []);

  // Newest first in the list; numbers follow the order the runs happened.
  const list = useMemo(() => {
    if (!runs) return [];
    return chronological(runs).map((run, index) => statsOf(run, run.sequence ?? index + 1)).reverse();
  }, [runs]);

  const selectedId = params.get('run');
  const selected = list.find((item) => item.run.run_id === selectedId) ?? null;
  const openRun = (id: string | null) => setParams(id ? { run: id } : {});

  if (error) {
    return (
      <div className="page-shell rn-page">
        <h1>Runs</h1>
        <p className="rn-error" role="alert">{error}</p>
      </div>
    );
  }
  if (!runs) {
    return (
      <div className="page-shell rn-page">
        <ShieldLoader label="Loading ingestion runs…" />
      </div>
    );
  }
  if (selectedId && !selected) {
    return (
      <div className="page-shell rn-page">
        <button type="button" className="rn-back" onClick={() => openRun(null)}>All runs</button>
        <p className="rn-empty">This run was not found. It may have been removed from the ingestion store.</p>
      </div>
    );
  }
  if (selected) return <RunDetail stats={selected} rules={rules} onBack={() => openRun(null)} />;

  const accepted = list.reduce((sum, item) => sum + item.run.accepted_claims, 0);
  const rejected = list.reduce((sum, item) => sum + item.run.rejected_records, 0);
  const withProblems = list.filter((item) => item.invalid > 0 || item.run.accepted_claims === 0).length;

  return (
    <div className="page-shell rn-page">
      <header className="rn-head">
        <div>
          <h1>Runs</h1>
          <p>Each time data is ingested, the claims are checked against the active rules. Newest run first.</p>
        </div>
        <button type="button" className="rn-primary" onClick={() => navigate('/app/ingest')}>Ingest data</button>
      </header>

      <dl className="rn-summary">
        <div><dt>Runs</dt><dd>{count(list.length)}</dd></div>
        <div><dt>Claims accepted</dt><dd>{count(accepted)}</dd></div>
        <div><dt>Records rejected</dt><dd className={rejected ? 'is-fail' : ''}>{count(rejected)}</dd></div>
        <div><dt>Runs needing attention</dt><dd className={withProblems ? 'is-unable' : ''}>{count(withProblems)}</dd></div>
      </dl>

      <section className="rn-card" aria-label="Ingestion runs">
        {list.length === 0 ? (
          <p className="rn-empty">
            No runs yet. <button type="button" className="rn-link" onClick={() => navigate('/app/ingest')}>Ingest data</button> to create the first one.
          </p>
        ) : (
          <div className="rn-scroll">
            <table className="rn-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="rn-right">Records</th>
                  <th scope="col" className="rn-right">Accepted</th>
                  <th scope="col" className="rn-right">Rejected</th>
                  <th scope="col" className="rn-right">Rule checks</th>
                  <th scope="col" className="rn-col-bar">Pass rate</th>
                  <th scope="col" className="rn-right">Failures</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((item) => (
                  <tr key={item.run.run_id} onClick={() => openRun(item.run.run_id)}>
                    <th scope="row">
                      <button
                        type="button"
                        className="rn-run"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRun(item.run.run_id);
                        }}
                      >
                        Run {item.number}
                      </button>
                      <span className="rn-id">{item.run.run_id.slice(0, 8)}</span>
                    </th>
                    <td>{item.run.source}</td>
                    <td className="rn-right rn-num">{count(item.run.total_records)}</td>
                    <td className="rn-right rn-num">{count(item.run.accepted_claims)}</td>
                    <td className={`rn-right rn-num${item.run.rejected_records ? ' is-fail' : ''}`}>{count(item.run.rejected_records)}</td>
                    <td className="rn-right rn-num">{count(item.checks)}</td>
                    <td className="rn-col-bar">
                      {item.checks ? (
                        <span className="rn-rate">
                          <Meter value={item.pass} max={item.checks} className="is-pass" />
                          <span className="rn-share">{share(item.pass, item.checks)}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="rn-right rn-num is-fail">{count(item.fail)}</td>
                    <td className="rn-notes">
                      {item.run.accepted_claims === 0 && <span className="rn-note is-fail">Every record rejected</span>}
                      {item.invalid > 0 && <span className="rn-note is-unable">{count(item.invalid)} invalid results</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RunDetail({ stats, rules, onBack }: { stats: RunStats; rules: RuleSummary[]; onBack: () => void }) {
  const { run } = stats;
  const titles = new Map(rules.map((rule) => [rule.rule_id, rule.title]));
  const active = new Set(rules.filter((rule) => rule.status === 'active').map((rule) => rule.rule_id));
  const counts = run.status_counts ?? {};
  const reasons = Object.entries(run.rejected_reasons ?? {}).sort((a, b) => b[1] - a[1]);
  const invalidRules = Object.entries(run.invalid_results ?? {});
  const ruleRows = Object.entries(run.rule_counts ?? {})
    .map(([ruleId, ruleCounts]) => {
      const total = Object.values(ruleCounts).reduce((sum, n) => sum + n, 0);
      const invalid = Object.entries(ruleCounts).filter(([key]) => !KNOWN.has(key)).reduce((sum, [, n]) => sum + n, 0);
      return { ruleId, total, invalid, pass: ruleCounts.PASS ?? 0, fail: ruleCounts.FAIL ?? 0, unable: ruleCounts.UNABLE_TO_ASSESS ?? 0, na: ruleCounts.NOT_APPLICABLE ?? 0 };
    })
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const maxFail = Math.max(1, ...ruleRows.map((row) => row.fail));

  return (
    <div className="page-shell rn-page">
      <button type="button" className="rn-back" onClick={onBack}>All runs</button>

      <header className="rn-head">
        <div>
          <h1>Run {stats.number}</h1>
          <p>
            {run.source} upload · <span className="rn-id">{run.run_id}</span>
          </p>
        </div>
      </header>

      <dl className="rn-summary">
        <div><dt>Records</dt><dd>{count(run.total_records)}</dd></div>
        <div><dt>Accepted</dt><dd>{count(run.accepted_claims)}</dd></div>
        <div><dt>Rejected</dt><dd className={run.rejected_records ? 'is-fail' : ''}>{count(run.rejected_records)}</dd></div>
        <div><dt>Rule checks</dt><dd>{count(stats.checks)}</dd></div>
      </dl>

      {(reasons.length > 0 || invalidRules.length > 0) && (
        <section className="rn-card rn-pad" aria-label="Problems in this run">
          <h2>Needs attention</h2>
          <ul className="rn-problems">
            {reasons.map(([reason, n]) => (
              <li key={reason}>
                <span className="is-fail">{count(n)} record{n === 1 ? '' : 's'} rejected</span>: {REASON_LABEL[reason] ?? reason}
                <span className="rn-code">{reason}</span>
              </li>
            ))}
            {invalidRules.map(([ruleId, n]) => (
              <li key={ruleId}>
                <span className="is-unable">{count(n)} invalid results from {ruleId}</span>
                {titles.get(ruleId) ? ` (${titles.get(ruleId)})` : ''}: the rule returned a status outside PASS, FAIL, UNABLE_TO_ASSESS and NOT_APPLICABLE, so these results are not counted as failures.
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="rn-grid">
        <section className="rn-card rn-pad" aria-labelledby="rn-outcomes">
          <h2 id="rn-outcomes">Rule results</h2>
          {stats.checks === 0 ? (
            <p className="rn-empty is-inline">This run produced no rule results.</p>
          ) : (
            <ul className="rn-rows">
              {STATUSES.filter((status) => status.key !== 'NOT_IMPLEMENTED' || counts[status.key]).map((status) => (
                <li key={status.key}>
                  <span className={`rn-word ${status.className}`}>{status.label}</span>
                  <Meter value={counts[status.key] ?? 0} max={stats.checks} className={status.className} />
                  <span className="rn-num">{count(counts[status.key] ?? 0)}</span>
                  <span className="rn-share">{share(counts[status.key] ?? 0, stats.checks)}</span>
                </li>
              ))}
              {stats.invalid > 0 && (
                <li>
                  <span className="rn-word is-unable">Invalid status</span>
                  <Meter value={stats.invalid} max={stats.checks} className="is-unable" />
                  <span className="rn-num">{count(stats.invalid)}</span>
                  <span className="rn-share">{share(stats.invalid, stats.checks)}</span>
                </li>
              )}
            </ul>
          )}
        </section>

        <section className="rn-card rn-pad" aria-labelledby="rn-claims">
          <h2 id="rn-claims">Per claim</h2>
          {run.accepted_claims === 0 ? (
            <p className="rn-empty is-inline">No claims were accepted, so no rules ran.</p>
          ) : (
            <dl className="rn-facts">
              <div><dt>Rule checks per claim</dt><dd>{(stats.checks / run.accepted_claims).toFixed(1)}</dd></div>
              <div><dt>Failures per claim</dt><dd className="is-fail">{(stats.fail / run.accepted_claims).toFixed(2)}</dd></div>
              <div><dt>Unable to assess per claim</dt><dd className="is-unable">{(stats.unable / run.accepted_claims).toFixed(2)}</dd></div>
              <div><dt>Acceptance rate</dt><dd>{share(run.accepted_claims, run.total_records)}</dd></div>
            </dl>
          )}
        </section>
      </div>

      {ruleRows.length > 0 && (
        <section className="rn-card" aria-labelledby="rn-rules">
          <h2 id="rn-rules" className="rn-pad-head">Results by rule</h2>
          <div className="rn-scroll">
            <table className="rn-table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col" className="rn-right">Checks</th>
                  <th scope="col" className="rn-right">Pass</th>
                  <th scope="col" className="rn-right">Fail</th>
                  <th scope="col" className="rn-right">Unable</th>
                  <th scope="col" className="rn-right">N/A</th>
                  <th scope="col" className="rn-col-bar">Failures</th>
                </tr>
              </thead>
              <tbody className="is-static">
                {ruleRows.map((row) => (
                  <tr key={row.ruleId}>
                    <th scope="row">
                      <span className="rn-rule">{row.ruleId}</span> {titles.get(row.ruleId) ?? 'Rule no longer in the catalogue'}
                      {!active.has(row.ruleId) && rules.length > 0 && <span className="rn-note is-muted">inactive</span>}
                      {row.invalid > 0 && <span className="rn-note is-unable">{count(row.invalid)} invalid</span>}
                    </th>
                    <td className="rn-right rn-num">{count(row.total)}</td>
                    <td className="rn-right rn-num">{count(row.pass)}</td>
                    <td className={`rn-right rn-num${row.fail ? ' is-fail' : ''}`}>{count(row.fail)}</td>
                    <td className={`rn-right rn-num${row.unable ? ' is-unable' : ''}`}>{count(row.unable)}</td>
                    <td className="rn-right rn-num">{count(row.na)}</td>
                    <td className="rn-col-bar"><Meter value={row.fail} max={maxFail} className="is-fail" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
