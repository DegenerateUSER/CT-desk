// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  Telegram Direct Streaming  v4 (persistent worker pool)
// ─────────────────────────────────────────────────────────────────────────────
// Architecture:
//   1. Connection pool: 3 independent gramjs TCP connections (1 auth + 2 clones)
//   2. Persistent worker pool (9 workers) continuously fills the LRU cache.
//      Each worker independently grabs the next uncached chunk — no batch
//      waiting, no straggler blocking.
//   3. HTTP handler serves ONE chunk at a time from cache (near-instant).
//      On cache miss it piggy-backs on in-flight downloads or fetches inline.
//   4. 53 MB pre-buffer (50 start + 3 tail for MKV Cues) before first play
//   5. In-flight deduplication prevents workers + HTTP handler from
//      downloading the same chunk twice
//   6. 700 MB LRU RAM cache — holds ~half a 1.5 GB file for instant seeks
//   7. dcId routing: downloads go directly to the file's DC (no proxy hop)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const bigInt = require('big-integer');

// ── Session persistence ──────────────────────────────────────────────────────
// Authenticate once, save session string, reuse on subsequent launches.
// All pool clients clone the same session → 1 auth call, not N.
const SESSION_DIR  = path.join(os.homedir(), '.ct-desk');
const SESSION_FILE = path.join(SESSION_DIR, 'tg-session.json');

function loadSavedSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (data && data.session) return data.session;
    }
  } catch (e) {
    console.warn('[TelegramStream] Could not load saved session:', e.message);
  }
  return null;
}

function saveSession(sessionStr) {
  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ session: sessionStr, ts: Date.now() }));
  } catch (e) {
    console.warn('[TelegramStream] Could not save session:', e.message);
  }
}

// ── Tunables ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE        = 1024 * 1024;         // 1 MB — MTProto max per upload.getFile
const CLIENT_POOL_SIZE  = 3;                   // independent gramjs TCP connections
const WORKERS_PER_CONN  = 3;                   // concurrent downloads per connection
const PARALLEL_WORKERS  = CLIENT_POOL_SIZE * WORKERS_PER_CONN; // 9 total
const PREFETCH_CHUNKS   = 50;                  // 50 MB pre-buffer (+ 3 tail = 53 total)
const SEEK_PREBUF_CHUNKS= 10;                  // 10 MB blocking seek burst
const LOOKAHEAD_CHUNKS  = 250;                 // workers can fill up to 250 MB ahead
const CACHE_MAX_BYTES   = 700 * 1024 * 1024;   // 700 MB LRU cache
const MAX_CONSECUTIVE_FAILURES = 5;

// ── State ────────────────────────────────────────────────────────────────────
let clientPool  = [];
let clientCreds = null;
let localServer = null;
let localPort   = null;
let activeStreams = new Map();  // videoId → StreamState

// ── In-flight deduplication ──────────────────────────────────────────────────
// Prevents background downloader + HTTP handler from downloading the same chunk
const inFlight = new Map(); // cacheKey → Promise<Buffer|null>

// ── LRU Chunk Cache ──────────────────────────────────────────────────────────
class ChunkCache {
  constructor(maxBytes) {
    this.maxBytes  = maxBytes;
    this.usedBytes = 0;
    this.map       = new Map();
  }

  get(key) {
    const buf = this.map.get(key);
    if (!buf) return null;
    this.map.delete(key);
    this.map.set(key, buf);
    return buf;
  }

  set(key, buf) {
    if (this.map.has(key)) {
      this.usedBytes -= this.map.get(key).length;
      this.map.delete(key);
    }
    while (this.usedBytes + buf.length > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value;
      this.usedBytes -= this.map.get(oldest).length;
      this.map.delete(oldest);
    }
    this.map.set(key, buf);
    this.usedBytes += buf.length;
  }

  has(key) { return this.map.has(key); }

  clear() { this.map.clear(); this.usedBytes = 0; }

  deletePrefix(prefix) {
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) {
        this.usedBytes -= this.map.get(key).length;
        this.map.delete(key);
      }
    }
  }
}

const chunkCache = new ChunkCache(CACHE_MAX_BYTES);

// ── gramjs logger (silent except errors) ─────────────────────────────────────
const silentLogger = {
  canSend() { return false; },
  _log() {}, warn() {}, info() {}, debug() {},
  error(...args) { console.error('[gramjs]', ...args); },
};

// ── Connection Pool ──────────────────────────────────────────────────────────
// Strategy: authenticate ONE client (or reuse saved session), then clone
// the session string for remaining pool clients. This means only 1 call to
// auth.ImportBotAuthorization ever — no FloodWait.

async function createClientWithSession(creds, sessionStr) {
  const session = new StringSession(sessionStr || '');
  const c = new TelegramClient(session, creds.apiId, creds.apiHash, {
    connectionRetries: 10,
    retryDelay: 1000,
    autoReconnect: true,
    baseLogger: silentLogger,
  });
  if (sessionStr) {
    // Session already holds auth key — just connect, no auth RPC
    await c.connect();
  } else {
    // Fresh auth — will call auth.ImportBotAuthorization
    await c.start({ botAuthToken: creds.botToken });
  }
  return c;
}

async function ensureClientPool(creds) {
  clientCreds = creds;
  const alive = clientPool.filter(c => c && c.connected).length;
  if (alive >= CLIENT_POOL_SIZE) return;

  const needed = CLIENT_POOL_SIZE - alive;
  console.log('[TelegramStream] Connecting ' + needed + ' gramjs clients (pool ' + CLIENT_POOL_SIZE + ')...');
  const t0 = Date.now();

  // ── Obtain a valid session string ─────────────────────────────────
  let masterSession = loadSavedSession();

  // Try saved session first
  if (masterSession) {
    try {
      const test = await createClientWithSession(creds, masterSession);
      // Verify it's actually alive by making a trivial API call
      await test.getMe();
      console.log('[TelegramStream] Reusing saved session');
      // Update saved session in case DC migration happened
      const updatedSession = test.session.save();
      if (updatedSession !== masterSession) {
        masterSession = updatedSession;
        saveSession(masterSession);
      }
      // This test client becomes pool slot 0
      clientPool = [test];
    } catch (e) {
      console.warn('[TelegramStream] Saved session invalid (' + e.message + '), re-authenticating...');
      masterSession = null;
      clientPool = [];
    }
  }

  // No saved session (or it was stale) — authenticate once
  // If FloodWait, auto-wait and retry (logs countdown every 30s)
  if (!masterSession) {
    let primary = null;
    while (!primary) {
      try {
        primary = await createClientWithSession(creds, '');
      } catch (err) {
        if (err.seconds && err.errorMessage === 'FLOOD') {
          const waitSec = err.seconds + 5; // +5s safety margin
          console.log('[TelegramStream] FloodWait: must wait ' + waitSec + 's (' + (waitSec / 60).toFixed(0) + ' min). Auto-retrying...');
          // Wait with countdown logging every 30s
          let remaining = waitSec;
          while (remaining > 0) {
            const sleep = Math.min(remaining, 30);
            await new Promise(r => setTimeout(r, sleep * 1000));
            remaining -= sleep;
            if (remaining > 0) {
              console.log('[TelegramStream] FloodWait: ' + remaining + 's remaining...');
            }
          }
          console.log('[TelegramStream] FloodWait expired, retrying auth...');
        } else {
          throw err; // non-flood error — rethrow
        }
      }
    }
    masterSession = primary.session.save();
    saveSession(masterSession);
    console.log('[TelegramStream] Authenticated & saved session');
    clientPool = [primary];
  }

  // ── Clone session for remaining pool slots ────────────────────────
  // Each clone gets its own TCP connection but shares the auth key,
  // so NO additional auth.ImportBotAuthorization calls.
  const clonePromises = [];
  for (let i = clientPool.length; i < CLIENT_POOL_SIZE; i++) {
    clonePromises.push(
      createClientWithSession(creds, masterSession)
        .catch(err => {
          console.warn('[TelegramStream] Pool client ' + i + ' failed:', err.message);
          return null;
        })
    );
  }
  const clones = await Promise.all(clonePromises);
  for (const c of clones) {
    if (c) clientPool.push(c);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('[TelegramStream] ' + clientPool.length + ' clients connected in ' + elapsed + 's (1 auth, ' + (clientPool.length - 1) + ' clones)');
}

function getClient(chunkIndex) {
  return clientPool[chunkIndex % clientPool.length];
}

function getAnyClient() {
  for (const c of clientPool) { if (c && c.connected) return c; }
  return clientPool[0];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveFileLocation(chatId, messageId) {
  const c = getAnyClient();
  const numericChatId = typeof chatId === 'string' ? BigInt(chatId) : chatId;
  const messages = await c.getMessages(numericChatId, { ids: messageId });
  if (!messages || messages.length === 0) {
    throw new Error('Message ' + messageId + ' not found in chat ' + chatId);
  }
  const msg = messages[0];
  if (!msg || !msg.media) throw new Error('Message has no media');
  const doc = msg.media.document || msg.media;
  if (!doc || !doc.id) throw new Error('Message media is not a document');

  const dcId = doc.dcId || undefined;
  console.log('[TelegramStream] File DC: ' + (dcId || 'unknown') + ', size: ' + (Number(doc.size) / 1024 / 1024).toFixed(0) + ' MB');

  return {
    inputLocation: new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: '',
    }),
    fileSize: Number(doc.size),
    mimeType: doc.mimeType || 'video/mp4',
    dcId: dcId,
  };
}

// ── Single-chunk downloader (with in-flight dedup) ───────────────────────────

async function downloadChunk(videoId, inputLocation, chunkIndex, fileSize, dcId) {
  const cacheKey = videoId + ':' + chunkIndex;
  const cached = chunkCache.get(cacheKey);
  if (cached && cached.length > 0) return cached;

  // Deduplicate: if this chunk is already being downloaded, piggy-back
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const promise = _downloadChunkImpl(cacheKey, inputLocation, chunkIndex, fileSize, dcId);
  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function _downloadChunkImpl(cacheKey, inputLocation, chunkIndex, fileSize, dcId) {
  const offset = chunkIndex * CHUNK_SIZE;
  if (offset >= fileSize) return Buffer.alloc(0);

  const MAX_RETRIES = 4;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // On retry, rotate to a different client to avoid hammering a broken one
    const c = getClient(chunkIndex + attempt - 1);
    try {
      if (c && !c.connected) {
        console.log('[TelegramStream] Client ' + ((chunkIndex + attempt - 1) % clientPool.length) + ' disconnected, reconnecting...');
        try { await c.connect(); } catch (e) {
          console.warn('[TelegramStream] Reconnect failed:', e.message);
          if (attempt < MAX_RETRIES) {
            const delay = 200 * Math.pow(2, attempt - 1);
            await new Promise(r => setTimeout(r, delay));
            continue;  // try next client
          }
        }
      }

      let buf = null;
      for await (const chunk of c.iterDownload({
        file: inputLocation,
        offset: bigInt(offset),
        requestSize: CHUNK_SIZE,
        dcId: dcId,  // direct DC connection — avoids proxy through bot's home DC
      })) {
        buf = Buffer.from(chunk);
        break;  // only need 1 chunk
      }

      if (buf && buf.length > 0) {
        chunkCache.set(cacheKey, buf);
        return buf;
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error('[TelegramStream] Chunk ' + chunkIndex + ' failed after ' + MAX_RETRIES + ' retries:', err.message);
      } else {
        const delay = 200 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  return null;
}

// ── Parallel chunk fetcher ───────────────────────────────────────────────────

async function downloadChunksParallel(videoId, inputLocation, chunkIndices, fileSize, dcId) {
  const results = new Map();
  const queue = [...chunkIndices];

  async function worker() {
    while (queue.length > 0) {
      const idx = queue.shift();
      if (idx === undefined) break;
      const cacheKey = videoId + ':' + idx;
      const c = chunkCache.get(cacheKey);
      if (c && c.length > 0) { results.set(idx, c); continue; }
      try {
        const buf = await downloadChunk(videoId, inputLocation, idx, fileSize, dcId);
        results.set(idx, (buf && buf.length > 0) ? buf : null);
      } catch (err) {
        console.error('[TelegramStream] Chunk ' + idx + ' failed:', err.message);
        results.set(idx, null);
      }
    }
  }

  const workerCount = Math.min(PARALLEL_WORKERS, chunkIndices.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ── Continuous Background Downloader ─────────────────────────────────────────
// Runs as a persistent async loop, sequentially downloading chunks ahead of
// the playback cursor. The HTTP handler mostly just reads from cache.

class StreamDownloader {
  constructor(videoId, inputLocation, fileSize, dcId) {
    this.videoId = videoId;
    this.inputLocation = inputLocation;
    this.fileSize = fileSize;
    this.dcId = dcId;
    this.totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    this.playbackChunk = 0;
    this._cursor = 0;             // next chunk index to assign to a worker
    this._seekGeneration = 0;
    this.running = false;
    this._workerPromises = [];
  }

  start(fromChunk) {
    this._cursor = fromChunk;
    this.playbackChunk = 0;
    this.running = true;
    // Launch persistent workers — each independently grabs and downloads chunks
    for (let i = 0; i < PARALLEL_WORKERS; i++) {
      this._workerPromises.push(this._worker(i));
    }
  }

  stop() {
    this.running = false;
    this._workerPromises = [];
  }

  /** Called by HTTP handler on every served chunk */
  notifyPlayback(chunkIndex) {
    this.playbackChunk = chunkIndex;
    // Reposition if cursor ran past EOF or way ahead of playback
    if (this._cursor >= this.totalChunks ||
        this._cursor > chunkIndex + LOOKAHEAD_CHUNKS) {
      console.log('[TelegramStream] Reposition downloader: ' + this._cursor + ' → ' + chunkIndex);
      this._seekGeneration++;
      this._cursor = chunkIndex;
    }
  }

  /** Immediate jump — called by HTTP handler on seek */
  seekTo(chunkIndex) {
    console.log('[TelegramStream] Seek → chunk ' + chunkIndex + ' (was cursor=' + this._cursor + ')');
    this._seekGeneration++;
    this._cursor = chunkIndex;
    this.playbackChunk = chunkIndex;
  }

  /**
   * Grab the next uncached, non-in-flight chunk index.
   * Safe: JS is single-threaded between awaits, so _cursor++ is atomic.
   */
  _getNextChunk() {
    const limit = this.playbackChunk + LOOKAHEAD_CHUNKS;
    let scanned = 0;
    while (this._cursor < this.totalChunks && this._cursor <= limit && scanned < LOOKAHEAD_CHUNKS) {
      const idx = this._cursor++;
      scanned++;
      const key = this.videoId + ':' + idx;
      if (!chunkCache.has(key) && !inFlight.has(key)) {
        return idx;
      }
    }
    return null; // nothing to download right now
  }

  /** Persistent worker — grabs one chunk at a time, no batch waiting */
  async _worker(id) {
    while (this.running) {
      const gen = this._seekGeneration;
      const idx = this._getNextChunk();

      if (idx === null) {
        // Nothing to download — wait briefly and re-check
        await new Promise(r => setTimeout(r, 30));
        continue;
      }

      try {
        await downloadChunk(this.videoId, this.inputLocation, idx, this.fileSize, this.dcId);
      } catch (err) {
        // Error already logged inside downloadChunk retries
      }

      // If a seek happened during download, loop picks up from new cursor
      if (gen !== this._seekGeneration) continue;

      // Small cooldown to avoid hammering Telegram
      await new Promise(r => setTimeout(r, 30));
    }
  }
}

// ── Pre-buffer ───────────────────────────────────────────────────────────────

async function prefetchInitialChunks(videoId, inputLocation, fileSize, dcId) {
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const startCount = Math.min(PREFETCH_CHUNKS, totalChunks);
  const indices = Array.from({ length: startCount }, (_, i) => i);

  // Also pre-cache last 3 chunks — MKV Cues (index) lives at end of file.
  // Without this, mpv probes the end on every load, causing a 5+ second seek
  // that repositions the background downloader to EOF (breaking sequential fill).
  const TAIL_CHUNKS = 3;
  for (let i = Math.max(startCount, totalChunks - TAIL_CHUNKS); i < totalChunks; i++) {
    indices.push(i);
  }

  console.log('[TelegramStream] Pre-buffering ' + indices.length + ' chunks (' + startCount + ' start + ' + (indices.length - startCount) + ' tail, ' + (indices.length * CHUNK_SIZE / 1024 / 1024).toFixed(0) + ' MB)...');
  const t0 = Date.now();
  await downloadChunksParallel(videoId, inputLocation, indices, fileSize, dcId);
  const elapsed = (Date.now() - t0) / 1000;
  const speed = (indices.length * CHUNK_SIZE / 1024 / 1024) / elapsed;
  console.log('[TelegramStream] Pre-buffer done: ' + elapsed.toFixed(1) + 's (' + speed.toFixed(1) + ' MB/s)');
}

// ── Local HTTP streaming server ──────────────────────────────────────────────

function startLocalServer() {
  return new Promise(function(resolve, reject) {
    if (localServer) { resolve(localPort); return; }

    localServer = http.createServer(async function(req, res) {
      try {
        const match = req.url.match(/^\/stream\/([^/?]+)/);
        if (!match) { res.writeHead(404); res.end('Not found'); return; }

        const videoId = match[1];
        const streamInfo = activeStreams.get(videoId);
        if (!streamInfo) { res.writeHead(404); res.end('Stream not registered'); return; }

        const { inputLocation, fileSize, mimeType, downloader, dcId } = streamInfo;

        // HEAD
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          });
          res.end();
          return;
        }

        // Parse Range
        var rangeHeader = req.headers.range;
        var start = 0;
        var end = fileSize - 1;

        if (rangeHeader) {
          var m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (m) {
            start = parseInt(m[1], 10);
            end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
          }
        }
        if (end >= fileSize) end = fileSize - 1;
        var contentLength = end - start + 1;

        if (rangeHeader) {
          res.writeHead(206, {
            'Content-Type': mimeType,
            'Content-Length': contentLength,
            'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
        } else {
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
        }

        // Disable Nagle's algorithm for lower write-latency
        if (res.socket) res.socket.setNoDelay(true);

        // ── Seek detection + burst pre-buffer ──────────────────────────
        // If the first chunk of this request is NOT in cache, this is a seek
        // to an uncached region.  Burst-download SEEK_PREBUF_CHUNKS (30 MB)
        // in parallel BEFORE writing any bytes, so mpv has ~27 s of runway.
        var firstChunk = Math.floor(start / CHUNK_SIZE);
        var totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

        if (!chunkCache.has(videoId + ':' + firstChunk)) {
          // Tell background downloader to jump here immediately
          if (downloader) downloader.seekTo(firstChunk);

          // Blocking burst: download SEEK_PREBUF_CHUNKS before writing any
          // bytes so mpv gets a solid runway after seek.
          var burstEnd = Math.min(firstChunk + SEEK_PREBUF_CHUNKS, totalChunks);
          var burstIndices = [];
          for (var bi = firstChunk; bi < burstEnd; bi++) {
            if (!chunkCache.has(videoId + ':' + bi)) burstIndices.push(bi);
          }
          if (burstIndices.length > 0) {
            var bt0 = Date.now();
            console.log('[TelegramStream] Seek burst: downloading ' + burstIndices.length + ' chunks from #' + firstChunk + '...');
            await downloadChunksParallel(videoId, inputLocation, burstIndices, fileSize, dcId);
            var bElapsed = (Date.now() - bt0) / 1000;
            var bSpeed = (burstIndices.length * CHUNK_SIZE / 1024 / 1024) / bElapsed;
            console.log('[TelegramStream] Seek burst done: ' + bElapsed.toFixed(1) + 's (' + bSpeed.toFixed(1) + ' MB/s)');
          }
        }

        // ── Serve chunks from cache (instant) or inline download ──────
        var bytePos = start;
        var targetEnd = end + 1;
        var consecutiveFailures = 0;

        while (bytePos < targetEnd && !res.destroyed) {
          var chunkIndex = Math.floor(bytePos / CHUNK_SIZE);
          var offsetInChunk = bytePos % CHUNK_SIZE;

          // Tell background downloader where playback is
          if (downloader) downloader.notifyPlayback(chunkIndex);

          // 1. Try cache (instant — background downloader + seek burst keep it filled)
          var cacheKey = videoId + ':' + chunkIndex;
          var chunkBuf = chunkCache.get(cacheKey);

          // 2. Cache miss — check if background is downloading it (dedup)
          if (!chunkBuf && inFlight.has(cacheKey)) {
            chunkBuf = await inFlight.get(cacheKey);
          }

          // 3. Still nothing — inline download (should be rare after burst)
          if (!chunkBuf) {
            try {
              chunkBuf = await downloadChunk(videoId, inputLocation, chunkIndex, fileSize, dcId);
            } catch (err) {
              console.error('[TelegramStream] Inline download error chunk ' + chunkIndex + ':', err.message);
            }
          }

          if (!chunkBuf || chunkBuf.length === 0) {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              console.error('[TelegramStream] Too many failures, aborting');
              break;
            }
            await new Promise(r => setTimeout(r, 500));
            continue;
          }

          consecutiveFailures = 0;

          var remaining = targetEnd - bytePos;
          var available = chunkBuf.length - offsetInChunk;
          var toWrite = Math.min(available, remaining);
          if (toWrite <= 0) break;

          var ok = res.write(chunkBuf.slice(offsetInChunk, offsetInChunk + toWrite));
          bytePos += toWrite;

          // Back-pressure: respect Node writable buffer
          if (!ok) {
            await new Promise(r => res.once('drain', r));
          }
        }

        res.end();
      } catch (err) {
        console.error('[TelegramStream] Request error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal error');
        }
      }
    });

    localServer.listen(0, '127.0.0.1', function() {
      localPort = localServer.address().port;
      console.log('[TelegramStream] Local server on http://127.0.0.1:' + localPort);
      resolve(localPort);
    });

    localServer.on('error', reject);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

async function startTelegramStream(info) {
  var t0 = Date.now();
  function ms() { return '+' + ((Date.now() - t0) / 1000).toFixed(1) + 's'; }

  // 1. Connect pool
  await ensureClientPool({
    apiId: info.api_id,
    apiHash: info.api_hash,
    botToken: info.bot_token,
  });
  console.log('[TelegramStream] ' + ms() + ' pool ready');

  // 2. Local server
  var port = await startLocalServer();

  // 3. Resolve file
  var mainPart = info.parts[0];
  if (!mainPart || !mainPart.message_id) {
    throw new Error('No valid Telegram message for this video');
  }
  var resolved = await resolveFileLocation(info.chat_id, mainPart.message_id);
  var totalSize = info.total_size || resolved.fileSize;
  var dcId = resolved.dcId;
  console.log('[TelegramStream] ' + ms() + ' file resolved');

  // 4. Pre-buffer (50 start + 3 tail chunks = 53 MB)
  await prefetchInitialChunks(info.video_id, resolved.inputLocation, totalSize, dcId);
  console.log('[TelegramStream] ' + ms() + ' pre-buffer complete');

  // 5. Start persistent worker pool (9 workers downloading continuously)
  var downloader = new StreamDownloader(info.video_id, resolved.inputLocation, totalSize, dcId);
  downloader.start(PREFETCH_CHUNKS);

  // 6. Register stream
  activeStreams.set(info.video_id, {
    inputLocation: resolved.inputLocation,
    fileSize: totalSize,
    mimeType: info.mime_type || resolved.mimeType,
    downloader: downloader,
    dcId: dcId,
  });

  var url = 'http://127.0.0.1:' + port + '/stream/' + info.video_id;
  console.log('[TelegramStream] ' + ms() + ' Ready: ' + url + ' (' + info.name + ', ' + (totalSize / 1024 / 1024).toFixed(0) + ' MB)');
  return { url: url, port: port };
}

function stopStream(videoId) {
  var streamInfo = activeStreams.get(videoId);
  if (streamInfo && streamInfo.downloader) streamInfo.downloader.stop();
  activeStreams.delete(videoId);
  chunkCache.deletePrefix(videoId + ':');
}

async function destroy() {
  for (const [, info] of activeStreams) {
    if (info.downloader) info.downloader.stop();
  }
  activeStreams.clear();
  chunkCache.clear();
  if (localServer) { localServer.close(); localServer = null; localPort = null; }
  for (const c of clientPool) {
    if (c && c.connected) {
      try { await c.disconnect(); } catch (e) { /* noop */ }
    }
  }
  clientPool = [];
}

module.exports = { startTelegramStream, stopStream, destroy };
