// Admin credentials for endpoints that change how claims are evaluated.
// The token is kept for this browser tab only (sessionStorage) and sent as
// X-Admin-Token; the server rejects rule and config changes without it.

const TOKEN_KEY = 'claimguard-admin-token';
const ACTOR_KEY = 'claimguard-admin-actor';

function read(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); the value then lives only in the form.
  }
}

export const getAdminToken = () => read(TOKEN_KEY);
export const setAdminToken = (token: string) => write(TOKEN_KEY, token.trim());
export const getAdminActor = () => read(ACTOR_KEY);
export const setAdminActor = (actor: string) => write(ACTOR_KEY, actor.trim());

export function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Admin-Token': getAdminToken() };
  const actor = getAdminActor();
  if (actor) headers['X-Actor'] = actor;
  return headers;
}
