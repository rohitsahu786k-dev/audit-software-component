'use strict';

const crypto = require('crypto');
const { AUTH_SECRET, MIN_PASSWORD_LENGTH } = require('./config');

const PBKDF2_ITERATIONS = 120000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('base64url');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifyPassword(user, password) {
  if (!user) return false;
  const plain = String(password || '');
  const hashes = [user.passwordHash].concat(Array.isArray(user.legacyPasswordHashes) ? user.legacyPasswordHashes : []);
  for (const h of hashes) {
    const parts = String(h || '').split('$');
    if (parts[0] !== 'pbkdf2' || parts.length !== 4) continue;
    const actual = crypto.pbkdf2Sync(plain, parts[2], Number(parts[1]), 32, 'sha256').toString('base64url');
    if (safeEqual(actual, parts[3])) return true;
  }
  // Pre-hash accounts: still accepted once so the login can upgrade them to a hash.
  const legacyPlain = Array.isArray(user.legacyPasswords) ? user.legacyPasswords : [];
  if (legacyPlain.some(v => safeEqual(String(v || ''), plain))) return true;
  const stored = String(user.password || '');
  return stored.length > 0 && safeEqual(stored, plain);
}

// Spend the same CPU as a real check when the account does not exist, so response
// time does not reveal which login IDs are valid.
const DUMMY_HASH = hashPassword('timing-equalizer');
function burnPasswordCheck(password) { verifyPassword({ passwordHash: DUMMY_HASH }, password); }

// Fingerprint of the current credential. Stored in the session cookie so that changing
// or resetting a password signs out every session issued before the change.
function passwordVersion(user) {
  return crypto.createHash('sha256').update(String((user && (user.passwordHash || user.password)) || '')).digest('hex').slice(0, 16);
}

function hashOtp(userId, otp) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(`otp:${userId}:${otp}`).digest('hex');
}

function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (value.length > 200) return 'Password is too long';
  return '';
}

module.exports = { hashPassword, verifyPassword, burnPasswordCheck, passwordVersion, hashOtp, safeEqual, passwordProblem };
