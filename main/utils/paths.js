// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  Path Utilities
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const { app } = require('electron');

/**
 * Check if the app is packaged (production build via electron-builder).
 */
function isPackaged() {
  return app.isPackaged;
}

/**
 * Get the path to a resource file.
 * In development: relative to project root.
 * In production: inside the app.asar or extraResources.
 *
 * @param {...string} segments  Path segments relative to resources/
 * @returns {string}
 */
function getResourcePath(...segments) {
  if (isPackaged()) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, '..', '..', 'resources', ...segments);
}

/**
 * Get the path to the mpv binary for the current platform.
 * mpv binaries are placed in extraResources (not inside asar) so they can be executed.
 *
 * @returns {string}
 */
function getMpvBinaryPath() {
  const platform = process.platform;

  // In development, prefer system mpv from PATH
  if (!isPackaged()) {
    return 'mpv';
  }

  if (platform === 'win32') {
    return getResourcePath('win', 'mpv', 'mpv.exe');
  } else if (platform === 'darwin') {
    return getResourcePath('mac', 'mpv', 'mpv');
  } else {
    return 'mpv';
  }
}

/**
 * Get a safe temp directory for IPC sockets.
 * @returns {string}
 */
function getTempDir() {
  return app.getPath('temp');
}

/**
 * Get the user data directory for persistent app data.
 * @returns {string}
 */
function getUserDataPath() {
  return app.getPath('userData');
}

module.exports = {
  isPackaged,
  getResourcePath,
  getMpvBinaryPath,
  getTempDir,
  getUserDataPath,
};
