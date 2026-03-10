# spotify-now-playing

A lightweight service that proxies the Spotify "Currently Playing" API. Drop it anywhere — Cloudflare Workers, a Node.js server, Docker, Vercel, or any other platform — to expose a simple JSON endpoint your site can poll.

## Response format

```json
{ "isPlaying": true, "track": "Black Hole Sun", "artist": "Soundgarden", "url": "https://open.spotify.com/track/...", "albumArt": "https://...", "album": "Superunknown" }
```

Or `{ "isPlaying": false }` when nothing is playing or on any error.

---

## How it works

1. Your site's client-side JavaScript calls this service (e.g. every 30 seconds)
2. The service refreshes a Spotify OAuth access token using a stored refresh token
3. Calls `GET /v1/me/player/currently-playing` on the Spotify API
4. Returns normalized JSON with CORS headers
5. On Cloudflare Workers, responses are cached for 30 seconds to avoid rate limits

---

## Step 1: Create a Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Fill in:
   - **App name**: `now-playing` (or anything you like)
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

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code&code=YOUR_CODE&redirect_uri=http://localhost:8888/callback"
```

From the response, save the `refresh_token` — you'll need it in the next step.

---

## Step 3: Configure environment variables

Three variables are required regardless of where you deploy:

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID` | From your Spotify Developer App |
| `SPOTIFY_CLIENT_SECRET` | From your Spotify Developer App |
| `SPOTIFY_REFRESH_TOKEN` | From Step 2 above |

One optional variable:

| Variable | Description | Default |
|---|---|---|
| `CORS_ORIGIN` | Allowed origin for CORS (e.g. `https://your-site.com`) | `*` (all origins) |

Copy `.env.example` to `.env` for local runs:

```bash
cp .env.example .env
# fill in your values
```

---

## Deployment

### Option A — Cloudflare Workers

Requires [Node.js](https://nodejs.org/) v18+ and a [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works fine).

```bash
npm install
npx wrangler login
```

Store secrets (encrypted, never in code):

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REFRESH_TOKEN
npx wrangler secret put CORS_ORIGIN   # optional
```

Deploy:

```bash
npm run deploy:cf
```

Wrangler will output your Worker URL:
```
https://spotify-now-playing.<your-subdomain>.workers.dev
```

Local development against real secrets:

```bash
npm run dev:cf
# available at http://localhost:8787
```

---

### Option B — Node.js server

Requires Node.js v18+.

```bash
npm install
cp .env.example .env   # fill in your values
npm start
# listening on http://localhost:3000
```

Watch mode for development:

```bash
npm run dev
```

Set `PORT` in `.env` or your environment to change the port.

---

### Option C — Docker

```bash
docker build -t spotify-now-playing .
docker run -p 3000:3000 \
  -e SPOTIFY_CLIENT_ID=your_id \
  -e SPOTIFY_CLIENT_SECRET=your_secret \
  -e SPOTIFY_REFRESH_TOKEN=your_token \
  -e CORS_ORIGIN=https://your-site.com \
  spotify-now-playing
```

Or with a `.env` file:

```bash
docker run -p 3000:3000 --env-file .env spotify-now-playing
```

---

### Option D — Vercel

1. Push this repo to GitHub
2. Import it in the [Vercel dashboard](https://vercel.com/new)
3. Add the four environment variables in **Settings → Environment Variables**
4. Deploy — Vercel will use the `start` script automatically

For Edge Functions / serverless, export `src/index.js` as a Vercel Edge Function by creating `api/index.js`:

```js
export { default } from "../src/index.js";
export const config = { runtime: "edge" };
```

---

### Option E — Any platform supporting Node.js

Set the required environment variables and run:

```bash
npm start
```

The service listens on `PORT` (default `3000`).

---

## Testing

While playing something on Spotify, hit your endpoint:

```bash
curl http://localhost:3000
```

Expected:
```json
{ "isPlaying": true, "track": "Black Hole Sun", "artist": "Soundgarden", "url": "https://open.spotify.com/track/5ZCfVRqMsv3AQ0vF5bRrmF", "albumArt": "https://i.scdn.co/image/...", "album": "Superunknown" }
```

When nothing is playing:
```json
{ "isPlaying": false }
```

---

## Connect to your site

Point your site's config at the deployed URL. For example in a Hugo `hugo.yml`:

```yaml
params:
  spotifyNowPlayingUrl: "https://your-deployed-url"
```

Then poll it from client-side JavaScript every 30 seconds.

---

## CORS

`CORS_ORIGIN` controls which origins can call the endpoint. Set it to your site's origin to lock it down:

```
CORS_ORIGIN=https://your-site.com
```

Leave it unset to allow all origins (`*`), which is fine for private deploys.
