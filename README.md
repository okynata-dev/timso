# timso

A lacquered, minimal site: one unified live feed of **every timso sale across every
collection**, plus a glassmorphism collections gallery — and the infrastructure for
an automated Twitter/X bot. Runs entirely on a single Cloudflare Worker.

```
public/        static front-end (no build step, no framework)
  index.html   white-cube gallery layout
  styles.css   Off-White × Apple-icon × glassmorphism
  app.js       fetches /api/*, renders the feed + gallery
src/
  index.js     Worker: /api routes + cron handler
  opensea.js   OpenSea API v2 client (sales feed + collection meta)
  config.js    >>> who timso is + the list of collections <<<  (edit me)
  tweets.js    >>> tweet copy + voice <<<  (edit me)
  twitter.js   OAuth1.0a client (inert until creds added)
  collage.js   composites the day's sold works into one image (resvg-wasm)
  cache.js     KV cache with in-memory fallback
wrangler.jsonc  Worker config + cron triggers
```

## How the feed works (important)

The feed is built from **sales inside the collections timso created**, not from
"seller == wallet" (that only catches flips/secondary buys of other people's art).
His art sells as primary mints where the on-chain "seller" is a contract, so the
collection is the right unit. Collections were discovered via OpenSea
`GET /collections?creator_username=...` for the handles `timsouw, invaders_dev,
Bioms, timso_eth`, and live in `src/config.js`. Add/remove slugs there anytime.

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars      # paste your OpenSea key into .dev.vars
npm run dev                          # http://localhost:8787
```

## Deploy to Cloudflare

```bash
npx wrangler login                   # once
npx wrangler secret put OPENSEA_API_KEY   # paste the key (kept out of git)
npm run deploy
```

Then in the Cloudflare dashboard → Workers → `timsouw` → **Settings → Domains &
Routes → Add Custom Domain** to attach your Cloudflare-managed domain.

> Prefer Git auto-deploy? Connect this repo via **Workers & Pages → Create →
> Workers → Connect to Git**, set the build command to `npm run deploy` (or use
> Workers Builds), and add `OPENSEA_API_KEY` as a secret in the dashboard.

### Optional but recommended: persistent cache

Without KV the site uses a short in-isolate cache (fine for launch). For durable
caching + reliable once-a-day tweet dedupe:

```bash
npx wrangler kv namespace create CACHE
```

Paste the returned id into the `kv_namespaces` block in `wrangler.jsonc`
(uncomment it) and redeploy.

## API

| Route | What |
|---|---|
| `GET /api/feed` | unified, time-sorted sales across all collections |
| `GET /api/collections` | collection cards (name, image, supply, chain) |
| `GET /api/stats` | 24h / 7d counts + 24h volume |
| `GET /api/twitter/preview` | exactly what the bot would tweet right now |

## The Twitter bot (wire later)

Infrastructure is built and runs on cron; it stays in **dry-run** until you add
credentials. Strategy (UTC cron in `wrangler.jsonc`):

- **13:00** — good morning #1
- **16:00** — good morning #2
- **21:00** — daily summary, by sale count:
  - **0 sales** → recaps the week (else month): `old collectors got X Ξ ($Y).
    new collectors got N pieces.` + link.
  - **1 sale** → posts that single work.
  - **2+** → composites a collage (resvg-wasm): priciest piece big in the
    top-right, the rest fill an L (left + bottom), scaling up to 36 works.
  - caption carries counts, volume, top sale, and a timsouw.com link.
- every **5 min** — refreshes the cached feed.

Preview the exact text at `/api/twitter/preview`; eyeball a collage at
`/api/twitter/collage?n=8&token=…` (uses today's sales if `n` is omitted).

Voice lives in `src/tweets.js` (Johnny Knoxville × Andy Warhol — dumb-confident,
plain, secretly well-read). Tune the pools, then preview the exact output at
`/api/twitter/preview`.

To go live:

```bash
npx wrangler secret put TWITTER_API_KEY
npx wrangler secret put TWITTER_API_SECRET
npx wrangler secret put TWITTER_ACCESS_TOKEN
npx wrangler secret put TWITTER_ACCESS_SECRET
```

Then set `TWITTER_DRY_RUN` to `"false"` in `wrangler.jsonc` and redeploy. The app
needs **Read + Write** OAuth 1.0a user-context keys from the X developer portal.

## Brand assets

Favicon suite (`favicon.svg/.ico`, `apple-touch-icon`, PWA icons) and the social
share image (`og.png` — wordmark + a strip of real sold works) are pre-rendered
PNGs in `/public`. To regenerate after changing the mark:

```bash
npm i -D @resvg/resvg-js sharp
node scripts/gen-assets.mjs
```

## Performance note

Without KV, each cold request fans out to OpenSea for all collections. Cloudflare
reuses warm isolates and the cron warms the cache every 15 min, so this is fine
for normal traffic — but enabling KV (see above) is recommended for a busy site.

## Security note

The OpenSea API key is stored as a Worker **secret** and is never committed.
Because it was shared in plain text, consider rotating it in the OpenSea
developer dashboard.
