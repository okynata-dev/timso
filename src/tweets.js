// ── Tweet copy + strategy ────────────────────────────────────────────────────
// Voice: Johnny Knoxville × Andy Warhol. Dumb-confident, plain as five kopecks,
// but secretly smart and well-read. Crypto-twitter lowercase. Edit these pools
// freely. Picks are derived from the date (not random) so a given day is
// deterministic — re-runs never post a different line, and the pool cycles so
// nothing repeats for ~2 weeks.

export const GM_MORNING = [
  "gm. i make pictures and the pictures make money. simple.",
  "good morning to everyone except the people who right-click-save and feel nothing",
  "gm. in the future everyone will be a sellout for 15 minutes",
  "woke up, looked good, made art. you should try at least one of those",
  "gm. art is anything you can get away with and i get away with a lot",
  "good morning. the soup can was a flex too, they just didn't know it yet",
  "gm degens. today we mint, tomorrow we museum",
  "rise and grind is fake. rise and post is real. gm",
  "gm. i don't read the charts, i AM the chart",
  "good morning. cheap, fast, and out of control — that's the whole brand",
  "gm. i'm not saying i'm a genius, i'm saying check the secondary",
  "good morning. i paint, you cope, the floor does its little dance",
  "gm. being early is a personality and it's mine",
  "good morning. they'll get it in three years and pay 10x for the privilege",
  "gm. make ugly things confidently, it's basically a business plan",
  "gm. i have no idea what i'm doing and it's worth a fortune",
];

export const GM_SECOND = [
  "second gm of the day because one wasn't enough and neither am i",
  "gm again. checking on my little jpegs like a proud dad at a science fair",
  "afternoon gm for the people who slept in. no judgment. mostly.",
  "gm pt 2. the art doesn't sleep so why should the timeline",
  "reminder: it's still morning somewhere and i'm still the moment. gm",
  "gm to my collectors, my floor, and my one hater who keeps refreshing",
  "double gm. warhol made 60 soup cans, i can say good morning twice",
  "gm. if you bought today you have taste. if you didn't, there's still time. barely.",
  "back with another gm because consistency is the only avant-garde left",
  "gm round two. the jpegs are jpeg-ing and i am vibrating at a high frequency",
  "second sunrise of the brand. gm to the holders and the almost-holders",
  "gm again. i'd touch grass but the grass doesn't appreciate art",
];

// Header lines for the daily summary when sales DID happen.
export const SUMMARY_HEADERS = [
  "today's box score 👇",
  "the receipts. 24 hours of people having taste:",
  "daily damage report:",
  "what left the building in the last 24h:",
  "sold some pictures. here's the tape:",
  "another day, another batch of new owners:",
  "24h of strangers buying my feelings:",
  "the daily flex, sponsored by your impulse control:",
];

// Brand sign-offs rotated into the summary.
export const SIGNOFFS = [
  "made by timso. collect or cope.",
  "timso. cheap, fast, out of control.",
  "you can still be early. barely.",
  "collect or cope. simple as.",
  "more where that came from.",
];

// Ironic lines for days with ZERO sales.
export const NO_SALES = [
  "sold absolutely nothing today. maybe tomorrow lol",
  "zero sales. the art is fine, the timeline is asleep. we ride at dawn",
  "nobody bought anything today. building character. (mine, not yours)",
  "0 sales. even warhol had slow tuesdays probably. gm tomorrow",
  "made no money today and somehow still the moment. wild",
  "nothing sold. consider this a limited-time opportunity to be early. again.",
  "dry day. the floor is shy. respect her boundaries, ape tomorrow",
  "zero. zilch. nada. the pictures are playing hard to get. lol",
  "no sales today, just me and the art staring at each other lovingly",
  "0 for the day. masterpieces are an acquired taste and you're all still acquiring",
];

const SITE = "timsouw.com";
const TWEET_MAX = 278; // leave a little headroom under 280

// Deterministic pick: same (pool, daySeed) -> same line.
export function pick(pool, daySeed = 0, offset = 0) {
  if (!pool.length) return "";
  return pool[Math.abs(daySeed + offset) % pool.length];
}

// Merge ETH + WETH into one Ξ figure; keep other currencies separate.
function moneyLine(sales) {
  const totals = {};
  for (const s of sales) {
    if (!s.symbol || !s.price) continue;
    const sym = /^w?eth$/i.test(s.symbol) ? "Ξ" : s.symbol;
    totals[sym] = (totals[sym] || 0) + s.price;
  }
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([sym, v]) => `${trim(v)} ${sym}`)
    .join(" + ");
}

// Build the daily summary caption from a list of 24h sales.
export function summaryCaption(sales, daySeed = 0) {
  if (!sales.length) return pick(NO_SALES, daySeed);

  const count = sales.length;
  const byColl = {};
  for (const s of sales) byColl[s.collection] = (byColl[s.collection] || 0) + 1;
  const collCount = Object.keys(byColl).length;
  const money = moneyLine(sales);

  const top = [...sales].sort((a, b) => (b.price || 0) - (a.price || 0))[0];
  const piece = count === 1 ? "piece" : "pieces";

  const header = pick(SUMMARY_HEADERS, daySeed);
  const signoff = pick(SIGNOFFS, daySeed);

  // Lines in priority order; trimmed from the bottom if we exceed the limit.
  const stat = `${count} ${piece} gone in 24h` +
    `${collCount > 1 ? ` across ${collCount} collections` : ""}` +
    `${money ? ` · ${money}` : ""}.`;
  const topLine = top && top.price > 0
    ? `top sale: ${top.name} for ${trim(top.price)} ${/^w?eth$/i.test(top.symbol) ? "Ξ" : top.symbol}.`
    : "";

  const required = [header, "", stat];
  const optional = [topLine, "", signoff, SITE];

  let body = [...required, ...optional].filter((l) => l !== "").join("\n");
  // If too long, drop optional lines from the end until it fits.
  const opt = [...optional];
  while (lengthFor(joinLines(required, opt)) > TWEET_MAX && opt.length) opt.pop();
  return joinLines(required, opt);
}

function joinLines(required, optional) {
  return [...required, ...optional].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

// Twitter counts any URL as 23 chars regardless of real length.
function lengthFor(text) {
  return text.replace(/https?:\/\/\S+|[\w-]+\.(com|xyz|art|io|eth)\b\S*/gi, "x".repeat(23)).length;
}

function trim(v) {
  if (v < 0.001) return v.toFixed(4);
  if (v < 1) return v.toFixed(3);
  if (v < 100) return v.toFixed(2);
  return Math.round(v).toLocaleString("en-US");
}

// Day seed: integer day number (UTC) — stable within a calendar day.
export function daySeed(nowSec = Math.floor(Date.now() / 1000)) {
  return Math.floor(nowSec / 86400);
}
