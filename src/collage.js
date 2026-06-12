// ── Daily collage ────────────────────────────────────────────────────────────
// Builds a grid collage of works sold in the last 24h.
//
// Always returns an SVG string (zero dependencies). It ALSO returns PNG bytes IF
// the optional `@resvg/resvg-wasm` package is installed — Twitter needs a raster
// image, so before going live run:  npm i @resvg/resvg-wasm
// Without it, the daily summary simply posts as text.

const CELL = 300; // px per tile
const GAP = 10;
const PAD = 30;
const BG = "#0b0b0c";

async function fetchAsDataURI(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 3600 } });
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/png";
    if (!/image\//.test(mime)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 3_500_000) return null; // skip huge originals
    return `data:${mime};base64,${base64(buf)}`;
  } catch {
    return null;
  }
}

// sales: array of feed items (with .image). Tiles up to `max` of them.
export async function buildCollage(sales, { max = 16, title = "" } = {}) {
  const items = sales.filter((s) => s.image).slice(0, max);
  if (!items.length) return { svg: null, png: null };

  const cols = Math.min(4, Math.ceil(Math.sqrt(items.length)));
  const rows = Math.ceil(items.length / cols);

  // Resolve images in parallel.
  const uris = await Promise.all(items.map((s) => fetchAsDataURI(s.image)));
  const tiles = items
    .map((s, i) => ({ s, uri: uris[i] }))
    .filter((t) => t.uri);
  if (!tiles.length) return { svg: null, png: null };

  const W = PAD * 2 + cols * CELL + (cols - 1) * GAP;
  const titleH = title ? 70 : 0;
  const H = PAD * 2 + titleH + rows * CELL + (rows - 1) * GAP;

  let body = "";
  tiles.forEach((t, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = PAD + c * (CELL + GAP);
    const y = PAD + titleH + r * (CELL + GAP);
    const clip = `cl${i}`;
    body += `
      <clipPath id="${clip}"><rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="22"/></clipPath>
      <image href="${t.uri}" x="${x}" y="${y}" width="${CELL}" height="${CELL}"
             preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>
      <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="22" fill="none"
            stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>`;
  });

  const titleSvg = title
    ? `<text x="${PAD}" y="${PAD + 44}" font-family="Helvetica, Arial, sans-serif"
         font-size="40" font-weight="800" fill="#fff" letter-spacing="-1">${escapeXml(title)}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${titleSvg}
    ${body}
  </svg>`;

  const png = await rasterize(svg, W).catch(() => null);
  return { svg, png };
}

// Optional rasterization. Returns Uint8Array PNG or null if resvg isn't present.
// NOTE: specifiers are computed at runtime on purpose so the bundler does not try
// to resolve `@resvg/resvg-wasm` at build time. To enable PNG collages:
//   1) npm i @resvg/resvg-wasm
//   2) nothing else — this code picks it up automatically.
async function rasterize(svg, width) {
  try {
    const pkg = ["@resvg", "resvg-wasm"].join("/");
    const resvg = await import(/* webpackIgnore: true */ pkg);
    if (!globalThis.__resvgReady) {
      const wasm = await import(/* webpackIgnore: true */ pkg + "/index_bg.wasm");
      await resvg.initWasm(wasm.default || wasm);
      globalThis.__resvgReady = true;
    }
    const r = new resvg.Resvg(svg, { fitTo: { mode: "width", value: width } });
    return r.render().asPng();
  } catch {
    return null; // dependency not installed — text-only tweet
  }
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])
  );
}

function base64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
