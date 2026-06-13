// ── timso — static config ────────────────────────────────────────────────────
// Everything the app knows about "who is timso" lives here. Edit freely.

export const ARTIST = {
  name: "timso",
  // OpenSea usernames that map to the creator (used for reference / links).
  handles: ["timsouw", "invaders_dev", "Bioms", "timso_eth"],
  // Wallets the artist sells from (reference only — the feed is collection-driven).
  wallets: [
    "0xaa6627b5770aa4806238e3545bc1159e087438b4",
    "0x5aea201ad3b543f9b8f90d56b9d9f4dd265b602a",
    "0x01278f503ed332024fdf9521ffac0de13b101737",
    "0x014c2b84bce4f4ec280c8d91d9f6a9eb46063daf",
  ],
  twitter: "timso", // display handle; update to the real @
};

// Collections timso created (OpenSea slugs). The unified sales feed is the union
// of sales across ALL of these. Discovered via:
//   GET /api/v2/collections?creator_username={handle}
// Add or remove slugs here — the gallery and feed update automatically.
export const COLLECTIONS = [
  "bioms",
  "samepunks",
  "invadrrs",
  "crawlingpunks",
  "pnuks-1",
  "chadgy-penguins",
  "basedabsurds",
  "based-timso",
  "dumbsters",
  "balz",
  "showyourseed",
  "cards-of-culture",
  "merrybasemas",
  "invaders-ticket",
  "free-mint-art-pfp-nft",
  "base-squiggles",
  "memsries",
  "tangled-tapestries",
  "ticker-is",
  "brainless-renaissance",
  "based-1-1-s-by-timso",
  "circletopia",
  "comopepenosition",
  "pp-93",
  "opepepen-2",
  "hue-4",
  "transcendent-palette",
  "topology-3",
  "dimension-18",
  "tornado-and-balloon",
  "skulls-of-bull",
  "strings-3",
  "vortex-path",
  "dawn-of-spin",
  "rodeo-posts-7179",
  "erc-memes-1155",
  "erc-timso-1155",
  "erc-timso-721",
];

// How many sale events to pull per collection on each refresh.
export const SALES_PER_COLLECTION = 50;
// Size of the unified feed returned to the client.
export const FEED_SIZE = 120;
// Cache TTLs (seconds). Kept ABOVE the cron interval so the shared KV cache stays
// continuously warm — requests read KV instead of fanning out to OpenSea.
export const TTL = { feed: 900, collections: 7200, lastgood: 172800 };
