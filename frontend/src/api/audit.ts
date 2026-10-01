import { apiFetch } from './client';

export interface BackendAuditEvent {
  index: number;
  timestamp: string;
  event_type: string;
  claim_id?: string | null;
  actor: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
}

export interface AuditEventsResponse {
  total_count: number;
  offset: number;
  events: BackendAuditEvent[];
}

export interface AuditVerificationResponse {
  valid: boolean;
  first_broken_index: number | null;
}

export interface AuditChainExport {
  format: string;
  entry_count: number;
  integrity: AuditVerificationResponse;
  entries: Array<BackendAuditEvent & { payload: Record<string, unknown> }>;
}

function currentActor(): string {
  return sessionStorage.getItem('claimguard-demo-actor') || 'unknown-reviewer';
}

export function getAuditEvents(limit = 100, offset = 0, signal?: AbortSignal): Promise<AuditEventsResponse> {
  return apiFetch<AuditEventsResponse>(`/api/v1/audit/events?limit=${limit}&offset=${offset}`, { signal });
}

export function verifyAudit(signal?: AbortSignal): Promise<AuditVerificationResponse> {
  return apiFetch<AuditVerificationResponse>('/api/v1/audit/verify', { signal });
}

export function getAuditExport(signal?: AbortSignal): Promise<AuditChainExport> {
  return apiFetch<AuditChainExport>('/api/v1/audit/export', { signal });
}

export function recordReviewOpened(claimId: string, visitId: string): Promise<void> {
  return apiFetch<void>('/api/v1/reviews/opened', {
    method: 'POST',
    body: JSON.stringify({
      claim_id: claimId,
      actor: currentActor(),
      visit_id: visitId,
      opened_at: new Date().toISOString(),
    }),
    headers: { 'X-Actor': currentActor() },
  });
}
