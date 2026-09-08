const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_NOW_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";
const CACHE_TTL_SECONDS = 30;
const REFRESH_TOKEN_LIFETIME_DAYS = 180; // Spotify: refresh tokens expire 6 months after authorization
const EXPIRING_SOON_THRESHOLD_DAYS = 14;

function getCorsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env?.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
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

  let status = "ok";
  let tokenValid = true;
  let error = null;

  try {
    await getAccessToken(env);
  } catch (err) {
    tokenValid = false;
    error = err.message;
    if (err.code === "REFRESH_TOKEN_EXPIRED") {
      status = "expired";
    } else {
      status = "error";
    }
  }

  if (status === "ok" && daysRemaining !== null && daysRemaining <= EXPIRING_SOON_THRESHOLD_DAYS) {
    status = "expiring_soon";
  }

  const body = { status, tokenValid, daysRemaining, authorizedAt, expiresAt };
  if (error) body.error = error;

  return new Response(JSON.stringify(body), {
    status: status === "ok" ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
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
    if (url.pathname === "/health") {
      return handleHealth(env, corsHeaders);
    }

    // Use Cloudflare cache if available; skip silently on other runtimes
    let cache, cacheKey;
    try {
      cache = caches.default;
      cacheKey = new Request(request.url, request);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // caches API not available in this environment
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
      // REFRESH_TOKEN_EXPIRED is logged distinctly so it's visible in `wrangler tail`
      // even though the public response looks the same as "nothing playing".
      if (err.code === "REFRESH_TOKEN_EXPIRED") {
        console.error("spotify-now-playing: REFRESH_TOKEN_EXPIRED —", err.message);
      } else {
        console.error("spotify-now-playing error:", err.message);
      }
      return jsonResponse({ isPlaying: false }, corsHeaders);
    }
  },
};
