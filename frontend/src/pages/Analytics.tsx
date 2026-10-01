import { useState } from 'react';

interface AnalyticsProps {
  onNavigate: (page: string) => void;
}

/* ─── SVG CHART HELPERS ─────────────────────────────────────────────────────── */

const VOLUME_DATA = [
  { date: 'Sep 1', claims: 28 }, { date: 'Sep 3', claims: 34 }, { date: 'Sep 5', claims: 42 },
  { date: 'Sep 7', claims: 38 }, { date: 'Sep 9', claims: 51 }, { date: 'Sep 11', claims: 47 },
  { date: 'Sep 13', claims: 55 }, { date: 'Sep 15', claims: 62 }, { date: 'Sep 17', claims: 58 },
  { date: 'Sep 19', claims: 71 }, { date: 'Sep 21', claims: 65 }, { date: 'Sep 23', claims: 74 },
  { date: 'Sep 25', claims: 82 }, { date: 'Sep 27', claims: 78 }, { date: 'Sep 29', claims: 88 },
];

const UTA_TREND_DATA = [
  { date: 'Sep 1', pct: 5.2 }, { date: 'Sep 5', pct: 6.1 }, { date: 'Sep 9', pct: 4.8 },
  { date: 'Sep 13', pct: 5.5 }, { date: 'Sep 17', pct: 4.2 }, { date: 'Sep 21', pct: 3.9 },
  { date: 'Sep 25', pct: 4.8 }, { date: 'Sep 29', pct: 4.3 },
];

function AreaChart({ data, color, fillColor, width = 600, height = 160 }: {
  data: { date: string; claims: number }[];
  color: string;
  fillColor: string;
  width?: number;
  height?: number;
}) {
  const pad = { top: 10, right: 20, bottom: 28, left: 42 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map(d => d.claims));
  const minVal = 0;

  const toX = (i: number) => pad.left + (i / (data.length - 1)) * w;
  const toY = (v: number) => pad.top + h - ((v - minVal) / (maxVal - minVal)) * h;

  const pts = data.map((d, i) => `${toX(i)},${toY(d.claims)}`).join(' ');
  const areaPath = `M ${toX(0)},${toY(0)} ${data.map((d, i) => `L ${toX(i)},${toY(d.claims)}`).join(' ')} L ${toX(data.length - 1)},${pad.top + h} L ${toX(0)},${pad.top + h} Z`;

  const gridLines = 4;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {Array.from({ length: gridLines }).map((_, i) => {
        const y = pad.top + (i / (gridLines - 1)) * h;
        const val = Math.round(maxVal - (i / (gridLines - 1)) * (maxVal - minVal));
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={pad.left + w} y2={y} stroke="#f1f5f9" strokeWidth="1" />
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="JetBrains Mono, monospace">{val}</text>
          </g>
        );
      })}

      {/* X-axis labels — show every 3rd */}
      {data.filter((_, i) => i % 3 === 0).map((d, idx) => {
        const origIdx = idx * 3;
        return (
          <text key={d.date} x={toX(origIdx)} y={height - 4} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="JetBrains Mono, monospace">{d.date}</text>
        );
      })}

      {/* Area fill */}
      <path d={areaPath} fill={fillColor} />
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {/* Data dots — endpoints only */}
      {[data[0], data[data.length - 1]].map((d, i) => {
        const idx = i === 0 ? 0 : data.length - 1;
        return <circle key={i} cx={toX(idx)} cy={toY(d.claims)} r="3" fill={color} />;
      })}
    </svg>
  );
}

function LineChart({ data, color, width = 300, height = 80 }: {
  data: { date: string; pct: number }[];
  color: string;
  width?: number;
  height?: number;
}) {
  const pad = { top: 6, right: 12, bottom: 6, left: 12 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map(d => d.pct)) + 1;
  const minVal = Math.max(0, Math.min(...data.map(d => d.pct)) - 1);

  const toX = (i: number) => pad.left + (i / (data.length - 1)) * w;
  const toY = (v: number) => pad.top + h - ((v - minVal) / (maxVal - minVal)) * h;

  const pts = data.map((d, i) => `${toX(i)},${toY(d.pct)}`).join(' ');
  const area = `M ${toX(0)},${pad.top + h} ${data.map((d, i) => `L ${toX(i)},${toY(d.pct)}`).join(' ')} L ${toX(data.length - 1)},${pad.top + h} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <path d={area} fill={`${color}15`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HorizontalBar({ label, ruleId, count, maxCount, color, onRuleClick }: {
  label: string; ruleId: string; count: number; maxCount: number; color: string; onRuleClick: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const pct = (count / maxCount) * 100;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', cursor: 'default' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)', minWidth: 36 }}>{ruleId}</span>
      <span style={{ fontSize: '0.8125rem', color: '#334155', minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, position: 'relative', height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 70, justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', minWidth: 28, textAlign: 'right' }}>{count}</span>
        {hovered && (
          <button
            onClick={() => onRuleClick(ruleId)}
            style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}
          >
            View rule →
          </button>
        )}
      </div>
    </div>
  );
}

const FINDINGS_BY_RULE = [
  { ruleId: 'R008', label: 'Authorization reference', count: 42, color: '#f43f5e' },
  { ruleId: 'R003', label: 'Service date validity', count: 31, color: '#f59e0b' },
  { ruleId: 'R005', label: 'Duplicate service check', count: 18, color: '#f43f5e' },
  { ruleId: 'R009', label: 'Authorization validity', count: 15, color: '#f59e0b' },
  { ruleId: 'R004', label: 'Benefit coverage', count: 11, color: '#f43f5e' },
  { ruleId: 'R013', label: 'Diagnosis–procedure alignment', count: 8, color: '#f59e0b' },
  { ruleId: 'R002', label: 'Provider eligibility', count: 5, color: '#f43f5e' },
];

const OUTCOME_DATA = [
  { label: 'PASS', count: 1007, pct: 78.4, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
  { label: 'NEEDS REVIEW', count: 216, pct: 16.8, color: 'var(--status-review)', bg: 'var(--status-review-bg)', border: 'var(--status-review-border)' },
  { label: 'UNABLE TO ASSESS', count: 62, pct: 4.8, color: 'var(--status-uta)', bg: 'var(--status-uta-bg)', border: 'var(--status-uta-border)' },
  { label: 'FAIL', count: 47, pct: 3.7, color: 'var(--status-fail)', bg: 'var(--status-fail-bg)', border: 'var(--status-fail-border)' },
];

const MISSING_EVIDENCE = [
  { label: 'Authorization reference', pct: 46 },
  { label: 'Coverage information', pct: 28 },
  { label: 'Supporting documentation', pct: 17 },
  { label: 'Rendering provider NPI', pct: 9 },
];

const DATE_RANGES = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'All time'];
const DATASETS = ['All datasets', 'Development Suite (10 claims)', 'Meridian Q3 Batch', 'Pacific Medical Batch'];
const POLICY_OPTIONS = ['All policies', 'EDU-BASIC', 'EDU-PLUS'];

export default function Analytics({ onNavigate }: AnalyticsProps) {
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [dataset, setDataset] = useState('All datasets');
  const [policyFilter, setPolicyFilter] = useState('All policies');

  const kpis = [
    { label: 'Claims processed', value: '1,284', sub: '+12% vs prior period', subPos: true, color: 'var(--accent)', onClick: () => onNavigate('claims') },
    { label: 'Validation pass rate', value: '78.4%', sub: 'Of all evaluated claims', subPos: null, color: '#10b981', onClick: null },
    { label: 'Unable to assess', value: '4.8%', sub: 'Missing evidence', subPos: null, color: '#f59e0b', onClick: null },
    { label: 'Review rate', value: '16.8%', sub: 'Human review required', subPos: null, color: 'var(--status-review)', onClick: () => onNavigate('review-queue') },
  ];

  const maxFindings = Math.max(...FINDINGS_BY_RULE.map(r => r.count));

  const handleRuleClick = (ruleId: string) => {
    onNavigate('rules');
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#0f172a', marginBottom: 4 }}>Analytics</h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Understand claim validation trends, rule performance, and review workload over time.</p>
        </div>
      </div>

      {/* Scope / filter bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16, boxShadow: 'var(--card-shadow)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="#94a3b8" strokeWidth="1.2"/><path d="M7 4v3.5l2 1.5" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 500 }}>Period</span>
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={{ background: 'transparent', border: 'none', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {DATE_RANGES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2" width="11" height="10" rx="2" stroke="#94a3b8" strokeWidth="1.2"/><path d="M4 6h6M4 8.5h4" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 500 }}>Dataset</span>
          <select value={dataset} onChange={e => setDataset(e.target.value)} style={{ background: 'transparent', border: 'none', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {DATASETS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l6 2.5v4.5C13 11 10 13.5 7 14 4 13.5 1 11 1 8V3.5L7 1z" stroke="#94a3b8" strokeWidth="1.2" strokeLinejoin="round"/></svg>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 500 }}>Policy</span>
          <select value={policyFilter} onChange={e => setPolicyFilter(e.target.value)} style={{ background: 'transparent', border: 'none', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {POLICY_OPTIONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: '#94a3b8' }}>
          Showing: <strong style={{ color: '#334155' }}>1,284</strong> claims
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {kpis.map(kpi => (
          <div
            key={kpi.label}
            className="kpi-card"
            onClick={kpi.onClick ? kpi.onClick : undefined}
            style={{ cursor: kpi.onClick ? 'pointer' : 'default', transition: 'all 0.15s ease', position: 'relative' }}
            onMouseEnter={e => { if (kpi.onClick) { e.currentTarget.style.boxShadow = 'var(--card-shadow-md)'; e.currentTarget.style.borderColor = '#cbd5e1'; } }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--card-shadow)'; e.currentTarget.style.borderColor = '#e8eaed'; }}
          >
            {kpi.onClick && (
              <div style={{ position: 'absolute', top: 14, right: 14 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="#cbd5e1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            )}
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.625rem', fontWeight: 700, color: kpi.color, letterSpacing: '-0.04em', marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: '0.75rem', color: kpi.subPos === true ? '#059669' : kpi.subPos === false ? '#e11d48' : '#94a3b8' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Volume trend — full width */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 16, boxShadow: 'var(--card-shadow)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Claims processed over time</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Daily volume · {dateRange}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent)' }} />
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Claims processed</span>
          </div>
        </div>
        <AreaChart data={VOLUME_DATA} color="var(--accent)" fillColor="var(--accent-subtle)" />
      </div>

      {/* Two-col row: Outcome distribution + Review workload */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Outcome distribution */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Validation outcomes</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Distribution across {(1007 + 216 + 62 + 47).toLocaleString()} evaluated claims</p>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {/* Stacked bar */}
            <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 18 }}>
              {OUTCOME_DATA.map(o => <div key={o.label} style={{ width: `${o.pct}%`, background: o.color, transition: 'width 0.3s ease' }} />)}
            </div>
            {OUTCOME_DATA.map(o => (
              <div key={o.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: o.color, flexShrink: 0 }} />
                  <span style={{ color: '#334155', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.03em' }}>{o.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9375rem', fontWeight: 700, color: o.color, minWidth: 44, textAlign: 'right' }}>{o.count}</span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: 40, textAlign: 'right' }}>{o.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Review workload */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Human review workload</h3>
              <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Reviewer actions · {dateRange}</p>
            </div>
            <button onClick={() => onNavigate('review-queue')} style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>View queue</button>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Claims requiring review', value: 216, color: 'var(--status-review)', sub: '16.8% of total' },
              { label: 'Confirmed findings', value: 148, color: '#f43f5e', sub: '68.5% of reviewed' },
              { label: 'Dismissed findings', value: 42, color: '#10b981', sub: '19.4% of reviewed' },
              { label: 'Requests for information', value: 26, color: '#f59e0b', sub: '12.0% of reviewed' },
              { label: 'Re-checks completed', value: 19, color: 'var(--accent)', sub: 'After correction' },
            ].map(m => (
              <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{m.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1rem', fontWeight: 700, color: m.color }}>{m.value}</span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{m.sub}</span>
                </div>
              </div>
            ))}
            <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Avg. time to review</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9375rem', fontWeight: 700, color: '#334155' }}>4m 12s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Findings by rule — full width */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)', marginBottom: 16 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Findings by rule</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Total rule-level findings across all evaluated claims. Click a rule to view its definition.</p>
          </div>
          <button onClick={() => onNavigate('rules')} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 12px', fontSize: '0.8125rem', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
            View all rules
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div style={{ padding: '16px 24px' }}>
          {FINDINGS_BY_RULE.map(r => (
            <div key={r.ruleId} style={{ borderBottom: '1px solid #f8fafc' }}>
              <HorizontalBar
                ruleId={r.ruleId}
                label={r.label}
                count={r.count}
                maxCount={maxFindings}
                color={r.color}
                onRuleClick={handleRuleClick}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Two-col row: Unable to assess + Validation quality */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Unable to assess */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Unable to assess</h3>
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>4.8% rate · 62 claims this period</p>
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, color: '#f59e0b', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 8px' }}>4.8%</span>
            </div>
          </div>
          <div style={{ padding: '14px 20px 6px' }}>
            <div style={{ marginBottom: 16 }}>
              <LineChart data={UTA_TREND_DATA} color="#f59e0b" />
              <div style={{ fontSize: '0.6875rem', color: '#94a3b8', textAlign: 'center', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>Rate trend · Sep 1 – Sep 29</div>
            </div>
            <div style={{ height: 1, background: '#f1f5f9', marginBottom: 14 }} />
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Top missing evidence</div>
            {MISSING_EVIDENCE.map(m => (
              <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{m.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 60, height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${m.pct}%`, background: '#f59e0b', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 700, color: '#f59e0b', minWidth: 32, textAlign: 'right' }}>{m.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Validation quality */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Validation quality</h3>
              <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Based on evaluation runs with ground truth</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '3px 8px' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1l4 7H1L5 1z" stroke="#f59e0b" strokeWidth="1"/><path d="M5 3.5v2.5M5 7.5v.3" stroke="#f59e0b" strokeWidth="1" strokeLinecap="round"/></svg>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#92400e' }}>Evaluation data</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              {[
                { label: 'Status accuracy', value: '98.2%', color: '#0f172a', desc: 'Correct across all claims' },
                { label: 'Issue precision', value: '97.8%', color: '#10b981', desc: 'True positive rate' },
                { label: 'Issue recall', value: '96.2%', color: 'var(--accent)', desc: 'Sensitivity' },
                { label: 'Issue F1', value: '97.0%', color: 'var(--status-review)', desc: 'Harmonic mean' },
              ].map(m => (
                <div key={m.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '12px 14px' }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.125rem', fontWeight: 700, color: m.color, letterSpacing: '-0.02em', marginBottom: 3 }}>{m.value}</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', marginBottom: 1 }}>{m.label}</div>
                  <div style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{m.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: '#f1f5f9', marginBottom: 14 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'False alarm rate', value: '1.2%', color: '#f43f5e', desc: 'False positives / (FP + TN)' },
                { label: 'False abstention rate', value: '0.8%', color: '#f59e0b', desc: 'UTA when assessable' },
              ].map(m => (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#334155' }}>{m.label}</div>
                    <div style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{m.desc}</div>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1rem', fontWeight: 700, color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: '0.6875rem', color: '#94a3b8', lineHeight: 1.5 }}>
                Metrics based on <strong style={{ color: '#334155' }}>RUN-4817 – RUN-4821</strong> · Ground truth from annotated sample. Numbers are evaluation estimates, not production claims.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
