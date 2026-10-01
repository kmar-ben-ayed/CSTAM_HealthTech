import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
import { createDatasetRun, getRuns, type DatasetRun } from '../api/runs';
import { DATASET_SPLITS, type DatasetSplit } from '../hooks/useOperationalData';

export default function Runs() {
  const [runs, setRuns] = useState<DatasetRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<DatasetRun | null>(null);
  const [split, setSplit] = useState<DatasetSplit>('development');
  const [view, setView] = useState<'table' | 'detail'>('table');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getRuns(500, controller.signal)
      .then((response) => setRuns(response.runs))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Run history could not be loaded.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const openRun = (run: DatasetRun) => {
    setSelectedRun(run);
    setView('detail');
  };

  const startRun = async () => {
    setCreating(true);
    setError(null);
    try {
      const run = await createDatasetRun(split);
      setRuns((current) => [run, ...current]);
      setSelectedRun(run);
      setView('detail');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The dataset run could not be created.');
    } finally {
      setCreating(false);
    }
  };

  const benchmarkRuns = runs.filter((run) => run.benchmark);
  const averagePrecision = benchmarkRuns.length
    ? benchmarkRuns.reduce((sum, run) => sum + (run.benchmark?.issue_precision || 0), 0) / benchmarkRuns.length
    : null;
  const processedClaims = runs.reduce((sum, run) => sum + run.claim_count, 0);

  if (view === 'detail' && selectedRun) {
    const run = selectedRun;
    const benchmark = run.benchmark;
    const metric = (value: number | null | undefined) => value == null ? 'Not available' : `${(value * 100).toFixed(1)}%`;
    const metrics = benchmark ? [
      { label: 'Issue precision', value: metric(benchmark.issue_precision), desc: 'True positives / (TP + FP)', color: '#1f7a5c' },
      { label: 'Issue recall', value: metric(benchmark.issue_recall), desc: 'True positives / (TP + FN)', color: 'var(--accent)' },
      { label: 'Issue F1', value: metric(benchmark.issue_f1), desc: 'Harmonic mean of precision & recall', color: 'var(--status-review)' },
      { label: 'Status accuracy', value: metric(benchmark.status_accuracy), desc: 'Exact status matches on labeled results', color: '#0f172a' },
      { label: 'False alarm rate', value: metric(benchmark.false_alarm_rate), desc: 'False positives / (FP + TN)', color: '#b4403f' },
      { label: 'False abstentions', value: String(benchmark.false_abstentions), desc: 'Unable-to-assess where a label exists', color: '#96650f' },
    ] : [];
    const statusColors: Record<string, { color: string; bg: string; border: string }> = {
      PASS: { color: 'var(--status-pass)', bg: 'var(--status-pass-bg)', border: 'var(--status-pass-border)' },
      FAIL: { color: 'var(--status-fail)', bg: 'var(--status-fail-bg)', border: 'var(--status-fail-border)' },
      UNABLE_TO_ASSESS: { color: 'var(--status-uta)', bg: 'var(--status-uta-bg)', border: 'var(--status-uta-border)' },
      NOT_APPLICABLE: { color: 'var(--status-na)', bg: 'var(--status-na-bg)', border: 'var(--status-na-border)' },
      NOT_IMPLEMENTED: { color: 'var(--text-tertiary)', bg: 'var(--canvas-bg)', border: 'var(--border)' },
    };
    const statusDistribution = Object.entries(run.status_counts).map(([status, count]) => ({
      status,
      count,
      pct: run.result_count ? count / run.result_count * 100 : 0,
      ...statusColors[status],
    }));
    const ruleBreakdown = Object.entries(run.rule_status_counts).map(([id, counts]) => ({ id, counts }));

    return (
      <div className="page-shell">
        {/* Back */}
        <button
          onClick={() => setView('table')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit', fontWeight: 500, marginBottom: 24, padding: '4px 0' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Runs
        </button>

        {/* Run header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Sentinel state="pass" size={52} />
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em', marginBottom: 4 }}>
                {run.run_id}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Source', value: `${run.source.split} synthetic dataset` },
                  { label: 'Claims', value: String(run.claim_count) },
                  { label: 'Rule results', value: String(run.result_count) },
                  { label: 'Started', value: new Date(run.started_at).toLocaleString() },
                ].map(f => (
                  <span key={f.label} style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                    <span style={{ color: '#94a3b8' }}>{f.label}: </span>
                    <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: '#334155' }}>{f.value}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{new Date(run.finished_at).toLocaleString()}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: run.status === 'completed' ? '#e9f5ef' : '#fbefee',
              color: run.status === 'completed' ? '#1a6a4f' : '#9a3433',
              border: `1px solid ${run.status === 'completed' ? '#c4e1d1' : '#e9c8c7'}`,
              borderRadius: 20, padding: '4px 12px',
              fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: run.status === 'completed' ? '#1f7a5c' : '#b4403f' }} />
              {run.status}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Metrics */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.02em' }}>Performance metrics</h3>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {metrics.map(m => (
                <div key={m.label} style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: '1.5rem',
                    fontWeight: 700,
                    color: m.color,
                    letterSpacing: '-0.03em',
                    marginBottom: 4,
                  }}>
                    {m.value}
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', marginBottom: 2 }}>{m.label}</div>
                  <div style={{ fontSize: '0.6875rem', color: '#94a3b8', lineHeight: 1.4 }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Status distribution */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.02em' }}>Status distribution</h3>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {/* Stacked bar */}
              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
                {statusDistribution.map(s => (
                  <div key={s.status} style={{ width: `${s.pct}%`, background: s.color, transition: 'width 0.3s ease' }} />
                ))}
              </div>
              {statusDistribution.map(s => (
                <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                    <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{s.status}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 700, color: s.color }}>{s.count}</span>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{s.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rule breakdown table */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.02em' }}>Rule findings breakdown</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Name</th>
                <th>Pass</th>
                <th>Fail</th>
                <th>Unable to assess</th>
                <th>Not applicable</th>
                <th>Distribution</th>
              </tr>
            </thead>
            <tbody>
              {ruleBreakdown.map(r => {
                const pass = r.counts.PASS || 0;
                const fail = r.counts.FAIL || 0;
                const uta = r.counts.UNABLE_TO_ASSESS || 0;
                const na = r.counts.NOT_APPLICABLE || 0;
                const total = Object.values(r.counts).reduce((sum, count) => sum + count, 0);
                return (
                  <tr key={r.id}>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)' }}>{r.id}</span></td>
                    <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{r.id}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: '#1f7a5c' }}>{pass}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: fail > 0 ? '#b4403f' : '#94a3b8' }}>{fail}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: uta > 0 ? '#96650f' : '#94a3b8' }}>{uta}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: '#94a3b8' }}>{na}</span></td>
                    <td>
                      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', width: 120 }}>
                        <div style={{ width: `${total ? pass / total * 100 : 0}%`, background: '#1f7a5c' }} />
                        <div style={{ width: `${total ? fail / total * 100 : 0}%`, background: '#b4403f' }} />
                        <div style={{ width: `${total ? uta / total * 100 : 0}%`, background: '#96650f' }} />
                        <div style={{ width: `${total ? na / total * 100 : 0}%`, background: '#e2e8f0' }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#0f172a', marginBottom: 4 }}>
            Evaluation Runs
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>
            Track batch processing runs and performance metrics
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select aria-label="Dataset split for new run" value={split} onChange={(event) => setSplit(event.target.value as DatasetSplit)} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
          {DATASET_SPLITS.map((datasetSplit) => <option key={datasetSplit} value={datasetSplit}>{datasetSplit[0].toUpperCase() + datasetSplit.slice(1)}</option>)}
        </select>
        <button onClick={startRun} disabled={creating} style={{
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 7,
          padding: '8px 16px',
          color: '#fff',
          fontSize: '0.875rem',
          cursor: creating ? 'wait' : 'pointer',
          fontFamily: 'inherit',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {creating ? 'Running…' : 'Run dataset'}
        </button>
        </div>
      </div>

      {error && <div role="alert" style={{ color: 'var(--status-fail)', marginBottom: 16 }}>{error}</div>}

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total runs', value: String(runs.length), sub: 'Persisted dataset evaluations', color: 'var(--accent)' },
          { label: 'Avg issue precision', value: averagePrecision == null ? '—' : `${(averagePrecision * 100).toFixed(1)}%`, sub: `${benchmarkRuns.length} labeled runs`, color: '#1f7a5c' },
          { label: 'Claims evaluated', value: String(processedClaims), sub: 'Across saved runs', color: 'var(--status-review)' },
          { label: 'Duration', value: '—', sub: 'Not measured by the API', color: '#96650f' },
        ].map(m => (
          <div key={m.label} className="kpi-card">
            <div style={{ fontFamily: "var(--font-sans)", fontSize: '1.5rem', fontWeight: 700, color: m.color, letterSpacing: '-0.04em', marginBottom: 4 }}>
              {m.value}
            </div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: 2 }}>{m.label}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Runs table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Dataset</th>
              <th>Claims</th>
              <th>Results</th>
              <th>Status</th>
              <th>Issue F1</th>
              <th>Status accuracy</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center' }}>Loading run history…</td></tr> : runs.length === 0 ? <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>No dataset runs yet. Choose a split and run it to create the first record.</td></tr> : runs.map(run => (
              <tr key={run.run_id} onClick={() => openRun(run)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sentinel state="pass" size={18} />
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a' }}>{run.run_id.slice(0, 12)}</span>
                  </div>
                </td>
                <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{run.source.split} · synthetic</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{run.claim_count}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{run.result_count}</span></td>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: run.status === 'completed' ? '#e9f5ef' : '#fbefee',
                    color: run.status === 'completed' ? '#1a6a4f' : '#9a3433',
                    border: `1px solid ${run.status === 'completed' ? '#c4e1d1' : '#e9c8c7'}`,
                    borderRadius: 20, padding: '2px 8px',
                    fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: run.status === 'completed' ? '#1f7a5c' : '#b4403f' }} />
                    {run.status}
                  </span>
                </td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: 'var(--status-review)' }}>{run.benchmark?.issue_f1 == null ? '—' : `${(run.benchmark.issue_f1 * 100).toFixed(1)}%`}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: '#334155' }}>{run.benchmark ? `${(run.benchmark.status_accuracy * 100).toFixed(1)}%` : '—'}</span></td>
                <td><span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{new Date(run.started_at).toLocaleString()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
