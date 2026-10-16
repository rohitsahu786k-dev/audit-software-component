'use strict';

// Account routes that sit beside Auth.js. Sign-in, sign-out, session and CSRF are owned by
// Auth.js (lib/authjs.js, mounted after this router); this file covers profile, password
// reset and the current-user lookup.

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { wrapAsync, requireAdmin, invalidateAuthCaches, actorOf } = require('../middleware/auth');
const { findUserByIdentity, publicUser } = require('../lib/identity');
const { hashOtp, safeEqual, passwordProblem, verifyPassword } = require('../lib/password');
const { normalizeUserForStorage } = require('../lib/sync-helpers');
const { getFreshUsersRecord } = require('../lib/user-store');
const { saveOtp, deleteOtp, consumeAttempt } = require('../lib/otp-store');
const { issueSessionCookie } = require('../lib/authjs');
const limiter = require('../lib/rate-limit');
const { getMailer } = require('../lib/mailer');

const SMTP_FROM = process.env.SMTP_FROM || (process.env.SMTP_USER ? `OnePWS AuditPro <${process.env.SMTP_USER}>` : undefined);
const RESET_WINDOW_MS = 15 * 60 * 1000;
const MAX_RESET_REQUESTS_PER_IDENTITY = 3;
const MAX_RESET_REQUESTS_PER_IP = 15;
const MAX_RESET_ATTEMPTS_PER_IP = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

async function saveUsers(collection, nextUsers, updatedBy) {
  const now = new Date();
  await collection.updateOne({ key: 'ap_users' }, { $set: { key: 'ap_users', value: nextUsers, updatedAt: now, updatedBy } }, { upsert: true });
  invalidateAuthCaches();
  return now;
}

// GET /api/auth/me
router.get('/me', (req, res) => {
  res.json({ ok: true, user: publicUser(req.authUser) });
});

// PUT /api/auth/profile
router.put('/profile', wrapAsync(async (req, res) => {
  const patch = req.body || {};
  const name = String(patch.name || '').trim().slice(0, 120);
  const email = String(patch.email || '').trim().slice(0, 200);
  const dept = String(patch.dept || '').trim().slice(0, 120);
  const password = Object.prototype.hasOwnProperty.call(patch, 'password') ? String(patch.password || '') : '';
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });
  if (email && !EMAIL_PATTERN.test(email)) return res.status(400).json({ ok: false, error: 'Valid email is required' });
  if (password && passwordProblem(password)) return res.status(400).json({ ok: false, error: passwordProblem(password) });
  const { collection, users } = await getFreshUsersRecord();
  const idx = users.findIndex(u => u && String(u.id || '') === String(req.authUser.id || ''));
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Account not found' });
  const current = users[idx];
  const nextUser = normalizeUserForStorage({ ...current, name, email, dept, avatar: name.substring(0, 2).toUpperCase(), ...(password ? { password } : {}) }, current);
  const nextUsers = users.slice(); nextUsers[idx] = nextUser;
  const updatedAt = await saveUsers(collection, nextUsers, current.loginId || 'profile-update');
  if (password) await issueSessionCookie(req, res, nextUser);
  res.json({ ok: true, user: publicUser(nextUser), updatedAt });
}));

// POST /api/auth/admin-reset-password
// Immediate, server-confirmed reset for the Admin Panel. Signs the target user out everywhere.
router.post('/admin-reset-password', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const userId = String((req.body && req.body.userId) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!userId || !password) return res.status(400).json({ ok: false, error: 'User and password are required' });
  if (passwordProblem(password)) return res.status(400).json({ ok: false, error: passwordProblem(password) });
  const { collection, users } = await getFreshUsersRecord();
  const index = users.findIndex(user => user && String(user.id || '') === userId);
  if (index < 0) return res.status(404).json({ ok: false, error: 'User not found' });
  const nextUsers = users.slice();
  nextUsers[index] = normalizeUserForStorage({ ...users[index], password }, users[index]);
  const updatedAt = await saveUsers(collection, nextUsers, actorOf(req));
  res.json({ ok: true, userId, updatedAt });
}));

// POST /api/auth/verify-password
// Re-authentication gate for destructive admin actions (e.g. "reset all data"). Admin
// only, and failures count toward the same lockout as sign-in.
router.post('/verify-password', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const who = String(req.authUser.id || req.authUser.loginId);
  if (await limiter.count('login-id', who) >= 5) return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
  if (!verifyPassword(req.authUser, String((req.body && req.body.password) || ''))) {
    await limiter.hit('login-id', who, RESET_WINDOW_MS);
    return res.status(403).json({ ok: false, error: 'Incorrect password' });
  }
  await limiter.clear('login-id', who);
  res.json({ ok: true });
}));

// POST /api/auth/forgot-password
// Answers identically whether or not the account exists, so it cannot be used to discover
// valid login IDs or emails. Rate limited per identity and per IP.
router.post('/forgot-password', wrapAsync(async (req, res) => {
  const identity = String((req.body && req.body.identity) || '').trim().toLowerCase().slice(0, 200);
  if (!identity) return res.status(400).json({ ok: false, error: 'Login ID or email is required' });
  const [perIdentity, perIp] = await Promise.all([limiter.hit('reset-req-id', identity, RESET_WINDOW_MS), limiter.hit('reset-req-ip', req.ip, RESET_WINDOW_MS)]);
  if (perIdentity > MAX_RESET_REQUESTS_PER_IDENTITY || perIp > MAX_RESET_REQUESTS_PER_IP) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  }
  const generic = { ok: true, message: 'If an account with a registered email exists, an OTP has been sent.' };
  const { users } = await getFreshUsersRecord();
  const user = findUserByIdentity(users, identity);
  if (!user || !user.email) return res.json(generic);
  const otp = String(crypto.randomInt(100000, 1000000));
  await saveOtp(user.id, hashOtp(user.id, otp));
  const display = escapeHtml(user.name || user.loginId);
  try {
    await getMailer().sendMail({
      from: SMTP_FROM, to: user.email, subject: 'OnePWS AuditPro password reset OTP',
      text: `Hello ${user.name || user.loginId},\n\nYour OTP is ${otp}. Valid for 15 minutes.\n\nIf you did not request this, ignore this email.`,
      html: `<p>Hello ${display},</p><p>Your OTP is <strong style="font-size:18px;letter-spacing:3px">${otp}</strong>. Valid for 15 minutes.</p><p>If you did not request this, ignore this email.</p>`,
    });
  } catch (err) {
    await deleteOtp(user.id);
    console.error('[AuditPro] Password reset email failed:', err.message);
    return res.status(502).json({ ok: false, error: 'Password reset email could not be sent. Please contact your administrator.' });
  }
  res.json(generic);
}));

// POST /api/auth/reset-password
router.post('/reset-password', wrapAsync(async (req, res) => {
  const identity = String((req.body && req.body.identity) || '').trim().toLowerCase().slice(0, 200);
  const otp = String((req.body && req.body.otp) || '').trim();
  const password = String((req.body && req.body.password) || (req.body && req.body.newPassword) || '');
  if (!identity || !otp || !password) return res.status(400).json({ ok: false, error: 'Identity, OTP and password are required' });
  if (passwordProblem(password)) return res.status(400).json({ ok: false, error: passwordProblem(password) });
  if (await limiter.hit('reset-try-ip', req.ip, RESET_WINDOW_MS) > MAX_RESET_ATTEMPTS_PER_IP) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
  }
  const { collection, users } = await getFreshUsersRecord();
  const user = findUserByIdentity(users, identity);
  const invalid = () => res.status(400).json({ ok: false, error: 'Invalid or expired OTP' });
  if (!user) return invalid();
  const attempt = await consumeAttempt(user.id);
  if (attempt.status === 'locked') return res.status(429).json({ ok: false, error: 'Too many OTP attempts. Please request a new OTP' });
  if (attempt.status !== 'ok' || !safeEqual(attempt.otpHash, hashOtp(user.id, otp))) return invalid();
  const nextUsers = users.map(r => (r && r.id === user.id ? normalizeUserForStorage({ ...r, password }, r) : r));
  const updatedAt = await saveUsers(collection, nextUsers, 'password-reset');
  await deleteOtp(user.id);
  res.json({ ok: true, userId: user.id, loginId: user.loginId, updatedAt });
}));

module.exports = router;
