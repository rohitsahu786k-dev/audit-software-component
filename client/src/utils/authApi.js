// Thin client for the Auth.js endpoints mounted at /api/auth (csrf, callback/credentials,
// signout) plus the app's own /me lookup. Kept separate from apiFetch because Auth.js
// speaks form-encoded + redirect-URL responses rather than the app's { ok } JSON.
import { apiFetch, AUDITPRO_CLIENT_VERSION } from './api';

const ERROR_MESSAGES = {
  too_many_attempts: 'Too many failed attempts. Please wait 15 minutes or reset your password.',
  invalid_credentials: 'Invalid login ID or password.',
};

async function getCsrfToken() {
  const res = await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { 'X-AuditPro-Client': AUDITPRO_CLIENT_VERSION } });
  if (!res.ok) throw new Error('Could not reach the sign-in service. Please try again.');
  const { csrfToken } = await res.json();
  return csrfToken;
}

async function postForm(path, fields) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Auth-Return-Redirect': '1',
      'X-AuditPro-Client': AUDITPRO_CLIENT_VERSION,
    },
    body: new URLSearchParams(fields),
  });
}

// Signs in through Auth.js, then returns the signed-in user from /api/auth/me.
export async function signIn(identity, password) {
  const csrfToken = await getCsrfToken();
  const res = await postForm('/api/auth/callback/credentials', { csrfToken, identity, password, callbackUrl: window.location.origin, json: 'true' });
  let url = '';
  try { ({ url } = await res.json()); } catch {}
  const params = url ? new URL(url, window.location.origin).searchParams : new URLSearchParams();
  if (!res.ok || params.get('error')) {
    throw new Error(ERROR_MESSAGES[params.get('code')] || ERROR_MESSAGES.invalid_credentials);
  }
  const data = await apiFetch('/api/auth/me');
  return data.user;
}

export async function signOut() {
  try {
    const csrfToken = await getCsrfToken();
    await postForm('/api/auth/signout', { csrfToken, callbackUrl: window.location.origin, json: 'true' });
  } catch {
    // Even if the network call fails the UI signs out locally; the cookie still expires server-side.
  }
}

// Returns the current user, or null when there is no valid session.
export async function fetchCurrentUser() {
  try {
    const data = await apiFetch('/api/auth/me');
    return data.user || null;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}
