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
DIAGNOSTICS_URL="${BASE_URL}/api/diagnostics"
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
echo "[INFO] Checking diagnostics endpoint..."
if DIAGNOSTICS_RESPONSE="$(curl -fsS --max-time 8 "${DIAGNOSTICS_URL}")"; then
  if command -v python3 >/dev/null 2>&1; then
    DIAG_FILE="$(mktemp)"
    printf "%s" "${DIAGNOSTICS_RESPONSE}" > "${DIAG_FILE}"
    python3 - <<'PY' "${DIAG_FILE}"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
print(f"[INFO] Runtime: {payload.get('runtime')}")
print(f"[INFO] Build ID: {payload.get('build', {}).get('buildId')}")
print(f"[INFO] Dist dir: {payload.get('build', {}).get('distDir')}")
print(f"[INFO] Checked at: {payload.get('checkedAt')}")
bind = payload.get('bind', {})
print(f"[INFO] Bind URL: {bind.get('bindUrl')}")
print(f"[INFO] Browser URL: {bind.get('browserUrl')}")
print(f"[INFO] Listening PID: {payload.get('portStatus', {}).get('pid')}")

comfy = payload.get("comfy", {})
config = comfy.get("config", {})
ping = comfy.get("ping", {})
print(f"[INFO] Comfy base URL: {config.get('baseUrl')}")
print(f"[INFO] Comfy root dir: {config.get('comfyRootDir')}")
print(f"[INFO] Comfy video mode: {config.get('videoGenerationMode')}")
print(f"[INFO] Comfy ping ok: {ping.get('ok')}")
print(f"[INFO] Comfy ping message: {ping.get('message')}")
pipeline_error = (comfy.get("pipelineLastError") or "").strip()
if pipeline_error:
    print("[INFO] Latest Comfy pipeline error:")
    print(pipeline_error)
server_tail = comfy.get("serverLogTail", {})
if server_tail.get("lastErrorLine"):
    print("[INFO] Latest Comfy server error line:")
    print(server_tail.get("lastErrorLine"))
preview = (server_tail.get("preview") or "").strip()
if preview:
    print("[INFO] Latest Comfy server log preview:")
    print(preview)
dependency_report = comfy.get("dependencyReport", {})
print(f"[INFO] Comfy object_info available: {dependency_report.get('objectInfoAvailable')}")
if dependency_report.get("objectInfoError"):
    print("[WARN] Comfy object_info error:")
    print(dependency_report.get("objectInfoError"))
for workflow_name in ("image", "video", "audio", "sound"):
    workflow = dependency_report.get("workflows", {}).get(workflow_name, {})
    if not workflow:
        continue
    print(f"[INFO] {workflow_name.title()} workflow configured: {workflow.get('configured')}")
    if workflow.get("parseError"):
        print(f"[WARN] {workflow_name.title()} workflow parse error: {workflow.get('parseError')}")
        continue
    print(
        f"[INFO] {workflow_name.title()} workflow nodes: "
        f"{workflow.get('availableNodeTypes')}/{workflow.get('totalNodeTypes')}"
    )
    missing = workflow.get("missingNodeTypes") or []
    if missing:
        print(f"[WARN] {workflow_name.title()} missing nodes: {', '.join(missing[:12])}")
    hints = workflow.get("hints") or []
    if hints:
        plugins = [item.get("plugin") for item in hints if item.get("plugin")]
        if plugins:
            print(f"[WARN] {workflow_name.title()} suggested plugins: {', '.join(plugins)}")

for label in ("runtime", "startup"):
    entry = payload.get("logs", {}).get(label, {})
    print(f"[INFO] {label.title()} log exists: {entry.get('exists')}")
    print(f"[INFO] {label.title()} log bytes: {entry.get('bytes')}")
    print(f"[INFO] {label.title()} log updated: {entry.get('updatedAt')}")
    preview = (entry.get("preview") or "").strip()
    if preview:
        print(f"[INFO] Latest {label} log preview:")
        print(preview)
    else:
        print(f"[WARN] {label.title()} log preview is empty")
PY
    rm -f "${DIAG_FILE}"
  else
    echo "${DIAGNOSTICS_RESPONSE}"
  fi
  echo
  echo "[RESULT] Remote Windows access check passed"
  exit 0
fi

echo "[WARN] Diagnostics endpoint unavailable. Falling back to legacy endpoints."
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
