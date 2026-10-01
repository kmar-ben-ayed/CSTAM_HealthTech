import { apiFetch } from './client';
import type { BackendClaim, RuleResult } from './claims';

export interface RejectedRecord {
  index: number | null;
  reason: string;
  findings: Array<{ severity?: string; code?: string; message?: string; path?: string }>;
}

export interface IngestionResponse {
  batch_id: string;
  claims: BackendClaim[];
  evaluations: Record<string, RuleResult[]>;
  rejected: RejectedRecord[];
  fhir_findings?: Array<{ claim_id: string; findings: unknown[] }>;
  authorization_warning?: string | null;
}

export function ingestJsonl(text: string, signal?: AbortSignal): Promise<IngestionResponse> {
  return apiFetch<IngestionResponse>('/api/v1/ingest/jsonl', {
    method: 'POST',
    body: JSON.stringify({ text }),
    signal,
  });
}

export function ingestFhir(text: string, signal?: AbortSignal): Promise<IngestionResponse> {
  return apiFetch<IngestionResponse>('/api/v1/ingest/fhir', {
    method: 'POST',
    body: JSON.stringify({ text }),
    signal,
  });
}

export function ingestCsv(files: Record<string, string>, signal?: AbortSignal): Promise<IngestionResponse> {
  return apiFetch<IngestionResponse>('/api/v1/ingest/csv', {
    method: 'POST',
    body: JSON.stringify({ files }),
    signal,
  });
}
