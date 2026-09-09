const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_NOW_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";
const CACHE_TTL_SECONDS = 30;
const HEALTH_CACHE_TTL_SECONDS = 60;
const REFRESH_TOKEN_LIFETIME_DAYS = 180; // Spotify: refresh tokens expire 6 months after authorization
const EXPIRING_SOON_THRESHOLD_DAYS = 14;

function getCorsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env?.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Browser-only defense-in-depth for the / (now-playing) route: CORS_ORIGIN
// stops other sites' JS from reading the response, but does nothing against
// a direct curl/script call (CORS is enforced by browsers, not servers). This
// rejects requests with an Origin/Referer that explicitly doesn't match
// CORS_ORIGIN, blocking other sites' browser-based callers — a determined
// caller can still spoof these headers, so this is not real access control,
// only friction. Requests with neither header (curl, some browser privacy
// modes, redirects) are allowed through rather than guessing — this can't be
// used to distinguish "no header" from "a legitimate caller that stripped
// it", and false-positives on real traffic are worse than the friction lost.
// Intentionally NOT applied to /health, which has no browser Origin (it's
// polled by curl from GitHub Actions) and is instead rate-limited by caching.
function isAllowedOrigin(request, env) {
  const allowed = env?.CORS_ORIGIN;
  if (!allowed || allowed === "*") return true; // no restriction configured

  const origin = request.headers.get("Origin");
  if (origin) return origin === allowed;

  const referer = request.headers.get("Referer");
  if (referer) return referer.startsWith(allowed);

  return true; // no Origin or Referer — can't safely distinguish from real traffic
}

function jsonResponse(data, corsHeaders, status = 200, cacheControl = `public, max-age=${CACHE_TTL_SECONDS}`) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      ...corsHeaders,
    },
  });
}

class RefreshTokenExpiredError extends Error {
  constructor() {
    super("Spotify refresh token is invalid or expired (invalid_grant)");
    this.code = "REFRESH_TOKEN_EXPIRED";
  }
}

async function getAccessToken(env) {
  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 400 && body?.error === "invalid_grant") {
      throw new RefreshTokenExpiredError();
    }
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

function getTokenHealth(env) {
  const authorizedAt = env.SPOTIFY_AUTHORIZED_AT ? new Date(env.SPOTIFY_AUTHORIZED_AT) : null;
  if (!authorizedAt || Number.isNaN(authorizedAt.getTime())) {
    return { authorizedAt: null, expiresAt: null, daysRemaining: null };
  }

  const expiresAt = new Date(authorizedAt.getTime());
  expiresAt.setUTCDate(expiresAt.getUTCDate() + REFRESH_TOKEN_LIFETIME_DAYS);

  const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return {
    authorizedAt: env.SPOTIFY_AUTHORIZED_AT,
    expiresAt: expiresAt.toISOString().slice(0, 10),
    daysRemaining,
  };
}

async function handleHealth(env, corsHeaders) {
  const { authorizedAt, expiresAt, daysRemaining } = getTokenHealth(env);

  // status is ground-truth from the actual Spotify call, never overridden by
  // the daysRemaining estimate below — a live invalid_grant always wins.
  let status = "ok";
  let error = null;

  try {
    await getAccessToken(env);
  } catch (err) {
    error = err.message;
    status = err.code === "REFRESH_TOKEN_EXPIRED" ? "expired" : "error";
  }

  if (status === "ok" && daysRemaining !== null && daysRemaining <= EXPIRING_SOON_THRESHOLD_DAYS) {
    status = "expiring_soon";
  }

  const body = { status, tokenValid: !error, daysRemaining, authorizedAt, expiresAt };
  if (error) body.error = error;

  // Cached briefly (unlike a true no-store health check) so /health can't be used to
  // drive unlimited token-refresh calls against Spotify under our client credentials —
  // it's only ever polled by our own weekly GitHub Actions job, so a short TTL costs
  // nothing in practice.
  return jsonResponse(body, corsHeaders, status === "ok" ? 200 : 503, `public, max-age=${HEALTH_CACHE_TTL_SECONDS}`);
}

async function getNowPlaying(accessToken) {
  const response = await fetch(SPOTIFY_NOW_PLAYING_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 204 = nothing playing, 200 = something playing
  if (response.status === 204 || response.status > 200) {
    return { isPlaying: false };
  }

  const data = await response.json();

  // Only handle tracks (not podcasts/episodes)
  if (!data.is_playing || data.currently_playing_type !== "track") {
    return { isPlaying: false };
  }

  const track = data.item;
  const artists = track.artists.map((a) => a.name).join(", ");

  return {
    isPlaying: true,
    track: track.name,
    artist: artists,
    url: track.external_urls.spotify,
    albumArt: track.album.images[1]?.url ?? track.album.images[0]?.url,
    album: track.album.name,
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(env);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Checked before the cache lookup below: the cache key is URL-only (no Origin/
    // Referer), so a disallowed caller hitting the same URL within the cache window
    // would otherwise be served a response cached on behalf of an allowed caller.
    if (url.pathname !== "/health" && !isAllowedOrigin(request, env)) {
      return jsonResponse({ isPlaying: false }, corsHeaders, 403);
    }

    // Use Cloudflare cache if available; skip silently on other runtimes.
    // This also rate-limits /health, which otherwise would let anyone drive
    // unlimited token-refresh calls against Spotify under our credentials.
    let cache, cacheKey;
    try {
      cache = caches.default;
      cacheKey = new Request(request.url, request);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // caches API not available in this environment
    }

    if (url.pathname === "/health") {
      const response = await handleHealth(env, corsHeaders);
      if (cache && cacheKey && ctx?.waitUntil) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    }

    try {
      const accessToken = await getAccessToken(env);
      const nowPlaying = await getNowPlaying(accessToken);
      const response = jsonResponse(nowPlaying, corsHeaders);

      if (cache && cacheKey && ctx?.waitUntil) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    } catch (err) {
      // Fail silently to the poller: return isPlaying: false so the bar just hides.
      // The error code (e.g. REFRESH_TOKEN_EXPIRED) is logged so it's visible in
      // `wrangler tail` even though the public response looks like "nothing playing".
      console.error(`spotify-now-playing error${err.code ? ` [${err.code}]` : ""}:`, err.message);
      return jsonResponse({ isPlaying: false }, corsHeaders);
    }
  },
};
