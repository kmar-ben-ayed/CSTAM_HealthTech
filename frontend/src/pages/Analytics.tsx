import { useEffect, useState } from 'react';
import { getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { getRuns, type DatasetRun } from '../api/runs';
import { useOperationalData } from '../hooks/useOperationalData';
import type { DataSource } from '../hooks/useOperationalData';

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
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="var(--font-sans)">{val}</text>
          </g>
        );
      })}

      {/* X-axis labels — show every 3rd */}
      {data.filter((_, i) => i % 3 === 0).map((d, idx) => {
        const origIdx = idx * 3;
        return (
          <text key={d.date} x={toX(origIdx)} y={height - 4} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="var(--font-sans)">{d.date}</text>
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
      <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)', minWidth: 36 }}>{ruleId}</span>
      <span style={{ fontSize: '0.8125rem', color: '#334155', minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, position: 'relative', height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 70, justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', minWidth: 28, textAlign: 'right' }}>{count}</span>
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
  { ruleId: 'R008', label: 'Authorization reference', count: 42, color: '#b4403f' },
  { ruleId: 'R003', label: 'Service date validity', count: 31, color: '#96650f' },
  { ruleId: 'R005', label: 'Duplicate service check', count: 18, color: '#b4403f' },
  { ruleId: 'R009', label: 'Authorization validity', count: 15, color: '#96650f' },
  { ruleId: 'R004', label: 'Benefit coverage', count: 11, color: '#b4403f' },
  { ruleId: 'R013', label: 'Diagnosis–procedure alignment', count: 8, color: '#96650f' },
  { ruleId: 'R002', label: 'Provider eligibility', count: 5, color: '#b4403f' },
];

const OUTCOME_DATA = [
  { label: 'PASS', count: 1007, pct: 78.4, color: '#1f7a5c', bg: '#e9f5ef', border: '#c4e1d1' },
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
  const data = useOperationalData();
  const [policyFilter, setPolicyFilter] = useState('All policies');
  const [auditEvents, setAuditEvents] = useState<BackendAuditEvent[]>([]);
  const [runs, setRuns] = useState<DatasetRun[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getAuditEvents(500, 0, controller.signal), getRuns(100, controller.signal)])
      .then(([audit, runHistory]) => {
        setAuditEvents(audit.events);
        setRuns(runHistory.runs);
      })
      .catch(() => {
        setAuditEvents([]);
        setRuns([]);
      });
    return () => controller.abort();
  }, []);

  const policies = Array.from(new Set(data.records.map(({ claim }) => claim.policy_id).filter((value): value is string => typeof value === 'string')));
  const records = data.records.filter(({ claim }) => policyFilter === 'All policies' || claim.policy_id === policyFilter);
  const results = records.flatMap((record) => record.results);
  const statusCounts = results.reduce<Record<string, number>>((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});
  const ruleCounts = results.reduce<Record<string, number>>((counts, result) => {
    if (result.status === 'FAIL' || result.status === 'UNABLE_TO_ASSESS') counts[result.rule_id] = (counts[result.rule_id] || 0) + 1;
    return counts;
  }, {});
  const maxFindings = Math.max(1, ...Object.values(ruleCounts));
  const statusColors: Record<string, string> = {
    PASS: '#1f7a5c',
    FAIL: 'var(--status-fail)',
    UNABLE_TO_ASSESS: 'var(--status-uta)',
    NOT_APPLICABLE: 'var(--status-na)',
    NOT_IMPLEMENTED: 'var(--text-tertiary)',
  };
  const outcomes = Object.entries(statusCounts).map(([label, count]) => ({
    label: label.replaceAll('_', ' '),
    count,
    pct: results.length ? count / results.length * 100 : 0,
    color: statusColors[label] || 'var(--text-tertiary)',
  }));
  const reviewActions = auditEvents.filter((event) => event.event_type === 'human_decision');
  const actionCounts = reviewActions.reduce<Record<string, number>>((counts, event) => {
    const action = typeof event.payload.action === 'string' ? event.payload.action : 'unknown';
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, {});
  const utaEvidencePaths = results
    .filter((result) => result.status === 'UNABLE_TO_ASSESS')
    .flatMap((result) => Array.isArray(result.evidence) ? result.evidence : [])
    .reduce<Record<string, number>>((counts, item) => {
      if (typeof item === 'object' && item && 'path' in item && typeof item.path === 'string') counts[item.path] = (counts[item.path] || 0) + 1;
      return counts;
    }, {});
  const topMissingEvidence = Object.entries(utaEvidencePaths).sort((first, second) => second[1] - first[1]).slice(0, 4);
  const serviceDates = records.flatMap(({ claim }) => (claim.lines || []).map((line) => line.service_date).filter((value): value is string => typeof value === 'string'));
  const serviceDateSpan = serviceDates.length
    ? `${serviceDates.slice().sort()[0]} – ${serviceDates.slice().sort().at(-1)}`
    : 'No service dates available';
  const benchmarkRuns = runs.filter((run) => run.benchmark);
  const latestRun = runs[0];
  const latestBenchmark = latestRun?.benchmark || null;
  const kpis = [
    { label: 'Claims in source', value: String(records.length), sub: data.sourceLabel, subPos: null, color: 'var(--accent)', onClick: () => onNavigate('claims') },
    { label: 'Passing rule results', value: results.length ? `${((statusCounts.PASS || 0) / results.length * 100).toFixed(1)}%` : '—', sub: `${statusCounts.PASS || 0} of ${results.length} rule results`, subPos: null, color: '#1f7a5c', onClick: null },
    { label: 'Unable to assess', value: String(statusCounts.UNABLE_TO_ASSESS || 0), sub: 'Rule results', subPos: null, color: '#96650f', onClick: null },
    { label: 'Needs review', value: String(records.filter(({ row }) => row.status !== 'pass').length), sub: 'Claims with findings', subPos: null, color: 'var(--status-review)', onClick: () => onNavigate('review-queue') },
  ];

  const handleRuleClick = (ruleId: string) => {
    onNavigate('rules');
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#0f172a', marginBottom: 4 }}>Analytics</h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Rule outcomes from the selected synthetic dataset or latest ingested batch.</p>
        </div>
      </div>

      {/* Scope / filter bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16, boxShadow: 'var(--card-shadow)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2" width="11" height="10" rx="2" stroke="#94a3b8" strokeWidth="1.2"/><path d="M4 6h6M4 8.5h4" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 500 }}>Source</span>
          <select aria-label="Analytics data source" value={data.source} onChange={(event) => data.setSource(event.target.value as DataSource)} style={{ background: 'transparent', border: 'none', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            <option value="all">All synthetic splits</option>
            <option value="development">Development</option>
            <option value="validation">Validation</option>
            <option value="stress">Stress</option>
            <option value="ingested" disabled={!data.counts.ingested}>Latest ingested batch</option>
          </select>
        </div>
        <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l6 2.5v4.5C13 11 10 13.5 7 14 4 13.5 1 11 1 8V3.5L7 1z" stroke="#94a3b8" strokeWidth="1.2" strokeLinejoin="round"/></svg>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 500 }}>Policy</span>
          <select value={policyFilter} onChange={e => setPolicyFilter(e.target.value)} style={{ background: 'transparent', border: 'none', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            <option>All policies</option>
            {policies.map((policy) => <option key={policy}>{policy}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: "var(--font-sans)", fontSize: '0.6875rem', color: '#94a3b8' }}>
          Showing: <strong style={{ color: '#334155' }}>{records.length}</strong> claims · {data.sourceLabel}
        </div>
      </div>

      {data.error && <div role="alert" style={{ marginBottom: 16, color: 'var(--status-fail)' }}>{data.error}</div>}

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
            <div style={{ fontFamily: "var(--font-sans)", fontSize: '1.625rem', fontWeight: 700, color: kpi.color, letterSpacing: '-0.04em', marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: '0.75rem', color: kpi.subPos === true ? '#1a6a4f' : kpi.subPos === false ? '#9a3433' : '#94a3b8' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Volume trend — full width */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 16, boxShadow: 'var(--card-shadow)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Service-date coverage</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{data.sourceLabel} · {serviceDates.length} line dates</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Date range: {serviceDateSpan}</span>
          </div>
        </div>
        <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>The API provides service dates, not processing timestamps, so this view reports the records’ date coverage instead of inventing a volume trend.</p>
      </div>

      {/* Two-col row: Outcome distribution + Review workload */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Outcome distribution */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Validation outcomes</h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Distribution across {results.length.toLocaleString()} rule results</p>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {/* Stacked bar */}
            <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 18 }}>
              {outcomes.map(o => <div key={o.label} style={{ width: `${o.pct}%`, background: o.color, transition: 'width 0.3s ease' }} />)}
            </div>
            {outcomes.map(o => (
              <div key={o.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: o.color, flexShrink: 0 }} />
                  <span style={{ color: '#334155', fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.03em' }}>{o.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.9375rem', fontWeight: 700, color: o.color, minWidth: 44, textAlign: 'right' }}>{o.count}</span>
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
              <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{auditEvents.length} recent audit events loaded</p>
            </div>
            <button onClick={() => onNavigate('review-queue')} style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>View queue</button>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(actionCounts).map(([action, count]) => {
                const label = action.replaceAll('_', ' ');
                const color = action === 'confirm_issue' ? '#b4403f' : action === 'dismiss_with_reason' ? '#1f7a5c' : '#96650f';
                return (
              <div key={action} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: '1rem', fontWeight: 700, color }}>{count}</span>
                </div>
              </div>
                );
              })}
              {reviewActions.length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>No human decisions in the latest audit events.</p>}
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
          {Object.entries(ruleCounts).sort((first, second) => second[1] - first[1]).map(([ruleId, count]) => (
            <div key={ruleId} style={{ borderBottom: '1px solid #f8fafc' }}>
              <HorizontalBar
                ruleId={ruleId}
                label={`Rule ${ruleId}`}
                count={count}
                maxCount={maxFindings}
                color="var(--status-fail)"
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
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{statusCounts.UNABLE_TO_ASSESS || 0} rule results lack enough evidence</p>
              </div>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', fontWeight: 700, color: '#96650f', background: '#f8f1e3', border: '1px solid #e8d6ac', borderRadius: 4, padding: '2px 8px' }}>
                {results.length ? `${((statusCounts.UNABLE_TO_ASSESS || 0) / results.length * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
          <div style={{ padding: '14px 20px 6px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Evidence paths in UTA findings</div>
            {topMissingEvidence.map(([path, count]) => (
              <div key={path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: '0.8125rem', color: '#334155' }}>{path}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 60, height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${count / Math.max(1, topMissingEvidence[0]?.[1] || 1) * 100}%`, background: '#96650f', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: '#96650f', minWidth: 32, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
            {topMissingEvidence.length === 0 && <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>No UTA evidence paths in the selected source.</p>}
          </div>
        </div>

        {/* Validation quality */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Validation quality</h3>
              <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{latestRun ? `Latest labeled run · ${latestRun.source.split}` : 'No persisted labeled run is available'}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f8f1e3', border: '1px solid #e8d6ac', borderRadius: 4, padding: '3px 8px' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1l4 7H1L5 1z" stroke="#96650f" strokeWidth="1"/><path d="M5 3.5v2.5M5 7.5v.3" stroke="#96650f" strokeWidth="1" strokeLinecap="round"/></svg>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#6b4a0f' }}>Evaluation data</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              {[
                { label: 'Status accuracy', value: latestBenchmark ? `${(latestBenchmark.status_accuracy * 100).toFixed(1)}%` : '—', color: '#0f172a', desc: `${latestBenchmark?.count || 0} labeled rule results` },
                { label: 'Issue precision', value: latestBenchmark?.issue_precision == null ? '—' : `${(latestBenchmark.issue_precision * 100).toFixed(1)}%`, color: '#1f7a5c', desc: 'True positives / predicted issues' },
                { label: 'Issue recall', value: latestBenchmark?.issue_recall == null ? '—' : `${(latestBenchmark.issue_recall * 100).toFixed(1)}%`, color: 'var(--accent)', desc: 'True positives / expected issues' },
                { label: 'Issue F1', value: latestBenchmark?.issue_f1 == null ? '—' : `${(latestBenchmark.issue_f1 * 100).toFixed(1)}%`, color: 'var(--status-review)', desc: 'Harmonic mean of precision and recall' },
              ].map(m => (
                <div key={m.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '12px 14px' }}>
                  <div style={{ fontFamily: "var(--font-sans)", fontSize: '1.125rem', fontWeight: 700, color: m.color, letterSpacing: '-0.02em', marginBottom: 3 }}>{m.value}</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', marginBottom: 1 }}>{m.label}</div>
                  <div style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{m.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: '#f1f5f9', marginBottom: 14 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'False alarm rate', value: latestBenchmark?.false_alarm_rate == null ? '—' : `${(latestBenchmark.false_alarm_rate * 100).toFixed(1)}%`, color: '#b4403f', desc: 'False positives / (FP + TN)' },
                { label: 'False abstentions', value: latestBenchmark ? String(latestBenchmark.false_abstentions) : '—', color: '#96650f', desc: 'Unable to assess despite an available label' },
              ].map(m => (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#334155' }}>{m.label}</div>
                    <div style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{m.desc}</div>
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: '1rem', fontWeight: 700, color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: '0.6875rem', color: '#94a3b8', lineHeight: 1.5 }}>
                {latestRun && latestBenchmark
                  ? <>Metrics from persisted run <strong style={{ color: '#334155' }}>{latestRun.run_id.slice(0, 12)}</strong>; {latestRun.benchmark_skipped_claims} unlabeled claims excluded. Bundled data is synthetic.</>
                  : 'Create a dataset run to calculate metrics against the bundled synthetic labels.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
