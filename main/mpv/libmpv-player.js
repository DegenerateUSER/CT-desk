// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  LibMPV Player  (FFI via koffi)
// ─────────────────────────────────────────────────────────────────────────────
// Embeds mpv video inside the Electron window using the libmpv render API.
// Renders frames via the software renderer and sends them to the renderer
// process for display on a Canvas element.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const koffi = require('koffi');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { getResourcePath, isPackaged } = require('../utils/paths');

// ── Load libmpv ──────────────────────────────────────────────────────────────

function getLibmpvPath() {
  if (isPackaged()) {
    const platform = process.platform;
    if (platform === 'darwin') {
      return getResourcePath('mac', 'mpv', 'libmpv.2.dylib');
    } else if (platform === 'win32') {
      return getResourcePath('win', 'mpv', 'mpv-2.dll');
    } else {
      return getResourcePath('linux', 'mpv', 'libmpv.so.2');
    }
  }

  // Dev mode: try well-known locations
  if (process.platform === 'darwin') {
    // Check the custom-built version first, then Homebrew
    const paths = [
      '/tmp/mpv-install/lib/libmpv.2.dylib',
      '/opt/homebrew/lib/libmpv.2.dylib',
      '/usr/local/lib/libmpv.2.dylib',
    ];
    const fs = require('fs');
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'win32') {
    return 'mpv-2.dll';
  } else {
    return 'libmpv.so.2';
  }

  throw new Error('libmpv not found. Install mpv with libmpv support.');
}

// ── FFI Definitions ──────────────────────────────────────────────────────────

let lib;
let ffi = {};

function initFFI() {
  const libPath = getLibmpvPath();
  console.log(`[LibMPV] Loading library from: ${libPath}`);
  lib = koffi.load(libPath);

  // Opaque pointer types
  const mpv_handle = koffi.opaque('mpv_handle');
  const mpv_render_context = koffi.opaque('mpv_render_context');

  // mpv_render_param struct: { int type; void *data; }
  const mpv_render_param = koffi.struct('mpv_render_param', {
    type: 'int',
    data: 'void *',
  });

  // mpv_event struct (simplified — we only read event_id and data pointer)
  const mpv_event = koffi.struct('mpv_event', {
    event_id: 'int',
    error: 'int',
    reply_userdata: 'uint64',
    data: 'void *',
  });

  // mpv_event_property struct
  const mpv_event_property = koffi.struct('mpv_event_property', {
    name: 'const char *',
    format: 'int',
    data: 'void *',
  });

  // ── Client API functions ──────────────────────────────────────────────────

  ffi.mpv_create = lib.func('mpv_handle *mpv_create()');
  ffi.mpv_initialize = lib.func('int mpv_initialize(mpv_handle *ctx)');
  ffi.mpv_destroy = lib.func('void mpv_destroy(mpv_handle *ctx)');
  ffi.mpv_terminate_destroy = lib.func('void mpv_terminate_destroy(mpv_handle *ctx)');

  ffi.mpv_set_option_string = lib.func(
    'int mpv_set_option_string(mpv_handle *ctx, const char *name, const char *data)'
  );

  ffi.mpv_command = lib.func('int mpv_command(mpv_handle *ctx, const char **args)');
  ffi.mpv_command_string = lib.func('int mpv_command_string(mpv_handle *ctx, const char *args)');

  ffi.mpv_set_property_string = lib.func(
    'int mpv_set_property_string(mpv_handle *ctx, const char *name, const char *data)'
  );
  ffi.mpv_get_property_string = lib.func(
    'char *mpv_get_property_string(mpv_handle *ctx, const char *name)'
  );

  // mpv_get_property for reading doubles (MPV_FORMAT_DOUBLE = 5)
  ffi.mpv_get_property = lib.func(
    'int mpv_get_property(mpv_handle *ctx, const char *name, int format, void *data)'
  );

  ffi.mpv_observe_property = lib.func(
    'int mpv_observe_property(mpv_handle *mpv, uint64_t reply_userdata, const char *name, int format)'
  );

  // Return as void* and manually decode — koffi doesn't auto-decode struct pointer returns reliably
  ffi.mpv_wait_event = lib.func('void *mpv_wait_event(mpv_handle *ctx, double timeout)');

  ffi.mpv_free = lib.func('void mpv_free(void *data)');
  ffi.mpv_error_string = lib.func('const char *mpv_error_string(int error)');

  // ── Render API functions ──────────────────────────────────────────────────

  // int mpv_render_context_create(mpv_render_context **res, mpv_handle *mpv, mpv_render_param *params)
  // Use a buffer for the output pointer (void**) since koffi needs explicit handling
  ffi.mpv_render_context_create = lib.func(
    'int mpv_render_context_create(_Out_ void **res, mpv_handle *mpv, mpv_render_param *params)'
  );

  ffi.mpv_render_context_render = lib.func(
    'int mpv_render_context_render(mpv_render_context *ctx, mpv_render_param *params)'
  );

  ffi.mpv_render_context_update = lib.func(
    'uint64 mpv_render_context_update(mpv_render_context *ctx)'
  );

  ffi.mpv_render_context_free = lib.func(
    'void mpv_render_context_free(mpv_render_context *ctx)'
  );

  ffi.mpv_render_context_report_swap = lib.func(
    'void mpv_render_context_report_swap(mpv_render_context *ctx)'
  );

  // Store types for later use
  ffi.types = { mpv_render_param, mpv_event, mpv_event_property };
}

// ── mpv_render_param helpers ─────────────────────────────────────────────────

// mpv_render_param_type enum values
const MPV_RENDER_PARAM_INVALID = 0;
const MPV_RENDER_PARAM_API_TYPE = 1;
const MPV_RENDER_PARAM_SW_SIZE = 17;
const MPV_RENDER_PARAM_SW_FORMAT = 18;
const MPV_RENDER_PARAM_SW_STRIDE = 19;
const MPV_RENDER_PARAM_SW_POINTER = 20;

// mpv_format enum values
const MPV_FORMAT_NONE = 0;
const MPV_FORMAT_STRING = 1;
const MPV_FORMAT_OSD_STRING = 2;
const MPV_FORMAT_FLAG = 3;
const MPV_FORMAT_INT64 = 4;
const MPV_FORMAT_DOUBLE = 5;
const MPV_FORMAT_NODE = 6;

// mpv_event_id enum values
const MPV_EVENT_NONE = 0;
const MPV_EVENT_SHUTDOWN = 1;
const MPV_EVENT_LOG_MESSAGE = 2;
const MPV_EVENT_GET_PROPERTY_REPLY = 3;
const MPV_EVENT_SET_PROPERTY_REPLY = 4;
const MPV_EVENT_COMMAND_REPLY = 5;
const MPV_EVENT_START_FILE = 6;
const MPV_EVENT_END_FILE = 7;
const MPV_EVENT_FILE_LOADED = 8;
const MPV_EVENT_IDLE = 11;
const MPV_EVENT_TICK = 14;
const MPV_EVENT_CLIENT_MESSAGE = 16;
const MPV_EVENT_VIDEO_RECONFIG = 17;
const MPV_EVENT_AUDIO_RECONFIG = 18;
const MPV_EVENT_SEEK = 20;
const MPV_EVENT_PLAYBACK_RESTART = 21;
const MPV_EVENT_PROPERTY_CHANGE = 22;
const MPV_EVENT_QUEUE_OVERFLOW = 24;
const MPV_EVENT_HOOK = 25;

// MPV_RENDER_UPDATE flags
const MPV_RENDER_UPDATE_FRAME = 1;

// ── LibMpvPlayer Class ───────────────────────────────────────────────────────

class LibMpvPlayer extends EventEmitter {
  constructor() {
    super();
    this._mpv = null;
    this._renderCtx = null;
    this._frameBuffer = null;
    this._frameDims = { w: 0, h: 0 };
    this._renderWidth = 0;
    this._renderHeight = 0;
    this._renderStride = 0;
    this._pollInterval = null;
    this._eventInterval = null;
    this._initialized = false;
    this._playing = false;
    this._lastLoadTime = 0;   // for force-render fallback
    this._state = {
      playing: false,
      paused: false,
      duration: 0,
      position: 0,
      volume: 100,
      muted: false,
      speed: 1.0,
      filename: '',
      idle: true,
      tracks: { audio: [], video: [], sub: [] },
      cacheDuration: 0,
    };

    // Prevent unhandled 'error' events from crashing
    this.on('error', (err) => {
      console.error('[LibMPV] Error event:', err.message || err);
    });
  }

  /**
   * Initialize the libmpv instance with a render context.
   * @param {number} width  - Initial render width in pixels
   * @param {number} height - Initial render height in pixels
   */
  init(width = 1280, height = 720) {
    if (this._initialized) return;

    initFFI();

    // Create mpv core
    this._mpv = ffi.mpv_create();
    if (!this._mpv) {
      throw new Error('mpv_create() returned null');
    }

    // Set options BEFORE initialize
    this._setOption('vo', 'libmpv');         // Required for render API
    this._setOption('hwdec', 'auto-safe');   // Hardware decoding
    this._setOption('keep-open', 'yes');     // Don't quit on EOF
    this._setOption('idle', 'yes');          // Keep running when idle
    this._setOption('osd-level', '0');       // No OSD (we draw our own)
    this._setOption('input-default-bindings', 'no');
    this._setOption('input-vo-keyboard', 'no');

    // Cache settings for streaming
    this._setOption('cache', 'yes');
    this._setOption('cache-secs', '30');
    this._setOption('demuxer-max-bytes', '200MiB');
    this._setOption('demuxer-max-back-bytes', '100MiB');

    // Subtitles
    this._setOption('sub-auto', 'fuzzy');

    const err = ffi.mpv_initialize(this._mpv);
    if (err < 0) {
      const msg = ffi.mpv_error_string(err);
      ffi.mpv_destroy(this._mpv);
      this._mpv = null;
      throw new Error(`mpv_initialize() failed: ${msg}`);
    }

    // Create software render context
    this._createRenderContext();

    // Allocate initial frame buffer
    this._resizeBuffer(width, height);

    // Start polling for events and frames
    this._startEventLoop();
    this._startFramePoller();

    // Observe properties for status updates
    this._observeProperties();

    this._initialized = true;
    console.log('[LibMPV] Initialized successfully');
  }

  _setOption(name, value) {
    const err = ffi.mpv_set_option_string(this._mpv, name, value);
    if (err < 0) {
      console.warn(`[LibMPV] Warning: set option ${name}=${value} → ${ffi.mpv_error_string(err)}`);
    }
  }

  _createRenderContext() {
    // Build the params array for mpv_render_context_create.
    // params = [ { MPV_RENDER_PARAM_API_TYPE, "sw" }, { 0, NULL } ]
    // We need a null-terminated array of mpv_render_param structs.

    // Allocate string "sw" in native memory
    const swStr = Buffer.from('sw\0', 'utf8');

    // Build params array: [{type: 1, data: &"sw"}, {type: 0, data: null}]
    const params = [
      { type: MPV_RENDER_PARAM_API_TYPE, data: swStr },
      { type: MPV_RENDER_PARAM_INVALID, data: null },
    ];

    // Allocate output pointer for the render context
    const renderCtxOut = [null];

    const err = ffi.mpv_render_context_create(renderCtxOut, this._mpv, params);
    if (err < 0) {
      throw new Error(
        `mpv_render_context_create() failed: ${ffi.mpv_error_string(err)}`
      );
    }
    this._renderCtx = renderCtxOut[0];

    // NOTE: We intentionally do NOT use mpv_render_context_set_update_callback.
    // koffi's registered callbacks run via uv_async_send from mpv's render thread,
    // which can deadlock with concurrent FFI calls from the main thread.
    // Instead, we poll mpv_render_context_update() in the frame poller.
    console.log('[LibMPV] Render context created (software renderer)');
  }

  _resizeBuffer(width, height) {
    this._renderWidth = width;
    this._renderHeight = height;
    this._renderStride = width * 4; // RGBA = 4 bytes per pixel
    this._frameBuffer = Buffer.alloc(this._renderStride * height);
    this._frameDims = { w: width, h: height };
    console.log(`[LibMPV] Frame buffer: ${width}×${height} (${this._frameBuffer.length} bytes)`);
  }

  /**
   * Resize the render target.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (width === this._renderWidth && height === this._renderHeight) return;
    if (width < 1 || height < 1) return;
    this._resizeBuffer(Math.round(width), Math.round(height));
  }

  // ── Frame Rendering ──────────────────────────────────────────────────────

  _renderFrame() {
    if (!this._renderCtx || !this._frameBuffer) return null;

    // Check update flags (works reliably for initial loads):
    const flags = ffi.mpv_render_context_update(this._renderCtx);
    const hasNewFrame = !!(flags & MPV_RENDER_UPDATE_FRAME);

    // Fallback: after loadFile(), flags may not signal for sequential loads.
    // Force a render attempt if the last load was recent.
    const sinceLoad = Date.now() - (this._lastLoadTime || 0);
    const forceRender = (!hasNewFrame && sinceLoad < 10000 && sinceLoad > 100);

    if (!hasNewFrame && !forceRender) return null;

    // Prepare render params
    const w = this._renderWidth;
    const h = this._renderHeight;
    const stride = this._renderStride;

    // SW_SIZE: int[2] = {w, h}
    const sizeArr = Buffer.alloc(8);
    sizeArr.writeInt32LE(w, 0);
    sizeArr.writeInt32LE(h, 4);

    // SW_FORMAT: const char* "rgba" (native RGBA for Canvas ImageData — no conversion needed)
    const fmtStr = Buffer.from('rgba\0', 'utf8');

    // SW_STRIDE: size_t
    const strideArr = Buffer.alloc(8);
    if (os.endianness() === 'LE') {
      strideArr.writeBigUInt64LE(BigInt(stride));
    } else {
      strideArr.writeBigUInt64BE(BigInt(stride));
    }

    const params = [
      { type: MPV_RENDER_PARAM_SW_SIZE, data: sizeArr },
      { type: MPV_RENDER_PARAM_SW_FORMAT, data: fmtStr },
      { type: MPV_RENDER_PARAM_SW_STRIDE, data: strideArr },
      { type: MPV_RENDER_PARAM_SW_POINTER, data: this._frameBuffer },
      { type: MPV_RENDER_PARAM_INVALID, data: null },
    ];

    const err = ffi.mpv_render_context_render(this._renderCtx, params);
    if (err < 0) {
      console.error(`[LibMPV] render error: ${ffi.mpv_error_string(err)}`);
      return null;
    }

    ffi.mpv_render_context_report_swap(this._renderCtx);

    // For forced renders (fallback path for sequential loads), skip duplicate
    // detection — the IPC throttle in main.js limits bandwidth, and the Canvas
    // just re-paints the same image.  For flag-signalled frames, no check needed
    // since mpv guarantees a new frame.

    return {
      buffer: this._frameBuffer,
      width: w,
      height: h,
      stride: stride,
    };
  }

  _startFramePoller() {
    let frameCount = 0;
    let pollCount = 0;
    // Poll at ~60fps for new frames
    this._pollInterval = setInterval(() => {
      try {
        pollCount++;
        if (pollCount % 1800 === 0) {
          console.log(`[LibMPV] Frame stats: ${frameCount} frames in ${pollCount} polls`);
        }
        const frame = this._renderFrame();
        if (frame) {
          frameCount++;
          // Emit raw pixel data — copy into a clean ArrayBuffer for IPC
          const ab = new ArrayBuffer(frame.buffer.length);
          new Uint8Array(ab).set(frame.buffer);
          this.emit('frame', {
            data: ab,
            width: frame.width,
            height: frame.height,
          });
        }
      } catch (e) {
        console.error(`[LibMPV] FRAME POLLER ERROR at poll #${pollCount}:`, e.message, e.stack);
      }
    }, 16); // ~60fps
  }

  // ── Event Loop ───────────────────────────────────────────────────────────

  _startEventLoop() {
    // Poll mpv events at ~30Hz
    this._eventInterval = setInterval(() => {
      this._drainEvents();
    }, 33);
  }

  _drainEvents() {
    if (!this._mpv) return;

    // Process all pending events (non-blocking: timeout=0)
    for (let i = 0; i < 50; i++) {
      const evPtr = ffi.mpv_wait_event(this._mpv, 0);
      if (!evPtr) break;

      // Manually decode the struct from the raw pointer
      let ev;
      try {
        ev = koffi.decode(evPtr, ffi.types.mpv_event);
      } catch (e) {
        console.error('[LibMPV] Failed to decode mpv_event:', e.message);
        break;
      }

      const eventId = ev.event_id;
      if (eventId === MPV_EVENT_NONE) break;

      switch (eventId) {
        case MPV_EVENT_FILE_LOADED:
          console.log('[LibMPV] File loaded');
          this._state.idle = false;
          this._syncAllProperties();
          this.emit('file-loaded');
          break;

        case MPV_EVENT_END_FILE:
          console.log('[LibMPV] End file');
          this._state.playing = false;
          this._state.idle = true;
          this._playing = false;
          this.emit('ended', { reason: 'eof' });
          break;

        case MPV_EVENT_SHUTDOWN:
          console.log('[LibMPV] Shutdown event');
          break;

        case MPV_EVENT_PROPERTY_CHANGE:
          this._handlePropertyChange(ev);
          break;

        case MPV_EVENT_VIDEO_RECONFIG:
          // Video size may have changed — adapt render buffer
          this._handleVideoReconfig();
          break;

        case MPV_EVENT_PLAYBACK_RESTART:
          this._state.playing = true;
          this._state.paused = false;
          this.emit('status-update', this.getStatus());
          break;

        default:
          break;
      }
    }
  }

  _handlePropertyChange(ev) {
    if (!ev.data) return;

    // Read the mpv_event_property struct from ev.data
    let prop;
    try {
      prop = koffi.decode(ev.data, ffi.types.mpv_event_property);
    } catch {
      return;
    }

    const name = prop.name;
    const format = prop.format;

    if (format === MPV_FORMAT_DOUBLE && prop.data) {
      const val = koffi.decode(prop.data, 'double');
      this._updateProperty(name, val);
    } else if (format === MPV_FORMAT_FLAG && prop.data) {
      const val = koffi.decode(prop.data, 'int');
      this._updateProperty(name, !!val);
    } else if (format === MPV_FORMAT_STRING && prop.data) {
      const strPtr = koffi.decode(prop.data, 'const char *');
      this._updateProperty(name, strPtr);
    }
  }

  _updateProperty(name, value) {
    switch (name) {
      case 'time-pos':
        if (typeof value === 'number' && !isNaN(value)) {
          this._state.position = value;
        }
        break;
      case 'duration':
        if (typeof value === 'number' && !isNaN(value)) {
          this._state.duration = value;
        }
        break;
      case 'pause':
        this._state.paused = !!value;
        this._state.playing = !value;
        break;
      case 'volume':
        if (typeof value === 'number') {
          this._state.volume = value;
        }
        break;
      case 'mute':
        this._state.muted = !!value;
        break;
      case 'speed':
        if (typeof value === 'number') {
          this._state.speed = value;
        }
        break;
      case 'eof-reached':
        if (value === true) {
          this.emit('ended', { reason: 'eof' });
        }
        break;
      case 'demuxer-cache-duration':
        if (typeof value === 'number' && !isNaN(value)) {
          this._state.cacheDuration = value;
        }
        break;
    }

    this.emit('status-update', this.getStatus());
  }

  _observeProperties() {
    const doubleProps = ['time-pos', 'duration', 'volume', 'speed', 'demuxer-cache-duration'];
    const flagProps = ['pause', 'mute', 'eof-reached'];

    let id = 1;
    for (const prop of doubleProps) {
      ffi.mpv_observe_property(this._mpv, BigInt(id++), prop, MPV_FORMAT_DOUBLE);
    }
    for (const prop of flagProps) {
      ffi.mpv_observe_property(this._mpv, BigInt(id++), prop, MPV_FORMAT_FLAG);
    }
  }

  _handleVideoReconfig() {
    // Read video dimensions from mpv and optionally resize
    const wStr = this._getPropertyString('video-params/w');
    const hStr = this._getPropertyString('video-params/h');
    if (wStr && hStr) {
      const vw = parseInt(wStr, 10);
      const vh = parseInt(hStr, 10);
      if (vw > 0 && vh > 0) {
        console.log(`[LibMPV] Video reconfig: ${vw}×${vh}`);
        this.emit('video-reconfig', { width: vw, height: vh });
      }
    }
  }

  _syncAllProperties() {
    try {
      const pos = this._getPropertyDouble('time-pos');
      if (!isNaN(pos)) this._state.position = pos;

      const dur = this._getPropertyDouble('duration');
      if (!isNaN(dur)) this._state.duration = dur;

      const vol = this._getPropertyDouble('volume');
      if (!isNaN(vol)) this._state.volume = vol;

      const spd = this._getPropertyDouble('speed');
      if (!isNaN(spd)) this._state.speed = spd;

      // Sync track list (subtitles, audio, video)
      this._syncTrackList();

      this.emit('status-update', this.getStatus());
    } catch { /* not ready yet */ }
  }

  /**
   * Read the full track list from mpv and populate this._state.tracks.
   * mpv exposes track-list/count and track-list/N/key properties.
   */
  _syncTrackList() {
    const countStr = this._getPropertyString('track-list/count');
    const count = parseInt(countStr, 10);
    if (isNaN(count) || count <= 0) return;

    const audio = [];
    const video = [];
    const sub = [];

    for (let i = 0; i < count; i++) {
      const type = this._getPropertyString(`track-list/${i}/type`) || '';
      const idStr = this._getPropertyString(`track-list/${i}/id`);
      const id = parseInt(idStr, 10);
      if (isNaN(id)) continue;

      const track = {
        id,
        type,
        title: this._getPropertyString(`track-list/${i}/title`) || undefined,
        lang: this._getPropertyString(`track-list/${i}/lang`) || undefined,
        codec: this._getPropertyString(`track-list/${i}/codec`) || undefined,
        selected: this._getPropertyString(`track-list/${i}/selected`) === 'yes',
        external: this._getPropertyString(`track-list/${i}/external`) === 'yes',
      };

      if (type === 'audio') audio.push(track);
      else if (type === 'video') video.push(track);
      else if (type === 'sub') sub.push(track);
    }

    this._state.tracks = { audio, video, sub };
    console.log(`[LibMPV] Tracks: ${audio.length} audio, ${video.length} video, ${sub.length} sub`);
  }

  // ── Property Getters (synchronous) ───────────────────────────────────────

  _getPropertyString(name) {
    if (!this._mpv) return null;
    const str = ffi.mpv_get_property_string(this._mpv, name);
    if (!str) return null;
    const value = str; // koffi auto-decodes to JS string
    // Note: We should call mpv_free(str) but koffi handles string copy
    return value;
  }

  _getPropertyDouble(name) {
    if (!this._mpv) return NaN;
    const buf = Buffer.alloc(8);
    const err = ffi.mpv_get_property(this._mpv, name, MPV_FORMAT_DOUBLE, buf);
    if (err < 0) return NaN;
    return buf.readDoubleLE(0);
  }

  // ── Public Control API ───────────────────────────────────────────────────

  /**
   * Set HTTP headers for the next load (used for Bearer-token direct streams).
   * @param {string[]} headers - Array of "Key: Value" strings
   */
  setHttpHeaders(headers) {
    if (!this._mpv) return;
    if (!headers || headers.length === 0) {
      // Clear any previously set headers
      ffi.mpv_set_property_string(this._mpv, 'http-header-fields', '');
      return;
    }
    // mpv expects a comma-separated list for http-header-fields
    const joined = headers.join(',');
    console.log(`[LibMPV] Setting HTTP headers: ${headers.length} header(s)`);
    ffi.mpv_set_property_string(this._mpv, 'http-header-fields', joined);
  }

  /**
   * Load a media file/URL.
   * @param {string} source - File path or URL
   * @param {object} [opts] - Optional load options
   * @param {string[]} [opts.httpHeaders] - HTTP headers for streaming URLs
   */
  loadFile(source, opts = {}) {
    if (!this._initialized) {
      this.init();
    }
    console.log(`[LibMPV] Loading: ${source}`);
    this._state.filename = source;
    this._state.idle = false;
    this._playing = true;
    this._lastLoadTime = Date.now();

    // Set HTTP headers if provided (e.g. Authorization: Bearer ...)
    if (opts.httpHeaders && opts.httpHeaders.length > 0) {
      this.setHttpHeaders(opts.httpHeaders);
    } else {
      this.setHttpHeaders([]); // Clear stale headers
    }

    // Use command_string for simplicity
    const err = ffi.mpv_command_string(this._mpv, `loadfile "${source.replace(/"/g, '\\"')}"`);
    if (err < 0) {
      throw new Error(`loadfile failed: ${ffi.mpv_error_string(err)}`);
    }
  }

  play() {
    if (!this._mpv) return;
    ffi.mpv_set_property_string(this._mpv, 'pause', 'no');
    this._state.paused = false;
    this._state.playing = true;
  }

  pause() {
    if (!this._mpv) return;
    ffi.mpv_set_property_string(this._mpv, 'pause', 'yes');
    this._state.paused = true;
    this._state.playing = false;
  }

  stop() {
    if (!this._mpv) return;
    ffi.mpv_command_string(this._mpv, 'stop');
    this._state.playing = false;
    this._state.paused = false;
    this._state.idle = true;
    this._state.position = 0;
    this._state.duration = 0;
  }

  seek(positionSeconds) {
    if (!this._mpv) return;
    ffi.mpv_command_string(this._mpv, `seek ${positionSeconds} absolute`);
  }

  setVolume(volume) {
    if (!this._mpv) return;
    ffi.mpv_set_property_string(this._mpv, 'volume', String(volume));
    this._state.volume = volume;
  }

  setSpeed(speed) {
    if (!this._mpv) return;
    ffi.mpv_set_property_string(this._mpv, 'speed', String(speed));
    this._state.speed = speed;
  }

  setSubtitleTrack(trackId) {
    if (!this._mpv) return;
    ffi.mpv_set_property_string(this._mpv, 'sid', String(trackId));
    // Re-sync track list after a short delay so mpv updates the selected state
    setTimeout(() => {
      this._syncTrackList();
      this.emit('status-update', this.getStatus());
    }, 100);
  }

  setAudioTrack(trackId) {
    if (!this._mpv) return;
    ffi.mpv_set_property_string(this._mpv, 'aid', String(trackId));
    // Re-sync track list after a short delay so mpv updates the selected state
    setTimeout(() => {
      this._syncTrackList();
      this.emit('status-update', this.getStatus());
    }, 100);
  }

  getStatus() {
    return {
      ...this._state,
      connected: this._initialized,
      embedded: true,
    };
  }

  /**
   * Destroy the mpv instance and free resources.
   */
  destroy() {
    console.log('[LibMPV] Destroying...');

    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._eventInterval) {
      clearInterval(this._eventInterval);
      this._eventInterval = null;
    }

    if (this._renderCtx) {
      ffi.mpv_render_context_free(this._renderCtx);
      this._renderCtx = null;
    }

    if (this._mpv) {
      ffi.mpv_terminate_destroy(this._mpv);
      this._mpv = null;
    }

    this._frameBuffer = null;
    this._initialized = false;
    console.log('[LibMPV] Destroyed');
  }
}

module.exports = { LibMpvPlayer };
