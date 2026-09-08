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

## Step 2: Get your Refresh Token

> **Refresh tokens now expire after 6 months.** As of Spotify's [June 2026 policy change](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration), refresh tokens issued via this flow expire 6 months after you authorize — not reset by ongoing use — and Spotify enforces this on existing apps as of 2026-07-20. When it expires, the token endpoint returns `400 invalid_grant` and this service silently falls back to `{isPlaying: false}` until you redo this step. See [Re-authorizing](#re-authorizing-every-6-months) below for the recurring procedure, and [Monitoring token expiration](#monitoring-token-expiration) for how this repo reminds you before it lapses.

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

Four variables are required regardless of where you deploy:

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID` | From your Spotify Developer App |
| `SPOTIFY_CLIENT_SECRET` | From your Spotify Developer App |
| `SPOTIFY_REFRESH_TOKEN` | From Step 2 above |
| `SPOTIFY_AUTHORIZED_AT` | Today's date (`YYYY-MM-DD`) — the date you obtained the refresh token above. Used to compute the 6-month expiration for the `/health` check. |

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

#### A1. Install and log in

```bash
npm install
npx wrangler login
# opens a browser to authenticate with your Cloudflare account
```

#### A2. Store Spotify secrets

Wrangler stores secrets encrypted in Cloudflare — they are never in your code or `.env`. You only need to do this once (or when rotating credentials).

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
# paste your client ID when prompted

npx wrangler secret put SPOTIFY_CLIENT_SECRET
# paste your client secret when prompted

npx wrangler secret put SPOTIFY_REFRESH_TOKEN
# paste your refresh token when prompted

npx wrangler secret put CORS_ORIGIN
# optional — paste your site origin, e.g. https://your-site.com
```

To verify the secrets are set:

```bash
npx wrangler secret list
```

`SPOTIFY_AUTHORIZED_AT` is **not** a secret — it's set as a plain variable directly in `wrangler.toml` under `[vars]`, since it's just a date. Edit it in the repo and redeploy whenever you re-authorize (see [Re-authorizing](#re-authorizing-every-6-months) below).

#### A3. Deploy manually

```bash
npm run deploy:cf
```

Wrangler will output your Worker URL:
```
https://spotify-now-playing.<your-subdomain>.workers.dev
```

#### A4. Deploy automatically via GitHub Actions

The repo includes a workflow at `.github/workflows/deploy-cloudflare.yml` that deploys on every push to `main` (and can also be triggered manually from the Actions tab).

You need two GitHub repository secrets — add them at **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → **My Profile → API Tokens → Create Token** — use the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right sidebar on the Workers & Pages overview page |

Once the secrets are set, push to `main` and the workflow deploys automatically. You can also trigger it manually from **Actions → Deploy to Cloudflare Workers → Run workflow**.

> The Spotify secrets (`SPOTIFY_CLIENT_ID`, etc.) are stored directly in Cloudflare via `wrangler secret put` (Step A2) and do not need to be added to GitHub — Wrangler reads them from Cloudflare at deploy time.

#### A5. Local development

Run the Worker locally against your real Cloudflare secrets:

```bash
npm run dev:cf
# available at http://localhost:8787
```

> `wrangler dev` uses a remote preview environment that has access to your Worker's secrets. Fully local mode won't have them.

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
  -e SPOTIFY_AUTHORIZED_AT=2026-09-08 \
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
3. Add the required environment variables (Step 3 above) in **Settings → Environment Variables**
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

## Re-authorizing (every ~6 months)

Spotify refresh tokens expire 6 months after the authorization moment (not reset by ongoing use). Since this app doesn't run any user-facing login flow of its own, re-authorization is a manual, ~5 minute procedure you repeat periodically:

1. **Redo Step 2 above** (Authorize your account → exchange the code for tokens) to get a brand-new `refresh_token`. The `redirect_uri` in both the authorize URL and the token exchange **must exactly match what's registered** in the Spotify Developer Dashboard for this app (Settings → Redirect URIs) — using a different value (even a reasonable-looking one) gets rejected with `INVALID_CLIENT: Invalid redirect URI`. Check the dashboard if you're not sure what's currently registered.
2. **Update the Cloudflare secret**:
   ```bash
   npx wrangler secret put SPOTIFY_REFRESH_TOKEN
   # paste the new refresh token when prompted
   ```
   (For Node/Docker/Vercel deployments, update `SPOTIFY_REFRESH_TOKEN` in `.env` or your host's environment variables instead.)
3. **Update `SPOTIFY_AUTHORIZED_AT`** in `wrangler.toml` (`[vars]` section) to today's date — this resets the 6-month countdown used by the `/health` check.
4. **Redeploy**:
   ```bash
   npm run deploy:cf
   ```
5. **Verify**: hit `/health` on your deployed URL and confirm `"status": "ok"` with a fresh `daysRemaining` (~180).

You'll get a reminder before this is due — see below.

---

## Monitoring token expiration

This service exposes a `/health` endpoint that reports the refresh token's status:

```bash
curl https://your-deployed-url/health
```

```json
{ "status": "ok", "tokenValid": true, "daysRemaining": 172, "authorizedAt": "2026-09-08", "expiresAt": "2027-03-07" }
```

- `status` is one of `"ok"`, `"expiring_soon"` (within 14 days of the 6-month mark), `"expired"` (Spotify returned `invalid_grant`), or `"error"` (some other failure).
- The endpoint actually attempts a token refresh against Spotify, so it reflects ground truth, not just the calendar.
- HTTP status is `200` when `"ok"`, otherwise `503`.

A scheduled GitHub Actions workflow (`.github/workflows/check-spotify-token.yml`) polls this endpoint every **Friday** and, if the status isn't `"ok"`, automatically opens a GitHub Issue in this repo (and fails the workflow run, so you also get GitHub's default failed-workflow email) so re-authorization doesn't get forgotten. It won't file duplicate issues while one is already open.

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
