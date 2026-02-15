// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  IPC Handlers  (registered in main process)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { dialog, app, shell } = require('electron');
const { validateFilePath, validateUrl, validateNumber, validateString } = require('./security/validators');

/**
 * Register all IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ libmpvPlayer: LibMpvPlayer, getMainWindow: Function }} deps
 */
function registerIpcHandlers(ipcMain, { libmpvPlayer, getMainWindow }) {

  // ── MPV Handlers (libmpv embedded rendering) ─────────────────────────────

  ipcMain.handle('mpv:load', async (_event, source, options = {}) => {
    // source can be a local file path OR an HTTP(S) streaming URL
    if (source.startsWith('http://') || source.startsWith('https://')) {
      validateUrl(source);
    } else {
      validateFilePath(source);
    }

    // Initialize libmpv if needed (with render dimensions from options)
    const width = options.width || 1280;
    const height = options.height || 720;
    if (!libmpvPlayer._initialized) {
      libmpvPlayer.init(width, height);
    } else {
      libmpvPlayer.resize(width, height);
    }

    // Validate HTTP headers if provided (array of strings)
    const httpHeaders = options.httpHeaders;
    if (httpHeaders && (!Array.isArray(httpHeaders) || httpHeaders.some(h => typeof h !== 'string'))) {
      throw new Error('httpHeaders must be an array of strings');
    }

    libmpvPlayer.loadFile(source, { httpHeaders: httpHeaders || [] });
  });

  ipcMain.handle('mpv:play', async () => {
    return libmpvPlayer.play();
  });

  ipcMain.handle('mpv:pause', async () => {
    return libmpvPlayer.pause();
  });

  ipcMain.handle('mpv:stop', async () => {
    return libmpvPlayer.stop();
  });

  ipcMain.handle('mpv:seek', async (_event, position) => {
    validateNumber(position, 'position', { min: 0 });
    return libmpvPlayer.seek(position);
  });

  ipcMain.handle('mpv:set-volume', async (_event, volume) => {
    validateNumber(volume, 'volume', { min: 0, max: 150 });
    return libmpvPlayer.setVolume(volume);
  });

  ipcMain.handle('mpv:get-status', async () => {
    return libmpvPlayer.getStatus();
  });

  ipcMain.handle('mpv:set-subtitle', async (_event, trackId) => {
    validateNumber(trackId, 'trackId', { min: 0 });
    return libmpvPlayer.setSubtitleTrack(trackId);
  });

  ipcMain.handle('mpv:set-audio', async (_event, trackId) => {
    validateNumber(trackId, 'trackId', { min: 0 });
    return libmpvPlayer.setAudioTrack(trackId);
  });

  ipcMain.handle('mpv:toggle-fullscreen', async () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  ipcMain.handle('mpv:set-speed', async (_event, speed) => {
    validateNumber(speed, 'speed', { min: 0.1, max: 4.0 });
    return libmpvPlayer.setSpeed(speed);
  });

  ipcMain.handle('mpv:resize', async (_event, width, height) => {
    validateNumber(width, 'width', { min: 1 });
    validateNumber(height, 'height', { min: 1 });
    return libmpvPlayer.resize(width, height);
  });

  // ── File System Handlers ─────────────────────────────────────────────────

  ipcMain.handle('fs:open-file-dialog', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options.filters || [
        { name: 'Video Files', extensions: ['mkv', 'mp4', 'avi', 'webm', 'mov', 'flv', 'wmv', 'ts', 'mpg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── App Info Handlers ────────────────────────────────────────────────────

  ipcMain.handle('app:get-version', async () => {
    return app.getVersion();
  });

  ipcMain.handle('app:get-platform', async () => {
    return process.platform;
  });

  // ── Shell Handlers ───────────────────────────────────────────────────────

  ipcMain.handle('shell:open-external', async (_event, url) => {
    validateUrl(url);
    // Only allow http/https URLs to be opened externally
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http/https URLs can be opened externally');
    }
    return shell.openExternal(url);
  });
}

module.exports = { registerIpcHandlers };
