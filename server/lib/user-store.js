'use strict';

const { getCollection } = require('./mongo');
const { createTtlCache } = require('./ttl-cache');

// Every authenticated request needs the user list (to confirm the account is still
// active) and the permission matrix. Cache both briefly so normal traffic does not hit
// MongoDB per request; writers call invalidate*() so changes made on this instance
// apply immediately and other instances converge within the TTL.
const USERS_TTL_MS = Number(process.env.AUTH_USER_CACHE_MS || 15000);

const usersCache = createTtlCache(async () => {
  const row = await (await getCollection()).findOne({ key: 'ap_users' });
  return Array.isArray(row && row.value) ? row.value : [];
}, USERS_TTL_MS);

const permsCache = createTtlCache(async () => {
  const row = await (await getCollection()).findOne({ key: 'ap_permissions' });
  return row ? row.value : null;
}, USERS_TTL_MS);

// Uncached read for flows that read-modify-write the user list.
async function getFreshUsersRecord() {
  const collection = await getCollection();
  const row = await collection.findOne({ key: 'ap_users' });
  return { collection, users: Array.isArray(row && row.value) ? row.value : [] };
}

module.exports = {
  getCachedUsers: () => usersCache.get(),
  getCachedPermissions: () => permsCache.get(),
  getFreshUsersRecord,
  invalidateUsers: () => usersCache.invalidate(),
  invalidatePermissions: () => permsCache.invalidate(),
};
