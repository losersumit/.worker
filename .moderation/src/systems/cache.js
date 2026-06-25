/**
 * Short-Lived Result Cache
 * Simple Map-based cache with per-entry TTL support (default 30s).
 * Used for caching common DB queries to reduce redundant lookups.
 * A background sweep runs every 60s to purge expired entries.
 */

/** @type {Map<string, { value: any, expiresAt: number }>} */
const store = new Map();

// --- Periodic cleanup ---
// Sweep every 60s to remove entries that have outlived their TTL.
// unref() ensures this timer doesn't keep the Node process alive.
const CLEANUP_INTERVAL_MS = 60_000;
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.expiresAt) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

/**
 * Retrieve a cached value if it exists and hasn't expired.
 * @param {string} key
 * @returns {any|undefined} The cached value, or undefined on miss / expiry.
 */
export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (Date.now() >= entry.expiresAt) {
    // Lazy eviction — don't wait for the sweep
    store.delete(key);
    return undefined;
  }

  return entry.value;
}

/**
 * Store a value in the cache with a TTL.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlMs=30000] Time-to-live in milliseconds (default 30s).
 */
export function setCached(key, value, ttlMs = 30_000) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Immediately remove a single key from the cache.
 * @param {string} key
 */
export function invalidate(key) {
  store.delete(key);
}

/**
 * Drop every entry in the cache.
 */
export function clearAll() {
  store.clear();
}
