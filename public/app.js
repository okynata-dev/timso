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

function fmtVol(totals) {
  const parts = Object.entries(totals || {}).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([sym, v]) => `${v < 1 ? v.toFixed(3) : v.toFixed(2)} ${sym}`);
  return parts.join(" + ") || "0";
}

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }

// ── feed rendering ───────────────────────────────────────────────────────────
function rowEl(s, fresh) {
  const a = el("a", "row" + (fresh ? " fresh" : ""));
  a.href = s.url || (s.tx ? "#" : "#");
  if (s.url) { a.target = "_blank"; a.rel = "noopener"; }
  const img = s.image
    ? `<img loading="lazy" src="${esc(s.image)}" alt="" onerror="this.style.display='none'">`
    : "";
  a.innerHTML = `
    <div class="thumb">${img}</div>
    <div class="rmid">
      <div class="rcoll">&ldquo;<b>${esc(pretty(s.collection))}</b>&rdquo;</div>
      <div class="rname">${esc(s.name)}</div>
      <div class="rmeta">
        <span class="chip">${chainName(s.chain)}</span>
        ${s.buyerShort ? `<span>→ ${esc(s.buyerShort)}</span>` : ""}
        <span class="ext">VIEW ↗</span>
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
  $("#s24").textContent = st.sales24h ?? "—";
  $("#svol").textContent = fmtVol(st.volume24h);
  $("#s7").textContent = st.sales7d ?? "—";
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

function sortCols(mode) {
  const act = activityIndex();
  const get = (c) => act[c.slug] || { count: 0, last: 0 };
  const arr = [...COLS];
  if (mode === "az") arr.sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));
  else if (mode === "supply") arr.sort((a, b) => (b.supply || 0) - (a.supply || 0));
  else if (mode === "active") arr.sort((a, b) => get(b).count - get(a).count || get(b).last - get(a).last);
  else arr.sort((a, b) => get(b).last - get(a).last || get(b).count - get(a).count); // latest
  return { arr, act };
}

function cardEl(c, act) {
  const a = el("a", "card");
  a.href = c.url || `https://opensea.io/collection/${c.slug}`;
  a.target = "_blank"; a.rel = "noopener";
  const initial = (c.name || c.slug || "?").trim()[0]?.toUpperCase() || "?";
  const art = c.image
    ? `<img class="art" loading="lazy" src="${esc(c.image)}" alt="${esc(c.name)}" onerror="this.outerHTML='<div class=&quot;art fallback&quot;>${esc(initial)}</div>'">`
    : `<div class="art fallback">${esc(initial)}</div>`;
  const n = act.count || 0;
  const tag = n > 0
    ? `<div class="tagstrip${n >= 5 ? " hot" : ""}">${n} SOLD ${n >= 5 ? "🔥" : ""}</div>`
    : "";
  const supply = c.supply != null ? `<span>${c.supply} ITEMS</span>` : "";
  a.innerHTML = `
    ${art}
    ${tag}
    <div class="label">
      <div class="name"><span class="q">&ldquo;</span>${esc((c.name || c.slug).toUpperCase())}<span class="q">&rdquo;</span></div>
      <div class="cmeta"><span>${chainName(c.chain)}</span>${supply}</div>
    </div>`;
  return a;
}

function renderGrid() {
  const mode = $("#sort").value;
  const { arr, act } = sortCols(mode);
  const grid = $("#grid");
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
      $("#scol").textContent = COLS.length;
      renderGrid();
    } else {
      renderGrid(); // activity may have changed sort
    }
  } catch (e) {
    console.error(e);
    if (first) $("#feed").innerHTML = `<div class="caption" style="text-align:center;padding:40px 0">FEED OFFLINE — RETRYING…</div>`;
  }
}

$("#sort").addEventListener("change", renderGrid);
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
