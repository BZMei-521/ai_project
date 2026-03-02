#!/bin/bash
set -euo pipefail

HOST_INPUT="${1:-${STORYBOARD_WINDOWS_HOST:-xtzj-20250609lf}}"
PORT_INPUT="${2:-${STORYBOARD_WINDOWS_PORT:-3210}}"

if [[ "$HOST_INPUT" == http://* || "$HOST_INPUT" == https://* ]]; then
  BASE_URL="${HOST_INPUT%/}"
else
  BASE_URL="http://${HOST_INPUT}:${PORT_INPUT}"
fi

URL="${BASE_URL}/api/runtime-log/latest"

CONTENT="$(curl -fsS --max-time 5 "$URL")"
if [[ -z "$CONTENT" ]]; then
  echo "[WARN] Windows runtime log is empty at ${URL}"
  echo "[WARN] Trigger an action in the Windows UI first, for example: Detect Connection or Generate."
  exit 2
fi

printf "%s" "$CONTENT" | pbcopy

echo "[INFO] Copied latest Windows runtime log from ${URL} to clipboard"
