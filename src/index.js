// ── timso — Cloudflare Worker entrypoint ─────────────────────────────────────
// Serves /api/* (the rest is static assets from /public) and runs the cron bot.

import { ARTIST, COLLECTIONS, FEED_SIZE, TTL } from "./config.js";
import { buildFeed, buildCollections, salesWithin, nowSeconds } from "./opensea.js";
import { cacheGet, cacheSet, flagGet, flagSet } from "./cache.js";
import {
  GM_MORNING, GM_SECOND, pick, summaryCaption, daySeed,
} from "./tweets.js";
import { postTweet, postWithImage, isLive, hasCreds } from "./twitter.js";
import { buildCollage } from "./collage.js";

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
async function getFeed(env, { force = false } = {}) {
  if (!force) {
    const cached = await cacheGet(env, "feed:v1");
    if (cached) return cached;
  }
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
  // Never cache an empty result — a transient API failure (or missing key) must
  // self-heal on the next request instead of sticking around.
  if (feed.length) await cacheSet(env, "feed:v1", payload, TTL.feed);
  return payload;
}

async function getCollections(env, { force = false } = {}) {
  if (!force) {
    const cached = await cacheGet(env, "collections:v1");
    if (cached) return cached;
  }
  const cols = await buildCollections(env);
  const payload = { updated: nowSeconds(), count: cols.length, items: cols };
  // Cache a complete set for the full TTL; cache a partial (some collections
  // dropped to rate-limits) only briefly so it fills in on the next request.
  if (cols.length) {
    const complete = cols.length >= COLLECTIONS.length;
    await cacheSet(env, "collections:v1", payload, complete ? TTL.collections : 60);
  }
  return payload;
}

function statsFrom(feed) {
  return {
    updated: feed.updated,
    feedSize: (feed.items || []).length,
    totalCount: feed.count ?? 0,
    ...(feed.stats || { sales24h: 0, sales7d: 0, volume24h: {}, lastSale: null }),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function handleApi(url, env) {
  const path = url.pathname;

  if (path === "/api/feed") {
    const feed = await getFeed(env);
    return json(feed);
  }
  if (path === "/api/collections") {
    const cols = await getCollections(env);
    return json(cols);
  }
  if (path === "/api/stats") {
    const feed = await getFeed(env);
    return json(statsFrom(feed));
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
    return json({
      live: isLive(env),
      configured: hasCreds(env),
      goodMorning1: pick(GM_MORNING, seed),
      goodMorning2: pick(GM_SECOND, seed),
      dailySummary: summaryCaption(sales24, seed),
      summaryWillAttachCollage: sales24.filter((s) => s.image).length,
    });
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(url, env);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    // Non-API: serve static assets.
    return env.ASSETS.fetch(request);
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
  if (cron === "*/15 * * * *") {
    await Promise.all([getFeed(env, { force: true }), getCollections(env, { force: true })]);
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
  // Daily 24h summary + collage
  if (cron === "0 21 * * *") {
    return doOncePerDay(env, `summary:${seed}`, async () => {
      const feed = await getFeed(env, { force: true });
      const sales24 = salesWithin(feed.items, 24);
      const caption = summaryCaption(sales24, seed);
      let png = null;
      if (sales24.length) {
        const { png: bytes } = await buildCollage(sales24, {
          max: 16,
          title: `timso · ${sales24.length} sold / 24h`,
        });
        png = bytes;
      }
      return postWithImage(env, caption, png);
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
