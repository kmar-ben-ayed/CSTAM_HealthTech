import { useEffect, useState } from 'react';
import Sentinel from '../components/Sentinel';
import { datasetToClaimRows, getIngestedClaims, type ClaimRow } from '../api/claims';

interface ReviewQueueProps {
  onNavigate: (page: string, claimId?: string) => void;
}

type Priority = 'High' | 'Medium' | 'Low';
type ReviewStatus =
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
  age: string;
  lastAction: string;
  serviceDate: string;
  amount: string;
}

const PRIORITY_STYLE: Record<Priority, { bg: string; text: string; border: string }> = {
  High: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail-ink)', border: 'var(--status-fail-border)' },
  Medium: { bg: 'var(--status-uta-bg)', text: 'var(--status-uta-ink)', border: 'var(--status-uta-border)' },
  Low: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass-ink)', border: 'var(--status-pass-border)' },
};

const VALIDATION_STYLE: Record<ValidationOutcome, { bg: string; text: string; border: string }> = {
  PASS: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass)', border: 'var(--status-pass-border)' },
  FAIL: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail)', border: 'var(--status-fail-border)' },
  'NEEDS REVIEW': { bg: 'var(--status-review-bg)', text: 'var(--status-review)', border: 'var(--status-review-border)' },
  'UNABLE TO ASSESS': { bg: 'var(--status-uta-bg)', text: 'var(--status-uta)', border: 'var(--status-uta-border)' },
};

const REVIEW_STATUS_STYLE: Record<ReviewStatus, { color: string; dot: string }> = {
  'In Review': { color: 'var(--accent)', dot: 'var(--accent)' },
  'Waiting for Info': { color: 'var(--status-uta-ink)', dot: 'var(--status-uta)' },
  'Ready for Re-check': { color: 'var(--status-pass-ink)', dot: 'var(--status-pass)' },
  Completed: { color: 'var(--text-secondary)', dot: 'var(--text-secondary)' },
};

type FilterTab = 'all' | 'high' | 'waiting' | 'recheck';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High Priority' },
  { key: 'waiting', label: 'Waiting for Info' },
  { key: 'recheck', label: 'Ready for Re-check' },
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
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    getIngestedClaims(undefined, controller.signal).then((response) => {
      const rows = datasetToClaimRows(response).filter((row) => row.status !== 'pass');
      setQueueItems(rows.map((row: ClaimRow) => ({
        claimId: row.id,
        provider: row.provider,
        priority: row.status === 'fail' ? 'High' : row.status === 'review' ? 'Medium' : 'Low',
        validationOutcome: row.status === 'fail' ? 'FAIL' : row.status === 'review' ? 'NEEDS REVIEW' : 'UNABLE TO ASSESS',
        reviewStatus: 'In Review',
        topFinding: row.rule === '—' ? 'Evaluation requires review' : row.rule,
        age: 'Current batch',
        lastAction: 'Flagged by backend evaluation',
        serviceDate: row.dos,
        amount: row.amount,
      })));
    }).catch(() => setQueueItems([]));
    return () => controller.abort();
  }, []);

  const filtered = queueItems.filter((item) => {
    if (activeFilter === 'high') return item.priority === 'High';
    if (activeFilter === 'waiting') return item.reviewStatus === 'Waiting for Info';
    if (activeFilter === 'recheck') return item.reviewStatus === 'Ready for Re-check';
    return true;
  });

  const highPriority = filtered.filter((i) => i.priority === 'High');
  const workload = [
    { label: 'High priority', count: queueItems.filter((item) => item.priority === 'High').length, color: 'var(--status-fail-ink)', bg: 'var(--status-fail-bg)', border: 'var(--status-fail-border)' },
    { label: 'Waiting for info', count: queueItems.filter((item) => item.reviewStatus === 'Waiting for Info').length, color: 'var(--status-uta-ink)', bg: 'var(--status-uta-bg)', border: 'var(--status-uta-border)' },
    { label: 'In review', count: queueItems.filter((item) => item.reviewStatus === 'In Review').length, color: 'var(--accent)', bg: 'var(--accent-subtle)', border: 'var(--status-pass-border)' },
  ];

  const handleStartReview = (claimId: string, idx: number) => {
    onNavigate('claim-review', claimId);
  };

  return (
    <div className="page-shell review-queue-shell">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div className="review-queue-heading" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <span className="sc-eyebrow"> Human in the loop</span>
            <h1
              style={{
                fontSize: '1.375rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.025em',
                margin: '12px 0 4px',
              }}
            >
              Review Queue
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{queueItems.length}</strong> claims need your attention
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, marginTop: 2 }}>
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
                background: isActive ? 'var(--canvas-bg-secondary)' : 'transparent',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: '0.8125rem',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
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
            border: '1px solid var(--status-review-border)',
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
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
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
              color: 'var(--card-bg)',
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
            <div style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              You're all caught up
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              There are no claims waiting for your review.
            </div>
            <div
              style={{
                marginTop: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--status-pass-bg)',
                border: '1px solid var(--status-pass-border)',
                borderRadius: 20,
                padding: '4px 14px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--status-pass-ink)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="var(--status-pass-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
                        <span
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: '0.8125rem',
                            color: 'var(--text-secondary)',
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
                            background: 'var(--card-bg)',
                            border: '1px solid var(--border)',
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
                          Open →
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
              Showing {filtered.length} of {queueItems.length} claims
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: '0.8125rem',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ← Prev
              </button>
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  padding: '0 4px',
                }}
              >
                1 / 4
              </span>
              <button
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: '0.8125rem',
                  color: 'var(--text-primary)',
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
