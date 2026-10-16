'use strict';

function cleanIdentity(input) { return String(input || '').trim().toLowerCase(); }

function findUserByIdentity(users, identity) {
  const needle = cleanIdentity(identity);
  if (!needle) return null;
  return users.find(u => {
    if (!u || u.active === false) return false;
    const aliases = Array.isArray(u.legacyLoginIds) ? u.legacyLoginIds : [];
    return cleanIdentity(u.loginId) === needle || cleanIdentity(u.email) === needle || aliases.some(a => cleanIdentity(a) === needle);
  }) || null;
}

function publicUser(user) {
  if (!user || typeof user !== 'object') return user;
  const copy = { ...user };
  delete copy.password; delete copy.passwordHash; delete copy.legacyPasswords; delete copy.legacyPasswordHashes;
  return copy;
}

module.exports = { cleanIdentity, findUserByIdentity, publicUser };
