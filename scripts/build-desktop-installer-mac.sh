#!/usr/bin/env bash
# Stage PS plugin + companion, then electron-builder --mac.
# Override plugin path: PS_PLUGIN_SOURCE=/path/to/ps-local-edit/plugin
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEFAULT_PLUGIN="/workspace/push-ps/ps-local-edit/plugin"
if [[ -z "${PS_PLUGIN_SOURCE:-}" ]]; then
  if [[ -f "$DEFAULT_PLUGIN/manifest.json" ]]; then
    PS_PLUGIN_SOURCE="$DEFAULT_PLUGIN"
  elif [[ -f "$HOME/ps-local-edit/plugin/manifest.json" ]]; then
    PS_PLUGIN_SOURCE="$HOME/ps-local-edit/plugin"
  else
    echo "Photoshop plugin source was not found. Set PS_PLUGIN_SOURCE to ps-local-edit/plugin." >&2
    exit 1
  fi
fi
if [[ ! -f "$PS_PLUGIN_SOURCE/manifest.json" ]]; then
  echo "PS_PLUGIN_SOURCE is not a valid plugin directory: $PS_PLUGIN_SOURCE" >&2
  exit 1
fi

PLUGIN_ROOT="$(cd "$(dirname "$PS_PLUGIN_SOURCE")" && pwd)"
STAGE="$ROOT/desktop/package/ps-plugin"
COMPANION="$ROOT/desktop/package/ps-companion/scripts"
rm -rf "$ROOT/desktop/package"
mkdir -p "$STAGE" "$COMPANION"
cp -R "$PS_PLUGIN_SOURCE"/. "$STAGE"/
# Companion: voice-server + Win workers (kept for bundled Win parity) + any future mac helpers
if [[ -d "$PLUGIN_ROOT/scripts" ]]; then
  cp -f "$PLUGIN_ROOT/scripts/voice-server.cjs" "$COMPANION"/
  shopt -s nullglob
  for f in "$PLUGIN_ROOT/scripts"/*.ps1 "$PLUGIN_ROOT/scripts"/*.sh "$PLUGIN_ROOT/scripts"/*.mjs; do
    cp -f "$f" "$COMPANION"/
  done
  shopt -u nullglob
fi

npm run build
npx electron-builder --mac dmg zip
# Optional cleanup of staging (keep if build failed halfway — we exit on error above)
rm -rf "$ROOT/desktop/package"
echo "Mac desktop artifacts under $ROOT/release-desktop/"
echo "NOTE: codesign/notarize not configured yet (unsigned dmg/zip)."
