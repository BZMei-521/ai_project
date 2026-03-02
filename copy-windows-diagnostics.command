#!/bin/bash
set -euo pipefail

HOST_INPUT="${1:-${STORYBOARD_WINDOWS_HOST:-xtzj-20250609lf}}"
PORT_INPUT="${2:-${STORYBOARD_WINDOWS_PORT:-3210}}"

if [[ "$HOST_INPUT" == http://* || "$HOST_INPUT" == https://* ]]; then
  BASE_URL="${HOST_INPUT%/}"
else
  BASE_URL="http://${HOST_INPUT}:${PORT_INPUT}"
fi

URL="${BASE_URL}/api/diagnostics"
CONTENT="$(curl -fsS --max-time 8 "$URL")"

if [[ -z "$CONTENT" ]]; then
  echo "[WARN] Windows diagnostics payload is empty at ${URL}"
  exit 2
fi

printf "%s" "$CONTENT" | pbcopy
echo "[INFO] Copied Windows diagnostics payload from ${URL} to clipboard"
