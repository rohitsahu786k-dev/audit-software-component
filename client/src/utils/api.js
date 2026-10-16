// ── API FETCH WRAPPER ─────────────────────────────────
// Authentication is a httpOnly session cookie managed by Auth.js on the server, so the
// browser never handles (or can leak via XSS) a token. fetch() sends the cookie
// automatically for same-origin requests.
export const AUDITPRO_CLIENT_VERSION = 'AuditPro-Web/2026-07-02-sync-guard-2';

export async function apiFetch(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-AuditPro-Client': AUDITPRO_CLIENT_VERSION,
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
