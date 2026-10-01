import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';
import { getIngestionRuns, type IngestionRun } from '../api/runs';

type DisplayRun = IngestionRun & {
  id: string;
  dataset: string;
  ruleset: string;
  model: string;
  claims: number;
  duration: string;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  far: number;
  fabr: number;
  started: string;
  sentinel: SentinelState;
};

export default function Runs() {
  const [runs, setRuns] = useState<DisplayRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<DisplayRun | null>(null);
  const [view, setView] = useState<'table' | 'detail'>('table');

  useEffect(() => {
    const controller = new AbortController();
    getIngestionRuns(controller.signal).then(({ runs: responseRuns }) => {
      const mapped = responseRuns.map((run) => ({
        ...run,
        id: run.run_id,
        dataset: run.source,
        ruleset: 'Backend rules',
        model: 'Deterministic engine',
        claims: run.accepted_claims,
        status_counts: run.status_counts || {},
        rule_counts: run.rule_counts || {},
        duration: '—',
        precision: 0,
        recall: 0,
        f1: 0,
        accuracy: 0,
        far: 0,
        fabr: 0,
        started: '—',
        sentinel: 'pass' as SentinelState,
      }));
      setRuns(mapped);
      setSelectedRun(mapped[0] || null);
    }).catch(() => {
      setRuns([]);
      setSelectedRun(null);
    });
    return () => controller.abort();
  }, []);

  const openRun = (run: DisplayRun) => {
    setSelectedRun(run);
    setView('detail');
  };

  if (view === 'detail' && selectedRun) {
    const run = selectedRun;
    const statusCounts = run.status_counts || {};
    const ruleCounts = run.rule_counts || {};
    const evaluationTotal = Object.values(statusCounts).reduce((total, count) => total + count, 0);
    const statusDist = Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        status: status.replaceAll('_', ' '),
        count,
        pct: evaluationTotal ? (count / evaluationTotal) * 100 : 0,
        color: status === 'PASS' ? 'var(--status-pass)' : status === 'FAIL' ? 'var(--status-fail)' : 'var(--status-uta)',
      }));
    const ruleBreakdown = Object.entries(ruleCounts).map(([id, counts]) => ({
      id,
      name: id,
      pass: counts.PASS || 0,
      fail: counts.FAIL || 0,
      uta: counts.UNABLE_TO_ASSESS || 0,
      na: counts.NOT_APPLICABLE || 0,
    }));
    const metrics = [
      { label: 'Accepted claims', value: String(run.accepted_claims), desc: 'Claims accepted from this upload', color: 'var(--accent)' },
      { label: 'Rejected records', value: String(run.rejected_records), desc: 'Records rejected during ingestion', color: 'var(--status-fail)' },
      { label: 'Pass rate', value: `${evaluationTotal ? ((statusCounts.PASS || 0) / evaluationTotal * 100).toFixed(1) : '0.0'}%`, desc: 'Rule evaluations returning PASS', color: 'var(--status-pass)' },
      { label: 'Failures', value: String(statusCounts.FAIL || 0), desc: 'Rule evaluations returning FAIL', color: 'var(--status-fail)' },
      { label: 'Unable to assess', value: String(statusCounts.UNABLE_TO_ASSESS || 0), desc: 'Evaluations missing required evidence', color: 'var(--status-uta)' },
      { label: 'Rule evaluations', value: String(evaluationTotal), desc: 'All stored rule outcomes', color: 'var(--status-review)' },
    ];

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
            <Sentinel state={run.sentinel} size={52} />
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em', marginBottom: 4 }}>
                {run.id}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Dataset', value: run.dataset },
                  { label: 'Ruleset', value: run.ruleset },
                  { label: 'AI model', value: run.model },
                  { label: 'Claims', value: String(run.claims) },
                  { label: 'Duration', value: run.duration },
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
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{run.started}</span>
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
                {statusDist.map(s => (
                  <div key={s.status} style={{ width: `${s.pct}%`, background: s.color, transition: 'width 0.3s ease' }} />
                ))}
              </div>
              {statusDist.map(s => (
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
                const total = r.pass + r.fail + r.uta + r.na;
                return (
                  <tr key={r.id}>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)' }}>{r.id}</span></td>
                    <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{r.name}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: '#1f7a5c' }}>{r.pass}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: r.fail > 0 ? '#b4403f' : '#94a3b8' }}>{r.fail}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: r.uta > 0 ? '#96650f' : '#94a3b8' }}>{r.uta}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, color: '#94a3b8' }}>{r.na}</span></td>
                    <td>
                      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', width: 120 }}>
                        <div style={{ width: `${(r.pass / total) * 100}%`, background: '#1f7a5c' }} />
                        <div style={{ width: `${(r.fail / total) * 100}%`, background: '#b4403f' }} />
                        <div style={{ width: `${(r.uta / total) * 100}%`, background: '#96650f' }} />
                        <div style={{ width: `${(r.na / total) * 100}%`, background: '#e2e8f0' }} />
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
        <button style={{
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 7,
          padding: '8px 16px',
          color: '#fff',
          fontSize: '0.875rem',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          New run
        </button>
      </div>

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total runs', value: String(runs.length), sub: 'Stored ingestion batches', color: 'var(--accent)' },
          { label: 'Avg precision', value: '—', sub: 'Not recorded by backend', color: '#1f7a5c' },
          { label: 'Claims processed', value: String(runs.reduce((total, run) => total + run.claims, 0)), sub: 'Across stored batches', color: 'var(--status-review)' },
          { label: 'Avg latency', value: '—', sub: 'Not recorded by backend', color: '#96650f' },
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
              <th>Ruleset</th>
              <th>AI model</th>
              <th>Claims</th>
              <th>Status</th>
              <th>Precision</th>
              <th>Recall</th>
              <th>F1</th>
              <th>Duration</th>
              <th>Started</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <tr key={run.id} onClick={() => openRun(run)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sentinel state={run.sentinel} size={18} />
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a' }}>{run.id}</span>
                  </div>
                </td>
                <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{run.dataset}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.75rem', color: '#64748b' }}>{run.ruleset}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.75rem', color: '#64748b' }}>{run.model}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{run.claims}</span></td>
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
                <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: '#1f7a5c' }}>{run.precision > 0 ? `${run.precision}%` : '–'}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: 'var(--accent)' }}>{run.recall > 0 ? `${run.recall}%` : '–'}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: 'var(--status-review)' }}>{run.f1 > 0 ? `${run.f1}%` : '–'}</span></td>
                <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', color: '#64748b' }}>{run.duration}</span></td>
                <td><span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{run.started}</span></td>
                <td>
                  <button
                    onClick={e => { e.stopPropagation(); openRun(run); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 4 }}
                  >
                    View
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
