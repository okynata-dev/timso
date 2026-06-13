// ── timso front-end ──────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };

let FEED = [];          // full feed items
let COLS = [];          // collection metas (merged with activity)
let shown = 0;
const PAGE = 30;

// ── helpers ──────────────────────────────────────────────────────────────────
function timeAgo(sec) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return d + "s";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  if (d < 604800) return Math.floor(d / 86400) + "d";
  return Math.floor(d / 604800) + "w";
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pretty = (slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const chainName = (c) => ({ ethereum: "ETH", base: "BASE", flow: "FLOW", polygon: "POLY", optimism: "OP", abstract: "ABS", shape: "SHAPE", ape_chain: "APE" }[c] || (c || "").toUpperCase());

// Request a right-sized image from OpenSea's CDN (crisp on retina, fast to load).
function sizedImg(url, w) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("seadn.io")) {
      u.searchParams.set("w", String(w));
      u.searchParams.set("auto", "format");
      return u.toString();
    }
  } catch {}
  return url;
}

const fmtNum = (n) => (n || 0).toLocaleString("en-US");
function fmtEth(v) {
  if (!v) return "0 Ξ";
  if (v < 1) return v.toFixed(3) + " Ξ";
  if (v < 1000) return v.toFixed(2) + " Ξ";
  return Math.round(v).toLocaleString("en-US") + " Ξ";
}

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }

// ── feed rendering ───────────────────────────────────────────────────────────
function rowEl(s, fresh) {
  const a = el("a", "row" + (fresh ? " fresh" : ""));
  a.href = s.url || "#";
  if (s.url) { a.target = "_blank"; a.rel = "noopener"; }
  const img = s.image
    ? `<img loading="lazy" decoding="async" src="${esc(sizedImg(s.image, 128))}" alt="" onerror="this.style.display='none'">`
    : "";
  a.innerHTML = `
    <div class="thumb">${img}</div>
    <div class="rmid">
      <div class="rcoll">&ldquo;<b>${esc(pretty(s.collection))}</b>&rdquo;</div>
      <div class="rname">${esc(s.name)}</div>
      <div class="rmeta">
        <span class="chip">${chainName(s.chain)}</span>
        ${s.buyerShort ? `<span>→ ${esc(s.buyerShort)}</span>` : ""}
      </div>
    </div>
    <div class="rright">
      <div class="price">${esc(s.priceStr || "—")}</div>
      <div class="ago">${timeAgo(s.time)} ago</div>
    </div>`;
  return a;
}

function renderFeed(reset) {
  const feed = $("#feed");
  if (reset) { feed.innerHTML = ""; shown = 0; }
  if (!FEED.length) {
    feed.innerHTML = '<div class="state">Awaiting the next sale — stand by.</div>';
    $("#feedMore").hidden = true;
    return;
  }
  const slice = FEED.slice(shown, shown + PAGE);
  for (const s of slice) feed.appendChild(rowEl(s, false));
  shown += slice.length;
  $("#feedMore").hidden = shown >= FEED.length;
}

// Merge a fresh feed pull, animating genuinely-new sales at the top.
function applyFeed(items) {
  const known = new Set(FEED.map((x) => x.id));
  const incomingTop = items.filter((x) => !known.has(x.id));
  FEED = items;
  const sk = $("#feedSkeleton"); if (sk) sk.remove();

  if (shown === 0) { renderFeed(true); return; }
  // prepend new ones
  const feed = $("#feed");
  if (incomingTop.length && incomingTop.length <= 8) {
    for (let i = incomingTop.length - 1; i >= 0; i--) feed.prepend(rowEl(incomingTop[i], true));
    shown += incomingTop.length;
  } else if (incomingTop.length > 8) {
    renderFeed(true);
  }
  // refresh "x ago" labels
  document.querySelectorAll(".row").forEach((r, i) => {
    const s = FEED[i]; if (!s) return;
    const ago = r.querySelector(".ago"); if (ago) ago.textContent = timeAgo(s.time) + " ago";
  });
}

// ── stats ────────────────────────────────────────────────────────────────────
function renderStats(st) {
  const set = (p, o) => {
    $("#" + p + "_n").textContent = fmtNum(o && o.sales);
    $("#" + p + "_v").textContent = fmtEth(o && o.vol);
  };
  set("d", st.day); set("w", st.week); set("m", st.month); set("a", st.all);
}

// ── collections gallery ──────────────────────────────────────────────────────
function activityIndex() {
  const idx = {};
  for (const s of FEED) {
    const a = (idx[s.collection] ||= { count: 0, last: 0 });
    a.count++; if (s.time > a.last) a.last = s.time;
  }
  return idx;
}

// Default order: most recently active collections first.
function sortCols() {
  const act = activityIndex();
  const get = (c) => act[c.slug] || { count: 0, last: 0 };
  const arr = [...COLS].sort(
    (a, b) => get(b).last - get(a).last || get(b).count - get(a).count
  );
  return { arr, act };
}

function cardEl(c, act) {
  const a = el("a", "card");
  a.href = c.url || `https://opensea.io/collection/${c.slug}`;
  a.target = "_blank"; a.rel = "noopener";
  const initial = (c.name || c.slug || "?").trim()[0]?.toUpperCase() || "?";
  const art = c.image
    ? `<img class="art" loading="lazy" decoding="async" src="${esc(sizedImg(c.image, 600))}" alt="${esc(c.name)}" onerror="this.outerHTML='<div class=&quot;art fallback&quot;>${esc(initial)}</div>'">`
    : `<div class="art fallback">${esc(initial)}</div>`;
  const supply = c.supply != null ? `<span>${c.supply} ITEMS</span>` : "";
  a.innerHTML = `
    ${art}
    <div class="label">
      <div class="name"><span class="q">&ldquo;</span>${esc((c.name || c.slug).toUpperCase())}<span class="q">&rdquo;</span></div>
      <div class="cmeta"><span>${chainName(c.chain)}</span>${supply}</div>
    </div>`;
  return a;
}

function renderGrid() {
  const { arr, act } = sortCols();
  const grid = $("#grid");
  if (!arr.length) { grid.innerHTML = '<div class="state" style="grid-column:1/-1">Loading collections…</div>'; return; }
  grid.innerHTML = "";
  for (const c of arr) grid.appendChild(cardEl(c, act[c.slug] || {}));
}

// ── liveness ──────────────────────────────────────────────────────────────────
function setLive(updated, count) {
  const fresh = updated && (Date.now() / 1000 - updated) < 1200;
  const node = $("#live");
  node.classList.toggle("on", !!fresh);
  $("#liveLabel").textContent = fresh ? "LIVE" : "CACHED";
}

// ── boot ──────────────────────────────────────────────────────────────────────
async function loadAll(first) {
  try {
    const [feed, stats] = await Promise.all([getJSON("/api/feed"), getJSON("/api/stats")]);
    applyFeed(feed.items || []);
    renderStats(stats);
    setLive(feed.updated, feed.count);
    if (first) {
      const cols = await getJSON("/api/collections");
      COLS = cols.items || [];
      renderGrid();
    } else {
      renderGrid(); // activity may have changed order
    }
  } catch (e) {
    console.error(e);
    const sk = $("#feedSkeleton"); if (sk) sk.remove();
    if (!FEED.length) $("#feed").innerHTML = '<div class="state">Feed offline — retrying…</div>';
  }
}

$("#feedMore").addEventListener("click", () => renderFeed(false));

loadAll(true);
setInterval(() => loadAll(false), 45000);
// keep "x ago" honest between pulls
setInterval(() => {
  document.querySelectorAll(".row").forEach((r, i) => {
    const s = FEED[i]; if (!s) return;
    const ago = r.querySelector(".ago"); if (ago) ago.textContent = timeAgo(s.time) + " ago";
  });
}, 15000);
