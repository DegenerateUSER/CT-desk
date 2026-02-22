// ─────────────────────────────────────────────────────────────────────────────
// CT-desk  ·  Electron Main Process
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, session } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { LibMpvPlayer } = require('./mpv/libmpv-player');
const { getResourcePath, isPackaged } = require('./utils/paths');
const { destroy: destroyTelegramStream } = require('./telegram-stream');
const { destroy: destroyWebTorrent } = require('./webtorrent-stream');

// ── Globals ──────────────────────────────────────────────────────────────────

let mainWindow = null;
let libmpvPlayer = null;

// ── Security: Restrict new window / navigation ──────────────────────────────

function setupSecurity() {
  // Deny all permission requests from the renderer
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  // Block navigation to external URLs
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const parsed = new URL(url);
      // Only allow file: protocol (local pages)
      if (parsed.protocol !== 'file:') {
        event.preventDefault();
      }
    });

    // Block creating new windows (popups)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

// ── Window Creation ──────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'CheapTricks',
    icon: path.join(__dirname, '..', 'resources', 'icons', 'icon.png'),
    backgroundColor: '#030c15',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false, // Show only when ready (avoid flash)
  });

  // Load statically exported Next.js app
  const indexPath = path.join(__dirname, '..', 'renderer', 'out', 'index.html');
  mainWindow.loadFile(indexPath);

  // Show when ready to prevent white-flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Forward fullscreen state changes to the renderer
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('app:fullscreen-change', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('app:fullscreen-change', false);
  });

  // Open DevTools in dev mode
  if (!isPackaged()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Cleanup libmpv when window closes
    if (libmpvPlayer) {
      libmpvPlayer.destroy();
      libmpvPlayer = null;
    }
  });
}

// ── Content Security Policy ──────────────────────────────────────────────────

function setupCSP() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",    // Next.js needs inline scripts
            "style-src 'self' 'unsafe-inline'",      // Tailwind injects styles
            "img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://telegra.ph http://165.232.116.243:*",
            "font-src 'self' data:",
            "connect-src 'self' http://localhost:* http://127.0.0.1:* http://165.232.116.243:* https://*",  // API calls + local streams + backend
            "media-src 'self' blob:",                    // Canvas video frames
            "object-src 'none'",
            "frame-src 'none'",
          ].join('; '),
        ],
      },
    });
  });
}

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  setupSecurity();
  setupCSP();

  // Initialize the libmpv player (lazy — will fully init on first load)
  libmpvPlayer = new LibMpvPlayer();

  // Register all IPC handlers
  registerIpcHandlers(ipcMain, { libmpvPlayer, getMainWindow: () => mainWindow });

  // Create the window
  createMainWindow();

  // Forward libmpv frames to the renderer with throttling and back-pressure
  let lastFrameTime = 0;
  const MIN_FRAME_INTERVAL = 33; // ~30fps max
  libmpvPlayer.on('frame', (frame) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Throttle: skip frames to maintain ~30fps max IPC rate
    const now = Date.now();
    if (now - lastFrameTime < MIN_FRAME_INTERVAL) return;
    lastFrameTime = now;

    // Send the raw Buffer through IPC (Electron serializes it efficiently)
    mainWindow.webContents.send('mpv:frame', {
      data: frame.data,   // Node Buffer — Electron IPC handles serialization
      width: frame.width,
      height: frame.height,
    });
  });

  libmpvPlayer.on('status-update', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpv:status-update', status);
    }
  });

  libmpvPlayer.on('ended', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpv:ended', info);
    }
  });

  libmpvPlayer.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpv:error', err);
    }
  });

  libmpvPlayer.on('video-reconfig', (dims) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpv:video-reconfig', dims);
    }
  });

  // macOS: re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit on all windows closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on quit
app.on('before-quit', async () => {
  if (libmpvPlayer) {
    libmpvPlayer.destroy();
  }
  await destroyTelegramStream();
  await destroyWebTorrent();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
