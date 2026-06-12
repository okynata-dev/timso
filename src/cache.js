// ── Cache layer ──────────────────────────────────────────────────────────────
// Uses Workers KV when the CACHE binding is present; otherwise falls back to a
// per-isolate in-memory cache. This lets the site deploy with ZERO setup and
// upgrade to durable caching simply by adding the KV namespace.

const mem = new Map(); // key -> { value, expires }

export async function cacheGet(env, key) {
  if (env.CACHE) {
    const v = await env.CACHE.get(key, "json");
    return v ?? null;
  }
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.expires && hit.expires < Date.now()) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}

export async function cacheSet(env, key, value, ttlSec) {
  if (env.CACHE) {
    await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSec) });
    return;
  }
  mem.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}

// Plain string get/set (for Twitter dedupe markers etc.).
export async function flagGet(env, key) {
  if (env.CACHE) return env.CACHE.get(key);
  const hit = mem.get(key);
  return hit ? hit.value : null;
}
export async function flagSet(env, key, value, ttlSec = 172800) {
  if (env.CACHE) { await env.CACHE.put(key, String(value), { expirationTtl: ttlSec }); return; }
  mem.set(key, { value: String(value), expires: Date.now() + ttlSec * 1000 });
}
