/**
 * Node.js HTTP adapter for spotify-now-playing.
 * Use this to run the service on any Node.js host, container, or VPS.
 *
 * Usage:
 *   node src/server.js
 *
 * Required environment variables (set in .env or your host's config):
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN
 *
 * Optional:
 *   CORS_ORIGIN  – allowed origin, defaults to * (all origins)
 *   PORT         – port to listen on, defaults to 3000
 */

import { createServer } from "node:http";
import handler from "./index.js";

const PORT = process.env.PORT || 3000;

const env = {
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
};

const server = createServer(async (req, res) => {
  const url = `http://${req.headers.host}${req.url}`;
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
  });

  const response = await handler.fetch(request, env, {});

  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});

server.listen(PORT, () => {
  console.log(`spotify-now-playing listening on http://localhost:${PORT}`);
});
