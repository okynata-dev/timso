// ── Twitter / X client ───────────────────────────────────────────────────────
// Full OAuth 1.0a user-context implementation (HMAC-SHA1 via WebCrypto) so the
// bot can post text + media with no third-party dependency.
//
// It stays INERT until all four secrets are present AND TWITTER_DRY_RUN !== "true".
// Until then, postTweet/postWithImage return a {dryRun:true, preview} object so
// you can inspect exactly what *would* be posted (see /api/twitter/preview).

const V2_TWEETS = "https://api.twitter.com/2/tweets";
const V1_MEDIA = "https://upload.twitter.com/1.1/media/upload.json";

export function hasCreds(env) {
  return Boolean(
    env.TWITTER_API_KEY &&
      env.TWITTER_API_SECRET &&
      env.TWITTER_ACCESS_TOKEN &&
      env.TWITTER_ACCESS_SECRET
  );
}

export function isLive(env) {
  return hasCreds(env) && String(env.TWITTER_DRY_RUN).toLowerCase() !== "true";
}

// ── OAuth 1.0a signing ───────────────────────────────────────────────────────
function enc(s) {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function nonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1(key, msg) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// Build the OAuth Authorization header. `params` includes any body params that
// participate in the signature (form-urlencoded bodies do; JSON/multipart don't).
async function authHeader(env, method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: env.TWITTER_API_KEY,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.TWITTER_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}=${enc(all[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(paramStr)}`;
  const signingKey = `${enc(env.TWITTER_API_SECRET)}&${enc(env.TWITTER_ACCESS_SECRET)}`;
  oauth.oauth_signature = await hmacSha1(signingKey, base);
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
      .join(", ")
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

// Upload a raw image (PNG/JPG bytes) and return its media_id string.
export async function uploadMedia(env, bytes, _mime = "image/png") {
  const b64 = base64(bytes);
  const params = { media_data: b64 };
  const header = await authHeader(env, "POST", V1_MEDIA, params);
  const body = new URLSearchParams(params).toString();
  const r = await fetch(V1_MEDIA, {
    method: "POST",
    headers: {
      Authorization: header,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!r.ok) throw new Error(`media upload ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.media_id_string;
}

export async function postTweet(env, text, mediaIds = []) {
  if (!isLive(env)) {
    return { dryRun: true, preview: { text, media: mediaIds.length } };
  }
  const header = await authHeader(env, "POST", V2_TWEETS); // JSON body not signed
  const payload = { text };
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  const r = await fetch(V2_TWEETS, {
    method: "POST",
    headers: { Authorization: header, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`tweet ${r.status}: ${await r.text()}`);
  return { dryRun: false, result: await r.json() };
}

// Convenience: post text with an optional PNG collage (Uint8Array | null).
export async function postWithImage(env, text, pngBytes) {
  if (!isLive(env)) {
    return { dryRun: true, preview: { text, media: pngBytes ? 1 : 0 } };
  }
  let mediaIds = [];
  if (pngBytes && pngBytes.length) {
    try {
      const id = await uploadMedia(env, pngBytes);
      mediaIds = [id];
    } catch (e) {
      // If media fails, still post the text — never lose the tweet.
      console.error("media upload failed, posting text-only:", e.message);
    }
  }
  return postTweet(env, text, mediaIds);
}

function base64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
