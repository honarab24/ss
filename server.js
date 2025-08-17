// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();

// Base URL of your channel
const BASE_URL =
  "http://143.44.136.110:6610/001/2/ch00000090990000001179/";

// ✅ Proxy everything (manifest + segments)
app.get("/channel/*", async (req, res) => {
  try {
    // Append the requested path after /channel/
    const targetPath = req.params[0]; 
    const targetUrl = BASE_URL + targetPath + (req._parsedUrl.search || ""); 

    console.log("Proxying:", targetUrl);

    // Forward headers including Range for streaming
    const response = await fetch(targetUrl, {
      headers: {
        Range: req.headers.range || "",
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
    });

    // Mirror status and headers
    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Pipe stream to client (VLC or browser)
    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error: " + err.message);
  }
});

app.listen(3000, () => {
  console.log("✅ Proxy server running at http://localhost:3000/channel/");
});
