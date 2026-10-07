export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload && 'details' in payload && payload.details
      ? typeof payload.details === 'object' && payload.details && 'errors' in payload.details && Array.isArray(payload.details.errors)
        ? payload.details.errors.join(' ')
        : String(payload.details)
      : typeof payload === 'object' && payload && 'error' in payload
      ? String(payload.error)
      : typeof payload === 'object' && payload && 'detail' in payload && typeof payload.detail === 'object' && payload.detail && 'errors' in payload.detail
        ? (Array.isArray(payload.detail.errors) ? payload.detail.errors.join(' ') : String(payload.detail.errors))
        : typeof payload === 'object' && payload && 'detail' in payload
          ? String(payload.detail)
          : `Request failed with status ${response.status}`;
    const code = typeof payload === 'object' && payload && 'code' in payload
      ? String(payload.code)
      : undefined;
    throw new ApiError(message, response.status, code);
  }

  return payload as T;
}
