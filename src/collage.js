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

// ── layout: hero + adaptive grid that always fills the square ────────────────
function gridFill(x0, y0, W, H, count, out) {
  const aspect = W / H;
  let cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * aspect))));
  const rows = Math.ceil(count / cols);
  const tw = W / cols, th = H / rows;
  const lastCount = count - cols * (rows - 1);
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const stretch = r === rows - 1 && lastCount < cols;
    const cw = stretch ? W / lastCount : tw;
    const cx = stretch ? x0 + c * cw : x0 + c * tw;
    out.push({ x: cx, y: y0 + r * th, w: cw, h: th });
  }
}

function layout(n, S) {
  const tiles = [];
  if (n <= 1) return { hero: { x: 0, y: 0, w: S, h: S }, tiles };
  if (n <= 3) {
    const hw = Math.round(S * 0.6);
    gridFill(0, 0, S - hw, S, n - 1, tiles);
    return { hero: { x: S - hw, y: 0, w: hw, h: S }, tiles };
  }
  const R = n - 1;
  const f = R <= 7 ? 0.62 : R <= 15 ? 0.55 : R <= 35 ? 0.48 : 0.42;
  const h = Math.round(S * f);
  const leftW = S - h, botW = h, botH = S - h;
  const leftA = leftW * S, botA = botW * botH;
  let leftR = Math.round((R * leftA) / (leftA + botA));
  leftR = Math.max(1, Math.min(R - 1, leftR));
  gridFill(0, 0, leftW, S, leftR, tiles);
  if (R - leftR > 0) gridFill(S - h, h, botW, botH, R - leftR, tiles);
  return { hero: { x: S - h, y: 0, w: h, h }, tiles };
}

function svgFor(images, S) {
  const L = layout(images.length, S);
  const gap = 7;
  const cell = (img, t) => {
    const x = t.x + gap / 2, y = t.y + gap / 2, w = t.w - gap, h = (t.h || t.w) - gap;
    const rad = Math.min(26, w * 0.06 + 6);
    const id = `c${Math.round(x)}_${Math.round(y)}`;
    return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}"/></clipPath>` +
      `<image href="${img}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" fill="none" stroke="rgba(255,255,255,.1)"/>`;
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
