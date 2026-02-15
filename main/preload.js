// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  Preload Script  (runs in sandboxed renderer context)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Strict channel allow-list ────────────────────────────────────────────────
// Every IPC channel the renderer can use MUST be listed here.
// This prevents arbitrary command injection via IPC.

const ALLOWED_INVOKE_CHANNELS = [
  // MPV playback
  'mpv:load',            // Load a file/URL into mpv
  'mpv:play',            // Resume playback
  'mpv:pause',           // Pause playback
  'mpv:stop',            // Stop playback
  'mpv:seek',            // Seek to position (seconds)
  'mpv:set-volume',      // Set volume (0-100)
  'mpv:get-status',      // Get current playback status
  'mpv:set-subtitle',    // Set subtitle track
  'mpv:set-audio',       // Set audio track
  'mpv:toggle-fullscreen', // Toggle fullscreen
  'mpv:set-speed',       // Set playback speed
  'mpv:resize',          // Resize render target

  // File system (sandboxed)
  'fs:open-file-dialog', // Open native file picker
  'fs:open-folder-dialog', // Open native folder picker

  // Shell
  'shell:open-external', // Open URL in external browser

  // App
  'app:get-version',     // Get app version
  'app:get-platform',    // Get OS platform
];

const ALLOWED_ON_CHANNELS = [
  'mpv:status-update',   // Periodic playback status from mpv
  'mpv:error',           // mpv errors
  'mpv:ended',           // Playback ended
  'mpv:frame',           // Video frame data (libmpv render)
  'mpv:video-reconfig',  // Video dimensions changed
  'app:fullscreen-change', // Window fullscreen state changed
];

// ── Exposed API ──────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Invoke a handler in the main process (request/response).
   * @param {string} channel  - Must be in ALLOWED_INVOKE_CHANNELS
   * @param  {...any} args    - Serializable arguments
   * @returns {Promise<any>}
   */
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * Listen for events from the main process.
   * @param {string}   channel  - Must be in ALLOWED_ON_CHANNELS
   * @param {Function} callback - Receives (...args)
   * @returns {Function}        - Unsubscribe function
   */
  on: (channel, callback) => {
    if (!ALLOWED_ON_CHANNELS.includes(channel)) {
      console.warn(`IPC channel "${channel}" is not allowed for listening`);
      return () => {};
    }
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    // Return an unsubscribe function
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Listen for a one-time event from the main process.
   * @param {string}   channel
   * @param {Function} callback
   */
  once: (channel, callback) => {
    if (!ALLOWED_ON_CHANNELS.includes(channel)) {
      console.warn(`IPC channel "${channel}" is not allowed for listening`);
      return;
    }
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },

  /** Platform constants exposed for the renderer */
  platform: process.platform,
  isElectron: true,
});
