import { useEffect, useRef, useState } from 'react';
import ShieldLoader from './ShieldLoader';
import { describeAuditEvent, getAuditEvents, type BackendAuditEvent } from '../api/audit';
import { displayName, timeAgo } from '../api/claimCards';

// ── Notifications ──────────────────────────────────────────────────────────
// Recent activity from the audit log, newest first. Per-rule engine results
// are left out (every claim produces one per rule); reviewer decisions, AI
// explanations and ingestion events remain. "Unread" means newer than the
// last time this panel was opened in this browser session.

const SEEN_KEY = 'cg-notifications-seen';
const LIMIT = 8;

function readSeen(): number {
  try {
    return Number(sessionStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function storeSeen(at: number) {
  try {
    sessionStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // Not remembered; everything shows as read once the panel closes.
  }
}

export default function NotificationsMenu({ onOpenAudit }: { onOpenAudit: () => void }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<BackendAuditEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const ref = useRef<HTMLDivElement>(null);

  // Loaded on mount for the unread marker, and again each time the panel opens.
  useEffect(() => {
    const controller = new AbortController();
    getAuditEvents(200, controller.signal)
      .then((response) => {
        const recent = response.events
          .filter((event) => event.event_type !== 'rule_execution')
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
          .slice(0, LIMIT);
        setEvents(recent);
        setFailed(false);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // However the panel closes, what it showed counts as read.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const now = Date.now();
      storeSeen(now);
      setSeen(now);
    }
    wasOpen.current = open;
  }, [open]);

  const unread = (events ?? []).filter((event) => Date.parse(event.timestamp) > seen).length;

  return (
    <div ref={ref} className="notifications">
      <button
        type="button"
        className="topbar-icon-button"
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2a5 5 0 00-5 5v3L2.5 12.5h13L14 10V7a5 5 0 00-5-5z" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 14a2 2 0 004 0" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {unread > 0 && <span className="notifications-count" aria-hidden="true">{unread}</span>}
      </button>

      {open && (
        <div className="notifications-panel" role="dialog" aria-label="Notifications">
          <div className="notifications-heading">Recent activity</div>
          {failed ? (
            <p className="notifications-empty">The audit log could not be loaded.</p>
          ) : events === null ? (
            <ShieldLoader label="Loading recent activity…" inline />
          ) : events.length === 0 ? (
            <p className="notifications-empty">No activity yet.</p>
          ) : (
            <ul>
              {events.map((event) => {
                const isNew = Date.parse(event.timestamp) > seen;
                return (
                  <li key={event.index} className={isNew ? 'is-new' : undefined}>
                    <span className="notifications-title">{describeAuditEvent(event)}</span>
                    <span className="notifications-meta">
                      {event.claim_id && <span className="mono">{event.claim_id}</span>}
                      {displayName(event.actor)} · {timeAgo(new Date(event.timestamp))}
                      {isNew && <span className="visually-hidden"> (new)</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="notifications-all"
            onClick={() => {
              setOpen(false);
              onOpenAudit();
            }}
          >
            Open the audit trail
          </button>
        </div>
      )}
    </div>
  );
}
