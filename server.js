import express from "express";
import fetch from "node-fetch";

const app = express();

// Your target MPD stream (original source)
const MPD_URL = "http://136.239.159.18:6610/001/2/ch00000090990000001093/manifest.mpd?AuthInfo=DvftfiQOMAT%2Fl3VKz%2F6TxorYbnegGQcVSa4v7mOKzojA5L43DLuqa4gGxA71OWYhBl0kLG1MjLMhEVrkZmBvUA%3D%3D&version=v1.0&BreakPoint=0&virtualDomain=001.live_hls.zte.com&programid=ch00000000000000001415&contentid=ch00000000000000001415&videoid=ch00000090990000001179&recommendtype=0&userid=0020230859495&boid=001&stbid=02:00:00:00:00:00&terminalflag=1&profilecode=&usersessionid=526239246&NeedJITP=1&JITPMediaType=DASH&JITPDRMType=Widevine&RateLow=1280000&RateHigh=25600000&IASHttpSessionId=OTT000020240723233153072050&ispcode=55";

// ClearKey values (from your KODIPROP)
const clearkey = {
  keys: [
    {
      kty: "oct",
      kid: "MTYyMTg0ODMwMTIwMzkxOA", // Base64 of 31363231383438333031323033393138
      k: "OGlONDJNVDR4MWt0VXU0Nw"       // Base64 of 38694e34324d543478316b7455753437
    }
  ]
};

// Route to proxy the MPD file
app.get("/channel/gma7.mpd", async (req, res) => {
  try {
    const response = await fetch(MPD_URL);
    const body = await response.text();
    res.setHeader("Content-Type", "application/dash+xml");
    res.send(body);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching MPD");
  }
});

// Route to serve clearkey license
app.get("/license/gma7", (req, res) => {
  res.json(clearkey);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
