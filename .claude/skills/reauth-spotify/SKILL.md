---
name: reauth-spotify
description: Walk through re-authorizing this app's Spotify refresh token (required every ~6 months per Spotify's token expiration policy) and redeploying. Invoke with /reauth-spotify.
disable-model-invocation: true
---

# Re-authorize Spotify refresh token

Spotify refresh tokens expire 6 months after authorization (not reset by ongoing use). This
service has no user-facing login flow, so re-authorization is a manual procedure repeated every
~6 months. Full context and the source-of-truth steps live in README.md's "Re-authorizing"
section — this skill just walks through executing them.

This app's registered values (from README.md):
- Client ID: `f125f8626d094836a5f1f4099103776d`
- Redirect URI: `https://api.puneeth.io/callback` (must match exactly what's registered in the
  [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → this app → Settings →
  Redirect URIs)
- Deployed Worker: `https://spotify.api.puneeth.io`

## Steps

1. **Authorize.** Give the user this URL to open in their browser, log in with the Spotify account
   this service should track, and click Agree:
   ```
   https://accounts.spotify.com/authorize?client_id=f125f8626d094836a5f1f4099103776d&response_type=code&redirect_uri=https%3A%2F%2Fapi.puneeth.io%2Fcallback&scope=user-read-currently-playing
   ```
   They'll be redirected to `https://api.puneeth.io/callback?code=...` — nothing listens there, so
   an error/404 page is expected. Ask them to copy the `code=` value out of the address bar.

2. **Exchange the code for a refresh token.** The client secret must not be pasted into chat —
   have the user run this themselves, or run it with them providing the secret directly to the
   command:
   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -u "f125f8626d094836a5f1f4099103776d:YOUR_CLIENT_SECRET" \
     -d "grant_type=authorization_code&code=YOUR_CODE&redirect_uri=https://api.puneeth.io/callback"
   ```
   The code is single-use and expires in a few minutes — run this promptly. Copy `refresh_token`
   from the JSON response.

3. **Update the Cloudflare secret.** Same rule — don't have the refresh token pass through chat.
   Have the user run this themselves and paste the value directly into wrangler's prompt:
   ```bash
   npx wrangler secret put SPOTIFY_REFRESH_TOKEN
   ```
   If `node_modules/.bin/wrangler` lacks the executable bit (a known repo quirk, see CLAUDE.md),
   run `chmod +x node_modules/.bin/wrangler` first.

4. **Update the authorization date.** Edit `SPOTIFY_AUTHORIZED_AT` in `wrangler.toml` (`[vars]`
   section) to today's date (`YYYY-MM-DD`). This resets the 6-month countdown the `/health`
   endpoint uses.

5. **Commit, push, and redeploy.** `wrangler.toml` is in the deploy workflow's `paths:` filter, so
   pushing to `main` (or merging a PR into it) triggers `.github/workflows/deploy-cloudflare.yml`
   automatically. Follow this repo's normal branch/PR convention rather than pushing straight to
   `main`, unless the user says otherwise.

6. **Verify.**
   ```bash
   curl https://spotify.api.puneeth.io/health
   ```
   Confirm `"status": "ok"` with `daysRemaining` reset to ~180. Also spot-check the actual widget
   at `https://typedbyme.puneeth.io` still renders correctly.

## Notes

- Never let the client secret or refresh token appear in the conversation — both steps that need
  them should be run by the user directly, consistent with how this was originally done (see git
  history for this repo's first re-authorization, September 2026).
- If the README's "Re-authorizing" section has since changed, treat it as the source of truth over
  this skill and flag the drift.
