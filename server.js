const express = require('express');
const request = require('request');
const cors = require('cors');
const { URL } = require('url');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// ✅ Stream channel map (key: name, value: m3u8 URL)
const streams = {
  gma7: 'http://143.44.136.110:6610/001/2/ch00000090990000001093/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2388020250818020007000282&m3u8_level=2&ztecid=ch00000090990000001093&virtualDomain=001.live_hls.zte.com&ispcode=55',
  cinemo_ph: 'http://143.44.136.110:6610/001/2/ch00000090990000001254/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2339620250818035221000307&m3u8_level=2&ztecid=ch00000090990000001254&virtualDomain=001.live_hls.zte.com&ispcode=55',
  kapamilyachannelHD: 'http://143.44.136.110:6610/001/2/ch00000090990000001286/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2442320250818031101000309&m3u8_level=2&ztecid=ch00000090990000001286&virtualDomain=001.live_hls.zte.com&ispcode=55',
  gtv: 'http://143.44.136.110:6610/001/2/ch00000090990000001143/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2330520250818033205000291&m3u8_level=2&ztecid=ch00000090990000001143&virtualDomain=001.live_hls.zte.com&ispcode=55',
};

// 🎬 Proxy for .m3u8 playlist
app.get('/:stream/playlist.m3u8', (req, res) => {
  const key = req.params.stream;
  const streamUrl = streams[key];

  if (!streamUrl) return res.status(404).send('❌ Invalid stream key');

  const baseUrl = new URL(streamUrl);
  const basePath = baseUrl.href.substring(0, baseUrl.href.lastIndexOf('/') + 1);

  request.get(streamUrl, (err, response, body) => {
    if (err || response.statusCode !== 200) {
      return res.status(502).send('❌ Failed to fetch playlist');
    }

    const modified = body.replace(/^(?!#)(.+)$/gm, (line) => {
      line = line.trim();
      if (!line || line.startsWith('#')) return line;
      const fullUrl = new URL(line, basePath).href;
      return `/segment.ts?url=${encodeURIComponent(fullUrl)}`;
    });

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(modified);
  });
});

// 🎥 Proxy for .ts segments
app.get('/segment.ts', (req, res) => {
  const segmentUrl = req.query.url;
  if (!segmentUrl) return res.status(400).send('❌ No segment URL');

  request
    .get(segmentUrl)
    .on('response', (r) => res.set(r.headers))
    .on('error', () => res.status(502).send('❌ Segment failed'))
    .pipe(res);
});

// 🚀 Launch the server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
