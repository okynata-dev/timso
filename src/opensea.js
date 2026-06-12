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

async function getJSON(url, env) {
  const r = await fetch(url, { headers: headers(env) });
  if (!r.ok) throw new Error(`opensea ${r.status} ${url}`);
  return r.json();
}

// Run async tasks with a concurrency cap so we don't hammer the API / hit limits.
async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); }
      catch (e) { out[idx] = { __error: String(e && e.message || e) }; }
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
  const perColl = await pool(COLLECTIONS, 6, (slug) => collectionSales(slug, env));
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

// Collection metadata for the gallery cards.
async function collectionMeta(slug, env) {
  const j = await getJSON(`${BASE}/collections/${slug}`, env);
  return {
    slug,
    name: j.name || slug,
    description: j.description || "",
    image: j.image_url || "",
    banner: j.banner_image_url || "",
    supply: j.total_supply ?? null,
    chain:
      (Array.isArray(j.contracts) && j.contracts[0]?.chain) || j.chain || "",
    url: j.opensea_url || `https://opensea.io/collection/${slug}`,
  };
}

export async function buildCollections(env) {
  const metas = await pool(COLLECTIONS, 6, (slug) => collectionMeta(slug, env));
  return metas.filter((m) => m && !m.__error && m.slug);
}

// Sales within the last `hours` (used by the daily Twitter summary).
export function salesWithin(feed, hours = 24, nowSec = nowSeconds()) {
  const cutoff = nowSec - hours * 3600;
  return feed.filter((s) => s.time >= cutoff);
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
