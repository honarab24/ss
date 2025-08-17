// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();

/**
 * Generic proxy for MPD + all segments
 * Usage:
 *   https://your-app.onrender.com/proxy?u=<full-mpd-url>
 */
app.get("/proxy", async (req, res) => {
  try {
    const targetUrl = req.query.u;
    if (!targetUrl) {
      return res.status(400).send("Missing ?u=<url>");
    }

    console.log("Proxying:", targetUrl);

    const response = await fetch(targetUrl, {
      headers: {
        Range: req.headers.range || "",
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Stream back
    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error: " + err.message);
  }
});

/**
 * Catch-all proxy for segments when using relative paths
 * Example: MPD refers to "chunk.m4s" → this will resolve and fetch it
 */
app.get("/segment", async (req, res) => {
  try {
    const targetUrl = req.query.u;
    if (!targetUrl) {
      return res.status(400).send("Missing ?u=<url>");
    }

    console.log("Proxying segment:", targetUrl);

    const response = await fetch(targetUrl, {
      headers: {
        Range: req.headers.range || "",
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    response.body.pipe(res);
  } catch (err) {
    console.error("Segment proxy error:", err);
    res.status(500).send("Segment proxy error: " + err.message);
  }
});

app.listen(3000, () => {
  console.log("✅ Proxy server running at http://localhost:3000/proxy?u=<url>");
});
