const http = require('http');
const WebSocket = require('ws');
http.get('http://127.0.0.1:9222/json', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const targets = JSON.parse(d);
    const t = targets.find(x => x.url.includes('index.html'));
    if (!t) { console.log('no page found'); process.exit(1); }
    console.log('Connecting to:', t.webSocketDebuggerUrl);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    ws.on('open', () => {
      console.log('Connected, loading video...');
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{
        expression: "window.electronAPI.invoke('mpv:load', '/tmp/test-video.mp4', {width:640,height:480}).then(function(){return 'ok'}).catch(function(e){return e.message})",
        awaitPromise: true, returnByValue: true
      }}));
    });
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        console.log('Load result:', JSON.stringify(msg.result));
        setTimeout(() => { ws.close(); process.exit(0); }, 1000);
      }
    });
    ws.on('error', err => {
      console.error('WS error:', err.message);
      process.exit(1);
    });
  });
}).on('error', err => {
  console.error('HTTP error:', err.message);
  process.exit(1);
});
