import express from "express";
import fetch from "node-fetch";
import xsltProcessor from "xslt-processor";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// Load the XSL stylesheet you pasted
const xsltString = fs.readFileSync("mpd2hls.xsl", "utf8");

app.get("/proxy.m3u8", async (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).send("Missing ?u=");

  try {
    // Fetch original MPD
    const mpdResponse = await fetch(url);
    const mpdXml = await mpdResponse.text();

    // Transform MPD → M3U8 using XSL
    const m3u8 = xsltProcessor.xsltProcess(
      xsltProcessor.xmlParse(mpdXml),
      xsltProcessor.xmlParse(xsltString)
    );

    res.type("application/vnd.apple.mpegurl");
    res.send(m3u8);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error converting MPD to M3U8");
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
