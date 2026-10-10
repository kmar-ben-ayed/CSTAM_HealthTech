import { useEffect, useState } from 'react';
import { getAuditEvents, verifyAudit, type BackendAuditEvent } from '../api/audit';

const AUDIT_EVENTS = [
  {
    id: 'EVT-88291',
    time: '10:33:02',
    date: 'Sep 25, 2026',
    event: 'REVIEW_ACTION',
    actor: 'Marwen Agrebi',
    actorType: 'human',
    claimId: 'CLM-10481',
    runId: 'RUN-4821',
    ruleId: null,
    ruleVersion: null,
    detail: 'Review action: Request information submitted',
    reason: 'Authorization reference was subsequently provided',
    note: 'Provider indicated auth ref was submitted on 09/20. Awaiting confirmation.',
    prevHash: 'sha256:4a7f2e8c9b1d3a6e5f7c2b9d4a1e8c3b6d9f2a5e8c1b4d7a3e6f9b2d5a8c1e4f',
    eventHash: 'sha256:7c3a9e2f8b5d1c6a4e9f3b7d2c5a8e1f4c7b3a6d9e2f5b8c1a4d7e3f6b9d2a5c',
  },
  {
    id: 'EVT-88290',
    time: '10:32:17',
    date: 'Sep 25, 2026',
    event: 'REVIEW_OPENED',
    actor: 'Marwen Agrebi',
    actorType: 'human',
    claimId: 'CLM-10481',
    runId: 'RUN-4821',
    ruleId: null,
    ruleVersion: null,
    detail: 'Review workspace opened',
    reason: null,
    note: null,
    prevHash: 'sha256:2b5a8e3c1f6d9a4b7e2c5f8a1d4b7c3a6e9f2d5b8c1a4e7f3b6d9a2e5c8b1f4d',
    eventHash: 'sha256:4a7f2e8c9b1d3a6e5f7c2b9d4a1e8c3b6d9f2a5e8c1b4d7a3e6f9b2d5a8c1e4f',
  },
  {
    id: 'EVT-88289',
    time: '10:31:44',
    date: 'Sep 25, 2026',
    event: 'RULE_EVALUATED',
    actor: 'System',
    actorType: 'system',
    claimId: 'CLM-10481',
    runId: 'RUN-4821',
    ruleId: 'R009',
    ruleVersion: 'v2.4.1',
    detail: 'Rule R009 evaluated → UNABLE TO ASSESS',
    reason: null,
    note: null,
    prevHash: 'sha256:1a4d7e3f6b9d2c5a8e1f4c7b3a6d9e2f5b8c1a4d7e3f6b9d2a5c8e1f4b7d3a6e',
    eventHash: 'sha256:2b5a8e3c1f6d9a4b7e2c5f8a1d4b7c3a6e9f2d5b8c1a4e7f3b6d9a2e5c8b1f4d',
  },
  {
    id: 'EVT-88288',
    time: '10:31:43',
    date: 'Sep 25, 2026',
    event: 'RULE_EVALUATED',
    actor: 'System',
    actorType: 'system',
    claimId: 'CLM-10481',
    runId: 'RUN-4821',
    ruleId: 'R008',
    ruleVersion: 'v2.4.1',
    detail: 'Rule R008 evaluated → FAIL',
    reason: null,
    note: null,
    prevHash: 'sha256:9f2d5a8c1e4b7d3a6f9c2e5a8b1d4c7f3a6e9d2b5c8f1a4e7d3b6c9f2a5e8b1d',
    eventHash: 'sha256:1a4d7e3f6b9d2c5a8e1f4c7b3a6d9e2f5b8c1a4d7e3f6b9d2a5c8e1f4b7d3a6e',
  },
  {
    id: 'EVT-88287',
    time: '10:31:03',
    date: 'Sep 25, 2026',
    event: 'RUN_STARTED',
    actor: 'System',
    actorType: 'system',
    claimId: 'CLM-10481',
    runId: 'RUN-4821',
    ruleId: null,
    ruleVersion: null,
    detail: 'Evaluation run started · ruleset v2.4.1 · model CGM-3.1',
    reason: null,
    note: null,
    prevHash: 'sha256:6e9c2a5f8b1d4a7c3e6f9b2d5a8c1e4f7b3a6c9d2e5f8a1b4d7c3e6a9f2b5d8c1',
    eventHash: 'sha256:9f2d5a8c1e4b7d3a6f9c2e5a8b1d4c7f3a6e9d2b5c8f1a4e7d3b6c9f2a5e8b1d',
  },
  {
    id: 'EVT-88286',
    time: '10:28:44',
    date: 'Sep 25, 2026',
    event: 'CLAIM_RECEIVED',
    actor: 'System',
    actorType: 'system',
    claimId: 'CLM-10481',
    runId: null,
    ruleId: null,
    ruleVersion: null,
    detail: 'Claim ingested · Meridian Health Group · $2,840.00',
    reason: null,
    note: null,
    prevHash: 'sha256:3a6f9c2d5e8b1a4f7c3e6d9a2f5b8c1e4a7d3f6c9b2e5d8a1f4c7e3a6d9b2f5c8',
    eventHash: 'sha256:6e9c2a5f8b1d4a7c3e6f9b2d5a8c1e4f7b3a6c9d2e5f8a1b4d7c3e6a9f2b5d8c1',
  },
  {
    id: 'EVT-88279',
    time: '10:15:21',
    date: 'Sep 25, 2026',
    event: 'REVIEW_ACTION',
    actor: 'James Park',
    actorType: 'human',
    claimId: 'CLM-10480',
    runId: 'RUN-4820',
    ruleId: 'R005',
    ruleVersion: 'v2.4.1',
    detail: 'Review action: Issue confirmed → escalated to supervisor',
    reason: 'Duplicate claim confirmed by provider billing team',
    note: null,
    prevHash: 'sha256:8d1b4a7e3f6c9b2d5a8f1c4e7b3d6f9c2a5e8b1d4f7c3a6d9b2e5f8c1a4d7e3f6',
    eventHash: 'sha256:3a6f9c2d5e8b1a4f7c3e6d9a2f5b8c1e4a7d3f6c9b2e5d8a1f4c7e3a6d9b2f5c8',
  },
];

const EVENT_LABELS: Record<string, string> = {
  CLAIM_RECEIVED: 'Claim received',
  RUN_STARTED: 'Run started',
  RUN_COMPLETED: 'Run completed',
  RULE_EVALUATED: 'Rule evaluated',
  REVIEW_OPENED: 'Review opened',
  REVIEW_ACTION: 'Review decision',
  AI_EXPLANATION: 'AI explanation',
};

// A rule event takes the tone of its result; the rest by kind.
const RESULT_PILL: Record<string, string> = {
  FAIL: 'is-fail',
  PASS: 'is-pass',
  UNABLE_TO_ASSESS: 'is-uta',
  NOT_APPLICABLE: 'is-na',
};

function eventLabel(event: string): string {
  const fallback = event.replaceAll('_', ' ').toLowerCase();
  return EVENT_LABELS[event] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

function eventPill(event: AuditEvent): string {
  if (event.event === 'RULE_EVALUATED') return RESULT_PILL[event.result ?? ''] ?? 'is-na';
  if (event.event === 'REVIEW_ACTION') return 'is-pass';
  if (event.event === 'AI_EXPLANATION') return 'is-review';
  return 'is-na';
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

const RESULT_COLOR: Record<string, string> = {
  FAIL: 'var(--status-fail)',
  PASS: 'var(--status-pass)',
  'UNABLE TO ASSESS': 'var(--status-uta)',
  'NOT APPLICABLE': 'var(--status-na)',
};

type AuditEvent = {
  id: string;
  time: string;
  date: string;
  event: string;
  actor: string;
  actorType: 'human' | 'system';
  claimId: string | null;
  runId: string | null;
  ruleId: string | null;
  ruleVersion: string | null;
  result: string | null;
  detail: string;
  reason: string | null;
  note: string | null;
  prevHash: string;
  eventHash: string;
};

function toAuditEvent(event: BackendAuditEvent): AuditEvent {
  const timestamp = new Date(event.timestamp);
  const payload = event.payload;
  const status = typeof payload.status === 'string' ? payload.status : '';
  const ruleId = typeof payload.rule_id === 'string' ? payload.rule_id : null;
  const ruleVersion = typeof payload.rule_version === 'string' ? payload.rule_version : null;
  const eventName = event.event_type === 'rule_execution'
    ? 'RULE_EVALUATED'
    : event.event_type === 'human_decision'
      ? 'REVIEW_ACTION'
      : event.event_type === 'ai_decision'
        ? 'AI_EXPLANATION'
        : event.event_type.toUpperCase();
  const detail = event.event_type === 'rule_execution'
    ? `Rule ${ruleId || 'unknown'} evaluated → ${status.replaceAll('_', ' ')}`
    : event.event_type === 'human_decision'
      ? `Review action: ${String(payload.action || 'decision recorded').replaceAll('_', ' ')}`
      : `${String(payload.provider || 'AI')} explanation recorded`;

  return {
    id: `AUD-${event.index}`,
    time: Number.isNaN(timestamp.getTime()) ? '—' : timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    date: Number.isNaN(timestamp.getTime()) ? '—' : timestamp.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
    event: eventName,
    actor: event.actor,
    actorType: event.actor === 'system' ? 'system' : 'human',
    claimId: event.claim_id || null,
    runId: null,
    ruleId,
    ruleVersion,
    result: event.event_type === 'rule_execution' ? status : null,
    detail,
    reason: null,
    note: null,
    prevHash: 'Unavailable from minimized audit response',
    eventHash: event.entry_hash,
  };
}

export default function AuditTrail() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [filterClaim, setFilterClaim] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterEvent, setFilterEvent] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    Promise.all([getAuditEvents(500, controller.signal), verifyAudit(controller.signal)])
      .then(([audit, verification]) => {
        setEvents(audit.events.map(toAuditEvent));
        setVerified(verification.valid);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError('The audit history could not be loaded.');
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const result = await verifyAudit();
      setVerified(result.valid);
    } catch {
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const filtered = events.filter(e => {
    const matchClaim = !filterClaim || e.claimId?.toLowerCase().includes(filterClaim.toLowerCase());
    const matchActor = !filterActor || e.actorType === filterActor;
    const matchEvent = !filterEvent || e.event === filterEvent;
    return matchClaim && matchActor && matchEvent;
  });

  const uniqueEvents = Array.from(new Set(events.map(e => e.event)));

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ margin: '0 0 6px' }}>Audit trail</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Trace system and reviewer actions across every claim.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Chain integrity indicator */}
          {verified && !verifying && (
            <span className="status-pill is-pass">Chain verified · {events.length.toLocaleString()} events</span>
          )}
          {verified === false && !verifying && (
            <span className="status-pill is-fail">Chain verification failed</span>
          )}
          <button type="button" className="btn btn-secondary" onClick={handleVerify} disabled={verifying}>
            {verifying ? (
              <>
                <span style={{ width: 12, height: 12, border: '1.5px solid var(--accent-ink)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'sentinel-orbit 0.8s linear infinite' }} />
                Verifying…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 1l6 2.5v4.5C13 11 10 13.5 7 14 4 13.5 1 11 1 8V3.5L7 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                Verify chain
              </>
            )}
          </button>
          <button type="button" className="btn btn-secondary">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 2v7M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 11h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="audit-filters">
        <div className="claims-search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Claim ID, e.g. CLM-10481"
            aria-label="Filter by claim ID"
            value={filterClaim}
            onChange={e => setFilterClaim(e.target.value)}
          />
        </div>

        <select className="form-select" aria-label="Filter by actor" value={filterActor} onChange={e => setFilterActor(e.target.value)}>
          <option value="">All actors</option>
          <option value="human">Human</option>
          <option value="system">System</option>
        </select>

        <select className="form-select" aria-label="Filter by event type" value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="">All event types</option>
          {uniqueEvents.map(e => <option key={e} value={e}>{eventLabel(e)}</option>)}
        </select>

        {(filterClaim || filterActor || filterEvent) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => { setFilterClaim(''); setFilterActor(''); setFilterEvent(''); }}
          >
            Clear
          </button>
        )}

        <span className="audit-filter-count">{filtered.length} events</span>
      </div>

      {loading && <div className="audit-empty">Loading audit history…</div>}
      {loadError && (
        <div className="audit-empty">
          <strong>Unable to load the audit trail</strong>
          <span>{loadError}</span>
        </div>
      )}

      {/* Event list */}
      {filtered.length > 0 && (
        <div className="audit-list">
          {filtered.map(event => {
            const isExpanded = expandedEvent === event.id;
            const toggle = () => setExpandedEvent(isExpanded ? null : event.id);

            return (
              <div key={event.id} className={`audit-row${isExpanded ? ' is-open' : ''}`}>
                <div
                  className="audit-row-head"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={toggle}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <span className="activity-avatar" aria-hidden="true">{initials(event.actor)}</span>

                  <div className="audit-row-main">
                    <div className="audit-row-title">
                      <span>{event.detail}</span>
                      <span className={`status-pill ${eventPill(event)}`}>{eventLabel(event.event)}</span>
                    </div>
                    <div className="audit-row-meta">
                      <span>{event.actor}</span>
                      {event.claimId && <span className="audit-mono">{event.claimId}</span>}
                      {event.ruleId && <span className="rule-chip">{event.ruleId}</span>}
                    </div>
                  </div>

                  <div className="audit-row-when">
                    <span className="audit-mono">{event.time}</span>
                    <span>{event.date}</span>
                  </div>

                  <svg
                    className="audit-row-chevron"
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="audit-row-detail">
                    <dl className="audit-facts">
                      {[
                        { label: 'Event ID', value: event.id, mono: true },
                        { label: 'Timestamp', value: `${event.date} ${event.time}`, mono: true },
                        { label: 'Actor', value: event.actor },
                        { label: 'Claim ID', value: event.claimId || '–', mono: true },
                        { label: 'Run ID', value: event.runId || '–', mono: true },
                        { label: 'Rule / version', value: event.ruleId ? [event.ruleId, event.ruleVersion].filter(Boolean).join(' · ') : '–', mono: true },
                      ].map(f => (
                        <div key={f.label}>
                          <dt>{f.label}</dt>
                          <dd className={f.mono ? 'audit-mono' : undefined}>{f.value}</dd>
                        </div>
                      ))}
                    </dl>

                    {event.reason && (
                      <div className="audit-note">
                        <div className="audit-label">Reason</div>
                        <p>{event.reason}</p>
                      </div>
                    )}

                    {event.note && (
                      <div className="audit-note">
                        <div className="audit-label">Reviewer note</div>
                        <p style={{ fontStyle: 'italic' }}>{event.note}</p>
                      </div>
                    )}

                    {/* Hash chain */}
                    <div className="audit-label">Hash chain</div>
                    <div className="audit-hash-label">Previous hash</div>
                    <div className="evidence-dark audit-hash">{event.prevHash}</div>
                    <div className="audit-hash-arrow" aria-hidden="true">↓</div>
                    <div className="audit-hash-label">Event hash</div>
                    <div className="evidence-dark audit-hash is-current">{event.eventHash}</div>
                    {verified && (
                      <div className="audit-verified">
                        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M6 1l5 2v3c0 3-2.5 5.5-5 6C3.5 11.5 1 9 1 6V3L6 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                          <path d="M4 6l1.5 1.5L8 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Verified with the rest of the chain
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <div className="audit-empty">
          <strong>No audit events found</strong>
          <span>Try adjusting your filters</span>
        </div>
      )}
    </div>
  );
}
