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

if ! command -v python3 >/dev/null 2>&1; then
  printf "%s" "$CONTENT" | pbcopy
  echo "[WARN] python3 not found. Copied raw diagnostics JSON from ${URL} to clipboard"
  exit 0
fi

TMP_FILE="$(mktemp)"
printf "%s" "$CONTENT" > "$TMP_FILE"

SUMMARY="$(
python3 - <<'PY' "$TMP_FILE"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
lines = []

def add(text=""):
    lines.append(text)

add("Windows Remote Diagnostics")
add(f"Runtime: {payload.get('runtime')}")
add(f"Build ID: {payload.get('build', {}).get('buildId')}")
add(f"Checked At: {payload.get('checkedAt')}")
bind = payload.get("bind", {})
add(f"Bind URL: {bind.get('bindUrl')}")
add(f"Browser URL: {bind.get('browserUrl')}")
add(f"Listening PID: {payload.get('portStatus', {}).get('pid')}")
add("")

comfy = payload.get("comfy", {})
config = comfy.get("config", {})
ping = comfy.get("ping", {})
add("Comfy")
add(f"- Base URL: {config.get('baseUrl')}")
add(f"- Root Dir: {config.get('comfyRootDir')}")
add(f"- Video Mode: {config.get('videoGenerationMode')}")
add(f"- Ping OK: {ping.get('ok')}")
add(f"- Ping Message: {ping.get('message')}")

pipeline_error = (comfy.get("pipelineLastError") or "").strip()
if pipeline_error:
    add(f"- Latest Pipeline Error: {pipeline_error}")

server_tail = comfy.get("serverLogTail", {})
if server_tail.get("lastErrorLine"):
    add(f"- Latest Server Error: {server_tail.get('lastErrorLine')}")

dependency_report = comfy.get("dependencyReport", {})
add(f"- object_info Available: {dependency_report.get('objectInfoAvailable')}")
if dependency_report.get("objectInfoError"):
    add(f"- object_info Error: {dependency_report.get('objectInfoError')}")

for workflow_name in ("image", "video", "audio", "sound"):
    workflow = dependency_report.get("workflows", {}).get(workflow_name, {})
    if not workflow:
        continue
    add(f"- {workflow_name.title()} Workflow Configured: {workflow.get('configured')}")
    if workflow.get("parseError"):
        add(f"  Parse Error: {workflow.get('parseError')}")
        continue
    add(
        f"  Nodes: {workflow.get('availableNodeTypes')}/{workflow.get('totalNodeTypes')}"
    )
    missing = workflow.get("missingNodeTypes") or []
    if missing:
        add(f"  Missing Nodes: {', '.join(missing[:20])}")
    hints = workflow.get("hints") or []
    plugins = [item.get("plugin") for item in hints if item.get("plugin")]
    if plugins:
        add(f"  Suggested Plugins: {', '.join(plugins)}")

add("")
for label in ("runtime", "startup"):
    entry = payload.get("logs", {}).get(label, {})
    add(f"{label.title()} Log")
    add(f"- Exists: {entry.get('exists')}")
    add(f"- Bytes: {entry.get('bytes')}")
    add(f"- Updated: {entry.get('updatedAt')}")
    preview = (entry.get("preview") or "").strip()
    if preview:
        add("- Preview:")
        add(preview)
    add("")

print("\n".join(lines).rstrip())
PY
)"

rm -f "$TMP_FILE"
printf "%s" "$SUMMARY" | pbcopy
echo "[INFO] Copied Windows diagnostics summary from ${URL} to clipboard"
