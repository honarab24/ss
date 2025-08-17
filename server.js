import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { xsltProcess, xmlParse } from "xslt-processor";

const app = express();
const PORT = process.env.PORT || 3000;

// Load XSLT stylesheet once
const xsltData = fs.readFileSync("./mpd2hls.xsl", "utf8");
const xsltDoc = xmlParse(xsltData);

// Proxy endpoint
app.get("/proxy", async (req, res) => {
  const mpdUrl = req.query.u;
  if (!mpdUrl) {
    return res.status(400).send("Missing ?u=mpd_url");
  }

  try {
    // Fetch MPD XML
    const response = await fetch(mpdUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch MPD: ${response.statusText}`);
    }
    const mpdText = await response.text();

    // Transform MPD -> M3U8 using XSLT
    const mpdDoc = xmlParse(mpdText);
    const m3u8Text = xsltProcess(mpdDoc, xsltDoc, ["run_id", "stream"]);

    res.set("Content-Type", "application/vnd.apple.mpegurl");
    res.send(m3u8Text);
  } catch (err) {
    console.error("Error processing MPD:", err);
    res.status(500).send("Error processing MPD");
  }
});

// Root info
app.get("/", (req, res) => {
  res.send("MPEG-DASH → HLS Proxy is running. Use /proxy?u=MPD_URL");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
