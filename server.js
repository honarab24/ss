import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Proxy route for MPD files
 * Example: /proxy?u=http://143.44.136.110:6610/.../manifest.mpd
 */
app.get("/proxy", async (req, res) => {
  try {
    const targetUrl = req.query.u;
    if (!targetUrl) return res.status(400).send("Missing ?u= parameter");

    const response = await fetch(targetUrl);
    if (!response.ok) return res.status(response.status).send("Source error");

    let body = await response.text();

    // Rewrite BaseURL so segments go through /segment
    body = body.replace(
      /<BaseURL>(.*?)<\/BaseURL>/g,
      (_, url) =>
        `<BaseURL>https://${req.get("host")}/segment?u=${new URL(url, targetUrl).href}</BaseURL>`
    );

    res.setHeader("Content-Type", "application/dash+xml");
    res.send(body);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error");
  }
});

/**
 * Proxy route for media segments (m4s, ts, mp4, etc.)
 * Example: /segment?u=http://143.44.136.110:6610/.../chunk.m4s
 */
app.get("/segment", async (req, res) => {
  try {
    const targetUrl = req.query.u;
    if (!targetUrl) return res.status(400).send("Missing ?u= parameter");

    const response = await fetch(targetUrl);
    if (!response.ok) return res.status(response.status).send("Segment error");

    // Pipe headers
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");

    // Stream the data
    response.body.pipe(res);
  } catch (err) {
    console.error("Segment error:", err);
    res.status(500).send("Segment proxy error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server running on http://localhost:${PORT}`);
});
