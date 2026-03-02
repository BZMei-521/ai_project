#!/bin/bash
set -euo pipefail

HOST_INPUT="${1:-${STORYBOARD_WINDOWS_HOST:-xtzj-20250609lf}}"
PORT_INPUT="${2:-${STORYBOARD_WINDOWS_PORT:-3210}}"

if [[ "$HOST_INPUT" == http://* || "$HOST_INPUT" == https://* ]]; then
  BASE_URL="${HOST_INPUT%/}"
else
  BASE_URL="http://${HOST_INPUT}:${PORT_INPUT}"
fi

HEALTH_URL="${BASE_URL}/api/health"
LOG_URL="${BASE_URL}/api/runtime-log/latest"
STARTUP_LOG_URL="${BASE_URL}/api/startup-log/latest"

echo "[INFO] Checking remote Windows access"
echo "[INFO] Base URL: ${BASE_URL}"
echo

if command -v tailscale >/dev/null 2>&1; then
  echo "[INFO] Local Tailscale detected"
  tailscale ip -4 2>/dev/null | sed 's/^/[INFO] Local Tailscale IPv4: /' || true
else
  echo "[WARN] Local Tailscale command not found"
fi

echo
echo "[INFO] Checking health endpoint..."
HEALTH_RESPONSE="$(curl -fsS --max-time 5 "${HEALTH_URL}")"
echo "${HEALTH_RESPONSE}"

echo
echo "[INFO] Checking runtime log endpoint..."
LOG_RESPONSE="$(curl -fsS --max-time 5 "${LOG_URL}")"

if [[ -z "${LOG_RESPONSE}" ]]; then
  echo "[WARN] Runtime log is currently empty"
  echo "[INFO] Checking startup log endpoint..."
  STARTUP_LOG_RESPONSE="$(curl -fsS --max-time 5 "${STARTUP_LOG_URL}")"
  if [[ -z "${STARTUP_LOG_RESPONSE}" ]]; then
    echo "[WARN] Startup log is currently empty"
  else
    if command -v python3 >/dev/null 2>&1; then
      STARTUP_LOG_LENGTH="$(printf "%s" "${STARTUP_LOG_RESPONSE}" | python3 -c 'import sys; print(len(sys.stdin.read()))')"
    else
      STARTUP_LOG_LENGTH="$(printf "%s" "${STARTUP_LOG_RESPONSE}" | wc -c | tr -d ' ')"
    fi
    echo "[INFO] Startup log bytes: ${STARTUP_LOG_LENGTH}"
    echo "[INFO] Latest startup log preview:"
    printf "%s\n" "${STARTUP_LOG_RESPONSE}" | sed -n '1,20p'
  fi
else
  if command -v python3 >/dev/null 2>&1; then
    LOG_LENGTH="$(printf "%s" "${LOG_RESPONSE}" | python3 -c 'import sys; print(len(sys.stdin.read()))')"
  else
    LOG_LENGTH="$(printf "%s" "${LOG_RESPONSE}" | wc -c | tr -d ' ')"
  fi
  echo "[INFO] Runtime log bytes: ${LOG_LENGTH}"
  echo "[INFO] Latest runtime log preview:"
  printf "%s\n" "${LOG_RESPONSE}" | sed -n '1,20p'
fi

echo
echo "[RESULT] Remote Windows access check passed"
