'use strict';

const crypto = require('crypto');
const { getCollection } = require('./mongo');

// Fixed-window counters stored in Mongo so limits hold across serverless instances.
// Keys live in the same collection but outside SYNC_KEYS, so they never reach clients.
function bucketKey(bucket, id) {
  return `_rl:${bucket}:${crypto.createHash('sha256').update(String(id || '')).digest('hex').slice(0, 32)}`;
}

async function hit(bucket, id, windowMs) {
  const col = await getCollection();
  const key = bucketKey(bucket, id);
  const now = Date.now();
  const bumped = await col.findOneAndUpdate({ key, resetAt: { $gt: now } }, { $inc: { count: 1 } }, { returnDocument: 'after' });
  if (bumped) return bumped.count;
  await col.updateOne({ key }, { $set: { key, count: 1, resetAt: now + windowMs, expireAt: new Date(now + windowMs) } }, { upsert: true });
  return 1;
}

async function count(bucket, id) {
  const col = await getCollection();
  const row = await col.findOne({ key: bucketKey(bucket, id), resetAt: { $gt: Date.now() } }, { projection: { count: 1 } });
  return row ? row.count : 0;
}

async function clear(bucket, id) {
  const col = await getCollection();
  await col.deleteOne({ key: bucketKey(bucket, id) });
}

module.exports = { hit, count, clear };
