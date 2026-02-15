// Simplified canvas test — inject canvas, load video, check painting
const http = require('http');
const WebSocket = require('ws');

function cdpSend(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout for id=${id}`)), 10000);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  // Get renderer page WS URL
  const targets = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
  const page = targets.find(t => t.url.includes('index.html'));
  if (!page) { console.log('No page found'); process.exit(1); }
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); });
  console.log('Connected');

  // Inject canvas + frame listener
  const canvasCode = `
    (function() {
      var c = document.getElementById('test-canvas');
      if (c) c.remove();
      c = document.createElement('canvas');
      c.id = 'test-canvas';
      c.width = 640; c.height = 480;
      c.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:black;';
      document.body.appendChild(c);
      var ctx = c.getContext('2d', { alpha: false });
      window.__painted = 0;
      window.__lastErr = '';
      window.electronAPI.on('mpv:frame', function(frame) {
        try {
          var pixels = new Uint8ClampedArray(frame.data);
          if (c.width !== frame.width || c.height !== frame.height) {
            c.width = frame.width; c.height = frame.height;
          }
          ctx.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
          window.__painted++;
        } catch(e) { window.__lastErr = e.message; }
      });
      return 'ok';
    })()
  `;
  const r1 = await cdpSend(ws, 1, 'Runtime.evaluate', { expression: canvasCode, returnByValue: true });
  console.log('Canvas:', r1.result.value);

  // Load video
  const loadExpr = "window.electronAPI.invoke('mpv:load', '/tmp/test-video.mp4', {width:640,height:480}).then(function(){return 'ok'}).catch(function(e){return e.message})";
  const r2 = await cdpSend(ws, 2, 'Runtime.evaluate', { expression: loadExpr, awaitPromise: true, returnByValue: true });
  console.log('Load:', r2.result.value);

  // Check paint count every 500ms for 6 seconds
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const r3 = await cdpSend(ws, 100 + i, 'Runtime.evaluate', { 
        expression: "JSON.stringify({painted: window.__painted || 0, err: window.__lastErr || ''})", 
        returnByValue: true 
      });
      console.log(`  t=${(i+1)*0.5}s: ${r3.result.value}`);
    } catch (e) {
      console.log(`  t=${(i+1)*0.5}s: ERROR ${e.message}`);
    }
  }

  console.log('Done');
  ws.close();
  process.exit(0);
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
