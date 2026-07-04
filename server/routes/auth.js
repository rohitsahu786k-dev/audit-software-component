'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getUsersRecord, findUserByIdentity, verifyPassword, publicUser, createAuthToken, AUTH_TOKEN_TTL_MS, hashPassword, hashOtp, wrapAsync, requireAdmin } = require('../middleware/auth');
const { getMailer } = require('../lib/mailer');
const { getCollection } = require('../lib/mongo');

const SMTP_FROM = process.env.SMTP_FROM || (process.env.SMTP_USER ? `OnePWS AuditPro <${process.env.SMTP_USER}>` : undefined);

function normalizeUserForStorage(user, existing) {
  if (!user || typeof user !== 'object') return user;
  const next = { ...(existing || {}), ...user };
  const password = Object.prototype.hasOwnProperty.call(user, 'password') ? String(user.password || '') : '';
  if (password) {
    next.passwordHash = hashPassword(password);
    delete next.legacyPasswordHashes; delete next.legacyPasswords;
  } else if (existing && existing.passwordHash) {
    next.passwordHash = existing.passwordHash;
  } else if (existing && existing.password) {
    next.passwordHash = hashPassword(existing.password);
  }
  delete next.password;
  return next;
}

async function getPasswordResetRows(collection) {
  const row = await collection.findOne({ key: '_password_reset_otps' });
  return Array.isArray(row && row.value) ? row.value : [];
}
async function savePasswordResetOtp(collection, userId, otpHash, expiresAt) {
  const now = Date.now();
  const rows = (await getPasswordResetRows(collection)).filter(r => r && r.userId !== userId && Number(r.expiresAt) > now);
  rows.push({ userId, otpHash, expiresAt, attempts: 0 });
  await collection.updateOne({ key: '_password_reset_otps' }, { $set: { key: '_password_reset_otps', value: rows, updatedAt: new Date(), updatedBy: 'password-reset' } }, { upsert: true });
}
async function updatePasswordResetOtp(collection, userId, patch) {
  const rows = (await getPasswordResetRows(collection)).map(r => r && r.userId === userId ? Object.assign({}, r, patch) : r);
  await collection.updateOne({ key: '_password_reset_otps' }, { $set: { key: '_password_reset_otps', value: rows, updatedAt: new Date(), updatedBy: 'password-reset' } }, { upsert: true });
}
async function deletePasswordResetOtp(collection, userId) {
  const rows = (await getPasswordResetRows(collection)).filter(r => r && r.userId !== userId);
  await collection.updateOne({ key: '_password_reset_otps' }, { $set: { key: '_password_reset_otps', value: rows, updatedAt: new Date(), updatedBy: 'password-reset' } }, { upsert: true });
}

// POST /api/auth/login
router.post('/login', wrapAsync(async (req, res) => {
  const identity = String((req.body && req.body.identity) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!identity || !password) return res.status(400).json({ ok: false, error: 'Login ID and password are required' });
  const { collection, users } = await getUsersRecord();
  const user = findUserByIdentity(users, identity);
  if (!user || !verifyPassword(user, password)) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  if (!user.passwordHash && user.password) {
    const nextUsers = users.map(r => r && r.id === user.id ? normalizeUserForStorage(r, r) : r);
    await collection.updateOne({ key: 'ap_users' }, { $set: { key: 'ap_users', value: nextUsers, updatedAt: new Date(), updatedBy: 'password-hash-migration' } }, { upsert: true });
  }
  res.json({ ok: true, token: createAuthToken(user), user: publicUser(user), expiresInMs: AUTH_TOKEN_TTL_MS });
}));

// GET /api/auth/me
router.get('/me', wrapAsync(async (req, res) => {
  if (!req.authUser) return res.status(401).json({ ok: false, error: 'Authentication required' });
  res.json({ ok: true, user: publicUser(req.authUser) });
}));

// PUT /api/auth/profile
router.put('/profile', wrapAsync(async (req, res) => {
  const patch = req.body || {};
  const name = String(patch.name || '').trim();
  const email = String(patch.email || '').trim();
  const dept = String(patch.dept || '').trim();
  const password = Object.prototype.hasOwnProperty.call(patch, 'password') ? String(patch.password || '') : '';
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email is required' });
  if (password && password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  const { collection, users } = await getUsersRecord();
  const idx = users.findIndex(u => u && String(u.id || '') === String(req.authUser.id || ''));
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Account not found' });
  const current = users[idx];
  const nextUser = normalizeUserForStorage({ ...current, name, email, dept, avatar: name.substring(0, 2).toUpperCase(), ...(password ? { password } : {}) }, current);
  const nextUsers = users.slice(); nextUsers[idx] = nextUser;
  const now = new Date();
  await collection.updateOne({ key: 'ap_users' }, { $set: { key: 'ap_users', value: nextUsers, updatedAt: now, updatedBy: current.loginId || 'profile-update' } }, { upsert: true });
  res.json({ ok: true, user: publicUser(nextUser), updatedAt: now });
}));

// POST /api/auth/forgot-password
router.post('/forgot-password', wrapAsync(async (req, res) => {
  const identity = String((req.body && req.body.identity) || '').trim().toLowerCase();
  if (!identity) return res.status(400).json({ ok: false, error: 'Login ID or email is required' });
  const { collection, users } = await getUsersRecord();
  const user = findUserByIdentity(users, identity);
  if (!user || !user.email) return res.status(404).json({ ok: false, error: 'No active account found with a registered email' });
  const otp = String(crypto.randomInt(100000, 1000000));
  await savePasswordResetOtp(collection, user.id, hashOtp(user.id, otp), Date.now() + 15 * 60 * 1000);
  const transport = getMailer();
  const subject = 'OnePWS AuditPro password reset OTP';
  const text = `Hello ${user.name||user.loginId},\n\nYour OTP is ${otp}. Valid for 15 minutes.\n\nIf you did not request this, ignore this email.`;
  const html = `<p>Hello ${user.name||user.loginId},</p><p>Your OTP is <strong style="font-size:18px;letter-spacing:3px">${otp}</strong>. Valid for 15 minutes.</p><p>If you did not request this, ignore this email.</p>`;
  try {
    await transport.sendMail({ from: SMTP_FROM, to: user.email, subject, text, html });
  } catch (err) {
    await deletePasswordResetOtp(collection, user.id);
    err.statusCode = 502; err.message = `Password reset email could not be sent: ${err.message}`; throw err;
  }
  res.json({ ok: true, maskedEmail: user.email.replace(/^(.).+(@.+)$/, '$1***$2') });
}));

// POST /api/auth/reset-password
router.post('/reset-password', wrapAsync(async (req, res) => {
  const identity = String((req.body && req.body.identity) || '').trim().toLowerCase();
  const otp = String((req.body && req.body.otp) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!identity || !otp || !password) return res.status(400).json({ ok: false, error: 'Identity, OTP and new password are required' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  const { collection, users } = await getUsersRecord();
  const user = findUserByIdentity(users, identity);
  if (!user) return res.status(404).json({ ok: false, error: 'No active account found' });
  const resets = await getPasswordResetRows(collection);
  const reset = resets.find(r => r && r.userId === user.id);
  if (!reset || reset.expiresAt < Date.now()) {
    await deletePasswordResetOtp(collection, user.id);
    return res.status(400).json({ ok: false, error: 'OTP expired. Please request a new OTP' });
  }
  reset.attempts += 1;
  if (reset.attempts > 5) {
    await deletePasswordResetOtp(collection, user.id);
    return res.status(429).json({ ok: false, error: 'Too many OTP attempts. Please request a new OTP' });
  }
  await updatePasswordResetOtp(collection, user.id, { attempts: reset.attempts });
  if (reset.otpHash !== hashOtp(user.id, otp)) return res.status(400).json({ ok: false, error: 'Invalid OTP' });
  const nextUsers = users.map(r => r && r.id === user.id ? normalizeUserForStorage({ ...r, password }, r) : r);
  const now = new Date();
  await collection.updateOne({ key: 'ap_users' }, { $set: { key: 'ap_users', value: nextUsers, updatedAt: now, updatedBy: 'password-reset' } }, { upsert: true });
  await deletePasswordResetOtp(collection, user.id);
  res.json({ ok: true, userId: user.id, loginId: user.loginId, updatedAt: now });
}));

module.exports = router;
