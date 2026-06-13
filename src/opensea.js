// ── OpenSea API v2 client ────────────────────────────────────────────────────
// Notes baked in from probing the live API:
//  - Events by collection:  GET /api/v2/events/collection/{slug}   (SINGULAR)
//    (the plural /events/collections/{slug} returns 404)
//  - Collection metadata:   GET /api/v2/collections/{slug}
//  - Sales are multi-chain (ethereum, base, flow, …); slug is global, no chain needed.

import { COLLECTIONS, SALES_PER_COLLECTION } from "./config.js";

const BASE = "https://api.opensea.io/api/v2";

function headers(env) {
  return { accept: "application/json", "x-api-key": env.OPENSEA_API_KEY || "" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with retry/backoff. From Cloudflare's shared egress IPs OpenSea rate-limits
// aggressively (429), so we retry patiently. This only runs in the background cron.
async function getJSON(url, env, attempt = 0) {
  const r = await fetch(url, { headers: headers(env) });
  if ((r.status === 429 || r.status >= 500) && attempt < 6) {
    const retryAfter = Number(r.headers.get("retry-after"));
    const wait = retryAfter > 0
      ? retryAfter * 1000
      : Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
    await sleep(wait);
    return getJSON(url, env, attempt + 1);
  }
  if (!r.ok) throw new Error(`opensea ${r.status} ${url}`);
  return r.json();
}

// Run tasks with a small concurrency cap + spacing between calls — polite enough
// to stay under OpenSea's per-IP rate limit during the background fan-out.
async function pool(items, limit, worker, delayMs = 0) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); }
      catch (e) { out[idx] = { __error: String(e && e.message || e) }; }
      if (delayMs && i < items.length) await sleep(delayMs);
    }
  });
  await Promise.all(runners);
  return out;
}

const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function priceOf(payment) {
  if (!payment) return { amount: 0, symbol: "" };
  const dec = payment.decimals ?? 18;
  const amount = Number(payment.quantity || 0) / 10 ** dec;
  return { amount, symbol: payment.symbol || "" };
}

// Normalize a raw OpenSea sale event into our flat feed item.
function normalizeSale(e, slug) {
  const { amount, symbol } = priceOf(e.payment);
  const nft = e.nft || {};
  return {
    id: `${e.transaction || ""}:${nft.contract || ""}:${nft.identifier || ""}`,
    collection: slug,
    chain: e.chain || "",
    name: nft.name || (nft.identifier ? `#${nft.identifier}` : "Untitled"),
    image: nft.display_image_url || nft.image_url || "",
    identifier: nft.identifier || "",
    contract: nft.contract || "",
    price: amount,
    symbol,
    priceStr: amount ? `${formatAmount(amount)} ${symbol}` : "—",
    buyer: e.buyer || "",
    buyerShort: shortAddr(e.buyer),
    seller: e.seller || "",
    sellerShort: shortAddr(e.seller),
    time: e.event_timestamp || e.closing_date || 0,
    tx: e.transaction || "",
    url: nft.opensea_url || "",
  };
}

function formatAmount(a) {
  if (a === 0) return "0";
  if (a < 0.001) return a.toFixed(4);
  if (a < 1) return a.toFixed(3);
  if (a < 100) return a.toFixed(2);
  return a.toFixed(1);
}

// Pull recent sales for one collection.
async function collectionSales(slug, env) {
  const url = `${BASE}/events/collection/${slug}?event_type=sale&limit=${SALES_PER_COLLECTION}`;
  const j = await getJSON(url, env);
  return (j.asset_events || [])
    .filter((e) => e.event_type === "sale")
    .map((e) => normalizeSale(e, slug));
}

// Build the unified, de-duped, time-sorted feed across ALL collections.
export async function buildFeed(env) {
  const perColl = await pool(COLLECTIONS, 2, (slug) => collectionSales(slug, env), 300);
  const seen = new Set();
  const all = [];
  for (const list of perColl) {
    if (!Array.isArray(list)) continue; // skip errored collections
    for (const item of list) {
      if (!item.image && !item.price) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
  }
  all.sort((a, b) => b.time - a.time);
  return all;
}

// Full per-collection detail: metadata + period stats + a few work images for the
// collage banner. Powers both the gallery cards and the detail drawer, and the
// aggregate stats bar is summed from these (one fan-out, three sources each).
async function collectionDetail(slug, env) {
  const meta = await getJSON(`${BASE}/collections/${slug}`, env);
  const stats = await getJSON(`${BASE}/collections/${slug}/stats`, env).catch(() => ({}));
  const nfts = await getJSON(`${BASE}/collection/${slug}/nfts?limit=12`, env).catch(() => ({}));

  const iv = {};
  for (const i of stats.intervals || []) iv[i.interval] = i;
  const pick = (x) => ({ sales: x?.sales || 0, vol: x?.volume || 0 });

  const samples = [];
  for (const n of nfts.nfts || []) {
    const u = n.display_image_url || n.image_url;
    if (u && !samples.includes(u)) samples.push(u);
    if (samples.length >= 8) break;
  }

  let desc = (meta.description || "").trim().replace(/\s+/g, " ");
  if (desc.length > 240) desc = desc.slice(0, 237).trimEnd() + "…";

  return {
    slug,
    name: meta.name || slug,
    description: desc,
    image: meta.image_url || "",
    banner: meta.banner_image_url || "",
    supply: meta.total_supply ?? null,
    chain: (Array.isArray(meta.contracts) && meta.contracts[0]?.chain) || meta.chain || "",
    url: meta.opensea_url || `https://opensea.io/collection/${slug}`,
    dropDate: meta.created_date || "",
    floor: stats.total?.floor_price ?? null,
    floorSym: stats.total?.floor_price_symbol || "ETH",
    samples,
    stats: {
      day: pick(iv.one_day),
      week: pick(iv.seven_day),
      month: pick(iv.thirty_day),
      all: { sales: stats.total?.sales || 0, vol: stats.total?.volume || 0 },
    },
  };
}

export async function buildCollections(env) {
  const metas = await pool(COLLECTIONS, 2, (slug) => collectionDetail(slug, env), 300);
  return metas.filter((m) => m && !m.__error && m.slug);
}

// Sum the per-collection period stats into the aggregate for the top bar.
export function aggregateStats(collections) {
  const agg = {
    day: { sales: 0, vol: 0 }, week: { sales: 0, vol: 0 },
    month: { sales: 0, vol: 0 }, all: { sales: 0, vol: 0 },
  };
  for (const c of collections) {
    if (!c || !c.stats) continue;
    for (const k of ["day", "week", "month", "all"]) {
      agg[k].sales += c.stats[k]?.sales || 0;
      agg[k].vol += c.stats[k]?.vol || 0;
    }
  }
  return { ...agg, collections: collections.length };
}

// Sales within the last `hours` (used by the daily Twitter summary).
export function salesWithin(feed, hours = 24, nowSec = nowSeconds()) {
  const cutoff = nowSec - hours * 3600;
  return feed.filter((s) => s.time >= cutoff);
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
