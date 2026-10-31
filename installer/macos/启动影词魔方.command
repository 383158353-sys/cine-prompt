#!/bin/bash
# Double-click in Finder to start 影词魔方 from source (needs Node 22+).
cd "$(dirname "$0")/../.."
echo "启动影词魔方 (源码模式)…"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js 22+ LTS：https://nodejs.org/"
  read -r -p "按回车关闭…"
  exit 1
fi
if [[ ! -d node_modules ]]; then
  echo "首次运行：npm install…"
  npm install
fi
npm start
