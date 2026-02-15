// Test: inject a canvas overlay into the Electron app and paint video frames
const WebSocket = require('ws');
const http = require('http');

function getRendererWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const targets = JSON.parse(data);
        const appPage = targets.find(t => t.title !== 'DevTools' && t.url.includes('index.html'));
        if (appPage) resolve(appPage.webSocketDebuggerUrl);
        else reject(new Error('No app page found'));
      });
    }).on('error', reject);
  });
}

const canvasCode = `
(() => {
  var c = document.getElementById('test-canvas');
  if (c) c.remove();
  c = document.createElement('canvas');
  c.id = 'test-canvas';
  c.width = 640;
  c.height = 480;
  c.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:black;object-fit:contain;';
  document.body.appendChild(c);
  var ctx = c.getContext('2d', { alpha: false });
  var painted = 0;

  var unsub = window.electronAPI.on('mpv:frame', function(frame) {
    try {
      var pixels = new Uint8ClampedArray(frame.data);
      if (c.width !== frame.width || c.height !== frame.height) {
        c.width = frame.width;
        c.height = frame.height;
      }
      ctx.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
      painted++;
    } catch(e) { console.error('paint error:', e); }
  });

  window.__testPaintUnsub = unsub;
  window.__testPainted = function() { return painted; };
  return 'Canvas created - painting frames';
})()
`;

(async () => {
  const wsUrl = await getRendererWsUrl();
  console.log('Connecting to:', wsUrl);
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  
  // Inject canvas
  const p1 = new Promise((resolve) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) { ws.off('message', handler); resolve(msg.result?.result?.value); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: canvasCode, returnByValue: true } }));
  });
  console.log('Canvas injection:', await p1);

  // Load video (mpv may already be playing, but loadfile restarts)
  const p2 = new Promise((resolve) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 2) { ws.off('message', handler); resolve(msg.result?.result?.value); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: {
      expression: "window.electronAPI.invoke('mpv:load', '/tmp/test-video.mp4', { width: 640, height: 480 }).then(function() { return 'loaded'; })",
      awaitPromise: true, returnByValue: true,
    }}));
  });
  console.log('Load:', await p2);

  // Check paint count periodically
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    const p = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 10 + i) { ws.off('message', handler); resolve(msg.result?.result?.value); }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id: 10 + i, method: 'Runtime.evaluate', params: {
        expression: 'window.__testPainted ? window.__testPainted() : -1',
        returnByValue: true,
      }}));
    });
    console.log(`  t=${(i+1)*0.5}s: painted=${await p}`);
  }

  console.log('Done - check the Electron window for video display');
  ws.close();
  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
