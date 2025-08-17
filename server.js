https://starofvenus.dpdns.org/proxy?u=http://143.44.136.110:6610/001/2/ch00000090990000001179/manifest.mpd?virtualDomain=001.live_hls.zte.com

// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();

const BASE_URL = "http://143.44.136.110:6610/001/2/ch00000090990000001179/manifest.mpd?virtualDomain=001.live_hls.zte.com";

// Proxy everything after /channel/*
app.get("/channel/*", async (req, res) => {
  const targetUrl = BASE_URL + req.params[0]; // e.g. manifest.mpd, seg.m4s
  try {
    const response = await fetch(targetUrl, {
      headers: { Range: req.headers.range || "" },
    });
    res.status(response.status);
    response.body.pipe(res);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
