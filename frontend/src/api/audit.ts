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
