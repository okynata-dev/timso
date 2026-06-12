// Generates the favicon suite + OG image as real PNGs.
// Run:  npm i -D @resvg/resvg-js && node scripts/gen-assets.mjs
// (Output PNGs are committed; this script only needs running when the mark changes.)
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const KEY = process.env.OPENSEA_API_KEY || "43a81c427714451e9c6251ebba983ca5";
const INK = "#0b0b0c", PAPER = "#f4f3ee", ACCENT = "#ff4d00", MUTE = "#8d8b84";

// ── the mark: a clean bold "t" with a round foot, in an Apple squircle ────────
function markSVG(size, { bg = INK, fg = PAPER, accent = true } = {}) {
  const s = size, k = s / 100;
  const sw = 13 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${26 * k}" fill="${bg}"/>
    <g fill="none" stroke="${fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${51 * k},${22 * k} L${51 * k},${60 * k} C${51 * k},${69 * k} ${57 * k},${72 * k} ${67 * k},${72 * k}"/>
      <path d="M${33 * k},${40 * k} L${69 * k},${40 * k}"/>
    </g>
    ${accent ? `<circle cx="${78 * k}" cy="${24 * k}" r="${6 * k}" fill="${ACCENT}"/>` : ""}
  </svg>`;
}

function png(svg, width) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
    background: "rgba(0,0,0,0)",
  }).render().asPng();
}

// ── PNG -> .ico (PNG-compressed ICO, supported by all modern browsers) ────────
function pngToIco(pngBytes, size = 32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size % 256, 0); entry.writeUInt8(size % 256, 1);
  entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBytes.length, 8); entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, Buffer.from(pngBytes)]);
}

async function fetchTiles(n = 6) {
  const slugs = ["bioms", "pnuks-1", "samepunks", "crawlingpunks", "chadgy-penguins", "basedabsurds", "invadrrs", "dumbsters"];
  const urls = [];
  for (const slug of slugs) {
    if (urls.length >= n) break;
    try {
      const r = await fetch(`https://api.opensea.io/api/v2/events/collection/${slug}?event_type=sale&limit=4`, { headers: { "x-api-key": KEY } });
      const j = await r.json();
      for (const e of (j.asset_events || [])) {
        const u = e.nft?.display_image_url;
        if (u && !urls.includes(u)) { urls.push(u); break; }
      }
    } catch {}
  }
  const tiles = [];
  for (const u of urls.slice(0, n)) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      // Normalize to PNG (resvg can't decode webp/avif) + square cover crop.
      const pngBuf = await sharp(buf).resize(320, 320, { fit: "cover" }).png().toBuffer();
      tiles.push(`data:image/png;base64,${pngBuf.toString("base64")}`);
    } catch {}
  }
  return tiles;
}

function ogSVG(tiles) {
  const W = 1200, H = 630;
  const cell = 150, gap = 18, n = Math.min(tiles.length, 5);
  const stripW = n * cell + (n - 1) * gap;
  const sx = W - 72 - stripW, sy = H - 72 - cell;
  let strip = "";
  tiles.slice(0, n).forEach((uri, i) => {
    const x = sx + i * (cell + gap);
    strip += `<clipPath id="c${i}"><rect x="${x}" y="${sy}" width="${cell}" height="${cell}" rx="26"/></clipPath>
      <image href="${uri}" x="${x}" y="${sy}" width="${cell}" height="${cell}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>
      <rect x="${x}" y="${sy}" width="${cell}" height="${cell}" rx="26" fill="none" stroke="rgba(255,255,255,.14)"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${INK}"/>
    <text x="72" y="180" font-family="Helvetica,Arial,sans-serif" font-size="132" font-weight="800" fill="${PAPER}" letter-spacing="-5">timso<tspan font-size="40" dy="-58" fill="${MUTE}">®</tspan></text>
    <text x="76" y="250" font-family="Helvetica,Arial,sans-serif" font-size="30" font-weight="700" letter-spacing="6" fill="${MUTE}">EVERY SALE — EVERY COLLECTION</text>
    <circle cx="84" cy="320" r="8" fill="${ACCENT}"/>
    <text x="104" y="330" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="6" fill="${PAPER}">LIVE SALES FEED</text>
    <text x="72" y="${H - 56}" font-family="Helvetica,Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="3" fill="${MUTE}">timsouw.com</text>
    ${strip}
  </svg>`;
}

const manifest = {
  name: "timso", short_name: "timso",
  description: "Live feed of every timso sale, across every collection.",
  start_url: "/", display: "standalone",
  background_color: INK, theme_color: INK,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

// ── render everything ─────────────────────────────────────────────────────────
const w = (name, data) => { writeFileSync(join(OUT, name), data); console.log("wrote", name, data.length, "bytes"); };

w("favicon.svg", Buffer.from(markSVG(100)));
w("favicon-16.png", png(markSVG(16, { accent: false }), 16));
w("favicon-32.png", png(markSVG(32), 32));
w("favicon.ico", pngToIco(png(markSVG(32), 32), 32));
w("apple-touch-icon.png", png(markSVG(180), 180));
w("icon-192.png", png(markSVG(192), 192));
w("icon-512.png", png(markSVG(512), 512));
w("site.webmanifest", Buffer.from(JSON.stringify(manifest, null, 2)));

const tiles = await fetchTiles(5);
console.log("og tiles:", tiles.length);
w("og.png", png(ogSVG(tiles), 1200));

console.log("done.");
