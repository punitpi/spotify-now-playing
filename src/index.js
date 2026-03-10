const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_NOW_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";
const CACHE_TTL_SECONDS = 30;
const ALLOWED_ORIGIN = "https://typedbyme.puneeth.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      ...corsHeaders,
    },
  });
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
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
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
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // Check Cloudflare cache first
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const accessToken = await getAccessToken(env);
      const nowPlaying = await getNowPlaying(accessToken);
      const response = jsonResponse(nowPlaying);

      // Store in Cloudflare cache
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      // Fail silently: return isPlaying: false so the bar just hides
      console.error("Spotify Worker error:", err.message);
      return jsonResponse({ isPlaying: false });
    }
  },
};
