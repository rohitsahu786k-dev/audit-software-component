'use strict';

const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) || Boolean(process.env.RENDER);

// The signing secret is the root of trust for every session cookie. A guessable fallback
// would let anyone forge an admin session, so production refuses to boot without one.
function resolveSecret() {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || '';
  if (secret.length >= 32) return secret;
  if (IS_PROD) throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters (openssl rand -hex 32)');
  console.warn('[AuditPro] AUTH_SECRET missing/short — using a random per-process secret (sessions reset on restart). Set it in .env.');
  return crypto.randomBytes(32).toString('hex');
}

const AUTH_SECRET = resolveSecret();
const SESSION_MAX_AGE_SECONDS = Math.max(900, Number(process.env.AUTH_SESSION_MAX_AGE_SECONDS || 8 * 60 * 60));
const MIN_PASSWORD_LENGTH = 8;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = { IS_PROD, AUTH_SECRET, SESSION_MAX_AGE_SECONDS, MIN_PASSWORD_LENGTH, ALLOWED_ORIGINS };
