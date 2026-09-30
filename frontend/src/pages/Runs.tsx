import { useState } from 'react';
import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';

const RUNS = [
  { id: 'RUN-4821', dataset: 'Meridian Q3 Batch', ruleset: 'v2.4.1', model: 'CGM-3.1', status: 'completed', claims: 24, duration: '18.4s', precision: 97.8, recall: 96.2, f1: 97.0, accuracy: 98.2, far: 1.2, fabr: 0.8, started: 'Today 10:31', sentinel: 'pass' as SentinelState },
  { id: 'RUN-4820', dataset: 'Pacific Medical Batch', ruleset: 'v2.4.1', model: 'CGM-3.1', status: 'completed', claims: 18, duration: '14.1s', precision: 95.5, recall: 94.1, f1: 94.8, accuracy: 96.7, far: 2.1, fabr: 1.4, started: 'Today 09:44', sentinel: 'pass' as SentinelState },
  { id: 'RUN-4819', dataset: 'Eastern Group Audit', ruleset: 'v2.4.0', model: 'CGM-3.1', status: 'completed', claims: 52, duration: '41.8s', precision: 98.4, recall: 97.9, f1: 98.1, accuracy: 99.1, far: 0.8, fabr: 0.5, started: 'Yesterday 16:22', sentinel: 'pass' as SentinelState },
  { id: 'RUN-4818', dataset: 'Emergency Review Dataset', ruleset: 'v2.4.0', model: 'CGM-3.1', status: 'failed', claims: 8, duration: '–', precision: 0, recall: 0, f1: 0, accuracy: 0, far: 0, fabr: 0, started: 'Yesterday 14:05', sentinel: 'fail' as SentinelState },
  { id: 'RUN-4817', dataset: 'Monthly Audit Sample', ruleset: 'v2.3.9', model: 'CGM-3.0', status: 'completed', claims: 100, duration: '82.3s', precision: 94.2, recall: 93.8, f1: 94.0, accuracy: 95.6, far: 3.1, fabr: 2.2, started: 'Sep 24, 17:00', sentinel: 'pass' as SentinelState },
];

const RULE_BREAKDOWN = [
  { id: 'R001', name: 'Member eligibility', pass: 22, fail: 2, uta: 0, na: 0 },
  { id: 'R002', name: 'Provider enrollment', pass: 24, fail: 0, uta: 0, na: 0 },
  { id: 'R003', name: 'Service date validity', pass: 23, fail: 1, uta: 0, na: 0 },
  { id: 'R005', name: 'Duplicate claim check', pass: 24, fail: 0, uta: 0, na: 0 },
  { id: 'R008', name: 'Authorization reference', pass: 18, fail: 4, uta: 0, na: 2 },
  { id: 'R009', name: 'Authorization validity', pass: 16, fail: 2, uta: 4, na: 2 },
  { id: 'R013', name: 'Diagnosis-procedure', pass: 22, fail: 2, uta: 0, na: 0 },
  { id: 'R015', name: 'Coordination of benefits', pass: 12, fail: 0, uta: 0, na: 12 },
];

const STATUS_DIST = [
  { status: 'PASS', count: 14, pct: 58.3, color: 'var(--status-pass)', bg: 'var(--status-pass-bg)', border: 'var(--status-pass-border)' },
  { status: 'NEEDS REVIEW', count: 6, pct: 25.0, color: 'var(--status-review)', bg: 'var(--status-review-bg)', border: 'var(--status-review-border)' },
  { status: 'FAIL', count: 3, pct: 12.5, color: 'var(--status-fail)', bg: 'var(--status-fail-bg)', border: 'var(--status-fail-border)' },
  { status: 'UNABLE TO ASSESS', count: 1, pct: 4.2, color: 'var(--status-uta)', bg: 'var(--status-uta-bg)', border: 'var(--status-uta-border)' },
];

export default function Runs() {
  const [selectedRun, setSelectedRun] = useState(RUNS[0]);
  const [view, setView] = useState<'table' | 'detail'>('table');

  const openRun = (run: typeof RUNS[0]) => {
    setSelectedRun(run);
    setView('detail');
  };

  if (view === 'detail') {
    const run = selectedRun;
    const metrics = [
      { label: 'Issue precision', value: `${run.precision}%`, desc: 'True positives / (TP + FP)', color: '#10b981' },
      { label: 'Issue recall', value: `${run.recall}%`, desc: 'True positives / (TP + FN)', color: 'var(--accent)' },
      { label: 'Issue F1', value: `${run.f1}%`, desc: 'Harmonic mean of precision & recall', color: 'var(--status-review)' },
      { label: 'Status accuracy', value: `${run.accuracy}%`, desc: 'Correct status across all claims', color: '#0f172a' },
      { label: 'False alarm rate', value: `${run.far}%`, desc: 'False positives / (FP + TN)', color: '#f43f5e' },
      { label: 'False abstention', value: `${run.fabr}%`, desc: 'Unable to assess when assessable', color: '#f59e0b' },
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
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em', marginBottom: 4 }}>
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
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: '#334155' }}>{f.value}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{run.started}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: run.status === 'completed' ? '#ecfdf5' : '#fff1f2',
              color: run.status === 'completed' ? '#059669' : '#e11d48',
              border: `1px solid ${run.status === 'completed' ? '#a7f3d0' : '#fecdd3'}`,
              borderRadius: 20, padding: '4px 12px',
              fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: run.status === 'completed' ? '#10b981' : '#f43f5e' }} />
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
                    fontFamily: "'JetBrains Mono', monospace",
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
                {STATUS_DIST.map(s => (
                  <div key={s.status} style={{ width: `${s.pct}%`, background: s.color, transition: 'width 0.3s ease' }} />
                ))}
              </div>
              {STATUS_DIST.map(s => (
                <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                    <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{s.status}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 700, color: s.color }}>{s.count}</span>
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
              {RULE_BREAKDOWN.map(r => {
                const total = r.pass + r.fail + r.uta + r.na;
                return (
                  <tr key={r.id}>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)' }}>{r.id}</span></td>
                    <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{r.name}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#10b981' }}>{r.pass}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: r.fail > 0 ? '#f43f5e' : '#94a3b8' }}>{r.fail}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: r.uta > 0 ? '#f59e0b' : '#94a3b8' }}>{r.uta}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#94a3b8' }}>{r.na}</span></td>
                    <td>
                      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', width: 120 }}>
                        <div style={{ width: `${(r.pass / total) * 100}%`, background: '#10b981' }} />
                        <div style={{ width: `${(r.fail / total) * 100}%`, background: '#f43f5e' }} />
                        <div style={{ width: `${(r.uta / total) * 100}%`, background: '#f59e0b' }} />
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
          { label: 'Total runs', value: '4,821', sub: 'All time', color: 'var(--accent)' },
          { label: 'Avg precision', value: '96.5%', sub: 'Last 30 days', color: '#10b981' },
          { label: 'Claims processed', value: '28,441', sub: 'Last 30 days', color: 'var(--status-review)' },
          { label: 'Avg latency', value: '1.2s', sub: 'Per claim', color: '#f59e0b' },
        ].map(m => (
          <div key={m.label} className="kpi-card">
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', fontWeight: 700, color: m.color, letterSpacing: '-0.04em', marginBottom: 4 }}>
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
            {RUNS.map(run => (
              <tr key={run.id} onClick={() => openRun(run)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sentinel state={run.sentinel} size={18} />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a' }}>{run.id}</span>
                  </div>
                </td>
                <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{run.dataset}</span></td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#64748b' }}>{run.ruleset}</span></td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#64748b' }}>{run.model}</span></td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{run.claims}</span></td>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: run.status === 'completed' ? '#ecfdf5' : '#fff1f2',
                    color: run.status === 'completed' ? '#059669' : '#e11d48',
                    border: `1px solid ${run.status === 'completed' ? '#a7f3d0' : '#fecdd3'}`,
                    borderRadius: 20, padding: '2px 8px',
                    fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: run.status === 'completed' ? '#10b981' : '#f43f5e' }} />
                    {run.status}
                  </span>
                </td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: '#10b981' }}>{run.precision > 0 ? `${run.precision}%` : '–'}</span></td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: 'var(--accent)' }}>{run.recall > 0 ? `${run.recall}%` : '–'}</span></td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: 'var(--status-review)' }}>{run.f1 > 0 ? `${run.f1}%` : '–'}</span></td>
                <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', color: '#64748b' }}>{run.duration}</span></td>
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
