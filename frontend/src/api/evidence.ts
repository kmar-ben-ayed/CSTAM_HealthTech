import { apiFetch } from './client';
import type { BackendClaim, EvaluationStatus } from './claims';

// Supporting-evidence retrieval. Passages are unverified text from the claim's
// own documents: they help the reviewer, they never change a rule result.

export type PatientMatch = 'match' | 'mismatch' | 'unknown';
export type DateRelation = 'equal' | 'different' | 'none';
export type StatusHint = 'approved' | 'denied' | 'pending' | 'draft' | 'final';
export type AdvisoryFlag =
  | 'contradicting_evidence'
  | 'possible_resolution'
  | 'no_supporting_evidence'
  | 'injection_suspected'
  | 'ocr_low_confidence';

export interface PassageSignals {
  patient_match: PatientMatch;
  date_relation: DateRelation;
  identifier_found: string[];
  status_hint: StatusHint | null;
  injection_suspected: boolean;
}

export interface EvidencePassage {
  passage_id: string;
  document_id: string;
  attachment_id: string;
  filename: string;
  source: 'pdf' | 'inline';
  page: number | null;
  text: string;
  highlights: Array<{ start: number; end: number; term: string }>;
  score: number;
  matched: { identifiers: string[]; dates: string[]; words: string[] };
  signals: PassageSignals;
}

export interface EvidenceResponse {
  claim_id: string;
  rule_id: string;
  finding_status: EvaluationStatus;
  applicable: boolean;
  retriever: string | null;
  advisory: AdvisoryFlag[];
  passages: EvidencePassage[];
  documents_searched: number;
  warnings: string[];
  notice: string;
}

export interface EvidenceDocument {
  document_id: string;
  claim_id: string;
  attachment_id: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  page_count: number;
  method: 'text' | 'ocr' | 'mixed' | 'none';
  warnings: string[];
  created_at: string;
}

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export function getEvidence(claim: BackendClaim, ruleId: string, signal?: AbortSignal): Promise<EvidenceResponse> {
  return apiFetch<EvidenceResponse>('/api/v1/claims/evidence', {
    method: 'POST',
    body: JSON.stringify({ claim, rule_id: ruleId }),
    signal,
  });
}

export function listDocuments(claimId: string, signal?: AbortSignal): Promise<{ claim_id: string; documents: EvidenceDocument[] }> {
  return apiFetch(`/api/v1/claims/${encodeURIComponent(claimId)}/documents`, { signal });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsDataURL(file);
  });
}

export async function uploadDocument(
  claimId: string,
  attachmentId: string,
  file: File,
): Promise<EvidenceDocument & { created: boolean }> {
  const content_base64 = await readAsBase64(file);
  return apiFetch(`/api/v1/claims/${encodeURIComponent(claimId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({ attachment_id: attachmentId, filename: file.name, content_base64 }),
  });
}

export function deleteDocument(claimId: string, documentId: string): Promise<{ document_id: string; removed: boolean }> {
  return apiFetch(`/api/v1/claims/${encodeURIComponent(claimId)}/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

// Results already fetched this session, per claim and rule. Cleared for a claim
// whenever its documents change.
export const evidenceCache = new Map<string, EvidenceResponse>();

export function clearEvidenceCache(claimId: string): void {
  for (const key of evidenceCache.keys()) {
    if (key.startsWith(`${claimId}:`)) evidenceCache.delete(key);
  }
}
