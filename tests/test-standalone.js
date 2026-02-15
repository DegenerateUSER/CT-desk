// Standalone test of LibMpvPlayer — no Electron, just Node.js
'use strict';

// Mock electron's app object for paths.js
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (request === 'electron') {
    return require.resolve('./test-electron-mock.js');
  }
  return origResolve.call(this, request, parent, ...args);
};

process.chdir(__dirname);

const { LibMpvPlayer } = require('./main/mpv/libmpv-player');

const player = new LibMpvPlayer();

let frameCount = 0;

player.on('frame', (frame) => {
  frameCount++;
  if (frameCount <= 5 || frameCount % 30 === 0) {
    console.log(`Frame #${frameCount}: ${frame.width}x${frame.height}, ${frame.data.byteLength} bytes`);
  }
});

player.on('status-update', (status) => {
  if (status.position > 0 && Math.round(status.position * 10) % 10 === 0) {
    console.log(`Status: pos=${status.position.toFixed(1)}, playing=${status.playing}`);
  }
});

player.on('ended', (info) => {
  console.log('Ended:', info);
});

player.on('error', (err) => {
  console.log('Error:', err);
});

player.on('video-reconfig', (dims) => {
  console.log('Video reconfig:', dims);
});

console.log('Initializing...');
player.init(640, 480);

// Event loop heartbeat — check if the event loop is alive
let hbCount = 0;
const hbInterval = setInterval(() => {
  hbCount++;
  console.log(`[heartbeat #${hbCount}] frames=${frameCount}`);
}, 500);

console.log('Loading video...');
player.loadFile('/tmp/test-video.mp4');

// Report every second
let tick = 0;
let secondLoadDone = false;
const interval = setInterval(() => {
  tick++;
  console.log(`[t=${tick}s] frames=${frameCount}`);
  
  // After first playback ends (~6s mark), load again
  if (tick === 7 && !secondLoadDone) {
    secondLoadDone = true;
    frameCount = 0;
    console.log('=== SECOND LOAD ===');
    player.loadFile('/tmp/test-video.mp4');
  }
  
  if (tick >= 14) {
    clearInterval(interval);
    console.log(`Final after 2nd load: ${frameCount} frames`);
    player.destroy();
    process.exit(0);
  }
}, 1000);
