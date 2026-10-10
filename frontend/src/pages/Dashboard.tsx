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
    statusLabel: 'Needs review',
    updated: '12 min ago',
    sentinel: 'review' as SentinelState,
  },
  {
    id: 'CLM-10479',
    provider: 'Northside Clinic',
    service: 'Sep 13, 2026',
    findings: 1,
    status: 'uncertain',
    statusLabel: 'Unable to assess',
    updated: '1h ago',
    sentinel: 'uncertain' as SentinelState,
  },
  {
    id: 'CLM-10477',
    provider: 'Metro Health Partners',
    service: 'Sep 12, 2026',
    findings: 3,
    status: 'review',
    statusLabel: 'Needs review',
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
    statusLabel: 'Needs review',
    sentinel: 'review' as SentinelState,
  },
];

const ACTIVITY = [
  { time: '10:33:02', event: 'REVIEW_ACTION', actor: 'Marwen Agrebi', detail: 'CLM-10481 · Request information submitted', type: 'human' },
  { time: '10:31:03', event: 'RUN_COMPLETED', actor: 'System', detail: 'Run RUN-4821 · 24 claims · 98.2% status accuracy', type: 'system' },
  { time: '10:28:44', event: 'CLAIM_RECEIVED', actor: 'System', detail: 'CLM-10482 · Meridian Health Group · $2,840.00', type: 'system' },
  { time: '10:15:21', event: 'REVIEW_ACTION', actor: 'James Park', detail: 'CLM-10480 · Issue confirmed → escalated', type: 'human' },
  { time: '09:58:07', event: 'RULE_EVALUATED', actor: 'System', detail: 'R008 → FAIL · CLM-10479 · Auth reference missing', type: 'rule' },
  { time: '09:44:12', event: 'RUN_STARTED', actor: 'System', detail: 'Run RUN-4820 · Pacific Medical dataset', type: 'system' },
];

const STATUS_PILL: Record<string, string> = {
  review: 'is-review',
  fail: 'is-fail',
  pass: 'is-pass',
  uncertain: 'is-uta',
};

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

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
    review: 'Needs review', fail: 'Failed', uncertain: 'Unable to assess', pass: 'Passed',
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
          <rect x="2" y="3" width="14" height="12" rx="2" stroke="var(--accent-ink)" strokeWidth="1.5"/>
          <path d="M5 7h8M5 10h5" stroke="var(--accent-ink)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: 'var(--accent)',
    },
    {
      label: 'Needs review',
      value: String((statusCounts.review || 0) + (statusCounts.fail || 0)),
      change: 'From current claims',
      changePos: null,
      sub: `${statusCounts.fail || 0} failed`,
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="7" r="3" stroke="var(--status-uta-ink)" strokeWidth="1.5"/>
          <path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="var(--status-uta-ink)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: 'var(--status-review)',
    },
    {
      label: 'Unable to assess',
      value: String(statusCounts.uncertain || 0),
      change: 'Awaiting evidence',
      changePos: null,
      sub: '3 pending info',
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="7" stroke="var(--status-uta-ink)" strokeWidth="1.5"/>
          <path d="M9 6v4M9 13v.5" stroke="var(--status-uta-ink)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: 'var(--status-uta)',
    },
    {
      label: 'Issues detected',
      value: String(claims.reduce((total, claim) => total + claim.findings, 0)),
      change: 'Across accumulated claims',
      changePos: null,
      sub: 'R008 most frequent',
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2l7 13H2L9 2z" stroke="var(--status-fail-ink)" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M9 7v4M9 13v.5" stroke="var(--status-fail-ink)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      accent: 'var(--status-fail)',
    },
  ];

  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateline = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const outcomeShare = (count: number) => (claims.length ? (count / claims.length) * 100 : 0);
  const outcomes = [
    { key: 'pass', label: 'Pass', count: statusCounts.pass || 0, color: 'var(--status-pass)' },
    { key: 'fail', label: 'Fail', count: statusCounts.fail || 0, color: 'var(--status-fail)' },
    { key: 'uncertain', label: 'Unable', count: statusCounts.uncertain || 0, color: 'var(--status-uta)' },
    { key: 'review', label: 'Review', count: statusCounts.review || 0, color: 'var(--status-review)' },
  ];

  return (
    <div className="dashboard-shell">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <p className="page-dateline">{dateline}</p>
          <h1 style={{ margin: '0 0 6px' }}>{greeting}, Marwen</h1>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
            {loading
              ? 'Loading claims…'
              : `${reviewClaims.length} ${reviewClaims.length === 1 ? 'claim needs' : 'claims need'} a decision.`}
          </p>
        </div>
        <div className="dashboard-header-actions" style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => onNavigate('ingest')} className="btn btn-secondary">
            Ingest data
          </button>
          <button onClick={() => onNavigate('review-queue')} className="btn btn-primary">
            Open review queue →
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="kpi-tiles">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="kpi-tile">
            <div className="kpi-tile-label">{kpi.label}</div>
            <span className="kpi-tile-dot" style={{ background: kpi.accent }} aria-hidden="true" />
            <div className="kpi-tile-value">{loading ? '—' : kpi.value}</div>
            <div className="kpi-tile-caption">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="dashboard-grid">
        {/* Review queue */}
          <div className="dashboard-panel dashboard-queue-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Priority review</h2>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 3 }}>Highest-risk claims first</p>
            </div>
            <button onClick={() => onNavigate('claims')} className="text-action" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              View all claims →
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
                return (
                  <tr
                    key={item.id}
                    onClick={() => onNavigate('claim-review', item.id)}
                    onMouseEnter={() => setHoveredRow(item.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{ background: hoveredRow === item.id ? 'var(--card-bg)' : undefined }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sentinel state={item.sentinel} size={24} />
                        <span className="mono-id" style={{ color: 'var(--text-primary)' }}>{item.id}</span>
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
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        <strong style={{ color: item.findings > 0 ? 'var(--status-fail-ink)' : 'var(--status-pass-ink)' }}>{item.findings}</strong>
                        {item.findings === 1 ? ' finding' : ' findings'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${STATUS_PILL[item.status]}`}>{statusLabels[item.status]}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>{item.updated}</span>
                    </td>
                    <td>
                      <button
                        onClick={e => { e.stopPropagation(); onNavigate('claim-review', item.id); }}
                        className="btn btn-secondary btn-sm"
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
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Latest evaluation</h3>
              <button onClick={() => onNavigate('runs')} className="text-action">Run details</button>
            </div>
            <dl className="evaluation-facts">
              <div><dt>Source</dt><dd>Accumulated store</dd></div>
              <div><dt>Claims evaluated</dt><dd>{claims.length}</dd></div>
              <div><dt>Ruleset</dt><dd>Configured backend rules</dd></div>
              <div><dt>Last event</dt><dd>{activity[0] ? new Date(activity[0].timestamp).toLocaleTimeString() : '—'}</dd></div>
            </dl>
            <div className="outcome-distribution">
              <div className="outcome-distribution-label">Outcome distribution · {claims.length} claims</div>
              <div className="outcome-bar" role="img" aria-label={outcomes.map((o) => `${o.label} ${o.count}`).join(', ')}>
                {outcomes.filter((o) => o.count > 0).map((o) => (
                  <span key={o.key} style={{ width: `${outcomeShare(o.count)}%`, background: o.color }} />
                ))}
              </div>
              <div className="outcome-legend">
                {outcomes.map((o) => (
                  <span key={o.key}><i style={{ background: o.color }} />{o.label} {Math.round(outcomeShare(o.count))}%</span>
                ))}
              </div>
            </div>
            <p className="context-note">Rule outcomes are deterministic. AI explanations are linked to the recorded evidence.</p>
          </section>

          <section className="dashboard-panel activity-panel">
            <div className="dashboard-panel-header">
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Recent activity</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3 }}>Last 60 minutes</p>
              </div>
              <button onClick={() => onNavigate('audit')} className="text-action" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Audit trail →</button>
            </div>
            <div className="activity-feed">
              {activity.length === 0 && !loading && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', padding: '4px 0' }}>No activity recorded yet.</p>
              )}
              {activity.map((a, i) => (
                <div key={i} className="activity-entry">
                  <span className="activity-avatar" style={{ color: activityColor(a) }} aria-hidden="true">{initials(a.actor)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.45 }}>
                      <strong style={{ fontWeight: 650 }}>{a.actor}</strong>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>{activityLabel(a).toLowerCase().replace(/_/g, ' ')}</span>{' '}
                      <span className="mono-id" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{activityDetail(a)}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </div>
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
