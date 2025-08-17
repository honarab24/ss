// server.js
// Generic MPEG-DASH/HLS pass-through proxy for legally owned/authorized content.
// - Preserves Range requests for segment streaming
// - Copies safe headers
// - Adds CORS for your frontend
// - Simple rate-limiting & compression
// - Works with any full URL passed via ?u=... (MPD, M3U8, segments, keys if YOUR service exposes them)

import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch"; // v3 ESM
import { pipeline } from "stream";
import { promisify } from "util";

const app = express();
const streamPipeline = promisify(pipeline);

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

function copyHeaders(from, to) {
  for (const [k, v] of from.entries()) {
    if (!hopByHop.has(k.toLowerCase())) {
      to.setHeader(k, v);
    }
  }
}

// Main proxy endpoint: /proxy?u=<FULL_ENCODED_URL>
app.all("/proxy", async (req, res) => {
  const target = req.query.u;
  if (!target || typeof target !== "string") {
    return res.status(400).json({ error: "Missing ?u=<full URL>" });
  }
  // Only allow http/https
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).json({ error: "Only http/https URLs supported" });
  }

  try {
    // Build upstream headers (preserve Range, UA, Accept, etc.)
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

    // Fetch options
    const options = {
      method: req.method,
      headers: upstreamHeaders,
      redirect: "follow",
    };

    // Forward body for POST/PUT/PATCH
    if (!["GET", "HEAD"].includes(req.method)) {
      options.body = req;
    }

    const upstream = await fetch(target, options);

    // Set CORS for your web player/app
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Authorization, Accept");
    res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
    res.setHeader("Vary", "Origin");

    // Preflight
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    // Mirror status & headers
    res.status(upstream.status);
    copyHeaders(upstream.headers, res);

    // Optional: light caching for segments (tune as needed)
    const ct = upstream.headers.get("content-type") || "";
    if (/video|audio|application\/octet-stream|mp2t|mp4|dash|mssegment|mpegurl/i.test(ct)) {
      // Short segment cache to reduce upstream load (ensure allowed by your rights)
      if (!res.hasHeader("Cache-Control")) {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
      }
    }

    // HEAD requests: no body
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    // Stream body to client
    await streamPipeline(upstream.body, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Upstream fetch failed" });
    } else {
      res.end();
    }
  }
});

// Optional: fixed upstream base (for your own origin) with path join
// Example usage:
//   BASE_URL=https://example.com/dash  -> GET /base/manifest.mpd
const BASE_URL = process.env.BASE_URL || "";
import { URL } from "http://136.239.159.18:6610/001/2/ch00000090990000001093/manifest.mpd?AuthInfo=DvftfiQOMAT%2Fl3VKz%2F6TxorYbnegGQcVSa4v7mOKzojA5L43DLuqa4gGxA71OWYhBl0kLG1MjLMhEVrkZmBvUA%3D%3D&version=v1.0&BreakPoint=0&virtualDomain=001.live_hls.zte.com&programid=ch00000000000000001415&contentid=ch00000000000000001415&videoid=ch00000090990000001179&recommendtype=0&userid=0020230859495&boid=001&stbid=02:00:00:00:00:00&terminalflag=1&profilecode=&usersessionid=526239246&NeedJITP=1&JITPMediaType=DASH&JITPDRMType=Widevine&RateLow=1280000&RateHigh=25600000&IASHttpSessionId=OTT000020240723233153072050&ispcode=55";

app.get("/base/*", async (req, res) => {
  if (!BASE_URL) return res.status(400).json({ error: "BASE_URL not configured" });
  const path = req.params[0] || "";
  const target = new URL(path, BASE_URL).toString();
  req.url = `/proxy?u=${encodeURIComponent(target)}`;
  app._router.handle(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on :${PORT}`));
