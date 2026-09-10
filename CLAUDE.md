# spotify-now-playing

Cloudflare Worker proxying Spotify's "currently playing" API for a personal portfolio widget. Zero-dependency vanilla JS (`src/index.js`), no build step. `src/server.js` wraps the same handler for Node/Docker/Vercel.

## Repo quirks
- `node_modules/` is committed to git despite being gitignored (force-added historically) — don't be surprised by it, and don't try to "fix" this as a drive-by; it's out of scope unless asked.
- The committed `node_modules/.bin/wrangler` sometimes lacks the executable bit or is built for the wrong platform (seen: Windows binaries on a macOS checkout). Fix locally with `chmod +x node_modules/.bin/wrangler`, or `rm -rf node_modules && npm install` for a full platform-correct reinstall — don't commit either fix, it's a local-checkout issue, not a repo one.
- No test/lint/typecheck scripts exist. Verify changes with `node --check src/index.js` (syntax) and by mocking `fetch` in a scratch copy of `src/index.js` (see git history for the pattern) — real behavioral testing needs the actual deployed Worker via `curl`.
- `caches.default` (Cloudflare's edge cache API) only works in the real Workers runtime — throws in plain Node, so it's wrapped in try/catch in the handler and can't be exercised by local Node tests.
- No Cloudflare API credentials are available in this dev environment — `wrangler dev`/`wrangler deploy` won't authenticate here. Deploys happen via `.github/workflows/deploy-cloudflare.yml` on push to `main`, scoped by a `paths:` filter to `src/**`, `wrangler.toml`, `package*.json`, and the workflow file itself (docs-only changes don't trigger a deploy).

## This deployment's actual values
- Deployed Worker: `https://spotify.api.puneeth.io`
- Spotify Client ID: `f125f8626d094836a5f1f4099103776d` (public by OAuth design, safe to reference)
- Registered Spotify redirect URI: `https://api.puneeth.io/callback`
- Consuming site (`CORS_ORIGIN`): `https://typedbyme.puneeth.io` — the only origin allowed to call `/`
- Refresh tokens expire 6 months after authorization (Spotify policy, 2026-07-20 enforcement) — re-auth procedure is documented in README.md "Re-authorizing"; `/health` endpoint + weekly GitHub Actions job track this.
