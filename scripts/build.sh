#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# CheapTricks Desktop — Build Script
# Builds the Next.js renderer (static export) then packages with electron-builder
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="${1:-all}"   # "win", "mac", "linux", or "all"

echo "┌──────────────────────────────────────────┐"
echo "│  CheapTricks Desktop — Build Pipeline    │"
echo "└──────────────────────────────────────────┘"

# ── 1. Install root deps ─────────────────────────────────────────────────────
echo ""
echo "▸ [1/4] Installing root dependencies..."
npm install --prefer-offline

# ── 2. Install renderer deps ─────────────────────────────────────────────────
echo ""
echo "▸ [2/4] Installing renderer dependencies..."
cd renderer
npm install --prefer-offline
cd ..

# ── 3. Build static renderer ─────────────────────────────────────────────────
echo ""
echo "▸ [3/4] Building Next.js static export..."
cd renderer
npx next build
cd ..

# Verify the export produced index.html
if [ ! -f renderer/out/index.html ]; then
  echo "ERROR: renderer/out/index.html not found. Static export failed."
  exit 1
fi

echo "   ✓ Static export → renderer/out/"

# ── 4. Package with electron-builder ─────────────────────────────────────────
echo ""
echo "▸ [4/4] Packaging with electron-builder (target: $TARGET)..."

case "$TARGET" in
  win)
    npx electron-builder --win --config electron-builder.yml
    ;;
  mac)
    npx electron-builder --mac --config electron-builder.yml
    ;;
  linux)
    npx electron-builder --linux --config electron-builder.yml
    ;;
  all)
    npx electron-builder --mac --win --config electron-builder.yml
    ;;
  renderer)
    echo "   Skipping packaging — renderer-only build."
    ;;
  *)
    echo "Unknown target: $TARGET (use win, mac, linux, all, or renderer)"
    exit 1
    ;;
esac

echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Build complete! Check ./dist/ folder    │"
echo "└──────────────────────────────────────────┘"
