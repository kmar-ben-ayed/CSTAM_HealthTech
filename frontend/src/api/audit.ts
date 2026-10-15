import { apiFetch } from './client';

export interface BackendAuditEvent {
  index: number;
  timestamp: string;
  event_type: string;
  claim_id?: string | null;
  actor: string;
  payload: Record<string, unknown>;
  entry_hash: string;
}

export interface AuditEventsResponse {
  total_count: number;
  events: BackendAuditEvent[];
}

export interface AuditVerificationResponse {
  valid: boolean;
  first_broken_index: number | null;
}

export function getAuditEvents(limit = 500, signal?: AbortSignal): Promise<AuditEventsResponse> {
  return apiFetch<AuditEventsResponse>(`/api/v1/audit/events?limit=${limit}`, { signal });
}

export function verifyAudit(signal?: AbortSignal): Promise<AuditVerificationResponse> {
  return apiFetch<AuditVerificationResponse>('/api/v1/audit/verify', { signal });
}

/** One line describing an audit event for people, e.g. "Review action: confirm issue on R004". */
export function describeAuditEvent(event: BackendAuditEvent): string {
  const action = typeof event.payload.action === 'string' ? event.payload.action.replaceAll('_', ' ') : '';
  const rule = typeof event.payload.rule_id === 'string' ? event.payload.rule_id : '';
  if (event.event_type === 'human_decision') return `Review action: ${action || 'decision recorded'}${rule ? ` on ${rule}` : ''}`;
  if (event.event_type === 'ai_decision') return `AI explanation drafted${rule ? ` for ${rule}` : ''}`;
  if (event.event_type === 'evidence_retrieval') return `Evidence searched${rule ? ` for ${rule}` : ''}`;
  if (event.event_type === 'evidence_document_added') return 'Supporting document added';
  if (event.event_type === 'evidence_document_removed') return 'Supporting document removed';
  const kind = event.event_type.replaceAll('_', ' ');
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
