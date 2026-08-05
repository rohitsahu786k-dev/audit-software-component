'use strict';

const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_SEND_LOCK_PREFIX = '_email_send_lock_';
const EMAIL_LOCK_PENDING_MS = 10 * 60 * 1000;

function emailSendLockKey(input) {
  return EMAIL_SEND_LOCK_PREFIX + crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function normalizeFrequencyDays(value) {
  return Math.max(1, Math.min(365, Number(value) || 1));
}

// Atomically reserve the right to send `lockKey`. Returns false when a previous send is still
// inside its frequency window, or when another worker is mid-send. The lock doc shares the
// `appdata` collection and its unique `key` index: when the doc exists but is not yet due, the
// filter misses and the upsert collides on that index (E11000), which is the "not granted" signal.
async function claimEmailLock(collection, lockKey, frequencyDays, meta, by) {
  const now = new Date();
  const key = emailSendLockKey(lockKey);
  const frequency = normalizeFrequencyDays(frequencyDays);
  const nextAllowedAt = new Date(now.getTime() + frequency * DAY_MS);
  const pendingUntil = new Date(now.getTime() + EMAIL_LOCK_PENDING_MS);
  try {
    const doc = await collection.findOneAndUpdate(
      {
        key,
        $and: [
          { $or: [{ nextAllowedAt: { $exists: false } }, { nextAllowedAt: { $lte: now } }] },
          { $or: [{ pendingUntil: { $exists: false } }, { pendingUntil: { $lte: now } }] },
        ],
      },
      {
        $set: { key, lockKey, frequencyDays: frequency, nextAllowedAt, pendingUntil, claimedAt: now, claimedBy: String(by || 'engine').slice(0, 80), meta: meta && typeof meta === 'object' ? meta : {} },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return Boolean(doc);
  } catch (err) {
    if (err && err.code === 11000) return false;
    throw err;
  }
}

// On success the lock stays held for `frequencyDays`. On failure it is released immediately so
// the next run retries rather than silently swallowing the send for a whole cycle.
async function commitEmailLock(collection, lockKey, frequencyDays, success, by) {
  const now = new Date();
  const frequency = normalizeFrequencyDays(frequencyDays);
  const released = new Date(0);
  const committedBy = String(by || 'engine').slice(0, 80);
  const update = success
    ? { $set: { frequencyDays: frequency, lastSentAt: now, nextAllowedAt: new Date(now.getTime() + frequency * DAY_MS), pendingUntil: released, committedAt: now, committedBy } }
    : { $set: { frequencyDays: frequency, lastFailedAt: now, nextAllowedAt: released, pendingUntil: released, committedAt: now, committedBy } };
  await collection.updateOne({ key: emailSendLockKey(lockKey) }, update);
}

module.exports = { EMAIL_SEND_LOCK_PREFIX, EMAIL_LOCK_PENDING_MS, emailSendLockKey, normalizeFrequencyDays, claimEmailLock, commitEmailLock };
