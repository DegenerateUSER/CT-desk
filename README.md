# CheapTricks Desktop

Offline Electron desktop app for streaming Google Drive videos with native **mpv** playback. Full feature parity with the CheapTricks-u web app, running entirely as a standalone native application.

## Architecture

```
CT-desk/
├── main/                    # Electron main process
│   ├── main.js              # Window creation, security, lifecycle
│   ├── preload.js           # contextBridge — allowlisted IPC channels
│   ├── ipc-handlers.js      # All IPC handle registrations
│   ├── mpv/
│   │   ├── controller.js    # Spawn & control mpv child process
│   │   └── ipc-socket.js    # JSON IPC protocol over Unix/Win named pipe
│   ├── backend/
│   │   └── manager.js       # Spawn PyInstaller backend, health checks
│   ├── security/
│   │   └── validators.js    # Input validation for IPC payloads
│   └── utils/
│       └── paths.js         # Resolve bundled binary paths (asar-aware)
│
├── renderer/                # Next.js 14 static export
│   ├── src/
│   │   ├── app/             # Root page.tsx (router), layout.tsx, globals.css
│   │   ├── views/           # View components (Home, Login, Register, etc.)
│   │   ├── components/      # MpvPlayer, VideoCard, 8bit UI library
│   │   └── lib/             # api.ts, auth.tsx, navigation.tsx, electron.ts
│   └── out/                 # Static export output (loaded by Electron)
│
├── resources/               # Platform binaries (outside ASAR)
│   ├── mac/mpv/             # macOS mpv binary
│   ├── mac/backend/         # macOS PyInstaller backend
│   ├── win/mpv/             # Windows mpv binary
│   ├── win/backend/         # Windows PyInstaller backend
│   └── credentials.json     # Google Drive service account credentials
│
├── build/                   # App icons & macOS entitlements
├── scripts/build.sh         # Full build pipeline
├── electron-builder.yml     # Packaging configuration
└── package.json             # Root deps (electron, electron-builder)
```

## Quick Start

### Prerequisites

- **Node.js** 18+
- **npm** 9+
- **mpv** binary for your platform (see [MPV Bundling](#mpv-bundling))
- **Python backend** binary (PyInstaller, see [Backend Setup](#backend-setup))

### Development

```bash
# Install all dependencies (root + renderer)
cd CT-desk
npm install

# Build the renderer (static export)
npm run build:renderer

# Run in development mode
npm run dev
```

### Production Build

```bash
# Full build: renderer + electron-builder
./scripts/build.sh mac      # macOS DMG
./scripts/build.sh win      # Windows NSIS installer
./scripts/build.sh all      # Both platforms
```

Output goes to `dist/`.

## MPV Bundling

mpv is NOT bundled automatically. You must place the mpv binary in the correct `resources/` directory.

### macOS

```bash
# Option 1: brew (then copy)
brew install mpv
cp $(which mpv) resources/mac/mpv/mpv

# Option 2: Download static build
# Place binary at: resources/mac/mpv/mpv
```

### Windows

```bash
# Download from https://mpv.io/installation/ or https://sourceforge.net/projects/mpv-player-windows/
# Extract and place:
#   resources/win/mpv/mpv.exe
#   resources/win/mpv/*.dll  (all required DLLs)
```

The build system copies these into `extraResources/mpv/` in the packaged app.

## Backend Setup

The local Python backend streams Google Drive content. Build it with PyInstaller:

```bash
cd ../Cheaptricks-s

# Install dependencies
pip install -r requirements.txt
pip install pyinstaller

# Build single executable
pyinstaller --onefile --name cheaptricks-backend main.py

# Copy to resources
cp dist/cheaptricks-backend ../CT-desk/resources/mac/backend/
# (or resources/win/backend/ for Windows)
```

Place your `credentials.json` (Google service account) at `resources/credentials.json`.

## Key Differences from Web App

| Feature | Web (CheapTricks-u) | Desktop (CT-desk) |
|---------|---------------------|---------------------|
| Video player | HTML5 `<video>` | Native mpv (IPC socket) |
| Routing | Next.js file-system router | React state-based navigation |
| API proxy | Next.js rewrites | Local PyInstaller backend |
| Auth | Server-relative fetch | Remote server direct fetch |
| Font loading | `next/font/google` | Self-hosted woff2 |
| Images | `next/image` | Native `<img>` |
| Deployment | Docker/Vercel | electron-builder (NSIS/DMG) |

## Security

- `contextIsolation: true` — renderer cannot access Node.js
- `sandbox: true` — Chromium sandbox enabled
- `nodeIntegration: false` — no `require()` in renderer
- Strict CSP headers (no `eval`, restricted script sources)
- IPC channel allowlist in preload (15 invoke, 5 listen channels)
- Input validation on all IPC handlers (path traversal, injection checks)
- Navigation blocked to external URLs
- `webSecurity: true` by default

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Launch app (needs pre-built renderer) |
| `npm run dev` | Launch in development mode |
| `npm run build:renderer` | Build Next.js static export |
| `npm run build:win` | Build Windows NSIS installer |
| `npm run build:mac` | Build macOS DMG |
| `npm run build:all` | Build for all platforms |
| `npm run clean` | Remove dist/, out/, .next/ |
