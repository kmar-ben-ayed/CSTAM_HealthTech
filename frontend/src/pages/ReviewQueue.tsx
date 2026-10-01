import { useState } from 'react';
import Sentinel from '../components/Sentinel';
import { useOperationalData } from '../hooks/useOperationalData';
import type { DataSource } from '../hooks/useOperationalData';

interface ReviewQueueProps {
  onNavigate: (page: string, claimId?: string) => void;
}

type Priority = 'High' | 'Medium' | 'Low';
type ReviewStatus =
  | 'Unassigned'
  | 'Assigned'
  | 'In Review'
  | 'Waiting for Info'
  | 'Ready for Re-check'
  | 'Completed';
type ValidationOutcome = 'PASS' | 'FAIL' | 'NEEDS REVIEW' | 'UNABLE TO ASSESS';

interface QueueItem {
  claimId: string;
  provider: string;
  priority: Priority;
  validationOutcome: ValidationOutcome;
  reviewStatus: ReviewStatus;
  topFinding: string;
  assignedTo: string | null;
  age: string;
  lastAction: string;
  serviceDate: string;
  amount: string;
}

const QUEUE_ITEMS: QueueItem[] = [
  {
    claimId: 'CLM-10482',
    provider: 'Northside Behavioral Health',
    priority: 'High',
    validationOutcome: 'FAIL',
    reviewStatus: 'In Review',
    topFinding: 'Authorization reference missing',
    assignedTo: 'Aya Gaha',
    age: '2h',
    lastAction: 'Rule R008 flagged',
    serviceDate: '2026-09-14',
    amount: '$3,420.00',
  },
  {
    claimId: 'CLM-10479',
    provider: 'Summit Psychiatry Clinic',
    priority: 'High',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'Unassigned',
    topFinding: 'Session count exceeds plan limit',
    assignedTo: null,
    age: '4h',
    lastAction: 'Flagged by run RUN-4821',
    serviceDate: '2026-09-12',
    amount: '$2,875.00',
  },
  {
    claimId: 'CLM-10477',
    provider: 'Lakeside Counseling Center',
    priority: 'High',
    validationOutcome: 'UNABLE TO ASSESS',
    reviewStatus: 'Waiting for Info',
    topFinding: 'Clinical notes not submitted',
    assignedTo: 'Marcus Webb',
    age: '1d',
    lastAction: 'Information requested',
    serviceDate: '2026-09-10',
    amount: '$1,290.00',
  },
  {
    claimId: 'CLM-10475',
    provider: 'Clearwater Psychology',
    priority: 'High',
    validationOutcome: 'FAIL',
    reviewStatus: 'Ready for Re-check',
    topFinding: 'Diagnosis code unsupported for service',
    assignedTo: 'Priya Nair',
    age: '1d 6h',
    lastAction: 'Corrected records submitted',
    serviceDate: '2026-09-09',
    amount: '$4,100.00',
  },
  {
    claimId: 'CLM-10480',
    provider: 'Valley Behavioral Sciences',
    priority: 'High',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'Assigned',
    topFinding: 'Provider NPI not enrolled',
    assignedTo: 'Aya Gaha',
    age: '3h',
    lastAction: 'Assigned to reviewer',
    serviceDate: '2026-09-13',
    amount: '$2,050.00',
  },
  {
    claimId: 'CLM-10471',
    provider: 'Greenfield Mental Health',
    priority: 'High',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'In Review',
    topFinding: 'Modifier 95 unverified',
    assignedTo: 'Marcus Webb',
    age: '5h',
    lastAction: 'Evidence reviewed',
    serviceDate: '2026-09-08',
    amount: '$3,780.00',
  },
  {
    claimId: 'CLM-10472',
    provider: 'Beacon Recovery Services',
    priority: 'High',
    validationOutcome: 'FAIL',
    reviewStatus: 'Unassigned',
    topFinding: 'Service outside coverage window',
    assignedTo: null,
    age: '7h',
    lastAction: 'Flagged by run RUN-4820',
    serviceDate: '2026-09-07',
    amount: '$5,200.00',
  },
  {
    claimId: 'CLM-10474',
    provider: 'Cedar Ridge Outpatient',
    priority: 'High',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'Unassigned',
    topFinding: 'Duplicate claim suspected',
    assignedTo: null,
    age: '9h',
    lastAction: 'Rule R014 flagged',
    serviceDate: '2026-09-06',
    amount: '$1,640.00',
  },
  {
    claimId: 'CLM-10476',
    provider: 'Pacific Wellness Partners',
    priority: 'Medium',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'In Review',
    topFinding: 'Place of service mismatch',
    assignedTo: 'Priya Nair',
    age: '2d',
    lastAction: 'Notes under review',
    serviceDate: '2026-09-05',
    amount: '$2,310.00',
  },
  {
    claimId: 'CLM-10473',
    provider: 'Horizon Counseling Group',
    priority: 'Medium',
    validationOutcome: 'UNABLE TO ASSESS',
    reviewStatus: 'Waiting for Info',
    topFinding: 'Plan enrollment unverifiable',
    assignedTo: 'Marcus Webb',
    age: '2d 4h',
    lastAction: 'Enrollment query sent',
    serviceDate: '2026-09-04',
    amount: '$980.00',
  },
  {
    claimId: 'CLM-10478',
    provider: 'Sunrise Therapy Associates',
    priority: 'Medium',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'Unassigned',
    topFinding: 'Units exceed expected maximum',
    assignedTo: null,
    age: '3d',
    lastAction: 'Flagged by run RUN-4819',
    serviceDate: '2026-09-03',
    amount: '$3,100.00',
  },
  {
    claimId: 'CLM-10481',
    provider: 'Redwood Behavioral Health',
    priority: 'Low',
    validationOutcome: 'NEEDS REVIEW',
    reviewStatus: 'Unassigned',
    topFinding: 'Rendering provider not listed',
    assignedTo: null,
    age: '4d',
    lastAction: 'Flagged by run RUN-4818',
    serviceDate: '2026-09-02',
    amount: '$1,800.00',
  },
];

const PRIORITY_STYLE: Record<Priority, { bg: string; text: string; border: string }> = {
  High: { bg: '#fbefee', text: '#8c322f', border: '#e9c8c7' },
  Medium: { bg: '#f8f1e3', text: '#6b4a0f', border: '#e8d6ac' },
  Low: { bg: '#e9f5ef', text: '#17503c', border: '#c4e1d1' },
};

const VALIDATION_STYLE: Record<ValidationOutcome, { bg: string; text: string; border: string }> = {
  PASS: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass)', border: 'var(--status-pass-border)' },
  FAIL: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail)', border: 'var(--status-fail-border)' },
  'NEEDS REVIEW': { bg: 'var(--status-review-bg)', text: 'var(--status-review)', border: 'var(--status-review-border)' },
  'UNABLE TO ASSESS': { bg: 'var(--status-uta-bg)', text: 'var(--status-uta)', border: 'var(--status-uta-border)' },
};

const REVIEW_STATUS_STYLE: Record<ReviewStatus, { color: string; dot: string }> = {
  Unassigned: { color: '#94a3b8', dot: '#94a3b8' },
  Assigned: { color: '#1d5c8a', dot: '#1d5c8a' },
  'In Review': { color: 'var(--accent)', dot: 'var(--accent)' },
  'Waiting for Info': { color: 'var(--status-uta)', dot: 'var(--status-uta)' },
  'Ready for Re-check': { color: 'var(--status-pass)', dot: 'var(--status-pass)' },
  Completed: { color: '#64748b', dot: '#64748b' },
};

type FilterTab = 'all' | 'high' | 'fail' | 'uncertain';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High Priority' },
  { key: 'fail', label: 'Failed' },
  { key: 'uncertain', label: 'Unable to Assess' },
];

const WORKLOAD = [
  { label: 'High priority', count: 8, color: '#b4403f', bg: '#fbefee', border: '#e9c8c7' },
  { label: 'Unassigned', count: 12, color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
  { label: 'Waiting for info', count: 7, color: '#96650f', bg: '#f8f1e3', border: '#e8d6ac' },
  { label: 'In review', count: 15, color: 'var(--accent)', bg: 'var(--accent-subtle)', border: 'var(--status-pass-border)' },
];

function Badge({
  label,
  bg,
  text,
  border,
}: {
  label: string;
  bg: string;
  text: string;
  border: string;
}) {
  return (
    <span
      style={{
        background: bg,
        color: text,
        border: `1px solid ${border}`,
        borderRadius: 20,
        padding: '2px 9px',
        fontSize: '0.6875rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export default function ReviewQueue({ onNavigate }: ReviewQueueProps) {
  const data = useOperationalData();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'date' | 'amount'>('priority');
  const [sessionIndex, setSessionIndex] = useState<number | null>(null);
  const queueItems: QueueItem[] = data.records.flatMap(({ claim, results, row }) => {
    const findings = results.filter((result) => result.status === 'FAIL' || result.status === 'UNABLE_TO_ASSESS');
    if (!findings.length) return [];
    const severity = findings.some((result) => result.severity === 'high')
      ? 'High'
      : findings.some((result) => result.severity === 'medium') ? 'Medium' : 'Low';
    const topFinding = typeof findings[0].explanation === 'string'
      ? findings[0].explanation
      : `Rule ${findings[0].rule_id} needs review`;
    return [{
      claimId: claim.claim_id,
      provider: row.provider,
      priority: severity,
      validationOutcome: row.status === 'fail' ? 'FAIL' : row.status === 'uncertain' ? 'UNABLE TO ASSESS' : 'NEEDS REVIEW',
      reviewStatus: 'Unassigned',
      topFinding,
      assignedTo: null,
      age: '—',
      lastAction: '—',
      serviceDate: row.dos,
      amount: row.amount,
    } satisfies QueueItem];
  });
  const filtered = queueItems.filter((item) => {
    if (activeFilter === 'high') return item.priority === 'High';
    if (activeFilter === 'fail') return item.validationOutcome === 'FAIL';
    if (activeFilter === 'uncertain') return item.validationOutcome === 'UNABLE TO ASSESS';
    return true;
  }).sort((first, second) => {
    if (sortBy === 'date') return second.serviceDate.localeCompare(first.serviceDate);
    if (sortBy === 'amount') return second.amount.localeCompare(first.amount);
    const ranks: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
    return ranks[first.priority] - ranks[second.priority];
  });

  const highPriority = filtered.filter((i) => i.priority === 'High');
  const workload = [
    { label: 'High priority', count: queueItems.filter((item) => item.priority === 'High').length, color: '#b4403f', bg: '#fbefee', border: '#e9c8c7' },
    { label: 'Failed claims', count: queueItems.filter((item) => item.validationOutcome === 'FAIL').length, color: '#b4403f', bg: '#fbefee', border: '#e9c8c7' },
    { label: 'Unable to assess', count: queueItems.filter((item) => item.validationOutcome === 'UNABLE TO ASSESS').length, color: '#96650f', bg: '#f8f1e3', border: '#e8d6ac' },
  ];

  const handleStartReview = (claimId: string, idx: number) => {
    setSessionIndex(idx);
    onNavigate('claim-review', claimId);
  };

  return (
    <div className="page-shell review-queue-shell">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div className="review-queue-heading" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1
              style={{
                fontSize: '1.375rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.025em',
                marginBottom: 4,
              }}
            >
              Review Queue
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{data.loading ? '…' : queueItems.length}</strong> claims need attention · {data.sourceLabel}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select aria-label="Queue data source" value={data.source} onChange={(event) => data.setSource(event.target.value as DataSource)} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 7, padding: '7px 10px', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
              <option value="all">All synthetic splits ({data.counts.all})</option>
              <option value="development">Development ({data.counts.development})</option>
              <option value="validation">Validation ({data.counts.validation})</option>
              <option value="stress">Stress ({data.counts.stress})</option>
              <option value="ingested" disabled={!data.counts.ingested}>Latest ingested batch ({data.counts.ingested})</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: 7,
                padding: '7px 28px 7px 10px',
                fontSize: '0.8125rem',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none',
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 4l3 3 3-3' stroke='%2394a3b8' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 8px center',
              }}
            >
              <option value="priority">Sort: Priority</option>
              <option value="date">Sort: Service date</option>
              <option value="amount">Sort: Amount</option>
            </select>
          </div>
        </div>
      </div>

      {/* Workload summary */}
      <div className="review-queue-summary" style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        {workload.map((w) => (
          <div
            key={w.label}
            style={{
              background: w.bg,
              border: `1px solid ${w.border}`,
              borderRadius: 10,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: w.color,
                flexShrink: 0,
                boxShadow: `0 0 0 3px color-mix(in srgb, ${w.color} 15%, transparent)`,
              }}
            />
            <div>
              <div
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: w.color,
                  fontFamily: "var(--font-sans)",
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
              >
                {w.count}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                {w.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 16,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 8,
          padding: 4,
          width: 'fit-content',
        }}
      >
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={{
                background: isActive ? '#f1f5f9' : 'transparent',
                border: isActive ? '1px solid #e2e8f0' : '1px solid transparent',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: '0.8125rem',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#0f172a' : '#64748b',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Queue session context banner (when high priority filter active) */}
      {activeFilter === 'high' && highPriority.length > 0 && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(15,122,130,0.06), rgba(150,101,15,0.04))',
            border: '1px solid rgba(15,122,130,0.2)',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sentinel state="scanning" size={20} showLabel={false} />
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
              Review session — {highPriority.length} high-priority claims
            </span>
          </div>
          <button
            onClick={() => handleStartReview(highPriority[0].claimId, 0)}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Start session →
          </button>
        </div>
      )}

      {/* Queue table */}
      <div
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        {data.loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading evaluated claims…</div>
        ) : data.error ? (
          <div role="alert" style={{ padding: 48, textAlign: 'center', color: 'var(--status-fail)' }}>{data.error}</div>
        ) : filtered.length === 0 ? (
          /* Empty state */
          <div style={{ padding: '64px 32px', textAlign: 'center' }}>
            <div style={{ marginBottom: 20 }}>
              <Sentinel state="pass" size={56} showLabel={false} />
            </div>
            <div style={{ fontSize: '1.0625rem', fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
              You're all caught up
            </div>
            <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
              There are no claims waiting for your review.
            </div>
            <div
              style={{
                marginTop: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#e9f5ef',
                border: '1px solid #c4e1d1',
                borderRadius: 20,
                padding: '4px 14px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#17503c',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#1f7a5c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Queue clear
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Claim ID</th>
                  <th>Provider</th>
                  <th>Priority</th>
                  <th>Validation</th>
                  <th style={{ minWidth: 220 }}>Top Finding</th>
                  <th>Service date</th>
                  <th>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const prStyle = PRIORITY_STYLE[item.priority];
                  const valStyle = VALIDATION_STYLE[item.validationOutcome];

                  return (
                    <tr
                      key={item.claimId}
                      onClick={() => handleStartReview(item.claimId, idx)}
                    >
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontWeight: 600,
                            color: 'var(--accent)',
                            fontSize: '0.8125rem',
                          }}
                        >
                          {item.claimId}
                        </span>
                      </td>
                      <td>
                        <div
                          style={{
                            fontSize: '0.875rem',
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.provider}
                        </div>
                      </td>
                      <td>
                        <Badge
                          label={item.priority}
                          bg={prStyle.bg}
                          text={prStyle.text}
                          border={prStyle.border}
                        />
                      </td>
                      <td>
                        <Badge
                          label={item.validationOutcome}
                          bg={valStyle.bg}
                          text={valStyle.text}
                          border={valStyle.border}
                        />
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {item.topFinding}
                        </span>
                      </td>
                      <td><span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{item.serviceDate}</span></td>
                      <td><span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{item.amount}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleStartReview(item.claimId, idx)}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            padding: '5px 12px',
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          Review →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {filtered.length > 0 && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--card-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              {filtered.length} flagged claims · {data.sourceLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
