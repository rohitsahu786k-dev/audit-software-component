// ── API FETCH WRAPPER ─────────────────────────────────
const AUDITPRO_CLIENT_VERSION = 'AuditPro-Web/2026-07-02-sync-guard-2';
const AUTH_TOKEN_KEY = 'ap_auth_token';
const AUTH_EXPIRES_KEY = 'ap_auth_expires_at';

export function getAuthToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; }
}
export function hasUsableAuthToken() {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const exp = Number(localStorage.getItem(AUTH_EXPIRES_KEY) || 0);
    if (exp && Date.now() > exp) { clearAuthState(); return false; }
  } catch {}
  return true;
}
export function saveAuthToken(token, expiresInMs) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    if (expiresInMs) localStorage.setItem(AUTH_EXPIRES_KEY, String(Date.now() + expiresInMs));
  } catch {}
}
export function clearAuthState() {
  try {
    localStorage.removeItem('ap_cu');
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_EXPIRES_KEY);
  } catch {}
}

export async function apiFetch(path, opts = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    'X-AuditPro-Client': AUDITPRO_CLIENT_VERSION,
    ...(opts.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
