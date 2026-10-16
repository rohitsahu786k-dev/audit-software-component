'use strict';

const { readSessionToken } = require('../lib/authjs');
const { getCachedUsers, getCachedPermissions, invalidateUsers, invalidatePermissions } = require('../lib/user-store');
const { cleanIdentity } = require('../lib/identity');
const { passwordVersion, safeEqual } = require('../lib/password');

const REQUIRED_SYNC_CLIENT = 'AuditPro-Web/2026-07-02-sync-guard-2';

// Endpoints reachable without a session. Everything under /api/auth/ that Auth.js owns
// (csrf, session, callback/credentials, signout…) is public by design — Auth.js enforces
// its own CSRF/credential checks there. The three account routes below need a session.
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/forgot-password', '/api/auth/reset-password']);
const SESSION_AUTH_PATHS = new Set(['/api/auth/me', '/api/auth/profile', '/api/auth/admin-reset-password', '/api/auth/verify-password']);

// Resolve the signed-in user from the session cookie. The cookie only proves who the
// user is; role/active state come from the (briefly cached) user store, and a password
// change invalidates older cookies via the credential fingerprint.
async function findActiveUserFromRequest(req) {
  const token = await readSessionToken(req);
  if (!token || !token.uid) return null;
  const users = await getCachedUsers();
  const user = users.find(u => u && u.active !== false && (String(u.id || '') === String(token.uid) || cleanIdentity(u.loginId) === cleanIdentity(token.loginId)));
  if (!user) return null;
  if (!token.pv || !safeEqual(token.pv, passwordVersion(user))) return null;
  return user;
}

async function requireApiAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/api/auth/') && !SESSION_AUTH_PATHS.has(req.path)) return next();
  const user = await findActiveUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
  req.authUser = user;
  const isSyncPath = req.path === '/api/sync' || req.path.startsWith('/api/sync/');
  if (isSyncPath && String(req.headers['x-auditpro-client'] || '') !== REQUIRED_SYNC_CLIENT) {
    res.setHeader('X-AuditPro-Client-Warning', 'refresh-recommended');
  }
  return next();
}

function requireAdmin(req) {
  if (!req.authUser || req.authUser.role !== 'admin') {
    const err = new Error('Master Admin access required');
    err.statusCode = 403;
    throw err;
  }
}

// Allow only the listed roles (admin always passes through requireRoles via its own entry).
function requireRoles(req, roles, message) {
  if (!req.authUser || !roles.includes(req.authUser.role)) {
    const err = new Error(message || 'You do not have permission to perform this action');
    err.statusCode = 403;
    throw err;
  }
}

// Mirrors client/src/utils/helpers.js DEFAULT_PERMS / loadPermissions â€” kept in sync
// manually since client and server don't share a module. Used to enforce the
// *configurable* per-role page grants server-side (requireAdmin above is for the
// small set of things that must always be the literal admin role, never grantable).
const DEFAULT_PERMS = {
  admin:   { ocp:1,dashboard:1,analytics:1,planning:1,execution:1,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:1,adminpanel:1,mytasks:1,managerpanel:1,mastertracker:1,importdata:1 },
  auditor: { ocp:1,dashboard:1,analytics:1,planning:1,execution:1,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:1,mastertracker:1,importdata:1 },
  spoc:    { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:0,mastertracker:1,importdata:0 },
  manager: { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:1,mastertracker:1,importdata:0 },
  viewer:  { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:0,learnings:0,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:0,mastertracker:0,importdata:0 },
};

function mergePermissions(saved) {
  const roles = (saved && saved.roles) || saved || {};
  const base = JSON.parse(JSON.stringify(DEFAULT_PERMS));
  if (roles && typeof roles === 'object') {
    Object.keys(base).forEach(role => {
      if (!roles[role] || typeof roles[role] !== 'object') return;
      Object.keys(base[role]).forEach(page => {
        if (Object.prototype.hasOwnProperty.call(roles[role], page)) base[role][page] = roles[role][page] ? 1 : 0;
      });
    });
  }
  base.admin = Object.keys(base.admin).reduce((a, p) => { a[p] = 1; return a; }, {});
  return base;
}

async function requirePageAccess(req, page) {
  if (!req.authUser) { const err = new Error('Authentication required'); err.statusCode = 401; throw err; }
  if (req.authUser.role === 'admin') return;
  const perms = mergePermissions(await getCachedPermissions());
  const role = req.authUser.role || 'viewer';
  if (!(perms[role] && perms[role][page])) {
    const err = new Error('You do not have permission to modify this data');
    err.statusCode = 403;
    throw err;
  }
}

function wrapAsync(fn) {
  return function (req, res, next) { Promise.resolve(fn(req, res, next)).catch(next); };
}

// Identity recorded in updatedBy/audit fields. Always derived from the session — a
// client-supplied "by" value must never be trusted for attribution.
function actorOf(req) {
  return String((req.authUser && (req.authUser.loginId || req.authUser.id)) || 'system');
}

module.exports = {
  requireApiAuth, requireAdmin, requireRoles, requirePageAccess, wrapAsync, actorOf,
  invalidateAuthCaches: () => { invalidateUsers(); invalidatePermissions(); },
};
