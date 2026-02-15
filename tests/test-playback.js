// Minimal test: load video and check frames in the Electron app
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
        if (!appPage) reject(new Error('No app page found'));
        else resolve(appPage.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });
}

async function cdpEval(ws, expr) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const timer = setTimeout(() => reject(new Error('CDP eval timeout')), 8000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timer);
        ws.off('message', handler);
        if (msg.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
        } else {
          resolve(msg.result?.result?.value);
        }
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }));
  });
}

(async () => {
  const wsUrl = await getRendererWsUrl();
  console.log('Connecting to:', wsUrl);
  const ws = new WebSocket(wsUrl);
  
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('Connected');

  // Step 1: Set up frame counter
  await cdpEval(ws, `
    window.__fc = 0;
    window.__unsub = window.electronAPI.on('mpv:frame', () => { window.__fc++; });
    'listener set'
  `);
  console.log('Frame listener set');

  // Step 2: Load video
  const loadResult = await cdpEval(ws, `
    window.electronAPI.invoke('mpv:load', '/tmp/test-video.mp4', { width: 640, height: 480 }).then(() => 'loaded')
  `);
  console.log('Load:', loadResult);

  // Step 3: Wait and check frames every 500ms
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    const count = await cdpEval(ws, 'window.__fc');
    const status = await cdpEval(ws, `
      window.electronAPI.invoke('mpv:get-status').then(s => JSON.stringify({playing:s.playing,pos:s.position,dur:s.duration}))
    `);
    console.log(`  t=${(i+1)*0.5}s: frames=${count}, status=${status}`);
  }

  // Step 4: Cleanup
  await cdpEval(ws, 'window.__unsub(); "done"');
  
  ws.close();
  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
