# spotify-now-playing — Cloudflare Worker

A lightweight Cloudflare Worker that proxies the Spotify "Currently Playing" API. Used by [typedbyme.puneeth.io](https://typedbyme.puneeth.io/) to show a live "Now Playing" bar at the top of the page.

Returns a simple JSON response:

```json
{ "isPlaying": true, "track": "Black Hole Sun", "artist": "Soundgarden", "url": "https://open.spotify.com/track/...", "albumArt": "https://...", "album": "Superunknown" }
```

Or `{ "isPlaying": false }` when nothing is playing or on any error.

---

## How it works

1. The Hugo site's client-side JavaScript calls this Worker every 30 seconds
2. The Worker refreshes a Spotify OAuth access token using a stored refresh token
3. Calls `GET /v1/me/player/currently-playing` on the Spotify API
4. Returns normalized JSON with CORS headers locked to the site origin
5. Cloudflare caches the response for 30 seconds to avoid Spotify rate limits

---

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works fine)
- [Node.js](https://nodejs.org/) v18+
- A [Spotify account](https://spotify.com)

---

## Step 1: Create a Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Fill in:
   - **App name**: `now-playing` (or anything you like)
   - **App description**: anything
   - **Redirect URIs**: `http://localhost:8888/callback`
   - **APIs used**: check **Web API**
4. Click **Save**
5. Note your **Client ID** and **Client Secret** (click "View client secret")

---

## Step 2: Get your Refresh Token (one-time OAuth flow)

You only need to do this once. The refresh token doesn't expire unless you revoke it.

### 2a. Authorize your account

Build this URL (replace `YOUR_CLIENT_ID`):

```
https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A8888%2Fcallback&scope=user-read-currently-playing
```

Open it in your browser, log in with Spotify, and click **Agree**.

You'll be redirected to something like:
```
http://localhost:8888/callback?code=AQD...LONG_CODE...
```

Copy that `code` value.

### 2b. Exchange the code for tokens

Run this `curl` command (replace the placeholders):

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code&code=YOUR_CODE&redirect_uri=http://localhost:8888/callback"
```

The response will look like:

```json
{
  "access_token": "BQ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "AQ...",
  "scope": "user-read-currently-playing"
}
```

Save the `refresh_token` — you'll store this as a Worker secret.

---

## Step 3: Install Wrangler and dependencies

```bash
cd workers/spotify-now-playing
npm install
```

Log in to Cloudflare:

```bash
npx wrangler login
```

---

## Step 4: Set secrets

Store your Spotify credentials as Worker secrets (encrypted at rest, never in code):

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
# paste your client ID when prompted

npx wrangler secret put SPOTIFY_CLIENT_SECRET
# paste your client secret when prompted

npx wrangler secret put SPOTIFY_REFRESH_TOKEN
# paste your refresh token when prompted
```

---

## Step 5: Deploy

```bash
npm run deploy
```

Wrangler will output your Worker URL:
```
https://spotify-now-playing.<your-subdomain>.workers.dev
```

---

## Step 6: Test it

While playing something on Spotify:

```bash
curl https://spotify-now-playing.<your-subdomain>.workers.dev
```

Expected response:
```json
{ "isPlaying": true, "track": "Black Hole Sun", "artist": "Soundgarden", "url": "https://open.spotify.com/track/5ZCfVRqMsv3AQ0vF5bRrmF", "albumArt": "https://i.scdn.co/image/...", "album": "Superunknown" }
```

When nothing is playing:
```json
{ "isPlaying": false }
```

---

## Step 7: Connect to the Hugo site

Update `hugo.yml` in the main site repo:

```yaml
params:
  spotifyWorkerUrl: "https://spotify-now-playing.<your-subdomain>.workers.dev"
```

Commit and push. The site will pick up the URL at build time and the "Now Playing" bar will activate.

---

## Local development

Run the Worker locally (against real Spotify secrets):

```bash
npm run dev
# Worker available at http://localhost:8787
```

Note: `wrangler dev` uses a remote preview environment that has access to your secrets. Local-only mode won't have secrets available.

---

## CORS note

The Worker only allows requests from `https://typedbyme.puneeth.io`. If you fork this for your own site, update `ALLOWED_ORIGIN` in `src/index.js` before deploying.

---

## Moving to a standalone repo

This Worker lives in the `typedbyme` repo for now. To extract it:

1. Create a new GitHub repo (e.g., `spotify-now-playing-worker`)
2. Copy the `workers/spotify-now-playing/` contents into the new repo root
3. Re-run `wrangler secret put` for each secret in the new project
4. Deploy from the new repo
5. Delete `workers/` from the `typedbyme` repo

The Worker URL stays the same after extraction.
