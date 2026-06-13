// ── Daily media selection ────────────────────────────────────────────────────
// Instead of compositing a collage server-side (which needs a rasterizer and
// can't decode seadn's webp), we attach up to 4 of the day's sold works as
// native Twitter images — Twitter lays them out in a 2×2 grid automatically.

// Pick up to `max` distinct work images from the 24h sales, favouring variety
// across collections first, then the highest-value pieces.
export function selectWorkImages(sales, max = 4) {
  const withImg = [...sales].filter((s) => s.image).sort((a, b) => (b.price || 0) - (a.price || 0));
  const seen = new Set();
  const collSeen = new Set();
  const out = [];

  // Pass 1: one per collection (diversity).
  for (const s of withImg) {
    if (out.length >= max) break;
    if (collSeen.has(s.collection) || seen.has(s.image)) continue;
    seen.add(s.image); collSeen.add(s.collection); out.push(s.image);
  }
  // Pass 2: fill remaining slots with the highest-value leftovers.
  for (const s of withImg) {
    if (out.length >= max) break;
    if (seen.has(s.image)) continue;
    seen.add(s.image); out.push(s.image);
  }
  return out.map((u) => sizeForTwitter(u));
}

// Ask seadn's CDN for a reasonable size so uploads stay small and fast.
function sizeForTwitter(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("seadn.io")) {
      u.searchParams.set("w", "900");
      u.searchParams.set("auto", "format");
      return u.toString();
    }
  } catch {}
  return url;
}
