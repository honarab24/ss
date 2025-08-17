import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// Proxy MPD manifest
app.get("/proxy", async (req, res) => {
  try {
    const targetUrl = req.query.u;
    if (!targetUrl) return res.status(400).send("Missing ?u= parameter");

    const response = await fetch(targetUrl);
    if (!response.ok) return res.status(response.status).send("Source error");

    let body = await response.text();

    // Rewrite <BaseURL> so VLC requests segments through our /segment route
    body = body.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (_, url) => {
      const absUrl = new URL(url, targetUrl).href;
      return `<BaseURL>https://${req.get("host")}/segment?u=${encodeURIComponent(absUrl)}</BaseURL>`;
    });

    // Also rewrite SegmentTemplate (if used instead of BaseURL)
    body = body.replace(/media="([^"]+)"/g, (_, url) => {
      const absUrl = new URL(url, targetUrl).href;
      return `media="https://${req.get("host")}/segment?u=${encodeURIComponent(absUrl)}"`;
    });

    res.setHeader("Content-Type", "application/dash+xml");
    res.send(body);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error");
  }
});

// Proxy media segments
app.get("/segment", async (req, res) => {
  try {
    const targetUrl = req.query.u;
    if (!targetUrl) return res.status(400).send("Missing ?u= parameter");

    const response = await fetch(targetUrl, {
      headers: { "User-Agent": req.get("user-agent") || "VLC" },
    });
    if (!response.ok) return res.status(response.status).send("Segment error");

    // Pass through important headers for VLC
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    if (response.headers.get("accept-ranges")) {
      res.setHeader("Accept-Ranges", response.headers.get("accept-ranges"));
    }
    if (response.headers.get("content-length")) {
      res.setHeader("Content-Length", response.headers.get("content-length"));
    }

    response.body.pipe(res);
  } catch (err) {
    console.error("Segment error:", err);
    res.status(500).send("Segment proxy error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ VLC proxy server running at http://localhost:${PORT}`);
});
