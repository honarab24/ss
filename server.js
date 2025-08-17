import express from "express";
import fetch from "node-fetch";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";

const app = express();

// ✅ Enable security + compression
app.use(helmet());
app.use(compression());
app.use(morgan("tiny"));

// 🔗 Target MPD stream (original source)
const MPD_URL =
  "http://136.239.159.18:6610/001/2/ch00000090990000001093/manifest.mpd?AuthInfo=DvftfiQOMAT%2Fl3VKz%2F6TxorYbnegGQcVSa4v7mOKzojA5L43DLuqa4gGxA71OWYhBl0kLG1MjLMhEVrkZmBvUA%3D%3D&version=v1.0&BreakPoint=0&virtualDomain=001.live_hls.zte.com&programid=ch00000000000000001415&contentid=ch00000000000000001415&videoid=ch00000090990000001179&recommendtype=0&userid=0020230859495&boid=001&stbid=02:00:00:00:00:00&terminalflag=1&profilecode=&usersessionid=526239246&NeedJITP=1&JITPMediaType=DASH&JITPDRMType=Widevine&RateLow=1280000&RateHigh=25600000&IASHttpSessionId=OTT000020240723233153072050&ispcode=55";

// 🔑 ClearKey license values
const clearkey = {
  keys: [
    {
      kty: "oct",
      kid: "MTYyMTg0ODMwMTIwMzkxOA==", // Base64
      k: "OGlONDJNVDR4MWt0VXU0Nw=="   // Base64
    }
  ]
};

// 📺 Proxy MPD stream
app.get("/channel/gma7.mpd", async (req, res) => {
  try {
    const response = await fetch(MPD_URL, {
      headers: {
        "User-Agent": req.get("User-Agent") || "Mozilla/5.0",
        "Accept": "*/*",
        "Connection": "keep-alive",
      },
      timeout: 10000 // 10s timeout
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.text();
    res.setHeader("Content-Type", "application/dash+xml; charset=utf-8");
    res.send(body);

  } catch (err) {
    console.error("❌ Error fetching MPD:", err.message);
    res.status(502).send("Bad Gateway: Failed to fetch MPD stream");
  }
});

// 🔑 Serve ClearKey license
app.get("/license/gma7", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(clearkey);
});

// 🩺 Health check endpoint
app.get("/", (req, res) => {
  res.send("✅ IPTV ClearKey server is running");
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ IPTV ClearKey server running on http://localhost:${PORT}`);
});
