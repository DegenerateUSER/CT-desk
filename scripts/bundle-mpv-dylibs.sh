#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bundle libmpv and all its non-system dylib dependencies for macOS packaging.
# Copies them into resources/mac/mpv/ and rewrites all paths to use @loader_path.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../resources/mac/mpv"

# Source libmpv — prefer custom build, fallback to Homebrew
if [ -f "/tmp/mpv-install/lib/libmpv.2.dylib" ]; then
  LIBMPV_SRC="/tmp/mpv-install/lib/libmpv.2.dylib"
elif [ -f "/opt/homebrew/lib/libmpv.2.dylib" ]; then
  LIBMPV_SRC="/opt/homebrew/lib/libmpv.2.dylib"
elif [ -f "/usr/local/lib/libmpv.2.dylib" ]; then
  LIBMPV_SRC="/usr/local/lib/libmpv.2.dylib"
else
  echo "ERROR: libmpv.2.dylib not found. Install mpv with: brew install mpv"
  exit 1
fi

echo "==> Source libmpv: $LIBMPV_SRC"
echo "==> Destination:   $DEST_DIR"

mkdir -p "$DEST_DIR"

# ── Recursively collect all non-system dylib dependencies ─────────────────

declare -A PROCESSED

collect_deps() {
  local lib_path="$1"
  local lib_name
  lib_name="$(basename "$lib_path")"

  # Skip if already processed
  if [[ -n "${PROCESSED[$lib_name]:-}" ]]; then
    return
  fi
  PROCESSED[$lib_name]=1

  # Copy the library
  if [ ! -f "$DEST_DIR/$lib_name" ] || [ "$lib_path" -nt "$DEST_DIR/$lib_name" ]; then
    echo "  Copying: $lib_name"
    cp "$lib_path" "$DEST_DIR/$lib_name"
    chmod 755 "$DEST_DIR/$lib_name"
  fi

  # Get dependencies
  local deps
  deps=$(otool -L "$lib_path" | tail -n +2 | awk '{print $1}')

  for dep in $deps; do
    # Skip system libraries and self-references
    if [[ "$dep" == /usr/lib/* ]] || \
       [[ "$dep" == /System/* ]] || \
       [[ "$dep" == "@"* ]] || \
       [[ "$dep" == "$lib_path" ]]; then
      continue
    fi

    # Resolve the actual path
    local dep_path="$dep"
    if [ ! -f "$dep_path" ]; then
      # Try common Homebrew locations
      local dep_name
      dep_name="$(basename "$dep")"
      for search_dir in /opt/homebrew/lib /usr/local/lib /opt/homebrew/opt/*/lib; do
        if [ -f "$search_dir/$dep_name" ]; then
          dep_path="$search_dir/$dep_name"
          break
        fi
      done
    fi

    if [ -f "$dep_path" ]; then
      collect_deps "$dep_path"
    else
      echo "  WARNING: Could not find dependency: $dep"
    fi
  done
}

echo ""
echo "==> Collecting dependencies..."
collect_deps "$LIBMPV_SRC"

# ── Rewrite all library paths to use @loader_path ────────────────────────

echo ""
echo "==> Rewriting library paths..."

for dylib in "$DEST_DIR"/*.dylib; do
  [ -f "$dylib" ] || continue
  local_name="$(basename "$dylib")"
  echo "  Fixing: $local_name"

  # Change the library's own ID to @loader_path/name
  install_name_tool -id "@loader_path/$local_name" "$dylib" 2>/dev/null || true

  # Rewrite all dependencies that point to Homebrew or other absolute paths
  deps=$(otool -L "$dylib" | tail -n +2 | awk '{print $1}')
  for dep in $deps; do
    dep_name="$(basename "$dep")"
    # Only rewrite if it's not a system lib and we have it bundled
    if [[ "$dep" != /usr/lib/* ]] && \
       [[ "$dep" != /System/* ]] && \
       [[ "$dep" != "@"* ]] && \
       [ -f "$DEST_DIR/$dep_name" ]; then
      install_name_tool -change "$dep" "@loader_path/$dep_name" "$dylib" 2>/dev/null || true
    fi
  done
done

# ── Ad-hoc codesign all bundled dylibs (required on Apple Silicon) ────────

echo ""
echo "==> Codesigning..."
for dylib in "$DEST_DIR"/*.dylib; do
  [ -f "$dylib" ] || continue
  echo "  Signing: $(basename "$dylib")"
  codesign --force --sign - --timestamp=none "$dylib" 2>/dev/null || true
done

echo ""
echo "==> Done! Bundled $(ls "$DEST_DIR"/*.dylib 2>/dev/null | wc -l | tr -d ' ') dylibs into $DEST_DIR"
echo ""
echo "You can verify with:"
echo "  otool -L $DEST_DIR/libmpv.2.dylib"
