'use strict';

const express = require('express');
const router = express.Router();
const { getCollection } = require('../lib/mongo');
const { getMailer, parseRecipients, SMTP_FROM } = require('../lib/mailer');
const { wrapAsync, requireAdmin, requirePageAccess, actorOf } = require('../middleware/auth');
const { mergeEmailLogs } = require('../lib/sync-helpers');
const { emailSendLockKey, EMAIL_LOCK_PENDING_MS } = require('../lib/email-locks');
const { runEmailAutomation } = require('../lib/email-engine');

function normalizeEmailLockItems(input) {
  return (Array.isArray(input) ? input : []).map(item => {
    const key = String((item && item.key) || '').trim();
    const frequencyDays = Math.max(1, Math.min(365, Number((item && item.frequencyDays) || 1)));
    if (!key) return null;
    return { key, frequencyDays, meta: item && typeof item.meta === 'object' ? item.meta : {} };
  }).filter(Boolean).slice(0, 100);
}

// GET /api/email/verify
router.get('/verify', wrapAsync(async (req, res) => {
  await requirePageAccess(req, 'masterdata');
  const transport = getMailer();
  const verified = await transport.verify();
  res.json({ ok: true, smtp: Boolean(verified) });
}));

// POST /api/email
// Sends arbitrary subject/HTML to arbitrary recipients using the org's SMTP identity —
// currently only used by the admin-only "Send Test" template action, so gate it the
// same way. Relax deliberately (with its own access check) if a non-admin flow needs it.
router.post('/', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const to = parseRecipients(req.body && req.body.to);
  const cc = parseRecipients(req.body && req.body.cc);
  const bcc = parseRecipients(req.body && req.body.bcc);
  const subject = String((req.body && req.body.subject) || '').trim();
  const text = String((req.body && req.body.text) || '').trim();
  const html = req.body && req.body.html ? String(req.body.html) : undefined;
  const attachments = Array.isArray(req.body && req.body.attachments)
    ? req.body.attachments.filter(i => i && typeof i.url === 'string' && /^https:\/\//i.test(i.url)).map(i => ({ filename: String(i.filename || 'attachment'), path: String(i.url) }))
    : [];
  if (!to.length) return res.status(400).json({ ok: false, error: 'At least one recipient is required' });
  if (!subject) return res.status(400).json({ ok: false, error: 'Subject is required' });
  if (!text && !html) return res.status(400).json({ ok: false, error: 'Email body is required' });
  const transport = getMailer();
  const info = await transport.sendMail({ from: SMTP_FROM, to, cc, bcc, subject, text, html, attachments });
  res.json({ ok: true, messageId: info.messageId, accepted: info.accepted });
}));

// POST /api/email/run
// Admin-only manual trigger for the reminder engine that normally runs on the cron in server.js.
// Pass { dryRun: true } to preview exactly who would be mailed without sending anything.
router.post('/run', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const dryRun = Boolean(req.body && req.body.dryRun);
  const by = actorOf(req);
  const summary = await runEmailAutomation({ by, dryRun });
  res.json(summary);
}));

// POST /api/email/log
router.post('/log', wrapAsync(async (req, res) => {
  const log = req.body && req.body.log;
  if (!log || typeof log !== 'object') return res.status(400).json({ ok: false, error: 'Email log is required' });
  const collection = await getCollection();
  const current = await collection.findOne({ key: 'ap_email_logs' });
  const now = new Date();
  const value = mergeEmailLogs(current && current.value, [log], current && current.clearedAt);
  await collection.updateOne({ key: 'ap_email_logs' }, { $set: { key: 'ap_email_logs', value, updatedAt: now, updatedBy: actorOf(req), clearedAt: current && current.clearedAt ? current.clearedAt : null } }, { upsert: true });
  res.json({ ok: true, count: value.length, value });
}));

// POST /api/email/locks/claim
router.post('/locks/claim', wrapAsync(async (req, res) => {
  const locks = normalizeEmailLockItems(req.body && req.body.locks);
  if (!locks.length) return res.status(400).json({ ok: false, error: 'At least one email lock is required' });
  const collection = await getCollection();
  const now = new Date();
  const pendingUntil = new Date(now.getTime() + EMAIL_LOCK_PENDING_MS);
  const claimedBy = actorOf(req).slice(0, 80);
  const results = [];
  for (const item of locks) {
    const key = emailSendLockKey(item.key);
    const nextAllowedAt = new Date(now.getTime() + item.frequencyDays * 24 * 60 * 60 * 1000);
    try {
      const doc = await collection.findOneAndUpdate(
        { key, $and: [{ $or: [{ nextAllowedAt: { $exists: false } }, { nextAllowedAt: { $lte: now } }] }, { $or: [{ pendingUntil: { $exists: false } }, { pendingUntil: { $lte: now } }] }] },
        { $set: { key, lockKey: item.key, frequencyDays: item.frequencyDays, nextAllowedAt, pendingUntil, claimedAt: now, claimedBy, meta: item.meta }, $setOnInsert: { createdAt: now } },
        { upsert: true, returnDocument: 'after' }
      );
      results.push({ key: item.key, granted: Boolean(doc) });
    } catch (err) {
      if (err && err.code === 11000) results.push({ key: item.key, granted: false });
      else throw err;
    }
  }
  res.json({ ok: true, locks: results });
}));

// POST /api/email/locks/commit
router.post('/locks/commit', wrapAsync(async (req, res) => {
  const locks = normalizeEmailLockItems(req.body && req.body.locks);
  if (!locks.length) return res.status(400).json({ ok: false, error: 'At least one email lock is required' });
  const collection = await getCollection();
  const now = new Date();
  const success = Boolean(req.body && req.body.success);
  const committedBy = actorOf(req).slice(0, 80);
  const pendingUntil = new Date(0);
  const results = [];
  for (const item of locks) {
    const nextAllowedAt = new Date(now.getTime() + item.frequencyDays * 24 * 60 * 60 * 1000);
    const update = success
      ? { $set: { frequencyDays: item.frequencyDays, lastSentAt: now, nextAllowedAt, pendingUntil, committedAt: now, committedBy, meta: item.meta } }
      : { $set: { frequencyDays: item.frequencyDays, lastFailedAt: now, nextAllowedAt: pendingUntil, pendingUntil, committedAt: now, committedBy, meta: item.meta } };
    const result = await collection.updateOne({ key: emailSendLockKey(item.key) }, update);
    results.push({ key: item.key, updated: result.modifiedCount > 0 });
  }
  res.json({ ok: true, locks: results });
}));

module.exports = router;
