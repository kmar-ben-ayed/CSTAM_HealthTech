import { useState } from 'react';
import Sentinel from '../components/Sentinel';

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
  High: { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' },
  Medium: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  Low: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
};

const VALIDATION_STYLE: Record<ValidationOutcome, { bg: string; text: string; border: string }> = {
  PASS: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass)', border: 'var(--status-pass-border)' },
  FAIL: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail)', border: 'var(--status-fail-border)' },
  'NEEDS REVIEW': { bg: 'var(--status-review-bg)', text: 'var(--status-review)', border: 'var(--status-review-border)' },
  'UNABLE TO ASSESS': { bg: 'var(--status-uta-bg)', text: 'var(--status-uta)', border: 'var(--status-uta-border)' },
};

const REVIEW_STATUS_STYLE: Record<ReviewStatus, { color: string; dot: string }> = {
  Unassigned: { color: '#94a3b8', dot: '#94a3b8' },
  Assigned: { color: '#3b82f6', dot: '#3b82f6' },
  'In Review': { color: 'var(--accent)', dot: 'var(--accent)' },
  'Waiting for Info': { color: 'var(--status-uta)', dot: 'var(--status-uta)' },
  'Ready for Re-check': { color: 'var(--status-pass)', dot: 'var(--status-pass)' },
  Completed: { color: '#64748b', dot: '#64748b' },
};

type FilterTab = 'all' | 'mine' | 'unassigned' | 'high' | 'waiting' | 'recheck';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My Queue' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'high', label: 'High Priority' },
  { key: 'waiting', label: 'Waiting for Info' },
  { key: 'recheck', label: 'Ready for Re-check' },
];

const WORKLOAD = [
  { label: 'High priority', count: 8, color: '#f43f5e', bg: '#fff1f2', border: '#fecdd3' },
  { label: 'Unassigned', count: 12, color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
  { label: 'Waiting for info', count: 7, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
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
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [sortBy, setSortBy] = useState<'age' | 'priority' | 'status'>('priority');
  const [reviewerFilter, setReviewerFilter] = useState('All reviewers');
  const [sessionIndex, setSessionIndex] = useState<number | null>(null);

  const currentUser = 'Aya Gaha';

  const filtered = QUEUE_ITEMS.filter((item) => {
    if (activeFilter === 'mine') return item.assignedTo === currentUser;
    if (activeFilter === 'unassigned') return item.assignedTo === null;
    if (activeFilter === 'high') return item.priority === 'High';
    if (activeFilter === 'waiting') return item.reviewStatus === 'Waiting for Info';
    if (activeFilter === 'recheck') return item.reviewStatus === 'Ready for Re-check';
    return true;
  }).filter((item) => {
    if (reviewerFilter === 'All reviewers') return true;
    if (reviewerFilter === 'Unassigned') return item.assignedTo === null;
    return item.assignedTo === reviewerFilter;
  });

  const highPriority = filtered.filter((i) => i.priority === 'High');

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
              <strong style={{ color: 'var(--text-primary)' }}>42</strong> claims need your attention
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={reviewerFilter}
              onChange={(e) => setReviewerFilter(e.target.value)}
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
              <option>All reviewers</option>
              <option>Aya Gaha</option>
              <option>Marcus Webb</option>
              <option>Priya Nair</option>
              <option>Unassigned</option>
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
              <option value="age">Sort: Age</option>
              <option value="status">Sort: Status</option>
            </select>
          </div>
        </div>
      </div>

      {/* Workload summary */}
      <div className="review-queue-summary" style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        {WORKLOAD.map((w) => (
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
                  fontFamily: "'JetBrains Mono', monospace",
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
            background: 'linear-gradient(135deg, rgba(6,182,212,0.06), rgba(139,92,246,0.04))',
            border: '1px solid rgba(6,182,212,0.2)',
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
        {filtered.length === 0 ? (
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
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 20,
                padding: '4px 14px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#065f46',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Queue clear
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>Claim ID</th>
                  <th>Provider</th>
                  <th>Priority</th>
                  <th>Validation</th>
                  <th>Review Status</th>
                  <th style={{ minWidth: 220 }}>Top Finding</th>
                  <th>Assigned To</th>
                  <th>Age</th>
                  <th>Last Action</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const prStyle = PRIORITY_STYLE[item.priority];
                  const valStyle = VALIDATION_STYLE[item.validationOutcome];
                  const revStyle = REVIEW_STATUS_STYLE[item.reviewStatus];
                  const canResume =
                    item.assignedTo === currentUser &&
                    (item.reviewStatus === 'In Review' || item.reviewStatus === 'Assigned');

                  return (
                    <tr
                      key={item.claimId}
                      onClick={() => handleStartReview(item.claimId, idx)}
                    >
                      <td>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: revStyle.dot,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: '0.8125rem',
                              color: revStyle.color,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.reviewStatus}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {item.topFinding}
                        </span>
                      </td>
                      <td>
                        {item.assignedTo ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: '50%',
                                background:
                                  item.assignedTo === currentUser
                                    ? 'var(--accent)'
                                    : 'linear-gradient(135deg, #94a3b8, #64748b)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.625rem',
                                fontWeight: 700,
                                color: '#fff',
                                flexShrink: 0,
                              }}
                            >
                              {item.assignedTo
                                .split(' ')
                                .map((n) => n[0])
                                .join('')}
                            </div>
                            <span
                              style={{
                                fontSize: '0.8125rem',
                                color: 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.assignedTo === currentUser ? 'You' : item.assignedTo}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '0.8125rem',
                            color: '#64748b',
                            fontWeight: 500,
                          }}
                        >
                          {item.age}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '0.8125rem',
                            color: 'var(--text-tertiary)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.lastAction}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleStartReview(item.claimId, idx)}
                          style={{
                            background: canResume ? 'rgba(6,182,212,0.08)' : '#f8fafc',
                            border: canResume
                              ? '1px solid rgba(6,182,212,0.25)'
                              : '1px solid #e2e8f0',
                            borderRadius: 6,
                            padding: '5px 12px',
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: canResume ? 'var(--accent)' : 'var(--text-primary)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {canResume
                            ? 'Resume →'
                            : item.reviewStatus === 'Unassigned'
                            ? 'Start review'
                            : 'Open →'}
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
              Showing {filtered.length} of 42 claims
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                style={{
                  background: 'none',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: '0.8125rem',
                  color: '#334155',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ← Prev
              </button>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.8125rem',
                  color: '#64748b',
                  padding: '0 4px',
                }}
              >
                1 / 4
              </span>
              <button
                style={{
                  background: 'none',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: '0.8125rem',
                  color: '#334155',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
