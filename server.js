// server.js
// Generic MPEG-DASH/HLS pass-through proxy optimized for video players.
// - Preserves Range requests for segment streaming
// - Copies safe headers
// - Adds CORS for frontend players
// - Simple rate-limiting, compression
// - Optional short in-memory cache for segments
// - Safe URL parsing and timeouts

import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch"; // v3 ESM
import { pipeline } from "stream";
import { promisify } from "util";
import { URL } from "url";

const app = express();
const streamPipeline = promisify(pipeline);

// config (tune these)
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15_000); // upstream fetch timeout
const SEGMENT_CACHE_ENABLED = process.env.SEGMENT_CACHE === "1";
const SEGMENT_CACHE_TTL_MS = Number(process.env.SEGMENT_CACHE_TTL_MS || 60_000); // 60s
const SEGMENT_CACHE_MAX = Number(process.env.SEGMENT_CACHE_MAX || 1000);

// very small in-memory segment cache (map -> {expires, buffer, headers, status})
let segmentCache;
if (SEGMENT_CACHE_ENABLED) {
  segmentCache = new Map();
  // simple cleanup interval
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of segmentCache) {
      if (v.expires <= now) segmentCache.delete(k);
    }
    // cap size
    if (segmentCache.size > SEGMENT_CACHE_MAX) {
      const keys = Array.from(segmentCache.keys()).slice(0, segmentCache.size - SEGMENT_CACHE_MAX);
      for (const k of keys) segmentCache.delete(k);
    }
  }, Math.max(5_000, Math.floor(SEGMENT_CACHE_TTL_MS / 2)));
}

// Basic hard limits (tune for your infra)
app.set("trust proxy", 1);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300, // 300 req/min/IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(compression());

// Small healthcheck
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Utility: filter hop-by-hop headers
const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function copyHeaders(fromHeaders, res) {
  for (const [k, v] of fromHeaders.entries()) {
    if (!hopByHop.has(k.toLowerCase())) {
      // Some upstreams send array values; Express expects single or arrays via setHeader
      res.setHeader(k, v);
    }
  }
}

// CORS + preflight middleware for /proxy and /base
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Range, Content-Type, Authorization, Accept, Origin, User-Agent"
  );
  res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Build upstream headers (preserve Range, UA, Accept, etc.)
function buildUpstreamHeaders(req) {
  const upstreamHeaders = {};
  const passThrough = [
    "range",
    "user-agent",
    "accept",
    "accept-encoding",
    "accept-language",
    "referer",
    "origin",
    "authorization",
    "cookie", // only if your legal upstream requires it
  ];
  for (const h of passThrough) {
    if (req.headers[h]) upstreamHeaders[h] = req.headers[h];
  }
  return upstreamHeaders;
}

// Validate and normalize target URL
function normalizeTarget(raw) {
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) throw new Error("Invalid protocol");
    return url.toString();
  } catch (err) {
    return null;
  }
}

// Determine whether to cache by content-type
function isCacheableContentType(ct) {
  if (!ct) return false;
  return /video|audio|application\/octet-stream|mp2t|mp4|mpegurl|mpegurl|application\/vnd\.apple\.mpegurl|dash/i.test(
    ct
  );
}

// Core proxy handler used by /proxy and /base/*
async function proxyHandler(targetUrl, req, res) {
  if (!targetUrl) {
    res.status(400).json({ error: "Missing target URL" });
    return;
  }

  const target = normalizeTarget(targetUrl);
  if (!target) {
    res.status(400).json({ error: "Invalid target URL (must be full http/https URL)" });
    return;
  }

  // For caching: use decoded + method + range as cache key
  const cacheKey = `${req.method}:${target}:${req.headers.range || ""}`;

  if (SEGMENT_CACHE_ENABLED && req.method === "GET") {
    const cached = segmentCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      // serve from cache (headers already stored)
      res.status(cached.status);
      for (const [k, v] of Object.entries(cached.headers || {})) {
        res.setHeader(k, v);
      }
      // ensure CORS headers remain present
      res.setHeader("Access-Control-Allow-Origin", "*");
      await streamPipeline(cached.bufferStream(), res);
      return;
    }
  }

  // Setup timeout abort
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const options = {
      method: req.method,
      headers: buildUpstreamHeaders(req),
      redirect: "follow",
      signal: controller.signal,
    };

    // Forward body for POST/PUT/PATCH (pipe request body)
    if (!["GET", "HEAD"].includes(req.method)) {
      options.body = req;
    }

    const upstream = await fetch(target, options);

    // Mirror status & headers
    res.status(upstream.status);
    copyHeaders(upstream.headers, res);

    // Add a safe short cache-control for media segments if not provided (tunable)
    const ct = upstream.headers.get("content-type") || "";
    if (isCacheableContentType(ct) && !res.hasHeader("Cache-Control")) {
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
    }

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    // If caching is enabled and this response is cacheable and small-ish, buffer it then cache
    if (
      SEGMENT_CACHE_ENABLED &&
      req.method === "GET" &&
      upstream.ok &&
      isCacheableContentType(ct)
    ) {
      // Buffer up to a limit (to avoid OOM). We'll cap at ~8 MB here (tunable)
      const MAX_BUFFER_BYTES = Number(process.env.SEGMENT_CACHE_MAX_BYTES || 8 * 1024 * 1024);
      const contentLengthHeader = upstream.headers.get("content-length");
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : NaN;

      if (!isNaN(contentLength) && contentLength > MAX_BUFFER_BYTES) {
        // too big to buffer -> stream directly
        await streamPipeline(upstream.body, res);
        return;
      }

      // Buffer whole response
      const chunks = [];
      let total = 0;
      for await (const chunk of upstream.body) {
        chunks.push(chunk);
        total += chunk.length;
        if (total > MAX_BUFFER_BYTES) {
          // abort caching, stream what we have and pipe remainder
          const buffer = Buffer.concat(chunks);
          // first send buffer to client
          res.write(buffer);
          // then stream the rest directly from upstream (should rarely occur)
          for await (const moreChunk of upstream.body) {
            res.write(moreChunk);
          }
          res.end();
          return;
        }
      }
      const fullBuffer = Buffer.concat(chunks);

      // cache entry with a helper to create a Readable from buffer
      const headersObj = {};
      for (const [k, v] of upstream.headers.entries()) headersObj[k] = v;
      const expires = Date.now() + SEGMENT_CACHE_TTL_MS;
      segmentCache.set(cacheKey, {
        expires,
        status: upstream.status,
        headers: headersObj,
        buffer: fullBuffer,
        bufferStream() {
          // create a readable stream from buffer each time
          const { Readable } = require("stream");
          return Readable.from([this.buffer]);
        },
      });

      // send to client
      res.setHeader("Content-Length", String(fullBuffer.length));
      await streamPipeline(require("stream").Readable.from([fullBuffer]), res);
      return;
    }

    // default: stream upstream body to client
    await streamPipeline(upstream.body, res);
  } catch (err) {
    // handle abort specifically
    if (err.name === "AbortError") {
      console.warn(`Upstream timeout: ${target}`);
      if (!res.headersSent) res.status(504).json({ error: "Upstream timeout" });
      else res.end();
      return;
    }
    console.error("Proxy error:", err);
    if (!res.headersSent) res.status(502).json({ error: "Upstream fetch failed" });
    else res.end();
  } finally {
    clearTimeout(timeout);
  }
}

// /proxy?u=<full-encoded-url>
app.all("/proxy", async (req, res) => {
  const raw = req.query.u;
  if (!raw) {
    res.status(400).json({ error: "Missing ?u=<full URL>" });
    return;
  }
  // allow both encoded and plain
  const target = Array.isArray(raw) ? raw[0] : String(raw);
  await proxyHandler(target, req, res);
});

// Optional: fixed upstream base (for your own origin) with path join
// Usage: set BASE_URL env var to e.g. https://example.com/dash/
// Then GET /base/manifest.mpd -> will proxy https://example.com/dash/manifest.mpd
const BASE_URL = process.env.BASE_URL || "";

app.get("/base/*", async (req, res) => {
  if (!BASE_URL) return res.status(400).json({ error: "BASE_URL not configured" });
  const path = req.params[0] || "";
  // construct full url relative to BASE_URL
  const target = new URL(path, BASE_URL).toString();
  await proxyHandler(target, req, res);
});

// start
app.listen(PORT, () => console.log(`Proxy listening on :${PORT} (pid ${process.pid})`));
