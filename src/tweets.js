// ── Tweet copy + strategy ────────────────────────────────────────────────────
// Voice: Johnny Knoxville × Andy Warhol. Dumb-confident, plain as five kopecks,
// but secretly smart and well-read. Crypto-twitter lowercase. Edit these pools
// freely — the bot picks from them. (Index is derived from the date, not random,
// so the same day is deterministic and re-runs don't double-post different lines.)

export const GM_MORNING = [
  "gm. i make pictures and the pictures make money. simple.",
  "good morning to everyone except the people who right-click-save and feel something",
  "gm. in the future everyone will be a sellout for 15 minutes",
  "woke up, looked good, made art. you should try at least one of those",
  "gm. art is anything you can get away with and i get away with a lot",
  "good morning. the soup can was a flex too, they just didn't know it yet",
  "gm degens. today we mint, tomorrow we museum",
  "rise and grind is fake. rise and post is real. gm",
  "gm. i don't read the charts i AM the chart",
  "good morning. cheap, fast, and out of control — that's the brand",
];

export const GM_SECOND = [
  "second gm of the day because one wasn't enough and neither am i",
  "gm again. checking on my little jpegs like a proud dad at a science fair",
  "afternoon gm for the people who slept in, no judgment, mostly",
  "gm pt 2. the art doesn't sleep so why should the timeline",
  "reminder: it's still morning somewhere and i'm still the moment. gm",
  "gm to my collectors, my floor, and my one hater who keeps refreshing",
  "double gm. warhol made 60 soup cans, i can say good morning twice",
  "gm. if you bought today you have taste. if you didn't there's still time. barely",
];

// Caption header lines for the daily summary when sales DID happen.
export const SUMMARY_HEADERS = [
  "today's box score 👇",
  "the receipts. 24 hours of people having taste:",
  "daily damage report:",
  "what left the building in the last 24h:",
  "sold some pictures. here's the tape:",
  "another day another batch of new owners. the numbers:",
];

// Ironic lines for days with ZERO sales.
export const NO_SALES = [
  "sold absolutely nothing today. maybe tomorrow lol",
  "zero sales. the art is fine, the timeline is asleep. we ride at dawn",
  "nobody bought anything today. building character. (mine, not yours)",
  "0 sales. even warhol had slow tuesdays probably. gm tomorrow",
  "made no money today and somehow still the moment. wild",
  "nothing sold. consider this a limited-time opportunity to be early. again",
  "dry day. the floor is shy. respect her boundaries, ape tomorrow",
  "zero. zilch. nada. the pictures are playing hard to get. lol",
];

// Deterministic pick: same (pool, daySeed) -> same line.
export function pick(pool, daySeed = 0, offset = 0) {
  if (!pool.length) return "";
  const i = (Math.abs(daySeed + offset) % pool.length);
  return pool[i];
}

// Build the daily summary caption from a list of sales (already filtered to 24h).
export function summaryCaption(sales, daySeed = 0) {
  if (!sales.length) return pick(NO_SALES, daySeed);

  const count = sales.length;
  // Total per currency symbol.
  const totals = {};
  const byColl = {};
  for (const s of sales) {
    if (s.symbol) totals[s.symbol] = (totals[s.symbol] || 0) + s.price;
    byColl[s.collection] = (byColl[s.collection] || 0) + 1;
  }
  const money = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([sym, v]) => `${trim(v)} ${sym}`)
    .join(" + ");

  const collCount = Object.keys(byColl).length;
  const topColls = Object.entries(byColl)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, n]) => `${prettyColl(c)} (${n})`)
    .join(", ");

  const header = pick(SUMMARY_HEADERS, daySeed);
  const piece = count === 1 ? "piece" : "pieces";
  const lines = [
    header,
    "",
    `${count} ${piece} sold across ${collCount} collection${collCount === 1 ? "" : "s"}${money ? ` for ${money}` : ""}.`,
    topColls ? `heaviest: ${topColls}.` : "",
    "",
    "made by timso. collect or cope.",
  ].filter(Boolean);
  return lines.join("\n");
}

function trim(v) {
  if (v < 0.001) return v.toFixed(4);
  if (v < 1) return v.toFixed(3);
  return v.toFixed(2);
}

function prettyColl(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Day seed: integer day number (UTC) — stable within a calendar day.
export function daySeed(nowSec = Math.floor(Date.now() / 1000)) {
  return Math.floor(nowSec / 86400);
}
