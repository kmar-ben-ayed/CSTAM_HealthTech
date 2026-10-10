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

const PRIORITY_TONE: Record<Priority, { color: string; bars: number }> = {
  High: { color: 'var(--status-fail-ink)', bars: 3 },
  Medium: { color: 'var(--status-uta-ink)', bars: 2 },
  Low: { color: 'var(--status-pass-ink)', bars: 1 },
};

const VALIDATION_PILL: Record<ValidationOutcome, { className: string; label: string }> = {
  PASS: { className: 'is-pass', label: 'Passed' },
  FAIL: { className: 'is-fail', label: 'Failed' },
  'NEEDS REVIEW': { className: 'is-review', label: 'Needs review' },
  'UNABLE TO ASSESS': { className: 'is-uta', label: 'Unable to assess' },
};

const REVIEW_STATUS_PILL: Record<ReviewStatus, string> = {
  'In Review': 'is-review',
  'Waiting for Info': 'is-uta',
  'Ready for Re-check': 'is-pass',
  Completed: 'is-na',
};

type FilterTab = 'all' | 'high' | 'waiting' | 'recheck';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High priority' },
  { key: 'waiting', label: 'Waiting for info' },
  { key: 'recheck', label: 'Ready for re-check' },
];

/** Three signal bars, filled up to the priority level. */
function PriorityBars({ priority }: { priority: Priority }) {
  const tone = PRIORITY_TONE[priority];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: tone.color, fontWeight: 650, fontSize: '0.875rem' }}>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
        {[0, 1, 2].map((bar) => (
          <rect
            key={bar}
            x={bar * 5}
            y={0}
            width={3.2}
            height={12}
            rx={1}
            fill="currentColor"
            opacity={bar < tone.bars ? 1 : 0.22}
          />
        ))}
      </svg>
      {priority}
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

  const countFor = (tab: FilterTab) => queueItems.filter((item) => {
    if (tab === 'high') return item.priority === 'High';
    if (tab === 'waiting') return item.reviewStatus === 'Waiting for Info';
    if (tab === 'recheck') return item.reviewStatus === 'Ready for Re-check';
    return true;
  }).length;

  const filtered = queueItems.filter((item) => {
    if (activeFilter === 'high') return item.priority === 'High';
    if (activeFilter === 'waiting') return item.reviewStatus === 'Waiting for Info';
    if (activeFilter === 'recheck') return item.reviewStatus === 'Ready for Re-check';
    return true;
  });

  const highPriority = filtered.filter((i) => i.priority === 'High');
  const workload = [
    { label: 'High priority', count: countFor('high'), dot: 'var(--status-fail)' },
    { label: 'Waiting for info', count: countFor('waiting'), dot: 'var(--status-uta)' },
    { label: 'In review', count: queueItems.filter((item) => item.reviewStatus === 'In Review').length, dot: 'var(--status-review)' },
  ];

  const handleStartReview = (claimId: string) => {
    onNavigate('claim-review', claimId);
  };

  return (
    <div className="page-shell review-queue-shell">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div className="review-queue-heading" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title" style={{ margin: '0 0 6px' }}>Review queue</h1>
            <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{queueItems.length}</strong> claims waiting on a human decision.
            </p>
          </div>
        </div>
      </div>

      {/* Workload summary */}
      <div className="kpi-tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {workload.map((w) => (
          <div key={w.label} className="kpi-tile">
            <div className="kpi-tile-label">{w.label}</div>
            <span className="kpi-tile-dot" style={{ background: w.dot }} aria-hidden="true" />
            <div className="kpi-tile-value" style={{ fontSize: '1.875rem', marginBottom: 0 }}>{w.count}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs and sorting */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="segmented" role="tablist" aria-label="Filter the queue">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeFilter === tab.key}
              onClick={() => setActiveFilter(tab.key)}
            >
              {tab.label}
              <span className="segmented-count">{countFor(tab.key)}</span>
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          Sort by
          <select
            className="form-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ minWidth: 150 }}
          >
            <option value="priority">Priority</option>
            <option value="age">Age</option>
            <option value="status">Status</option>
          </select>
        </label>
      </div>

      {/* Queue session context banner (when high priority filter active) */}
      {activeFilter === 'high' && highPriority.length > 0 && (
        <div className="sc-card" style={{ padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sentinel state="scanning" size={22} showLabel={false} />
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Review session: {highPriority.length} high-priority claims
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => handleStartReview(highPriority[0].claimId)}>
            Start session →
          </button>
        </div>
      )}

      {/* Queue table */}
      <div className="sc-card" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '64px 32px', textAlign: 'center' }}>
            <div style={{ marginBottom: 20 }}>
              <Sentinel state="pass" size={56} showLabel={false} />
            </div>
            <div style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              You're all caught up
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              There are no claims waiting for your review.
            </div>
            <span className="status-pill is-pass">Queue clear</span>
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
                  <th>Review status</th>
                  <th style={{ minWidth: 220 }}>Top finding</th>
                  <th>Age</th>
                  <th>Last action</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const validation = VALIDATION_PILL[item.validationOutcome];
                  const ruleIds = item.topFinding.split(', ').filter((part) => /^R\d{3,}$/.test(part));
                  return (
                    <tr key={item.claimId} onClick={() => handleStartReview(item.claimId)}>
                      <td>
                        <span className="mono-id" style={{ color: 'var(--accent-ink)' }}>{item.claimId}</span>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.provider}
                        </div>
                      </td>
                      <td><PriorityBars priority={item.priority} /></td>
                      <td><span className={`status-pill ${validation.className}`}>{validation.label}</span></td>
                      <td><span className={`status-pill ${REVIEW_STATUS_PILL[item.reviewStatus]}`}>{item.reviewStatus}</span></td>
                      <td>
                        {ruleIds.length ? (
                          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
                            {ruleIds.map((ruleId) => <span key={ruleId} className="rule-chip">{ruleId}</span>)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{item.topFinding}</span>
                        )}
                      </td>
                      <td><span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{item.age}</span></td>
                      <td><span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{item.lastAction}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleStartReview(item.claimId)}>
                          Open
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
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              Showing {filtered.length} of {queueItems.length} claims
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm">← Prev</button>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', padding: '0 4px', fontVariantNumeric: 'tabular-nums' }}>1 / 4</span>
              <button type="button" className="btn btn-secondary btn-sm">Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
