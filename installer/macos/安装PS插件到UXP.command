#!/bin/bash
# Copy PS plugin into Adobe UXP External on this Mac.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLUGIN_SRC="${PS_PLUGIN_SOURCE:-/workspace/push-ps/ps-local-edit/plugin}"
if [[ ! -f "$PLUGIN_SRC/manifest.json" ]]; then
  # Fallback: sibling checkout
  if [[ -f "$ROOT/../ps-local-edit/plugin/manifest.json" ]]; then
    PLUGIN_SRC="$ROOT/../ps-local-edit/plugin"
  elif [[ -f "$HOME/ps-local-edit/plugin/manifest.json" ]]; then
    PLUGIN_SRC="$HOME/ps-local-edit/plugin"
  else
    echo "找不到插件目录。请设置 PS_PLUGIN_SOURCE 指向 ps-local-edit/plugin"
    read -r -p "按回车关闭…"
    exit 1
  fi
fi
TARGET="$HOME/Library/Application Support/Adobe/UXP/Plugins/External/com.local.lk888.psedit"
mkdir -p "$TARGET"
rsync -a --delete "$PLUGIN_SRC"/ "$TARGET"/
echo "已安装到：$TARGET"
echo "请打开 Photoshop → 增效工具 →「局部改图」。"
echo "版本：$(python3 -c "import json;print(json.load(open('$PLUGIN_SRC/manifest.json'))['version'])" 2>/dev/null || true)"
read -r -p "按回车关闭…"
