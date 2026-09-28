/**
 * these are the FHIR client helpers.
 * All mapping logic lives in the backend (backend/src/fhir_adapter.py), this file only
 * talks to /api/fhir/* and never invents missing values.
 */
export const API_BASE = 'http://127.0.0.1:8000';

/** True when the text looks like FHIR (Bundle or bare Claim), in JSON, array or JSONL form. */
export function looksLikeFhir(text) {
  return /"resourceType"\s*:\s*"(Bundle|Claim)"/.test(text.slice(0, 20000));
}

/** A bare Claim resource is wrapped into a Bundle so the backend can process it. */
export function wrapBareClaims(text) {
  try {
    const parsed = JSON.parse(text);
    const wrap = (r) => (r && r.resourceType === 'Claim'
      ? { resourceType: 'Bundle', type: 'collection', entry: [{ resource: r }] } : r);
    return JSON.stringify(Array.isArray(parsed) ? parsed.map(wrap) : wrap(parsed));
  } catch {
    return text; // JSONL or invalid JSON: let the backend report it
  }
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** outputs { claims, evaluations, fhir_findings, rejected } */
export function ingestFhir(text, sidecarSplit = null) {
  const q = sidecarSplit ? `?sidecar=${encodeURIComponent(sidecarSplit)}` : '';
  return post(`/api/fhir/ingest${q}`, wrapBareClaims(text));
}

/** outputs { results:[{index, findings}], parse_errors } */
export function validateFhir(text) {
  return post('/api/fhir/validate', wrapBareClaims(text));
}

/** Normalized claim (possibly edited in the UI) to FHIR Bundle. */
export function exportBundle(claim) {
  return post('/api/fhir/export', JSON.stringify(claim));
}

/** Human-readable summary for the upload report. */
export function summarizeIngest(result) {
  const warnings = result.fhir_findings.reduce((n, r) => n + r.findings.length, 0);
  const lines = [`Accepted ${result.claims.length} claim(s), rejected ${result.rejected.length}, ${warnings} FHIR warning(s).`];
  result.rejected.forEach((r) => {
    r.findings.forEach((f) => lines.push(`REJECTED #${r.index ?? '?'} [${f.code}] ${f.message}`));
  });
  result.fhir_findings.forEach((r) => r.findings.forEach((f) => lines.push(`${r.claim_id} [${f.code}] ${f.message}`)));
  return lines;
}