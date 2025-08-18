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
  cinemo_ph: 'https://d1bail49udbz1k.cloudfront.net/out/v1/78e282e04f0944f3ad0aa1db7a1be645/index_3.m3u8',
  kapamilyachannelHD: 'http://143.44.136.110:6610/001/2/ch00000090990000001286/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2442320250818031101000309&m3u8_level=2&ztecid=ch00000090990000001286&virtualDomain=001.live_hls.zte.com&ispcode=55',
  gtv: 'http://143.44.136.110:6610/001/2/ch00000090990000001143/sec-f1-v1-a1.m3u8?usersessionid=&IASHttpSessionId=OTT2330520250818033205000291&m3u8_level=2&ztecid=ch00000090990000001143&virtualDomain=001.live_hls.zte.com&ispcode=55',

};

// 🎬 Proxy for .m3u8 playlist
app.get('/:stream/index.m3u8', (req, res) => {
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

// 🏠 Homepage: Shaka Player with channel list
app.get('/', (req, res) => {
  const channelButtons = Object.keys(streams)
    .map(
      name => `<button onclick="loadChannel('${name}')">${name.toUpperCase()}</button>`
    )
    .join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>⭐ Star Of Venus ⭐</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.9.2/shaka-player.compiled.js"></script>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
          height: 100vh;
        }
        header {
          text-align: center;
          padding: 12px;
          background: #111;
          color: #f9c80e;
          font-size: 1.5em;
          font-weight: bold;
        }
        main {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        #channels {
          width: 200px;
          background: #111;
          padding: 10px;
          overflow-y: auto;
        }
        #channels button {
          width: 100%;
          padding: 10px;
          margin: 6px 0;
          background: #222;
          color: #61dafb;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
          transition: background 0.2s;
        }
        #channels button:hover {
          background: #333;
        }
        #player-container {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          background: #000;
          position: relative;
        }
        video {
          width: 100%;
          height: 100%;
          background: #000;
        }
        @media (max-width: 768px) {
          main {
            flex-direction: column;
          }
          #channels {
            width: 100%;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
          }
          #channels button {
            flex: 1 0 45%;
            margin: 5px;
          }
        }
      </style>
    </head>
    <body>
      <header>⭐ Star Of Venus ⭐</header>
      <main>
        <div id="channels">${channelButtons}</div>
        <div id="player-container">
          <video id="video" controls autoplay playsinline></video>
        </div>
      </main>

      <script>
        const manifestBase = window.location.origin;

        async function initPlayer() {
          if (shaka.Player.isBrowserSupported()) {
            window.player = new shaka.Player(document.getElementById('video'));
            player.addEventListener('error', onError);
          } else {
            alert('Browser not supported!');
          }
        }

        async function loadChannel(name) {
          const url = \`\${manifestBase}/\${name}/playlist.m3u8\`;
          try {
            await player.load(url);
            console.log('Now playing:', name);
          } catch (e) {
            onError(e);
          }
        }

        function onError(e) {
          console.error('Error loading stream:', e);
          alert('⚠️ Failed to load stream.');
        }

        document.addEventListener('DOMContentLoaded', initPlayer);
      </script>
    </body>
    </html>
  `);
});

// 🚀 Launch the server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
