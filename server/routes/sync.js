'use strict';

const express = require('express');
const router = express.Router();
const { getCollection } = require('../lib/mongo');
const { wrapAsync, requireAdmin } = require('../middleware/auth');
const {
  SYNC_KEYS, assertSyncKey, syncValuesEqual, sanitizeSyncValueForClient,
  mergeEmailLogs, mergeUsersForSync, mergeFindingsForSync,
  mergeNotificationsForSync, mergeAuditDraftsForSync, mergeCompletedAuditsForSync
} = require('../lib/sync-helpers');

const SYNC_READ_THROTTLE_MS = 20 * 1000;
const recentSyncReads = new Map();

function throttleSyncRead(req, res) {
  const isManifest = req.query && (req.query.manifest === '1' || req.query.meta === '1');
  if (!isManifest) return false;
  const key = String((req.authUser && (req.authUser.id || req.authUser.loginId)) || req.ip || 'anonymous');
  const now = Date.now();
  const last = recentSyncReads.get(key) || 0;
  recentSyncReads.set(key, now);
  if (last && now - last < SYNC_READ_THROTTLE_MS) {
    res.setHeader('Retry-After', String(Math.ceil((SYNC_READ_THROTTLE_MS - (now - last)) / 1000)));
    res.json({ ok: true, data: {}, throttled: true });
    return true;
  }
  return false;
}

// GET /api/sync/keys
router.get('/keys', (_req, res) => res.json({ ok: true, keys: SYNC_KEYS }));

// GET /api/sync  (manifest or full)
router.get('/', wrapAsync(async (req, res) => {
  if (throttleSyncRead(req, res)) return;
  const collection = await getCollection();
  const rows = await collection.find({ key: { $in: SYNC_KEYS.filter(k => k !== 'ap_local_storage_backup') } }).toArray();
  if (req.query && (req.query.manifest === '1' || req.query.meta === '1')) {
    const data = {};
    rows.forEach(row => { data[row.key] = { updatedAt: row.updatedAt, updatedBy: row.updatedBy || 'system' }; });
    return res.json({ ok: true, data, manifest: true });
  }
  const data = {};
  rows.forEach(row => { data[row.key] = { value: sanitizeSyncValueForClient(row.key, row.value), updatedAt: row.updatedAt, updatedBy: row.updatedBy || 'system' }; });
  res.json({ ok: true, data });
}));

// GET /api/sync/:key
router.get('/:key', wrapAsync(async (req, res) => {
  const { key } = req.params;
  assertSyncKey(key);
  const collection = await getCollection();
  const row = await collection.findOne({ key });
  res.json({ ok: true, key, value: row ? sanitizeSyncValueForClient(key, row.value) : null, updatedAt: row ? row.updatedAt : null });
}));

// PUT /api/sync/:key
router.put('/:key', wrapAsync(async (req, res) => {
  const { key } = req.params;
  assertSyncKey(key);
  const collection = await getCollection();
  const now = new Date();
  let incomingValue = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : null;
  let currentRow = null;
  const loadCurrent = async () => { if (!currentRow) currentRow = await collection.findOne({ key }); return currentRow; };
  if (key === 'ap_users' || key === 'ap_permissions') requireAdmin(req);

  if (key === 'ap_email_logs') {
    const current = await loadCurrent();
    const replace = Boolean(req.body && req.body.replace);
    const clearedAt = replace && Array.isArray(incomingValue) && incomingValue.length === 0 ? now : (current && current.clearedAt);
    const value = replace ? (Array.isArray(incomingValue) ? incomingValue : []) : mergeEmailLogs(current && current.value, incomingValue, clearedAt);
    if (!replace && current && syncValuesEqual(key, current.value, value)) return res.json({ ok: true, key, skipped: true, updatedAt: current.updatedAt || null, count: value.length });
    await collection.updateOne({ key }, { $set: { key, value, updatedAt: now, updatedBy: (req.body && req.body.by) || 'browser', clearedAt: clearedAt || null } }, { upsert: true });
    return res.json({ ok: true, key, updatedAt: now, count: value.length });
  }

  if (key === 'ap_finds') { const cur = await loadCurrent(); incomingValue = mergeFindingsForSync(cur && cur.value, incomingValue); }
  if (key === 'ap_users') { const cur = await loadCurrent(); incomingValue = mergeUsersForSync(cur && cur.value, incomingValue); }
  if (key === 'ap_audit_drafts') { const cur = await loadCurrent(); incomingValue = mergeAuditDraftsForSync(cur && cur.value, incomingValue); }
  if (key === 'ap_completed_audits') {
    const [cur, findingsRow] = await Promise.all([loadCurrent(), collection.findOne({ key: 'ap_finds' })]);
    incomingValue = mergeCompletedAuditsForSync(cur && cur.value, incomingValue, findingsRow && findingsRow.value);
  }
  if (key === 'ap_notifs') { const cur = await loadCurrent(); incomingValue = mergeNotificationsForSync(cur && cur.value, incomingValue); }

  const current = await loadCurrent();
  if (current && syncValuesEqual(key, current.value, incomingValue)) return res.json({ ok: true, key, skipped: true, updatedAt: current.updatedAt || null });
  await collection.updateOne({ key }, { $set: { key, value: incomingValue, updatedAt: now, updatedBy: (req.body && req.body.by) || 'browser' } }, { upsert: true });
  res.json({ ok: true, key, updatedAt: now });
}));

// POST /api/sync/bulk
router.post('/bulk', wrapAsync(async (req, res) => {
  const items = (req.body && req.body.items) || {};
  const keys = Object.keys(items).filter(k => SYNC_KEYS.includes(k));
  if (!keys.length) return res.json({ ok: true, count: 0 });
  if (keys.includes('ap_users') || keys.includes('ap_permissions')) requireAdmin(req);
  const collection = await getCollection();
  const now = new Date();
  const currentRows = new Map();
  const getCurrent = async k => { if (!currentRows.has(k)) currentRows.set(k, await collection.findOne({ key: k })); return currentRows.get(k); };
  for (const k of keys) {
    const cur = await getCurrent(k);
    if (k === 'ap_finds') items[k] = mergeFindingsForSync(cur && cur.value, items[k]);
    if (k === 'ap_audit_drafts') items[k] = mergeAuditDraftsForSync(cur && cur.value, items[k]);
    if (k === 'ap_email_logs') items[k] = mergeEmailLogs(cur && cur.value, items[k], cur && cur.clearedAt);
    if (k === 'ap_users') items[k] = mergeUsersForSync(cur && cur.value, items[k]);
    if (k === 'ap_completed_audits') {
      const fr = keys.includes('ap_finds') ? null : await collection.findOne({ key: 'ap_finds' });
      items[k] = mergeCompletedAuditsForSync(cur && cur.value, items[k], Array.isArray(items.ap_finds) ? items.ap_finds : (fr && fr.value));
    }
    if (k === 'ap_notifs') items[k] = mergeNotificationsForSync(cur && cur.value, items[k]);
  }
  const writeKeys = keys.filter(k => { const c = currentRows.get(k); return !(c && syncValuesEqual(k, c.value, items[k])); });
  if (!writeKeys.length) return res.json({ ok: true, count: 0, skipped: keys.length, updatedAt: now });
  await collection.bulkWrite(writeKeys.map(k => ({ updateOne: { filter: { key: k }, update: { $set: { key: k, value: items[k], updatedAt: now, updatedBy: (req.body && req.body.by) || 'browser' } }, upsert: true } })));
  res.json({ ok: true, count: writeKeys.length, skipped: keys.length - writeKeys.length, updatedAt: now });
}));

// DELETE /api/sync/:key
router.delete('/:key', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const { key } = req.params;
  assertSyncKey(key);
  const collection = await getCollection();
  await collection.deleteOne({ key });
  res.json({ ok: true, key });
}));

// DELETE /api/sync
router.delete('/', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const collection = await getCollection();
  const result = await collection.deleteMany({ key: { $in: SYNC_KEYS } });
  res.json({ ok: true, deletedCount: result.deletedCount });
}));

module.exports = router;
