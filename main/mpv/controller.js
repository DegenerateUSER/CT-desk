// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  MPV Controller
// ─────────────────────────────────────────────────────────────────────────────
// Manages the mpv child process with JSON IPC for full playback control.
// Supports:
//   - Embedding into the Electron window via --wid (platform-dependent)
//   - Fallback to a separate mpv window
//   - MKV, H.264, HEVC, subtitles, seeking, volume, hardware acceleration
//   - Local file paths and HTTP streaming URLs
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');
const { MpvIpcSocket } = require('./ipc-socket');
const { getMpvBinaryPath, getTempDir } = require('../utils/paths');

class MpvController extends EventEmitter {
  constructor() {
    super();
    this._process = null;
    this._ipc = null;
    this._socketPath = null;
    this._statusInterval = null;
    this._embedded = false;
    this._state = {
      playing: false,
      paused: false,
      duration: 0,
      position: 0,
      volume: 100,
      muted: false,
      speed: 1.0,
      filename: '',
      tracks: { audio: [], video: [], sub: [] },
      idle: true,
    };

    // Prevent unhandled 'error' events from crashing the app
    this.on('error', (err) => {
      console.error('[MPV] Error event:', err.message || err);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Load a media file or URL into mpv.
   *
   * @param {string} source       Local file path or HTTP(S) URL
   * @param {object} options
   * @param {Buffer} [options.embedHandle]  Native window handle for embedding
   * @param {boolean} [options.hwAccel=true] Enable hardware acceleration
   * @param {string} [options.startPosition]  Start position as "HH:MM:SS" or seconds
   * @returns {Promise<void>}
   */
  async load(source, options = {}) {
    const { embedHandle, hwAccel = true, startPosition } = options;

    // Kill existing mpv process if any
    if (this._process) {
      await this.quit();
    }

    // Generate unique socket path for JSON IPC
    const socketId = crypto.randomBytes(8).toString('hex');
    if (process.platform === 'win32') {
      this._socketPath = `\\\\.\\pipe\\mpv-cheaptricks-${socketId}`;
    } else {
      this._socketPath = path.join(getTempDir(), `mpv-cheaptricks-${socketId}.sock`);
    }

    // Build mpv command-line arguments
    const args = this._buildArgs({
      source,
      socketPath: this._socketPath,
      embedHandle,
      hwAccel,
      startPosition,
    });

    // Spawn mpv process
    const mpvBin = getMpvBinaryPath();
    console.log(`[MPV] Spawning: ${mpvBin} ${args.join(' ')}`);

    this._process = spawn(mpvBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Do NOT use shell: true — prevents command injection
      windowsHide: true,
    });

    this._process.stdout.on('data', (data) => {
      console.log(`[MPV stdout] ${data.toString().trim()}`);
    });

    this._process.stderr.on('data', (data) => {
      console.error(`[MPV stderr] ${data.toString().trim()}`);
    });

    this._process.on('error', (err) => {
      console.error('[MPV] Process error:', err.message);
      this.emit('error', { message: err.message, code: 'PROCESS_ERROR' });
      this._cleanup();
    });

    this._process.on('exit', (code, signal) => {
      console.log(`[MPV] Exited with code=${code} signal=${signal}`);
      // Only emit 'ended' if we were actually playing (socket connected)
      if (this._ipc?.connected) {
        this.emit('ended', { code, signal });
      }
      this._cleanup();
    });

    // Give mpv a moment to start before trying to connect to the socket.
    // If the process exits immediately (bad args, missing libs, etc.), detect that.
    await new Promise((resolve, reject) => {
      const earlyExit = (code) => {
        reject(new Error(`mpv exited immediately with code ${code} — check binary/args`));
      };
      if (!this._process || this._process.exitCode !== null) {
        reject(new Error(`mpv exited immediately with code ${this._process?.exitCode}`));
        return;
      }
      this._process.once('exit', earlyExit);
      setTimeout(() => {
        if (this._process) {
          this._process.removeListener('exit', earlyExit);
        }
        resolve();
      }, 500);
    });

    // Connect to IPC socket (with retries, mpv needs time to create it)
    this._ipc = new MpvIpcSocket(this._socketPath);

    try {
      await this._ipc.connect(8000);
      console.log('[MPV] IPC connected');
      this._embedded = !!embedHandle;
    } catch (err) {
      console.error('[MPV] IPC connection failed:', err.message);
      // Only retry without embedding if we actually used --wid embedding
      if (embedHandle) {
        console.log('[MPV] Embedding failed, retrying in separate window...');
        if (this._process && !this._process.killed) {
          this._process.kill();
        }
        this._process = null;
        if (this._ipc) {
          this._ipc.disconnect();
          this._ipc = null;
        }
        return this.load(source, { ...options, embedHandle: null });
      }
      throw err;
    }

    // Set up event listeners on IPC
    this._ipc.on('mpv-event', (msg) => this._handleMpvEvent(msg));
    this._ipc.on('disconnected', () => this._cleanup());

    // Observe key properties for status updates
    await this._observeProperties();

    // Start periodic status polling (backup for property observers)
    this._startStatusPolling();

    this._state.idle = false;
    this._state.filename = source;
  }

  async play() {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.setProperty('pause', false);
    this._state.paused = false;
    this._state.playing = true;
  }

  async pause() {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.setProperty('pause', true);
    this._state.paused = true;
    this._state.playing = false;
  }

  async stop() {
    if (!this._ipc?.connected) return;
    try {
      await this._ipc.command('stop');
    } catch { /* may already be stopped */ }
    this._state.playing = false;
    this._state.paused = false;
    this._state.idle = true;
  }

  async seek(positionSeconds) {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.command('seek', positionSeconds, 'absolute');
  }

  async setVolume(volume) {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.setProperty('volume', volume);
    this._state.volume = volume;
  }

  async setSubtitleTrack(trackId) {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.setProperty('sid', trackId);
  }

  async setAudioTrack(trackId) {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.setProperty('aid', trackId);
  }

  async toggleFullscreen() {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    const current = await this._ipc.getProperty('fullscreen');
    await this._ipc.setProperty('fullscreen', !current);
  }

  async setSpeed(speed) {
    if (!this._ipc?.connected) throw new Error('mpv not running');
    await this._ipc.setProperty('speed', speed);
    this._state.speed = speed;
  }

  getStatus() {
    return { ...this._state, connected: !!this._ipc?.connected, embedded: this._embedded };
  }

  async quit() {
    if (this._ipc?.connected) {
      try {
        await this._ipc.command('quit');
      } catch { /* ignore */ }
      this._ipc.disconnect();
    }
    if (this._process && !this._process.killed) {
      this._process.kill('SIGTERM');
      // Force kill after 3 seconds
      setTimeout(() => {
        if (this._process && !this._process.killed) {
          this._process.kill('SIGKILL');
        }
      }, 3000);
    }
    this._cleanup();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _buildArgs({ source, socketPath, embedHandle, hwAccel, startPosition }) {
    const args = [
      // IPC socket
      `--input-ipc-server=${socketPath}`,

      // No terminal output (cleaner logs)
      '--no-terminal',

      // Idle mode off — quit when done (unless we keep-open)
      '--keep-open=yes',

      // OSD level
      '--osd-level=1',

      // Cache settings for streaming
      '--cache=yes',
      '--cache-secs=30',
      '--demuxer-max-bytes=200MiB',
      '--demuxer-max-back-bytes=100MiB',

      // Subtitle defaults
      '--sub-auto=fuzzy',
      '--sub-file-paths=subs:subtitles:Subs:Subtitles',

      // Screenshot directory
      '--screenshot-directory=~~/screenshots',
    ];

    // Hardware acceleration & video output
    if (hwAccel) {
      if (process.platform === 'win32') {
        args.push('--hwdec=d3d11va');
        args.push('--gpu-api=d3d11');
        args.push('--vo=gpu');
      } else if (process.platform === 'darwin') {
        args.push('--hwdec=videotoolbox');
        // Use --vo=gpu for embedding (--wid works with gpu + auto api)
        // Use --vo=gpu-next (Metal/Vulkan) for separate window (better quality)
        args.push(embedHandle ? '--vo=gpu' : '--vo=gpu-next');
      } else {
        args.push('--hwdec=auto-safe');
        args.push('--vo=gpu');
      }
    } else {
      args.push('--vo=gpu');
    }

    // Embedding: attach mpv's video output to our window handle
    if (embedHandle) {
      let handleValue;
      if (embedHandle.length === 8) {
        handleValue = embedHandle.readBigUInt64LE().toString();
      } else {
        handleValue = embedHandle.readUInt32LE().toString();
      }
      args.push(`--wid=${handleValue}`);
    }

    // Start position
    if (startPosition) {
      args.push(`--start=${startPosition}`);
    }

    // The source file/URL goes last
    args.push(source);

    return args;
  }

  async _observeProperties() {
    if (!this._ipc?.connected) return;

    const properties = [
      'time-pos',      // Current position in seconds
      'duration',      // Total duration
      'pause',         // Paused state
      'volume',        // Volume level
      'mute',          // Muted state
      'speed',         // Playback speed
      'eof-reached',   // End of file
      'track-list',    // Available tracks (audio/video/sub)
    ];

    for (let i = 0; i < properties.length; i++) {
      try {
        await this._ipc.observeProperty(properties[i], i + 1);
      } catch {
        // Some properties may not be available yet
      }
    }
  }

  _handleMpvEvent(msg) {
    if (msg.event === 'property-change') {
      switch (msg.name) {
        case 'time-pos':
          if (typeof msg.data === 'number') {
            this._state.position = msg.data;
          }
          break;
        case 'duration':
          if (typeof msg.data === 'number') {
            this._state.duration = msg.data;
          }
          break;
        case 'pause':
          this._state.paused = !!msg.data;
          this._state.playing = !msg.data;
          break;
        case 'volume':
          if (typeof msg.data === 'number') {
            this._state.volume = msg.data;
          }
          break;
        case 'mute':
          this._state.muted = !!msg.data;
          break;
        case 'speed':
          if (typeof msg.data === 'number') {
            this._state.speed = msg.data;
          }
          break;
        case 'eof-reached':
          if (msg.data === true) {
            this.emit('ended', { code: 0, signal: null });
          }
          break;
        case 'track-list':
          if (Array.isArray(msg.data)) {
            this._state.tracks = {
              audio: msg.data.filter((t) => t.type === 'audio'),
              video: msg.data.filter((t) => t.type === 'video'),
              sub: msg.data.filter((t) => t.type === 'sub'),
            };
          }
          break;
      }

      // Emit status update for the renderer
      this.emit('status-update', this.getStatus());
    }

    if (msg.event === 'end-file') {
      this.emit('ended', { reason: msg.reason });
    }
  }

  _startStatusPolling() {
    this._stopStatusPolling();
    this._statusInterval = setInterval(async () => {
      if (!this._ipc?.connected) return;
      try {
        const pos = await this._ipc.getProperty('time-pos');
        if (typeof pos === 'number') this._state.position = pos;

        const dur = await this._ipc.getProperty('duration');
        if (typeof dur === 'number') this._state.duration = dur;

        this.emit('status-update', this.getStatus());
      } catch {
        // mpv may have quit
      }
    }, 500);
  }

  _stopStatusPolling() {
    if (this._statusInterval) {
      clearInterval(this._statusInterval);
      this._statusInterval = null;
    }
  }

  _cleanup() {
    this._stopStatusPolling();

    if (this._ipc) {
      this._ipc.disconnect();
      this._ipc = null;
    }

    this._process = null;
    this._embedded = false;

    // Clean up socket file (Unix only)
    if (this._socketPath && process.platform !== 'win32') {
      try {
        fs.unlinkSync(this._socketPath);
      } catch { /* may not exist */ }
    }
    this._socketPath = null;

    this._state = {
      playing: false,
      paused: false,
      duration: 0,
      position: 0,
      volume: this._state.volume, // Preserve volume across sessions
      muted: false,
      speed: 1.0,
      filename: '',
      tracks: { audio: [], video: [], sub: [] },
      idle: true,
    };
  }
}

module.exports = { MpvController };
