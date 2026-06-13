// ── Daily collage ────────────────────────────────────────────────────────────
// Composites the day's sold works into one image with resvg-wasm:
//   • most expensive piece = big, top-right
//   • the rest fill the L-region (left column + bottom row), sized to fill
//   • scales from 2 up to ~36 tiles; beyond that we show the top 36 by price
// seadn can serve PNG (?format=png), which resvg decodes — so no webp problem.

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

let wasmReady;
function ensureWasm() {
  if (!wasmReady) wasmReady = initWasm(resvgWasm);
  return wasmReady;
}

export const MAX_TILES = 36;

// Order sales for the collage: most expensive first (the hero), deduped by image.
export function orderForCollage(sales, max = MAX_TILES) {
  const seen = new Set();
  const out = [];
  for (const s of [...sales].filter((s) => s.image).sort((a, b) => (b.price || 0) - (a.price || 0))) {
    if (seen.has(s.image)) continue;
    seen.add(s.image);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// ── layout: SQUARE tiles only (works are square — never distort them). The
// priciest piece is a big square top-right; the rest are unit squares filling
// the nearest cells around it. Empty cells are fine (they read as negative space).
function layout(n, S) {
  if (n <= 1) return { hero: { x: 0, y: 0, w: S }, tiles: [] };
  let g = 3, k = 2;
  for (g = 3; g <= 14; g++) {
    k = Math.max(2, Math.round(0.45 * g));
    if (k >= g) k = g - 1;
    if (g * g - k * k + 1 >= n) break;
  }
  const u = S / g;
  const hx0 = g - k; // hero spans columns [hx0, g), rows [0, k) — top-right
  const hero = { x: hx0 * u, y: 0, w: k * u };
  const hcx = hx0 + k / 2, hcy = k / 2;
  const cells = [];
  for (let r = 0; r < g; r++) for (let c = 0; c < g; c++) {
    if (c >= hx0 && r < k) continue; // inside the hero block
    cells.push({ c, r, d: Math.hypot(c + 0.5 - hcx, r + 0.5 - hcy) });
  }
  cells.sort((a, b) => a.d - b.d); // fill nearest-to-hero first; empties land far away
  const tiles = cells.slice(0, n - 1).map(({ c, r }) => ({ x: c * u, y: r * u, w: u }));
  return { hero, tiles };
}

function svgFor(images, S) {
  const L = layout(images.length, S);
  const gap = 8;
  const cell = (img, t) => {
    const x = t.x + gap / 2, y = t.y + gap / 2, w = t.w - gap;
    const rad = Math.min(28, w * 0.07 + 5);
    const id = `c${Math.round(x)}_${Math.round(y)}`;
    return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${rad}"/></clipPath>` +
      `<image href="${img}" x="${x}" y="${y}" width="${w}" height="${w}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${rad}" fill="none" stroke="rgba(255,255,255,.1)"/>`;
  };
  let body = cell(images[0], L.hero);
  L.tiles.forEach((t, i) => { body += cell(images[i + 1] || images[0], t); });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
    `<rect width="${S}" height="${S}" fill="#0b0b0c"/>${body}</svg>`;
}

function sizedPng(url, w) {
  try {
    const u = new URL(url);
    u.searchParams.set("format", "png");
    u.searchParams.set("w", String(w));
    return u.toString();
  } catch { return url; }
}

async function fetchDataUri(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 3600 } });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if (!b.length || b.length > 3_000_000) return null;
    let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return "data:image/png;base64," + btoa(bin);
  } catch { return null; }
}

// Build the collage PNG. `sales` should be ordered (hero first). Returns
// Uint8Array PNG or null if fewer than 2 images resolve.
export async function buildCollagePng(sales, canvas = 1000) {
  const items = sales.slice(0, MAX_TILES);
  if (items.length < 2) return null;
  const w = items.length > 16 ? 320 : 460;
  const uris = (await Promise.all(items.map((s) => fetchDataUri(sizedPng(s.image, w))))).filter(Boolean);
  if (uris.length < 2) return null;
  await ensureWasm();
  const png = new Resvg(svgFor(uris, canvas), { fitTo: { mode: "width", value: canvas } }).render().asPng();
  return png;
}
