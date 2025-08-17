// server.js
// Generic MPEG-DASH/HLS pass-through proxy optimized for video players
// Supports: Range, CORS, Compression, Rate-limiting, DASH/HLS segments

import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch"; // if Node >=18, you can remove this and use built-in fetch
import { pipeline } from "stream";
import { promisify } from "util";
import { URL } from "url";

const app = express();
const streamPipeline = promisify(pipeline);

// config
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 15000; // 15s timeout for upstream fetch

// Your fixed MPD link to restream
const FIXED_MPD =
  "http://143.44.136.110:6610/001/2/ch00000090990000001179/manifest.mpd?virtualDomain=001.live_hls.zte.com";

// Basic limits
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

// Healthcheck
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Hop-by-hop headers to strip
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
      res.setHeader(k, v);
    }
  }
}

// Build upstream headers (preserve common ones)
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
    "cookie",
  ];
  for (const h of passThrough) {
    if (req.headers[h]) upstreamHeaders[h] = req.headers[h];
  }
  return upstreamHeaders;
}

// Core proxy function
async function proxyHandler(target, req, res) {
  if (!target) return res.status(400).json({ error: "Missing target URL" });

  try {
    // abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const options = {
      method: req.method,
      headers: buildUpstreamHeaders(req),
      redirect: "follow",
      signal: controller.signal,
    };
    if (!["GET", "HEAD"].includes(req.method)) {
      options.body = req;
    }

    const upstream = await fetch(target, options);

    // CORS
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

    res.status(upstream.status);
    copyHeaders(upstream.headers, res);

    // Add caching for segments
    const ct = upstream.headers.get("content-type") || "";
    if (/video|audio|application\/octet-stream|mp2t|mp4|dash|mpegurl/i.test(ct)) {
      if (!res.hasHeader("Cache-Control")) {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
      }
    }

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    await streamPipeline(upstream.body, res);
    clearTimeout(timeout);
  } catch (err) {
    console.error("Proxy error:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Upstream fetch failed" });
    } else {
      res.end();
    }
  }
}

// 🔹 Dynamic proxy: /proxy?u=<full-URL>
app.all("/proxy", async (req, res) => {
  const raw = req.query.u;
  if (!raw) return res.status(400).json({ error: "Missing ?u=<full URL>" });
  const target = Array.isArray(raw) ? raw[0] : String(raw);
  await proxyHandler(target, req, res);
});

// 🔹 Fixed channel (your MPD): /channel
app.all("/channel", async (req, res) => {
  await proxyHandler(FIXED_MPD, req, res);
});

// start
app.listen(PORT, () => console.log(`Proxy listening on :${PORT}`));
