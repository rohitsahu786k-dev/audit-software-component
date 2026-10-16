'use strict';

const { getCollection } = require('./mongo');

// One document per user for password-reset OTPs, so attempt counting is a single atomic
// $inc (the old shared array could lose increments under concurrent guesses).
const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const otpKey = userId => `_otp:${userId}`;

async function saveOtp(userId, otpHash) {
  const col = await getCollection();
  const expiresAt = Date.now() + OTP_TTL_MS;
  await col.updateOne({ key: otpKey(userId) }, { $set: { key: otpKey(userId), otpHash, attempts: 0, expiresAt, expireAt: new Date(expiresAt) } }, { upsert: true });
}

async function deleteOtp(userId) {
  await (await getCollection()).deleteOne({ key: otpKey(userId) });
}

// Returns { status: 'missing' | 'expired' | 'locked' | 'ok', otpHash }.
// Each call consumes one attempt, whether or not the code turns out to be right.
async function consumeAttempt(userId) {
  const col = await getCollection();
  const doc = await col.findOneAndUpdate({ key: otpKey(userId) }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  if (!doc) return { status: 'missing' };
  if (doc.expiresAt < Date.now()) { await deleteOtp(userId); return { status: 'expired' }; }
  if (doc.attempts > MAX_OTP_ATTEMPTS) { await deleteOtp(userId); return { status: 'locked' }; }
  return { status: 'ok', otpHash: doc.otpHash };
}

module.exports = { saveOtp, deleteOtp, consumeAttempt };
