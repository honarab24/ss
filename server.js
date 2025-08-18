const express = require("express");
const request = require("request");
const cors = require("cors");
const { URL } = require("url");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// ✅ Keep real IPTV URLs ONLY on the server
const streams = {
  gma7: "http://143.44.136.110:6610/001/2/ch00000090990000001093/sec-f1-v1-a1.m3u8?...",
  cinemo_ph: "http://143.44.136.110:6610/001/2/ch00000090990000001254/sec-f1-v1-a1.m3u8?...",
  kapamilyachannelHD: "http://143.44.136.110:6610/001/2/ch00000090990000001286/sec-f1-v1-a1.m3u8?...",
  gtv: "http://143.44.136.110:6610/001/2/ch00000090990000001143/sec-f1-v1-a1.m3u8?...",
};

// 🔒 Temporary segment map (ID → real URL)
const segmentMap = new Map();

// 🎬 Playlist Proxy (hide origin URL)
app.get("/:stream/playlist.m3u8", (req, res) => {
  const key = req.params.stream;
  const streamUrl = streams[key];
  if (!streamUrl) return res.status(404).send("❌ Invalid stream key");

  const baseUrl = new URL(streamUrl);
  const basePath = baseUrl.href.substring(0, baseUrl.href.lastIndexOf("/") + 1);

  request.get(streamUrl, (err, response, body) => {
    if (err || response.statusCode !== 200) {
      return res.status(502).send("❌ Failed to fetch playlist");
    }

    // Rewrite playlist so client only sees /segment/xxxx.ts
    const modified = body.replace(/^(?!#)(.+)$/gm, (line) => {
      line = line.trim();
      if (!line || line.startsWith("#")) return line;

      const fullUrl = new URL(line, basePath).href;

      // generate short random ID
      const id = Math.random().toString(36).substring(2, 12);
      segmentMap.set(id, fullUrl);

      // cleanup after 60 seconds (optional)
      setTimeout(() => segmentMap.delete(id), 60 * 1000);

      return `/segment/${id}.ts`;
    });

    res.set("Content-Type", "application/vnd.apple.mpegurl");
    res.send(modified);
  });
});

// 🎥 Segment Proxy (using hidden ID)
app.get("/segment/:id.ts", (req, res) => {
  const segmentUrl = segmentMap.get(req.params.id);
  if (!segmentUrl) return res.status(404).send("❌ Segment not found");

  request
    .get(segmentUrl)
    .on("response", (r) => res.set(r.headers))
    .on("error", () => res.status(502).send("❌ Segment failed"))
    .pipe(res);
});

// 🚀 Start server
app.listen(port, () => {
  console.log(`✅ IPTV Proxy running at http://localhost:${port}`);
});
