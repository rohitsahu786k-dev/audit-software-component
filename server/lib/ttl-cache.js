'use strict';

// Tiny single-flight TTL cache. Concurrent callers share one in-flight load, and a
// loaded value is reused until it expires or is invalidated (e.g. after a write).
function createTtlCache(loader, ttlMs) {
  let value; let expiresAt = 0; let inflight = null;
  return {
    async get() {
      if (Date.now() < expiresAt) return value;
      if (!inflight) {
        inflight = Promise.resolve(loader())
          .then(v => { value = v; expiresAt = Date.now() + ttlMs; return v; })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
    invalidate() { expiresAt = 0; },
  };
}

module.exports = { createTtlCache };
