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
LAST_HASH=""

echo "[INFO] Watching Windows runtime log: ${URL}"
echo "[INFO] Press Ctrl+C to stop."

while true; do
  CONTENT="$(curl -fsS --max-time 3 "$URL" 2>/dev/null || true)"
  if [[ -n "$CONTENT" ]]; then
    CURRENT_HASH="$(printf "%s" "$CONTENT" | shasum | awk '{print $1}')"
    if [[ "$CURRENT_HASH" != "$LAST_HASH" ]]; then
      printf "%s" "$CONTENT" | pbcopy
      echo "[INFO] $(date '+%H:%M:%S') copied latest Windows runtime log to clipboard"
      LAST_HASH="$CURRENT_HASH"
    fi
  fi
  sleep 2
done
