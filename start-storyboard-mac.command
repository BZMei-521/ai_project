#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 Node.js。请先安装 Node.js 18+。"
  read -r -p "按回车键退出..." _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 npm。请先安装 Node.js 18+。"
  read -r -p "按回车键退出..." _
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 Rust / cargo。Mac 桌面入口需要 Rust 与 Tauri 环境。"
  read -r -p "按回车键退出..." _
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[ERROR] 未找到 node_modules。请先在项目目录执行 npm install。"
  read -r -p "按回车键退出..." _
  exit 1
fi

echo "[INFO] 正在启动 Storyboard Pro Mac 桌面版..."
npm run tauri:dev
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "[ERROR] 启动失败，退出码: $STATUS"
  read -r -p "按回车键退出..." _
  exit "$STATUS"
fi
