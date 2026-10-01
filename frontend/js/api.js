export const API_BASE = window.CLAIMGUARD_API || 'http://127.0.0.1:8000';

async function call(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return body;
}

export const getDataset = (split, limit) =>
  call(`/api/v1/datasets/${split}${limit ? `?limit=${limit}` : ''}`);

export const evaluateClaimRemote = (claim) =>
  call('/api/v1/claims/evaluate', { method: 'POST', body: JSON.stringify({ claim }) });

export const explainRule = (claim, rule_id, provider = 'mock') =>
  call('/api/v1/explanations', { method: 'POST', body: JSON.stringify({ claim, rule_id, provider }) });

export const postReview = (decision) =>
  call('/api/v1/reviews', {
    method: 'POST',
    body: JSON.stringify({ ...decision, created_at: new Date().toISOString() }),
  });

export const getAuditEvents = (limit = 50) => call(`/api/v1/audit/events?limit=${limit}`);
export const verifyAudit = () => call('/api/v1/audit/verify');