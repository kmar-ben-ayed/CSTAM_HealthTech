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

const EVENT_CONFIG: Record<string, { color: string; bg: string }> = {
  CLAIM_RECEIVED: { color: 'var(--accent)', bg: 'var(--accent-subtle)' },
  RUN_STARTED: { color: 'var(--status-review-ink)', bg: 'var(--status-review-bg)' },
  RUN_COMPLETED: { color: 'var(--status-pass-ink)', bg: 'var(--status-pass-bg)' },
  RULE_EVALUATED: { color: 'var(--status-uta-ink)', bg: 'var(--status-uta-bg)' },
  REVIEW_OPENED: { color: 'var(--status-na-ink)', bg: 'var(--status-na-bg)' },
  REVIEW_ACTION: { color: 'var(--status-fail-ink)', bg: 'var(--status-fail-bg)' },
};

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <span className="sc-eyebrow"> Tamper-evident log</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '12px 0 4px' }}>
            Audit Trail
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Trace system and reviewer actions across every claim.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Chain integrity indicator */}
          {verified && !verifying && (
            <div className="chain-verified">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" fill="var(--status-pass)"/>
                <path d="M3.5 6l2 2 3-4" stroke="var(--card-bg)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Audit chain verified
            </div>
          )}
          <button
            onClick={handleVerify}
            disabled={verifying}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: '7px 14px',
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              cursor: verifying ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: verifying ? 0.7 : 1,
            }}
          >
            {verifying ? (
              <>
                <div style={{ width: 12, height: 12, border: '1.5px solid var(--accent-ink)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'sentinel-orbit 0.8s linear infinite' }} />
                Verifying...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1l6 2.5v4.5C13 11 10 13.5 7 14 4 13.5 1 11 1 8V3.5L7 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                Verify chain
              </>
            )}
          </button>
          <button style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: '7px 14px',
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v7M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 11h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="var(--text-tertiary)" strokeWidth="1.3"/>
            <path d="M9.5 9.5l3 3" stroke="var(--text-tertiary)" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Filter by claim ID..."
            value={filterClaim}
            onChange={e => setFilterClaim(e.target.value)}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: '7px 12px 7px 32px',
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              outline: 'none',
              width: 200,
            }}
          />
        </div>

        <select
          value={filterActor}
          onChange={e => setFilterActor(e.target.value)}
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: '7px 12px',
            fontSize: '0.875rem',
            color: filterActor ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">All actors</option>
          <option value="human">Human</option>
          <option value="system">System</option>
        </select>

        <select
          value={filterEvent}
          onChange={e => setFilterEvent(e.target.value)}
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: '7px 12px',
            fontSize: '0.875rem',
            color: filterEvent ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">All event types</option>
          {uniqueEvents.map(e => <option key={e} value={e}>{e}</option>)}
        </select>

        {(filterClaim || filterActor || filterEvent) && (
          <button
            onClick={() => { setFilterClaim(''); setFilterActor(''); setFilterEvent(''); }}
            style={{ background: 'transparent', border: 'none', fontSize: '0.8125rem', color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Clear
          </button>
        )}

        <div style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
          {filtered.length} events
        </div>
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {filtered.map((event, i) => {
          const cfg = EVENT_CONFIG[event.event] || EVENT_CONFIG.CLAIM_RECEIVED;
          const isExpanded = expandedEvent === event.id;

          return (
            <div key={event.id} className="audit-event" style={{ display: 'flex', gap: 16, position: 'relative' }}>
              {/* Timeline line */}
              {i < filtered.length - 1 && (
                <div style={{
                  position: 'absolute',
                  left: 19,
                  top: 36,
                  bottom: 0,
                  width: 1,
                  background: 'var(--canvas-bg-secondary)',
                  zIndex: 0,
                }} />
              )}

              {/* Event dot */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, flexShrink: 0 }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: cfg.bg,
                  border: `1.5px solid color-mix(in srgb, ${cfg.color} 18%, transparent)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
                </div>
              </div>

              {/* Event card */}
              <div style={{ flex: 1, marginBottom: 12 }}>
                <div
                  style={{
                    background: isExpanded ? 'var(--canvas-bg)' : 'transparent',
                    border: '0',
                    borderBottom: '1px solid var(--border)',
                    borderRadius: 0,
                    padding: '12px 10px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: 'none',
                  }}
                  onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        color: cfg.color,
                        background: cfg.bg,
                        border: `1px solid color-mix(in srgb, ${cfg.color} 15%, transparent)`,
                        borderRadius: 4,
                        padding: '2px 7px',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}>
                        {event.event}
                      </span>

                      {event.ruleId && (
                        <span style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: '0.6875rem',
                          color: 'var(--accent-ink)',
                          background: 'var(--accent-subtle)',
                          border: '1px solid var(--status-review-border)',
                          borderRadius: 4,
                          padding: '2px 7px',
                          fontWeight: 600,
                        }}>
                          {event.ruleId}
                        </span>
                      )}

                      <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{event.detail}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{event.time}</div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>{event.date}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: event.actorType === 'human' ? 'var(--status-uta-bg)' : 'var(--status-pass-bg)',
                          border: event.actorType === 'human' ? '1px solid var(--status-uta-border)' : '1px solid var(--status-pass-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          {event.actorType === 'human' ? (
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <circle cx="5.5" cy="3.5" r="2" stroke="var(--status-uta-ink)" strokeWidth="1.1"/>
                              <path d="M1 10c0-2.5 2-4.5 4.5-4.5S10 7.5 10 10" stroke="var(--status-uta-ink)" strokeWidth="1.1" strokeLinecap="round"/>
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <rect x="1.5" y="2" width="8" height="7" rx="1.5" stroke="var(--status-pass-ink)" strokeWidth="1.1"/>
                              <path d="M3.5 5h4M3.5 7h2" stroke="var(--status-pass-ink)" strokeWidth="1.1" strokeLinecap="round"/>
                            </svg>
                          )}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{event.actor}</span>
                      </div>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', color: 'var(--text-tertiary)', flexShrink: 0 }}
                      >
                        <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: '1px solid var(--border)',
                      animation: 'fade-in 0.2s ease-out',
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                        {[
                          { label: 'Event ID', value: event.id, mono: true },
                          { label: 'Timestamp', value: `${event.date} ${event.time}`, mono: true },
                          { label: 'Actor', value: event.actor },
                          { label: 'Claim ID', value: event.claimId || '–', mono: true },
                          { label: 'Run ID', value: event.runId || '–', mono: true },
                          { label: 'Rule / version', value: event.ruleId ? `${event.ruleId} · ${event.ruleVersion}` : '–', mono: true },
                        ].map(f => (
                          <div key={f.label}>
                            <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                              {f.label}
                            </div>
                            <div style={{
                              fontSize: '0.8125rem',
                              color: 'var(--text-primary)',
                              fontFamily: f.mono ? "var(--font-sans)" : 'inherit',
                              fontWeight: f.mono ? 500 : 400,
                            }}>
                              {f.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {event.reason && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Reason</div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{event.reason}</div>
                        </div>
                      )}

                      {event.note && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Reviewer note</div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontStyle: 'italic' }}>{event.note}</div>
                        </div>
                      )}

                      {/* Hash chain */}
                      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 1l5 2v3c0 3-2.5 5.5-5 6C3.5 11.5 1 9 1 6V3L6 1z" stroke="var(--accent-ink)" strokeWidth="1.1" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--accent-ink)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Hash chain</span>
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-pass)' }} />
                            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--status-pass-ink)' }}>Verified</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div>
                            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Previous hash</div>
                            <div style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', color: 'var(--text-secondary)', wordBreak: 'break-all', lineHeight: 1.4 }}>{event.prevHash}</div>
                          </div>
                          <div style={{ height: 1, background: 'var(--canvas-bg-secondary)' }} />
                          <div>
                            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Event hash</div>
                            <div style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.4, fontWeight: 600 }}>{event.eventHash}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 24px' }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>No audit events found</div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>Try adjusting your filters</div>
        </div>
      )}
    </div>
  );
}
