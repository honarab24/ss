const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { URL } = require("url");
const fetch = require("node-fetch"); // ensure installed for Node <18

const app = express();
const port = process.env.PORT || 3000;

// ✅ Middlewares
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false, // HLS often breaks with CSP
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan("combined")); // logs requests

// ✅ Rate limiting (100 requests / 15 min per IP)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "❌ Too many requests, try again later."
}));

// ✅ IPTV Streams
const streams = {
  gma7: "http://143.44.136.110:6610/001/2/ch00000090990000001093/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2388020250818020007000282&m3u8_level=2&ztecid=ch00000090990000001093&virtualDomain=001.live_hls.zte.com&ispcode=55",
  cinemoph: "http://143.44.136.110:6610/001/2/ch00000090990000001254/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2339620250818035221000307&m3u8_level=2&ztecid=ch00000090990000001254&virtualDomain=001.live_hls.zte.com&ispcode=55",
  kapamilyachannelHD: "http://143.44.136.110:6610/001/2/ch00000090990000001286/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2442320250818031101000309&m3u8_level=2&ztecid=ch00000090990000001286&virtualDomain=001.live_hls.zte.com&ispcode=55",
  gtv: "http://143.44.136.110:6610/001/2/ch00000090990000001143/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2330520250818033205000291&m3u8_level=2&ztecid=ch00000090990000001143&virtualDomain=001.live_hls.zte.com&ispcode=55",
  cinemaoneph: "http://143.44.136.110:6610/001/2/ch00000090990000001283/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2331920250818234551000900&m3u8_level=2&ztecid=ch00000090990000001283&virtualDomain=001.live_hls.zte.com&ispcode=55",
  alltv2: "http://143.44.136.110:6610/001/2/ch00000090990000001179/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2342420250819074524001150&m3u8_level=2&ztecid=ch00000090990000001179&virtualDomain=001.live_hls.zte.com&ispcode=55",
  net25: "http://143.44.136.112:6610/001/2/ch00000090990000001090/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2477320250819074041000881&m3u8_level=2&ztecid=ch00000090990000001090&virtualDomain=001.live_hls.zte.com&ispcode=55",
};


// ✅ Segment cache (with TTL)
const segmentMap = new Map();
const SEGMENT_TTL = 60 * 1000; // 60s
const MAX_SEGMENTS = 5000;

// 🔒 Helper: get stable segment ID
function getSegmentId(url) {
  return Buffer.from(url).toString("base64").replace(/=+$/, "");
}

// 🧹 Prune old/extra segments (run every 30s)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of segmentMap.entries()) {
    if (now - entry.time > SEGMENT_TTL) segmentMap.delete(id);
  }
  while (segmentMap.size > MAX_SEGMENTS) {
    const oldestKey = segmentMap.keys().next().value;
    segmentMap.delete(oldestKey);
  }
}, 30 * 1000);

// 🔄 Fetch with retry + backoff
async function safeFetch(url, options = {}, retries = 2, backoff = 300) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  } catch (err) {
    if (retries > 0) {
      await new Promise(res => setTimeout(res, backoff));
      return safeFetch(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
}

// ✅ Middleware: validate stream key
function validateStream(req, res, next) {
  if (!streams[req.params.stream]) {
    return res.status(404).send("❌ Invalid stream key");
  }
  next();
}

// 🎬 Playlist Proxy
app.get("/:stream/playlist.m3u8", validateStream, async (req, res) => {
  const streamUrl = streams[req.params.stream];
  try {
    const resp = await safeFetch(streamUrl);
    const text = await resp.text();

    const baseUrl = new URL(streamUrl);
    const basePath = baseUrl.href.substring(0, baseUrl.href.lastIndexOf("/") + 1);

    const modified = text.replace(/^(?!#)(.+)$/gm, (line) => {
      line = line.trim();
      if (!line || line.startsWith("#")) return line;
      const fullUrl = new URL(line, basePath).href;
      const id = getSegmentId(fullUrl);
      if (!segmentMap.has(id)) {
        segmentMap.set(id, { url: fullUrl, time: Date.now() });
      }
      return `/segment/${id}.ts`;
    });

    res.set("Content-Type", "application/vnd.apple.mpegurl");
    res.set("Cache-Control", "no-store");
    res.send(modified);
  } catch (e) {
    console.error("Playlist Proxy Error:", e.message);
    res.status(502).send("❌ Proxy error");
  }
});

// 🎥 Segment Proxy
app.get("/segment/:id.ts", async (req, res) => {
  const entry = segmentMap.get(req.params.id);
  if (!entry) return res.status(404).send("❌ Segment not found");

  if (Date.now() - entry.time > SEGMENT_TTL) {
    segmentMap.delete(req.params.id);
    return res.status(410).send("❌ Segment expired");
  }

  try {
    const response = await safeFetch(entry.url);
    res.set("Content-Type", response.headers.get("content-type") || "video/mp2t");
    res.set("Cache-Control", "no-store");
    response.body.pipe(res);
  } catch (e) {
    console.error("Segment Proxy Error:", e.message);
    res.status(502).send("❌ Segment proxy error");
  }
});

// 🚀 Start server
const server = app.listen(port, () => {
  console.log(`✅ IPTV Proxy running at http://localhost:${port}`);
});

// 🛑 Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});
