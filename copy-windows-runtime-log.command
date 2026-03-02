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
STARTUP_URL="${BASE_URL}/api/startup-log/latest"

CONTENT="$(curl -fsS --max-time 5 "$URL")"
if [[ -z "$CONTENT" ]]; then
  STARTUP_CONTENT="$(curl -fsS --max-time 5 "$STARTUP_URL")"
  if [[ -z "$STARTUP_CONTENT" ]]; then
    echo "[WARN] Windows runtime log is empty at ${URL}"
    echo "[WARN] Windows startup log is also empty at ${STARTUP_URL}"
    echo "[WARN] Trigger an action in the Windows UI first, for example: Detect Connection or Generate."
    exit 2
  fi
  printf "%s" "$STARTUP_CONTENT" | pbcopy
  echo "[INFO] Runtime log is empty. Copied Windows startup log from ${STARTUP_URL} to clipboard"
  exit 0
fi

printf "%s" "$CONTENT" | pbcopy

echo "[INFO] Copied latest Windows runtime log from ${URL} to clipboard"
