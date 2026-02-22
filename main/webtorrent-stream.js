// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  WebTorrent Streaming Service
// ─────────────────────────────────────────────────────────────────────────────
// Provides instant torrent-to-video streaming by:
//   1. Adding a magnet/torrent via WebTorrent
//   2. Prioritising sequential download for the selected file
//   3. Spinning up a local HTTP server with Range request support
//   4. Returning a  http://127.0.0.1:{port}/stream  URL for MPV
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');

/** @type {any} */
let WebTorrent = null;

/** @type {Promise<void>} */
const _wtReady = import('webtorrent')
  .then((mod) => { WebTorrent = mod.default || mod; })
  .catch((e) => { console.error('[WebTorrent] Failed to load:', e.message); });

// ── State ────────────────────────────────────────────────────────────────────

/** @type {import('webtorrent').Instance | null} */
let client = null;

/** @type {Map<string, { torrent: any, server: http.Server, port: number, selectedFile: any }>} */
const activeStreams = new Map();

// Cache directory for downloaded torrent pieces
const CACHE_DIR = path.join(app ? app.getPath('userData') : os.tmpdir(), 'webtorrent-cache');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ensureClient() {
  await _wtReady;
  if (!WebTorrent) throw new Error('WebTorrent is not available — import failed');
  if (!client) {
    // Ensure cache dir exists
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    client = new WebTorrent({
      // Download to cache directory so pieces persist
      // Use UTP for better NAT traversal
      utp: true,
    });
    client.on('error', (err) => {
      console.error('[WebTorrent] Client error:', err.message);
    });
    console.log('[WebTorrent] Client created, cache dir:', CACHE_DIR);
  }
  return client;
}

/**
 * Get the list of video files in a torrent.
 */
function getVideoFiles(torrent) {
  const VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.avi', '.webm', '.mov', '.flv', '.wmv', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg',
  ]);
  return torrent.files
    .map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      size: file.length,
      ext: path.extname(file.name).toLowerCase(),
    }))
    .filter((f) => VIDEO_EXTENSIONS.has(f.ext));
}

/**
 * Find a free port on localhost.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get files list from a magnet link (downloads metadata only).
 * @param {string} magnetUri - Magnet URI
 * @returns {Promise<{ infoHash: string, name: string, files: Array<{index, name, path, size}> }>}
 */
async function getTorrentFiles(magnetUri) {
  const wt = await ensureClient();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Metadata download timed out (60s)'));
    }, 60000);

    // Check if torrent is already added
    const existing = wt.get(magnetUri);
    if (existing && existing.ready) {
      clearTimeout(timeout);
      const videoFiles = getVideoFiles(existing);
      return resolve({
        infoHash: existing.infoHash,
        name: existing.name,
        files: videoFiles,
      });
    }

    wt.add(magnetUri, { path: CACHE_DIR, destroyStoreOnDestroy: false }, (torrent) => {
      clearTimeout(timeout);

      // Initially deselect all files to avoid downloading everything
      torrent.files.forEach((f) => f.deselect());

      const videoFiles = getVideoFiles(torrent);
      resolve({
        infoHash: torrent.infoHash,
        name: torrent.name,
        files: videoFiles,
      });
    });
  });
}

/**
 * Start streaming a specific file from a torrent.
 * @param {string} magnetUri - Magnet URI
 * @param {number} fileIndex - Index of the file to stream
 * @param {Function} [onProgress] - Progress callback (downloaded, total, speed)
 * @returns {Promise<{ url: string, port: number, infoHash: string, fileName: string, fileSize: number }>}
 */
async function startStream(magnetUri, fileIndex, onProgress) {
  const wt = await ensureClient();

  const torrent = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Torrent metadata timeout'));
    }, 60000);

    const existing = wt.get(magnetUri);
    if (existing && existing.ready) {
      clearTimeout(timeout);
      return resolve(existing);
    }

    wt.add(magnetUri, { path: CACHE_DIR, destroyStoreOnDestroy: false }, (t) => {
      clearTimeout(timeout);
      resolve(t);
    });
  });

  const file = torrent.files[fileIndex];
  if (!file) throw new Error(`File index ${fileIndex} not found in torrent`);

  // Deselect all files, then select only the target file
  torrent.files.forEach((f) => f.deselect());
  file.select();

  // Create local HTTP server for Range-request streaming
  const port = await findFreePort();
  const streamId = `${torrent.infoHash}-${fileIndex}`;

  const server = http.createServer((req, res) => {
    if (req.url !== '/stream') {
      res.writeHead(404);
      return res.end('Not Found');
    }

    const fileSize = file.length;
    const rangeHeader = req.headers.range;

    // Determine mime type
    const ext = path.extname(file.name).toLowerCase();
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.flv': 'video/x-flv',
      '.wmv': 'video/x-ms-wmv',
      '.ts': 'video/mp2t',
      '.m4v': 'video/mp4',
    };
    const contentType = mimeTypes[ext] || 'video/mp4';

    if (rangeHeader) {
      // Parse Range header
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });

      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('[WebTorrent] Stream error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } else {
      // No Range — serve entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      });

      const stream = file.createReadStream();
      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('[WebTorrent] Stream error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[WebTorrent] Streaming "${file.name}" on http://127.0.0.1:${port}/stream`);
      resolve();
    });
    server.on('error', reject);
  });

  // Store reference for cleanup
  activeStreams.set(streamId, { torrent, server, port, selectedFile: file });

  // Set up progress reporting
  if (onProgress) {
    const progressInterval = setInterval(() => {
      if (!activeStreams.has(streamId)) {
        clearInterval(progressInterval);
        return;
      }
      onProgress({
        downloaded: torrent.downloaded,
        total: file.length,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        progress: torrent.progress,
        numPeers: torrent.numPeers,
        timeRemaining: torrent.timeRemaining,
      });
    }, 1000);

    // Clear interval on torrent done
    torrent.on('done', () => clearInterval(progressInterval));
  }

  return {
    url: `http://127.0.0.1:${port}/stream`,
    port,
    infoHash: torrent.infoHash,
    streamId,
    fileName: file.name,
    fileSize: file.length,
  };
}

/**
 * Stop a specific stream.
 * @param {string} streamId - The streamId returned from startStream
 */
function stopStream(streamId) {
  const entry = activeStreams.get(streamId);
  if (!entry) return;

  console.log(`[WebTorrent] Stopping stream: ${streamId}`);

  try {
    entry.server.close();
  } catch (e) {
    console.error('[WebTorrent] Error closing server:', e.message);
  }

  // Don't destroy the torrent — keep pieces cached for rewatching
  // Only deselect the file to pause downloading
  try {
    entry.selectedFile.deselect();
  } catch (e) {
    // file may already be deselected
  }

  activeStreams.delete(streamId);
}

/**
 * Get progress info for all active streams.
 */
function getStreamStatus() {
  const statuses = {};
  for (const [streamId, entry] of activeStreams) {
    const torrent = entry.torrent;
    statuses[streamId] = {
      streamId,
      fileName: entry.selectedFile.name,
      fileSize: entry.selectedFile.length,
      downloaded: torrent.downloaded,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      progress: torrent.progress,
      numPeers: torrent.numPeers,
      port: entry.port,
    };
  }
  return statuses;
}

/**
 * Clean up everything.
 */
function destroy() {
  // Close all servers
  for (const [streamId, entry] of activeStreams) {
    try { entry.server.close(); } catch {}
  }
  activeStreams.clear();

  // Destroy WebTorrent client (but keep downloaded data on disk)
  if (client) {
    try { client.destroy(); } catch {}
    client = null;
  }
  console.log('[WebTorrent] Destroyed');
}

module.exports = {
  getTorrentFiles,
  startStream,
  stopStream,
  getStreamStatus,
  destroy,
};
