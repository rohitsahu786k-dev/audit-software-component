'use strict';

// Auth.js (@auth/core) wiring. Auth.js is ESM-only, so it is loaded lazily with a dynamic
// import, which also keeps cold starts cheap for requests that never touch auth routes.
// Sessions are signed+encrypted JWTs in an httpOnly, SameSite=Lax (Secure on HTTPS) cookie;
// Auth.js itself provides the CSRF double-submit token for sign-in/sign-out.

const { AUTH_SECRET, SESSION_MAX_AGE_SECONDS } = require('./config');
const { getFreshUsersRecord, invalidateUsers } = require('./user-store');
const { findUserByIdentity, cleanIdentity } = require('./identity');
const { verifyPassword, burnPasswordCheck, passwordVersion } = require('./password');
const { normalizeUserForStorage } = require('./sync-helpers');
const limiter = require('./rate-limit');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IDENTITY = 8;
const MAX_FAILURES_PER_IP = 40;

let corePromise;
function loadCore() {
  if (!corePromise) {
    corePromise = Promise.all([import('@auth/core'), import('@auth/core/providers/credentials'), import('@auth/core/errors'), import('@auth/core/jwt')])
      .then(([core, creds, errors, jwt]) => ({ Auth: core.Auth, Credentials: creds.default, CredentialsSignin: errors.CredentialsSignin, getToken: jwt.getToken, encode: jwt.encode }));
    corePromise.catch(() => { corePromise = null; });
  }
  return corePromise;
}

async function authenticate(identityInput, passwordInput, ip) {
  const identity = cleanIdentity(identityInput);
  const password = String(passwordInput || '');
  if (!identity || !password || password.length > 200) return { error: 'invalid' };

  const [idFailures, ipFailures] = await Promise.all([limiter.count('login-id', identity), limiter.count('login-ip', ip)]);
  if (idFailures >= MAX_FAILURES_PER_IDENTITY || ipFailures >= MAX_FAILURES_PER_IP) return { error: 'locked' };

  const { collection, users } = await getFreshUsersRecord();
  const user = findUserByIdentity(users, identity);
  if (!user) burnPasswordCheck(password);
  if (!user || !verifyPassword(user, password)) {
    await Promise.all([limiter.hit('login-id', identity, LOGIN_WINDOW_MS), limiter.hit('login-ip', ip, LOGIN_WINDOW_MS)]);
    return { error: 'invalid' };
  }

  let current = user;
  if (!user.passwordHash && user.password) {
    current = normalizeUserForStorage(user, user);
    const nextUsers = users.map(r => (r && r.id === user.id ? current : r));
    await collection.updateOne({ key: 'ap_users' }, { $set: { key: 'ap_users', value: nextUsers, updatedAt: new Date(), updatedBy: 'password-hash-migration' } }, { upsert: true });
    invalidateUsers();
  }
  await limiter.clear('login-id', identity);
  return { user: current };
}

async function buildConfig() {
  const { Credentials, CredentialsSignin } = await loadCore();
  class AccountLocked extends CredentialsSignin { constructor() { super(); this.code = 'too_many_attempts'; } }
  class BadCredentials extends CredentialsSignin { constructor() { super(); this.code = 'invalid_credentials'; } }

  return {
    basePath: '/api/auth',
    secret: AUTH_SECRET,
    trustHost: true,
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 15 * 60 },
    jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
    pages: { signIn: '/', error: '/' },
    // A wrong password is an expected outcome, not a server error worth a stack trace.
    logger: {
      error(err) { if (!(err && err.type === 'CredentialsSignin')) console.error('[AuditPro][auth]', err && err.message ? err.message : err); },
      warn() {}, debug() {},
    },
    providers: [Credentials({
      credentials: { identity: {}, password: {} },
      async authorize(credentials, request) {
        const ip = request.headers.get('x-client-ip') || 'unknown';
        const result = await authenticate(credentials && credentials.identity, credentials && credentials.password, ip);
        if (result.error === 'locked') throw new AccountLocked();
        if (!result.user) throw new BadCredentials();
        const u = result.user;
        return { id: String(u.id || u.loginId), name: u.name || u.loginId, email: u.email || null, loginId: u.loginId, role: u.role, pv: passwordVersion(u) };
      },
    })],
    callbacks: {
      // Keep the cookie minimal: identity + a credential fingerprint. Role and active
      // state are always re-read from the user store, never trusted from the cookie.
      async jwt({ token, user }) {
        if (user) { token.uid = user.id; token.loginId = user.loginId; token.pv = user.pv; }
        return token;
      },
      async session({ session, token }) {
        if (session.user) { session.user.id = token.uid; session.user.loginId = token.loginId; }
        return session;
      },
    },
  };
}

let configPromise;
function getConfig() {
  if (!configPromise) { configPromise = buildConfig(); configPromise.catch(() => { configPromise = null; }); }
  return configPromise;
}

const FORWARDED_HEADERS = ['cookie', 'content-type', 'origin', 'referer', 'user-agent', 'accept', 'accept-language', 'x-auth-return-redirect', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'host'];

function toWebRequest(req) {
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
  const headers = new Headers();
  FORWARDED_HEADERS.forEach(name => { if (req.headers[name] !== undefined) headers.set(name, String(req.headers[name])); });
  headers.set('x-client-ip', req.ip || 'unknown'); // overwritten server-side; never client-supplied
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const isJson = String(req.headers['content-type'] || '').includes('application/json');
    init.body = isJson ? JSON.stringify(req.body || {}) : new URLSearchParams(req.body || {}).toString();
    if (!isJson) headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  return new Request(url, init);
}

async function sendWebResponse(webRes, res) {
  res.status(webRes.status);
  webRes.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });
  const cookies = typeof webRes.headers.getSetCookie === 'function' ? webRes.headers.getSetCookie() : [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.send(Buffer.from(await webRes.arrayBuffer()));
}

// Express handler for everything Auth.js owns under /api/auth (csrf, callback, signout, session…).
async function authHandler(req, res, next) {
  try {
    const { Auth } = await loadCore();
    await sendWebResponse(await Auth(toWebRequest(req), await getConfig()), res);
  } catch (err) { next(err); }
}

// Decode + verify the session cookie. Returns the token payload or null.
async function readSessionToken(req) {
  const hasCookie = /(?:^|;\s*)(?:__Secure-)?authjs\.session-token/.test(String(req.headers.cookie || ''));
  if (!hasCookie) return null;
  const { getToken } = await loadCore();
  try { return await getToken({ req: { headers: req.headers }, secret: AUTH_SECRET, secureCookie: isSecureRequest(req) }); } catch (_) { return null; }
}

function isSecureRequest(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

// Re-issue the session cookie after the user's own password change, so that change
// (which invalidates all older cookies) does not sign out the device that made it.
async function issueSessionCookie(req, res, user) {
  const { encode } = await loadCore();
  const secure = isSecureRequest(req);
  const name = `${secure ? '__Secure-' : ''}authjs.session-token`;
  const id = String(user.id || user.loginId);
  const value = await encode({
    token: { name: user.name || user.loginId, email: user.email || null, uid: id, sub: id, loginId: user.loginId, pv: passwordVersion(user) },
    secret: AUTH_SECRET, salt: name, maxAge: SESSION_MAX_AGE_SECONDS,
  });
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_MAX_AGE_SECONDS}`];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', [].concat(res.getHeader('Set-Cookie') || [], `${name}=${value}; ${attrs.join('; ')}`));
}

module.exports = { authHandler, readSessionToken, issueSessionCookie };
