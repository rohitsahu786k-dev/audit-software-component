'use strict';

const crypto = require('crypto');
const { getCollection } = require('../lib/mongo');

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.SESSION_SECRET || crypto.createHash('sha256')
  .update([(process.env.MONGODB_DB||'onepws_audit'), 'onepws-auditpro-auth-v2'].join('|')).digest('hex');
const AUTH_TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const REQUIRED_SYNC_CLIENT = 'AuditPro-Web/2026-07-02-sync-guard-2';

function base64Url(input) { return Buffer.from(input).toString('base64url'); }
function signText(input) { return crypto.createHmac('sha256', AUTH_SECRET).update(input).digest('base64url'); }

function createAuthToken(user) {
  const payload = { sub: String(user.id||''), loginId: String(user.loginId||''), role: String(user.role||''), exp: Date.now() + AUTH_TOKEN_TTL_MS };
  const body = base64Url(JSON.stringify(payload));
  return `${body}.${signText(body)}`;
}

function parseAuthToken(token) {
  const raw = String(token||'').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const expected = signText(parts[0]); const actual = parts[1];
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!payload || Number(payload.exp||0) < Date.now()) return null;
  return payload;
}

function cleanIdentity(input) { return String(input||'').trim().toLowerCase(); }

function findUserByIdentity(users, identity) {
  const needle = cleanIdentity(identity);
  if (!needle) return null;
  return users.find(u => {
    if (!u || u.active === false) return false;
    const aliases = Array.isArray(u.legacyLoginIds) ? u.legacyLoginIds : [];
    return cleanIdentity(u.loginId)===needle || cleanIdentity(u.email)===needle || aliases.some(a=>cleanIdentity(a)===needle);
  }) || null;
}

async function getUsersRecord() {
  const collection = await getCollection();
  const row = await collection.findOne({ key: 'ap_users' });
  return { collection, users: Array.isArray(row && row.value) ? row.value : [] };
}

async function findActiveUserFromToken(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : String(req.headers['x-auth-token']||'');
  const payload = parseAuthToken(token);
  if (!payload) return null;
  const { users } = await getUsersRecord();
  return users.find(u => {
    if (!u || u.active === false) return false;
    if (String(u.id||'') === String(payload.sub||'')) return true;
    return cleanIdentity(u.loginId) === cleanIdentity(payload.loginId);
  }) || null;
}

async function requireApiAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const publicRoutes = ['/api/health', '/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password'];
  if (publicRoutes.includes(req.path)) return next();
  const user = await findActiveUserFromToken(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
  req.authUser = user;
  const isSyncPath = req.path === '/api/sync' || req.path.startsWith('/api/sync/');
  if (isSyncPath && String(req.headers['x-auditpro-client']||'') !== REQUIRED_SYNC_CLIENT) {
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

function wrapAsync(fn) {
  return function (req, res, next) { Promise.resolve(fn(req, res, next)).catch(next); };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('base64url');
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(user, password) {
  if (!user) return false;
  const plain = String(password||'');
  const hashes = [user.passwordHash].concat(Array.isArray(user.legacyPasswordHashes)?user.legacyPasswordHashes:[]);
  for (const h of hashes) {
    const stored = String(h||'');
    if (stored.startsWith('pbkdf2$')) {
      const parts = stored.split('$');
      if (parts.length !== 4) continue;
      const actual = crypto.pbkdf2Sync(plain, parts[2], Number(parts[1]), 32, 'sha256').toString('base64url');
      if (actual.length === parts[3].length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(parts[3]))) return true;
    }
  }
  const legacyPlain = Array.isArray(user.legacyPasswords) ? user.legacyPasswords : [];
  if (legacyPlain.some(v => String(v||'') === plain)) return true;
  const stored = String(user.password||'');
  return stored.length > 0 && stored.length === plain.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(plain));
}

function publicUser(user) {
  if (!user || typeof user !== 'object') return user;
  const copy = { ...user };
  delete copy.password; delete copy.passwordHash; delete copy.legacyPasswords; delete copy.legacyPasswordHashes;
  return copy;
}

function hashOtp(userId, otp) {
  return crypto.createHash('sha256').update(`${userId}:${otp}:${process.env.SMTP_PASS||'auditpro'}`).digest('hex');
}

module.exports = {
  AUTH_TOKEN_TTL_MS, createAuthToken, parseAuthToken, cleanIdentity,
  findUserByIdentity, getUsersRecord, findActiveUserFromToken,
  requireApiAuth, requireAdmin, wrapAsync,
  hashPassword, verifyPassword, publicUser, hashOtp
};
