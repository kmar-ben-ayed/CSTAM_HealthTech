import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
import type { SentinelState } from '../components/Sentinel';
import { getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { datasetToClaimRows, getIngestedClaims, type ClaimRow } from '../api/claims';

interface DashboardProps {
  onNavigate: (page: string, claimId?: string) => void;
}

const QUEUE_ITEMS = [
  {
    id: 'CLM-10482',
    provider: 'Meridian Health Group',
    service: 'Sep 15, 2026',
    findings: 4,
    status: 'review',
    statusLabel: 'Needs Review',
    updated: '12 min ago',
    sentinel: 'review' as SentinelState,
  },
  {
    id: 'CLM-10479',
    provider: 'Northside Clinic',
    service: 'Sep 13, 2026',
    findings: 1,
    status: 'uncertain',
    statusLabel: 'Unable to Assess',
    updated: '1h ago',
    sentinel: 'uncertain' as SentinelState,
  },
  {
    id: 'CLM-10477',
    provider: 'Metro Health Partners',
    service: 'Sep 12, 2026',
    findings: 3,
    status: 'review',
    statusLabel: 'Needs Review',
    updated: '2h ago',
    sentinel: 'review' as SentinelState,
  },
  {
    id: 'CLM-10476',
    provider: 'Riverside Medical Center',
    findings: 1,
    status: 'fail',
    statusLabel: 'Failed',
    updated: '4h ago',
    sentinel: 'fail' as SentinelState,
  },
  {
    id: 'CLM-10474',
    provider: 'Summit Care Associates',
    service: 'Sep 10, 2026',
    findings: 2,
    status: 'review',
    statusLabel: 'Needs Review',
    sentinel: 'review' as SentinelState,
  },
];

const ACTIVITY = [
  { time: '10:33:02', event: 'REVIEW_ACTION', actor: 'Aya Gaha', detail: 'CLM-10481 · Request information submitted', type: 'human' },
  { time: '10:31:03', event: 'RUN_COMPLETED', actor: 'System', detail: 'Run RUN-4821 · 24 claims · 98.2% status accuracy', type: 'system' },
  { time: '10:28:44', event: 'CLAIM_RECEIVED', actor: 'System', detail: 'CLM-10482 · Meridian Health Group · $2,840.00', type: 'system' },
  { time: '10:15:21', event: 'REVIEW_ACTION', actor: 'James Park', detail: 'CLM-10480 · Issue confirmed → escalated', type: 'human' },
  { time: '09:58:07', event: 'RULE_EVALUATED', actor: 'System', detail: 'R008 → FAIL · CLM-10479 · Auth reference missing', type: 'rule' },
  { time: '09:44:12', event: 'RUN_STARTED', actor: 'System', detail: 'Run RUN-4820 · Pacific Medical dataset', type: 'system' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  review: { bg: 'var(--status-review-bg)', text: 'var(--status-review)', border: 'var(--status-review-border)', dot: 'var(--status-review)' },
  fail: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail)', border: 'var(--status-fail-border)', dot: 'var(--status-fail)' },
  pass: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass)', border: 'var(--status-pass-border)', dot: 'var(--status-pass)' },
  uncertain: { bg: 'var(--status-uta-bg)', text: 'var(--status-uta)', border: 'var(--status-uta-border)', dot: 'var(--status-uta)' },
};

const ACTIVITY_COLORS: Record<string, string> = {
  human: 'var(--status-review)',
  system: 'var(--accent)',
  rule: 'var(--status-fail)',
};

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [activity, setActivity] = useState<BackendAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getIngestedClaims(undefined, controller.signal),
      getAuditEvents(6, controller.signal),
    ]).then(([ingested, audit]) => {
      setClaims(datasetToClaimRows(ingested));
      setActivity(audit.events);
    }).catch(() => {
      setClaims([]);
      setActivity([]);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const reviewClaims = claims.filter((claim) => claim.status !== 'pass');
  const statusCounts = claims.reduce<Record<string, number>>((counts, claim) => {
    counts[claim.status] = (counts[claim.status] || 0) + 1;
    return counts;
  }, {});
  const queueItems = reviewClaims.slice(0, 5);
  const statusLabels: Record<ClaimRow['status'], string> = {
    review: 'Needs Review', fail: 'Failed', uncertain: 'Unable to Assess', pass: 'Passed',
  };
  const activityColor = (event: BackendAuditEvent) => event.event_type === 'human_decision'
    ? ACTIVITY_COLORS.human
    : event.event_type === 'rule_execution' ? ACTIVITY_COLORS.rule : ACTIVITY_COLORS.system;
  const activityLabel = (event: BackendAuditEvent) => event.event_type === 'rule_execution'
    ? 'RULE_EVALUATED'
    : event.event_type === 'human_decision' ? 'REVIEW_ACTION' : event.event_type.toUpperCase();
  const activityDetail = (event: BackendAuditEvent) => {
    const payload = event.payload;
    if (event.event_type === 'rule_execution') return `${event.claim_id || 'Claim'} · ${String(payload.status || 'evaluated')}`;
    if (event.event_type === 'human_decision') return `${event.claim_id || 'Claim'} · ${String(payload.action || 'review recorded')}`;
    return event.claim_id ? `Claim ${event.claim_id}` : 'System event recorded';
  };

  const kpis = [
    {
      label: 'Claims processed',
      value: String(claims.length),
      change: 'Accumulated locally',
      changePos: null,
      sub: `${reviewClaims.length} need review`,
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="3" width="14" height="12" rx="2" stroke="#1d5c8a" strokeWidth="1.5"/>
          <path d="M5 7h8M5 10h5" stroke="#1d5c8a" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: '#1d5c8a',
    },
    {
      label: 'Needs review',
      value: String((statusCounts.review || 0) + (statusCounts.fail || 0)),
      change: 'From current claims',
      changePos: null,
      sub: `${statusCounts.fail || 0} failed`,
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="7" r="3" stroke="#96650f" strokeWidth="1.5"/>
          <path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#96650f" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: '#96650f',
    },
    {
      label: 'Unable to assess',
      value: String(statusCounts.uncertain || 0),
      change: 'Awaiting evidence',
      changePos: null,
      sub: '3 pending info',
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="7" stroke="#96650f" strokeWidth="1.5"/>
          <path d="M9 6v4M9 13v.5" stroke="#96650f" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: '#96650f',
    },
    {
      label: 'Issues detected',
      value: String(claims.reduce((total, claim) => total + claim.findings, 0)),
      change: 'Across accumulated claims',
      changePos: null,
      sub: 'R008 most frequent',
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2l7 13H2L9 2z" stroke="#b4403f" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M9 7v4M9 13v.5" stroke="#b4403f" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: '#b4403f',
    },
  ];

  return (
    <div className="dashboard-shell">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontSize: '1.625rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Claims operations
          </h1>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
            23 claims await review. Three are marked urgent.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <div style={{
            fontFamily: "var(--font-sans)",
            fontSize: '0.6875rem',
            color: 'var(--text-secondary)',
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '6px 12px',
          }}>
            Fri, Sep 25, 2026
          </div>
          <button
            onClick={() => onNavigate('review-queue')}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 5,
              padding: '8px 16px',
              color: '#fff',
              fontSize: '0.875rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            Open review queue
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-metrics">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="dashboard-metric"
          >
            <div className="dashboard-metric-value">
              {kpi.value}
            </div>
            <div className="dashboard-metric-label">{kpi.label}</div>
            <div className="dashboard-metric-note">{kpi.sub}</div>
            <div className={`dashboard-metric-change ${kpi.changePos === true ? 'positive' : kpi.changePos === false ? 'negative' : ''}`}>
              {kpi.change}
            </div>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="dashboard-grid">
        {/* Review queue */}
          <div className="dashboard-panel dashboard-queue-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Priority review</h2>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 3 }}>Sorted by findings and time waiting</p>
            </div>
            <button
              onClick={() => onNavigate('claims')}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '5px 12px',
                fontSize: '0.8125rem',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              View all
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <div className="table-scroll">
          <table className="data-table dashboard-table">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Provider</th>
                <th>Service date</th>
                <th>Findings</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map(item => {
                const sc = STATUS_COLORS[item.status] || STATUS_COLORS['review'];
                return (
                  <tr
                    key={item.id}
                    onClick={() => onNavigate('claim-review', item.id)}
                    onMouseEnter={() => setHoveredRow(item.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{ background: hoveredRow === item.id ? '#f8fafc' : undefined }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sentinel state={item.sentinel} size={22} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {item.id}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{item.provider}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {item.dos}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 28,
                        height: 22,
                        background: item.findings > 0 ? 'var(--status-fail-bg)' : 'var(--status-pass-bg)',
                        color: item.findings > 0 ? 'var(--status-fail)' : 'var(--status-pass)',
                        borderRadius: 4,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        fontFamily: "var(--font-sans)",
                        border: item.findings > 0 ? '1px solid var(--status-fail-border)' : '1px solid var(--status-pass-border)',
                      }}>
                        {item.findings}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        background: sc.bg,
                        color: sc.text,
                        border: `1px solid ${sc.border}`,
                        borderRadius: 20,
                        padding: '3px 10px',
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap',
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot, display: 'inline-block', flexShrink: 0 }} />
                        {statusLabels[item.status]}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{item.updated}</span>
                    </td>
                    <td>
                      <button
                        onClick={e => { e.stopPropagation(); onNavigate('claim-review', item.id); }}
                        style={{
                          background: 'var(--canvas-bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontWeight: 600,
                        }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        <div className="dashboard-side">
          <section className="dashboard-panel context-panel">
            <div className="dashboard-panel-header">
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 650, color: 'var(--text-primary)' }}>Latest evaluation</h3>
              <button onClick={() => onNavigate('runs')} className="text-action">Run details</button>
            </div>
            <dl className="run-context">
              <div><dt>Source</dt><dd>Accumulated store</dd></div>
              <div><dt>Claims evaluated</dt><dd>{claims.length}</dd></div>
              <div><dt>Ruleset</dt><dd>Configured backend rules</dd></div>
              <div><dt>Last event</dt><dd>{activity[0] ? new Date(activity[0].timestamp).toLocaleTimeString() : '—'}</dd></div>
            </dl>
            <p className="context-note">Rule outcomes are deterministic. AI explanations are linked to the recorded evidence.</p>
          </section>

          <section className="dashboard-panel activity-panel">
            <div className="dashboard-panel-header">
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 650, color: 'var(--text-primary)' }}>Recent activity</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3 }}>Last 60 minutes</p>
              </div>
              <button onClick={() => onNavigate('audit')} className="text-action">Audit trail</button>
            </div>
            <div className="activity-list">
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, position: 'relative' }}>
                  {/* Timeline line */}
                  {i < activity.length - 1 && (
                    <div style={{
                      position: 'absolute',
                      left: 5,
                      top: 18,
                      bottom: -4,
                      width: 1,
                      background: 'var(--border)',
                    }} />
                  )}
                  <div style={{
                    width: 11,
                    height: 11,
                    borderRadius: '50%',
                    background: activityColor(a),
                    marginTop: 4,
                    flexShrink: 0,
                    zIndex: 1,
                  }} />
                  <div style={{ paddingBottom: 16, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        color: activityColor(a),
                        letterSpacing: '0.02em',
                      }}>
                        {activityLabel(a)}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-tertiary)' }}>{new Date(a.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{activityDetail(a)}</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 1 }}>{a.actor}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
