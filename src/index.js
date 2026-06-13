// ── timso — Cloudflare Worker entrypoint ─────────────────────────────────────
// Serves /api/* (the rest is static assets from /public) and runs the cron bot.

import { ARTIST, COLLECTIONS, FEED_SIZE, TTL } from "./config.js";
import { buildFeed, buildCollections, aggregateStats, salesWithin, nowSeconds } from "./opensea.js";
import { cacheGet, cacheSet, flagGet, flagSet } from "./cache.js";
import {
  GM_MORNING, GM_SECOND, pick, summaryCaption, daySeed,
} from "./tweets.js";
import { postTweet, postWithMediaUrls, isLive, hasCreds } from "./twitter.js";
import { selectWorkImages } from "./collage.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });

// ── Cached getters ───────────────────────────────────────────────────────────
const EMPTY_FEED = () => ({
  updated: nowSeconds(), count: 0, items: [], warming: true,
  stats: { sales24h: 0, sales7d: 0, volume24h: {}, lastSale: null },
});

async function getFeed(env, { force = false } = {}) {
  // User requests only READ the shared cache — they never fan out to OpenSea.
  if (!force) {
    return (
      (await cacheGet(env, "feed:v1")) ||
      (await cacheGet(env, "feed:lastgood")) ||
      EMPTY_FEED()
    );
  }
  // Background (cron / refresh) path: fan out politely and warm the cache.
  const feed = await buildFeed(env);
  // Stats are computed over the FULL feed before truncating for the client.
  const last24 = salesWithin(feed, 24);
  const last7d = salesWithin(feed, 24 * 7);
  const volume24h = {};
  for (const s of last24) if (s.symbol) volume24h[s.symbol] = (volume24h[s.symbol] || 0) + s.price;
  const payload = {
    updated: nowSeconds(),
    count: feed.length,
    items: feed.slice(0, FEED_SIZE),
    stats: { sales24h: last24.length, sales7d: last7d.length, volume24h, lastSale: feed[0] || null },
  };
  if (feed.length) {
    await cacheSet(env, "feed:v1", payload, TTL.feed);
    await cacheSet(env, "feed:lastgood", payload, TTL.lastgood); // bulletproof fallback
    return payload;
  }
  // Empty fan-out (OpenSea rate-limited this isolate): serve the last good data we
  // ever captured rather than showing an empty feed.
  const lastGood = await cacheGet(env, "feed:lastgood");
  if (lastGood) return lastGood;
  return payload;
}

async function getCollections(env, { force = false } = {}) {
  if (!force) {
    return (
      (await cacheGet(env, "collections:v1")) ||
      (await cacheGet(env, "collections:lastgood")) ||
      { updated: nowSeconds(), count: 0, items: [], warming: true }
    );
  }
  const cols = await buildCollections(env);
  const payload = { updated: nowSeconds(), count: cols.length, items: cols };
  if (cols.length) {
    const complete = cols.length >= COLLECTIONS.length;
    if (complete) {
      await cacheSet(env, "collections:v1", payload, TTL.collections);
      await cacheSet(env, "collections:lastgood", payload, TTL.lastgood);
      return payload;
    }
    // Partial set — prefer a complete last-known-good over showing fewer cards.
    const lastGood = await cacheGet(env, "collections:lastgood");
    if (lastGood && lastGood.count > cols.length) return lastGood;
    await cacheSet(env, "collections:v1", payload, 60);
    return payload;
  }
  const lastGood = await cacheGet(env, "collections:lastgood");
  if (lastGood) return lastGood;
  return payload;
}

// Aggregate stats are derived from the (cached) collection details — no separate
// fan-out. They refresh whenever the collections cache does (hourly cron).
async function getStats(env) {
  const cols = (await getCollections(env)).items || [];
  return { updated: nowSeconds(), ...aggregateStats(cols) };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function handleApi(url, env) {
  const path = url.pathname;

  // Manual cache warm (also what the cron does). Token-guarded.
  if (path === "/api/refresh") {
    if (!env.REFRESH_TOKEN || url.searchParams.get("token") !== env.REFRESH_TOKEN) {
      return json({ error: "forbidden" }, 403);
    }
    const what = url.searchParams.get("what") || "feed";
    const out = {};
    if (what === "feed" || what === "all") out.feed = (await getFeed(env, { force: true })).count;
    if (what === "collections" || what === "all") out.collections = (await getCollections(env, { force: true })).count;
    return json({ ok: true, ...out });
  }

  if (path === "/api/feed") {
    const feed = await getFeed(env);
    return json(feed);
  }
  if (path === "/api/collections") {
    const cols = await getCollections(env);
    return json(cols);
  }
  if (path === "/api/stats") {
    return json(await getStats(env));
  }
  if (path === "/api/meta") {
    return json({
      name: ARTIST.name,
      handles: ARTIST.handles,
      twitter: ARTIST.twitter,
      twitterLive: isLive(env),
      twitterConfigured: hasCreds(env),
    });
  }
  // What the bot would post right now (great for tuning copy before going live).
  if (path === "/api/twitter/preview") {
    const feed = await getFeed(env);
    const seed = daySeed();
    const sales24 = salesWithin(feed.items, 24);
    const summary = summaryCaption(sales24, seed);
    const images = sales24.length ? selectWorkImages(sales24, 4) : [];
    return json({
      live: isLive(env),
      configured: hasCreds(env),
      goodMorning1: pick(GM_MORNING, seed),
      goodMorning2: pick(GM_SECOND, seed),
      dailySummary: summary,
      dailySummaryChars: summary.length,
      imagesAttached: images.length,
      imageUrls: images,
    });
  }
  return json({ error: "not found" }, 404);
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy":
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; font-src 'self'; " +
    "connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'",
};

function withSecurity(resp) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let resp;
    if (url.pathname.startsWith("/api/")) {
      try {
        resp = await handleApi(url, env);
      } catch (e) {
        resp = json({ error: String(e && e.message || e) }, 500);
      }
    } else {
      resp = await env.ASSETS.fetch(request);
    }
    return withSecurity(resp);
  },

  // ── Cron ───────────────────────────────────────────────────────────────────
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    ctx.waitUntil(runCron(cron, env));
  },
};

async function runCron(cron, env) {
  const seed = daySeed();

  // Always keep the cache warm.
  // Refresh the shared feed cache (every 5 min).
  if (cron === "*/5 * * * *") {
    await getFeed(env, { force: true });
    return;
  }
  // Refresh collection details (hourly — stats bar derives from this).
  if (cron === "0 * * * *") {
    await getCollections(env, { force: true });
    return;
  }

  // Good morning #1
  if (cron === "0 13 * * *") {
    return doOncePerDay(env, `gm1:${seed}`, () => postTweet(env, pick(GM_MORNING, seed)));
  }
  // Good morning #2
  if (cron === "0 16 * * *") {
    return doOncePerDay(env, `gm2:${seed}`, () => postTweet(env, pick(GM_SECOND, seed)));
  }
  // Daily 24h summary + up to 4 sold works as native Twitter images
  if (cron === "0 21 * * *") {
    return doOncePerDay(env, `summary:${seed}`, async () => {
      const feed = await getFeed(env, { force: true });
      const sales24 = salesWithin(feed.items, 24);
      const caption = summaryCaption(sales24, seed);
      const images = sales24.length ? selectWorkImages(sales24, 4) : [];
      return postWithMediaUrls(env, caption, images);
    });
  }
}

// Ensure a given job posts at most once per day, even if cron retries (only
// enforced when KV is present; in-memory fallback is best-effort).
async function doOncePerDay(env, key, fn) {
  const marker = `posted:${key}`;
  if (isLive(env)) {
    const already = await flagGet(env, marker);
    if (already) return;
  }
  const res = await fn();
  if (isLive(env)) await flagSet(env, marker, "1");
  console.log("cron post", key, JSON.stringify(res).slice(0, 200));
}
