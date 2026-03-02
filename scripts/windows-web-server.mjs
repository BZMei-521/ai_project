#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fsSync, { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
let runtimeBuildInfo = {
  buildId: "unknown",
  assetFiles: [],
  distDir
};

const cli = parseCliArgs(process.argv.slice(2));
const host = cli.host || "127.0.0.1";
const port = Number.parseInt(cli.port || "3210", 10) || 3210;
const shouldOpen = cli.open === true;
const openHost = cli.openHost || (host === "0.0.0.0" ? "127.0.0.1" : host);

const dataRoot = resolveDataRoot();
const workspaceRoot = path.join(dataRoot, "workspace");
const currentProjectMarker = path.join(dataRoot, "current-project.txt");
const bridgeLogsRoot = path.join(dataRoot, "logs");
const pipelineRuntimeLogPath = path.join(bridgeLogsRoot, "pipeline-runtime-latest.log");
const comfyRuntimeConfigPath = path.join(bridgeLogsRoot, "comfy-runtime-config.json");
const startupLogPath = path.join(projectRoot, "logs", "windows-web-latest.log");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a", ".opus"]);

async function main() {
  await ensureDir(dataRoot);
  await ensureDir(workspaceRoot);
  await ensureDir(bridgeLogsRoot);
  await assertDistReady();
  runtimeBuildInfo = await resolveBuildInfo();

  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Comfy server log not found under:/i.test(message)) {
        console.warn(`[bridge] ${message}`);
      } else if (/missing_node_type|prompt_outputs_failed_validation/i.test(message)) {
        console.warn(`[bridge] comfy request failed: ${message}`);
      } else {
        console.error("[bridge] request failed", error);
      }
      sendJson(res, 500, {
        error: message
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const bindUrl = `http://${host}:${port}`;
  const browserUrl = `http://${openHost}:${port}`;
  console.log(`[INFO] Storyboard Pro Windows Web Bridge running at ${bindUrl}`);
  console.log(`[INFO] Workspace: ${workspaceRoot}`);
  console.log(`[INFO] Build: ${runtimeBuildInfo.buildId}`);
  console.log(`[INFO] Dist: ${runtimeBuildInfo.distDir}`);
  if (browserUrl !== bindUrl) {
    console.log(`[INFO] Browser URL: ${browserUrl}`);
  }

  if (shouldOpen) {
    openUrl(browserUrl).catch((error) => {
      console.error(`[WARN] Failed to open browser automatically: ${String(error)}`);
    });
  }
}

function parseCliArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--open") {
      output.open = true;
      continue;
    }
    if (token === "--host") {
      output.host = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token.startsWith("--host=")) {
      output.host = token.slice("--host=".length);
      continue;
    }
    if (token === "--port") {
      output.port = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token.startsWith("--port=")) {
      output.port = token.slice("--port=".length);
      continue;
    }
    if (token === "--open-host") {
      output.openHost = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token.startsWith("--open-host=")) {
      output.openHost = token.slice("--open-host=".length);
    }
  }
  return output;
}

function resolveDataRoot() {
  if (process.env.STORYBOARD_WEB_DATA_DIR?.trim()) {
    return path.resolve(process.env.STORYBOARD_WEB_DATA_DIR.trim());
  }
  if (process.platform === "win32" && process.env.APPDATA?.trim()) {
    return path.join(process.env.APPDATA.trim(), "StoryboardProWeb");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "StoryboardProWeb");
  }
  return path.join(os.homedir(), ".storyboard-pro-web");
}

async function assertDistReady() {
  const stat = await safeStat(path.join(distDir, "index.html"));
  if (!stat?.isFile()) {
    throw new Error(`dist/index.html not found in ${distDir}. Run npm run web:build first.`);
  }
}

async function resolveBuildInfo() {
  const indexHtmlPath = path.join(distDir, "index.html");
  const indexHtml = (await safeReadText(indexHtmlPath)) ?? "";
  const assetsDir = path.join(distDir, "assets");
  const entries = await safeReadDir(assetsDir);
  const assetFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const htmlMatch =
    indexHtml.match(/assets\/(index-[^"'?#]+\.js)/i) ??
    indexHtml.match(/assets\/(index-[^"'?#]+\.css)/i);
  const buildId =
    htmlMatch?.[1] ??
    assetFiles.find((name) => /^index-[^.]+\.js$/i.test(name)) ??
    assetFiles.find((name) => /^index-[^.]+\.css$/i.test(name)) ??
    assetFiles[0] ??
    "unknown";
  return {
    buildId,
    assetFiles,
    distDir
  };
}

async function routeRequest(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

  if (requestUrl.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      runtime: "windows-web-bridge",
      dataRoot,
      workspaceRoot,
      buildId: runtimeBuildInfo.buildId,
      distDir: runtimeBuildInfo.distDir,
      assetFiles: runtimeBuildInfo.assetFiles
    });
  }

  if (requestUrl.pathname === "/api/diagnostics") {
    return serveDiagnostics(res);
  }

  if (requestUrl.pathname === "/api/runtime-log/latest") {
    return serveRuntimeLog(res);
  }

  if (requestUrl.pathname === "/api/startup-log/latest") {
    return serveStartupLog(res);
  }

  if (requestUrl.pathname === "/api/local-file") {
    return serveLocalFile(requestUrl, res);
  }

  if (requestUrl.pathname.startsWith("/api/invoke/")) {
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method Not Allowed" });
    }
    const cmd = decodeURIComponent(requestUrl.pathname.slice("/api/invoke/".length));
    const args = await readJsonBody(req);
    const result = await invokeCommand(cmd, args);
    return sendJson(res, 200, { result });
  }

  return serveDistAsset(requestUrl.pathname, res);
}

async function serveDistAsset(rawPathname, res) {
  const pathname = rawPathname === "/" ? "/index.html" : rawPathname;
  const resolved = safeResolveInside(distDir, pathname);
  if (!resolved) {
    return sendText(res, 403, "Forbidden");
  }

  let finalPath = resolved;
  let stat = await safeStat(finalPath);

  if (!stat) {
    finalPath = path.join(distDir, "index.html");
    stat = await safeStat(finalPath);
    if (!stat) {
      return sendText(res, 404, "Not Found");
    }
  }

  if (stat.isDirectory()) {
    finalPath = path.join(finalPath, "index.html");
    stat = await safeStat(finalPath);
    if (!stat?.isFile()) {
      return sendText(res, 404, "Not Found");
    }
  }

  if (path.basename(finalPath) === "index.html") {
    let html = await fs.readFile(finalPath, "utf8");
    if (!html.includes("__STORYBOARD_WEB_BRIDGE__")) {
      html = html.replace(
        /<head>/i,
        '<head><script>window.__STORYBOARD_WEB_BRIDGE__=true;</script>'
      );
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(html);
    return;
  }

  const data = await fs.readFile(finalPath);
  res.writeHead(200, {
    "Content-Type": contentTypeForPath(finalPath),
    "Cache-Control": "no-store"
  });
  res.end(data);
}

async function serveLocalFile(requestUrl, res) {
  const raw = requestUrl.searchParams.get("path") || "";
  if (!raw.trim()) {
    return sendJson(res, 400, { error: "path is required" });
  }
  const filePath = path.resolve(raw);
  const stat = await safeStat(filePath);
  if (!stat?.isFile()) {
    return sendJson(res, 404, { error: "file not found" });
  }
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeForPath(filePath),
    "Cache-Control": "no-store"
  });
  res.end(data);
}

async function serveRuntimeLog(res) {
  const text = (await safeReadText(pipelineRuntimeLogPath)) ?? "";
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

async function serveDiagnostics(res) {
  const runtimeLog = await buildLogSummary(pipelineRuntimeLogPath, 40);
  const startupLog = await buildLogSummary(startupLogPath, 40);
  const portPid = await detectListeningPid(port);
  const comfyConfig = await readJsonFile(comfyRuntimeConfigPath);
  const comfyDiagnostics = await buildComfyDiagnostics(comfyConfig, runtimeLog);

  return sendJson(res, 200, {
    ok: true,
    runtime: "windows-web-bridge",
    checkedAt: new Date().toISOString(),
    bind: {
      host,
      port,
      openHost,
      browserUrl: `http://${openHost}:${port}`,
      bindUrl: `http://${host}:${port}`
    },
    build: runtimeBuildInfo,
    paths: {
      dataRoot,
      workspaceRoot,
      bridgeLogsRoot,
      pipelineRuntimeLogPath,
      startupLogPath
    },
    portStatus: {
      port,
      pid: portPid
    },
    comfy: comfyDiagnostics,
    logs: {
      runtime: runtimeLog,
      startup: startupLog
    }
  });
}

async function serveStartupLog(res) {
  const text = (await safeReadText(startupLogPath)) ?? "";
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

async function buildLogSummary(filePath, previewLines = 20) {
  const stat = await safeStat(filePath);
  const text = (await safeReadText(filePath)) ?? "";
  const lines = text ? text.split(/\r?\n/) : [];
  return {
    path: filePath,
    exists: Boolean(stat?.isFile()),
    bytes: Buffer.byteLength(text, "utf8"),
    updatedAt: stat?.mtime?.toISOString?.() ?? null,
    lineCount: lines.filter((line) => line.length > 0).length,
    preview: lines.slice(-previewLines).join("\n"),
    text
  };
}

async function buildComfyDiagnostics(config, runtimeLog) {
  const normalizedConfig = {
    baseUrl: String(config?.baseUrl || "").trim(),
    comfyRootDir: String(config?.comfyRootDir || "").trim(),
    comfyInputDir: String(config?.comfyInputDir || "").trim(),
    outputDir: String(config?.outputDir || "").trim(),
    videoGenerationMode: String(config?.videoGenerationMode || "").trim(),
    imageWorkflowJson: String(config?.imageWorkflowJson || ""),
    videoWorkflowJson: String(config?.videoWorkflowJson || ""),
    audioWorkflowJson: String(config?.audioWorkflowJson || ""),
    soundWorkflowJson: String(config?.soundWorkflowJson || ""),
    updatedAt: String(config?.updatedAt || "").trim() || null
  };
  const baseUrl = normalizedConfig.baseUrl ? normalizeBaseUrl(normalizedConfig.baseUrl) : "";
  const ping = baseUrl ? await comfyPing(baseUrl) : { ok: false, statusCode: null, message: "Comfy baseUrl not synced yet" };
  const pipelineLastError = extractLastComfyError(runtimeLog?.text || "");
  let dependencyReport = {
    objectInfoAvailable: false,
    objectInfoError: "",
    workflows: {}
  };
  let serverLogTail = {
    available: false,
    path: null,
    preview: "",
    error: "",
    lastErrorLine: ""
  };

  if (normalizedConfig.comfyRootDir && baseUrl) {
    try {
      const resolvedLogPath = await resolveComfyServerLogPath(normalizedConfig.comfyRootDir, baseUrl);
      const tail = await comfyReadServerLogTail(normalizedConfig.comfyRootDir, baseUrl, 80);
      serverLogTail = {
        available: true,
        path: resolvedLogPath || null,
        preview: tail.split(/\r?\n/).slice(-40).join("\n"),
        error: "",
        lastErrorLine: extractLastErrorLine(tail)
      };
    } catch (error) {
      serverLogTail = {
        available: false,
        path: null,
        preview: "",
        error: error instanceof Error ? error.message : String(error),
        lastErrorLine: ""
      };
    }
  }

  if (baseUrl && ping?.ok) {
    try {
      const objectInfo = await comfyGetObjectInfo(baseUrl);
      dependencyReport = {
        objectInfoAvailable: true,
        objectInfoError: "",
        workflows: {
          image: inspectWorkflowDependencyReport(normalizedConfig.imageWorkflowJson, objectInfo),
          video: inspectWorkflowDependencyReport(normalizedConfig.videoWorkflowJson, objectInfo),
          audio: inspectWorkflowDependencyReport(normalizedConfig.audioWorkflowJson, objectInfo),
          sound: inspectWorkflowDependencyReport(normalizedConfig.soundWorkflowJson, objectInfo)
        }
      };
    } catch (error) {
      dependencyReport = {
        objectInfoAvailable: false,
        objectInfoError: error instanceof Error ? error.message : String(error),
        workflows: {}
      };
    }
  }

  return {
    config: normalizedConfig,
    ping,
    pipelineLastError,
    dependencyReport,
    serverLogTail
  };
}

function extractLastComfyError(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!/\[ERROR\]/i.test(line)) continue;
    if (/comfy|workflow|prompt|节点|node|history|object_info|system_stats/i.test(line)) {
      return line;
    }
  }
  return "";
}

function extractLastErrorLine(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/error|exception|traceback|not found|failed|missing/i.test(line)) {
      return line;
    }
  }
  return "";
}

const NODE_HINT_MAP = [
  { pattern: /qwen|qwenedit|imageeditplus/i, plugin: "qweneditutils", repo: "https://github.com/kijai/ComfyUI-Qwen-Image-Edit" },
  { pattern: /rgthree|power lora loader/i, plugin: "rgthree-comfy", repo: "https://github.com/rgthree/rgthree-comfy" },
  { pattern: /kjnodes|sageattention|modelpatchtorchsettings|intconstant|pathchsageattention|simplemath\+/i, plugin: "ComfyUI-KJNodes", repo: "https://github.com/kijai/ComfyUI-KJNodes" },
  { pattern: /wan|wanvideo|wanmoe|wan.*ksampler/i, plugin: "ComfyUI-WanMoeKSampler / ComfyUI-wanBlockswap", repo: "https://github.com/stduhpf/ComfyUI-WanMoeKSampler" },
  { pattern: /impact|detailer|segs/i, plugin: "ComfyUI-Impact-Pack", repo: "https://github.com/ltdrdata/ComfyUI-Impact-Pack" },
  { pattern: /animatediff|motion/i, plugin: "ComfyUI-AnimateDiff-Evolved", repo: "https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved" },
  { pattern: /rife|vfi|frame interpolation/i, plugin: "comfyui-frame-interpolation", repo: "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation" },
  { pattern: /controlnet|advancedcontrolnet|acn_/i, plugin: "ComfyUI-Advanced-ControlNet", repo: "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet" },
  { pattern: /ipadapter/i, plugin: "comfyui_ipadapter_plus", repo: "https://github.com/cubiq/ComfyUI_IPAdapter_plus" },
  { pattern: /vhs|videohelper|loadvideo|savevideo/i, plugin: "comfyui-videohelpersuite", repo: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite" },
  { pattern: /easy.*use/i, plugin: "comfyui-easy-use", repo: "https://github.com/yolain/ComfyUI-Easy-Use" }
];

function inspectWorkflowDependencyReport(workflowJson, objectInfo) {
  const raw = String(workflowJson || "").trim();
  if (!raw) {
    return {
      configured: false,
      parseError: "",
      totalNodeTypes: 0,
      availableNodeTypes: 0,
      missingNodeTypes: [],
      hints: []
    };
  }
  try {
    const workflow = ensureWorkflowJsonText(raw);
    const requiredNodeTypes = extractWorkflowNodeTypesFromJson(workflow);
    if (requiredNodeTypes.length === 0) {
      return {
        configured: true,
        parseError: "",
        totalNodeTypes: 0,
        availableNodeTypes: 0,
        missingNodeTypes: [],
        hints: []
      };
    }
    const availableTypes = new Set(Object.keys(objectInfo || {}));
    const missingNodeTypes = requiredNodeTypes.filter((type) => !availableTypes.has(type));
    return {
      configured: true,
      parseError: "",
      totalNodeTypes: requiredNodeTypes.length,
      availableNodeTypes: requiredNodeTypes.length - missingNodeTypes.length,
      missingNodeTypes,
      hints: buildDependencyHints(missingNodeTypes)
    };
  } catch (error) {
    return {
      configured: true,
      parseError: error instanceof Error ? error.message : String(error),
      totalNodeTypes: 0,
      availableNodeTypes: 0,
      missingNodeTypes: [],
      hints: []
    };
  }
}

function ensureWorkflowJsonText(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("workflow JSON must be an object");
  }
  return parsed;
}

function extractWorkflowNodeTypesFromJson(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const nodeTypes = nodes
    .map((node) => (node && typeof node === "object" && typeof node.type === "string" ? node.type.trim() : ""))
    .filter((type) => type.length > 0);
  return uniquePreserveOrder(nodeTypes);
}

function buildDependencyHints(missingNodeTypes) {
  const hints = [];
  for (const nodeType of missingNodeTypes) {
    for (const rule of NODE_HINT_MAP) {
      if (!rule.pattern.test(nodeType)) continue;
      if (hints.some((item) => item.plugin === rule.plugin)) continue;
      hints.push({ plugin: rule.plugin, repo: rule.repo });
    }
  }
  return hints;
}

async function detectListeningPid(targetPort) {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const { stdout } = await runCommand("cmd", ["/c", `netstat -ano | findstr :${targetPort}`]);
    const match = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => /LISTENING/i.test(line));
    if (!match) return null;
    const columns = match.split(/\s+/);
    return columns.at(-1) || null;
  } catch {
    return null;
  }
}

async function invokeCommand(cmd, args) {
  switch (cmd) {
    case "find_missing_paths":
      return findMissingPaths(args?.paths);
    case "save_current_project":
      return saveCurrentProject(args?.snapshot);
    case "load_current_project":
      return loadCurrentProject();
    case "list_workspace_projects":
      return listWorkspaceProjects();
    case "create_workspace_project":
      return createWorkspaceProject(args?.name);
    case "select_workspace_project":
      return selectWorkspaceProject(args?.projectPath);
    case "rename_workspace_project":
      return renameWorkspaceProject(args?.projectPath, args?.newName);
    case "delete_workspace_project":
      return deleteWorkspaceProject(args?.projectPath);
    case "list_export_logs":
      return listExportLogs(args?.limit);
    case "clear_export_logs":
      return clearExportLogs();
    case "open_path_in_os":
      return openPathInOS(args?.path);
    case "write_base64_file":
      return writeBase64File(args?.filePath, args?.base64Data);
    case "copy_file_to":
      return copyFileTo(args?.sourcePath, args?.targetPath);
    case "export_animatic_from_frames":
      return exportAnimaticFromFrames(args);
    case "concat_video_segments":
      return concatVideoSegments(args?.videoPaths);
    case "mux_video_with_audio_tracks":
      return muxVideoWithAudioTracks(args);
    case "generate_local_video_from_images":
      return generateLocalVideoFromImages(args);
    case "comfy_ping":
      return comfyPing(args?.baseUrl);
    case "comfy_queue_prompt":
      return comfyQueuePrompt(args?.baseUrl, args?.prompt, args?.clientId);
    case "comfy_get_history":
      return comfyGetHistory(args?.baseUrl, args?.promptId);
    case "comfy_fetch_view_base64":
      return comfyFetchViewBase64(args?.url);
    case "comfy_discover_endpoints":
      return comfyDiscoverEndpoints();
    case "comfy_discover_local_dirs":
      return comfyDiscoverLocalDirs();
    case "comfy_get_object_info":
      return comfyGetObjectInfo(args?.baseUrl);
    case "comfy_install_plugins":
      return comfyInstallPlugins(args?.comfyRootDir, args?.repos);
    case "comfy_check_model_health":
      return comfyCheckModelHealth(args?.comfyRootDir);
    case "comfy_read_server_log_tail":
      return comfyReadServerLogTail(args?.comfyRootDir, args?.baseUrl, args?.maxLines);
    case "save_pipeline_logs":
      return savePipelineLogs(args?.text);
    case "save_comfy_runtime_config":
      return saveComfyRuntimeConfig(args?.config);
    case "read_pipeline_logs":
      return readPipelineLogs();
    default:
      throw new Error(`Unsupported bridge command: ${cmd}`);
  }
}

async function savePipelineLogs(text) {
  await ensureDir(bridgeLogsRoot);
  await fs.writeFile(pipelineRuntimeLogPath, typeof text === "string" ? text : "", "utf8");
  return { path: pipelineRuntimeLogPath };
}

async function saveComfyRuntimeConfig(config) {
  await ensureDir(bridgeLogsRoot);
  const next = {
    baseUrl: String(config?.baseUrl || "").trim(),
    comfyRootDir: String(config?.comfyRootDir || "").trim(),
    comfyInputDir: String(config?.comfyInputDir || "").trim(),
    outputDir: String(config?.outputDir || "").trim(),
    videoGenerationMode: String(config?.videoGenerationMode || "").trim(),
    imageWorkflowJson: String(config?.imageWorkflowJson || ""),
    videoWorkflowJson: String(config?.videoWorkflowJson || ""),
    audioWorkflowJson: String(config?.audioWorkflowJson || ""),
    soundWorkflowJson: String(config?.soundWorkflowJson || ""),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(comfyRuntimeConfigPath, JSON.stringify(next, null, 2), "utf8");
  return { path: comfyRuntimeConfigPath };
}

async function readPipelineLogs() {
  return (await safeReadText(pipelineRuntimeLogPath)) ?? "";
}

async function findMissingPaths(paths) {
  const input = Array.isArray(paths) ? paths : [];
  return input.filter((item) => {
    const value = String(item || "").trim();
    return value && !pathExists(value);
  });
}

async function saveCurrentProject(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("snapshot is required");
  }
  const projectDir = await resolveCurrentProjectDir();
  await ensureDir(projectDir);
  await fs.writeFile(snapshotPath(projectDir), JSON.stringify(snapshot, null, 2), "utf8");

  const project = snapshot.project && typeof snapshot.project === "object" ? snapshot.project : {};
  const projectJson = {
    schemaVersion: 1,
    projectId: String(project.id || ""),
    name: String(project.name || path.basename(projectDir, ".sbproj")),
    fps: Number(project.fps || 24),
    resolution: {
      width: Number(project.width || 1920),
      height: Number(project.height || 1080)
    },
    createdAt: String(project.createdAt || new Date().toISOString()),
    updatedAt: String(project.updatedAt || new Date().toISOString())
  };
  await fs.writeFile(path.join(projectDir, "project.json"), JSON.stringify(projectJson, null, 2), "utf8");
  return { projectPath: projectDir };
}

async function loadCurrentProject() {
  const projectDir = await resolveCurrentProjectDir();
  const file = snapshotPath(projectDir);
  if (!(await fileExists(file))) return null;
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function listWorkspaceProjects() {
  await ensureDir(workspaceRoot);
  const current = await resolveCurrentProjectDir();
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  return entries
    .filter((item) => item.isDirectory() && item.name.endsWith(".sbproj"))
    .map((item) => {
      const projectPath = path.join(workspaceRoot, item.name);
      return {
        name: item.name.replace(/\.sbproj$/i, ""),
        path: projectPath,
        isCurrent: normalizePath(projectPath) === normalizePath(current)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

async function createWorkspaceProject(name) {
  const slug = slugifyProjectName(String(name || ""));
  const projectDir = path.join(workspaceRoot, `${slug}.sbproj`);
  await ensureDir(projectDir);
  await setCurrentProjectPath(projectDir);
  return { projectPath: projectDir };
}

async function selectWorkspaceProject(projectPath) {
  const target = path.resolve(String(projectPath || ""));
  if (!(await fileExists(target))) throw new Error("Selected project path does not exist");
  if (!target.endsWith(".sbproj")) throw new Error("Selected project path must end with .sbproj");
  await setCurrentProjectPath(target);
  return { projectPath: target };
}

async function renameWorkspaceProject(projectPath, newName) {
  const source = path.resolve(String(projectPath || ""));
  if (!(await fileExists(source))) throw new Error("Project path is invalid");
  const target = path.join(workspaceRoot, `${slugifyProjectName(String(newName || ""))}.sbproj`);
  if (normalizePath(source) !== normalizePath(target) && (await fileExists(target))) {
    throw new Error("A project with the same name already exists");
  }
  await fs.rename(source, target);
  const current = await resolveCurrentProjectDir();
  if (normalizePath(current) === normalizePath(source)) {
    await setCurrentProjectPath(target);
  }
  return { projectPath: target };
}

async function deleteWorkspaceProject(projectPath) {
  const target = path.resolve(String(projectPath || ""));
  if (!target.endsWith(".sbproj")) throw new Error("Project path is invalid");
  await fs.rm(target, { recursive: true, force: true });
  const projects = await listWorkspaceProjects();
  if (projects.length === 0) {
    const fallback = fallbackProjectDir();
    await ensureDir(fallback);
    await setCurrentProjectPath(fallback);
  } else if (!projects.some((item) => item.isCurrent)) {
    await setCurrentProjectPath(projects[0].path);
  }
  return listWorkspaceProjects();
}

async function listExportLogs(limit) {
  const projectDir = await resolveCurrentProjectDir();
  const logPath = path.join(await exportsDir(projectDir), "export-log.jsonl");
  if (!(await fileExists(logPath))) return [];
  const raw = await fs.readFile(logPath, "utf8");
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
  return rows.slice(0, Math.max(1, Number(limit || 30)));
}

async function clearExportLogs() {
  const projectDir = await resolveCurrentProjectDir();
  const logPath = path.join(await exportsDir(projectDir), "export-log.jsonl");
  if (await fileExists(logPath)) {
    await fs.rm(logPath, { force: true });
  }
}

async function openPathInOS(targetPath) {
  const resolved = path.resolve(String(targetPath || ""));
  if (!(await fileExists(resolved))) {
    throw new Error("Path does not exist");
  }
  if (process.platform === "win32") {
    await runCommand("explorer", [resolved]);
  } else if (process.platform === "darwin") {
    await runCommand("open", [resolved]);
  } else {
    await runCommand("xdg-open", [resolved]);
  }
  return { openedPath: resolved };
}

async function writeBase64File(filePath, base64Data) {
  const target = path.resolve(String(filePath || ""));
  if (!target) throw new Error("filePath is empty");
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, Buffer.from(String(base64Data || ""), "base64"));
  return { filePath: target };
}

async function copyFileTo(sourcePath, targetPath) {
  const source = path.resolve(String(sourcePath || ""));
  const target = path.resolve(String(targetPath || ""));
  if (!(await fileExists(source))) {
    throw new Error(`Source file not found: ${source}`);
  }
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  return { filePath: target };
}

async function exportAnimaticFromFrames(args) {
  const projectDir = await resolveCurrentProjectDir();
  const frames = Array.isArray(args?.frames) ? args.frames : [];
  if (frames.length === 0) throw new Error("No frames provided for export");
  const fps = Math.max(1, Number(args?.fps || 24));
  const bitrate = Math.max(500, Number(args?.videoBitrateKbps || 8000));
  const frameOutputDir = await createTempExportDir(projectDir, "frames");
  const outputPath = await nextExportFilePath(projectDir, ".mp4");
  try {
    let concatText = "";
    let lastFramePath = "";
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const framePath = path.join(frameOutputDir, `frame-${String(index).padStart(4, "0")}.png`);
      await fs.writeFile(framePath, Buffer.from(String(frame.pngBase64 || ""), "base64"));
      const durationSeconds = Math.max(1, Number(frame.durationFrames || 1)) / fps;
      concatText += `file '${escapeFfmpegPath(framePath)}'\n`;
      concatText += `duration ${durationSeconds.toFixed(6)}\n`;
      lastFramePath = framePath;
    }
    if (lastFramePath) {
      concatText += `file '${escapeFfmpegPath(lastFramePath)}'\n`;
    }

    const concatPath = path.join(frameOutputDir, "concat.txt");
    await fs.writeFile(concatPath, concatText, "utf8");

    const ffmpegArgs = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath
    ];

    const audioTracks = Array.isArray(args?.audioTracks) ? args.audioTracks : [];
    const validAudio = [];
    let inputIndex = 1;
    for (const track of audioTracks) {
      const filePath = String(track?.filePath || "").trim();
      if (!filePath || !(await fileExists(filePath))) continue;
      ffmpegArgs.push("-i", filePath);
      validAudio.push({
        inputIndex,
        startFrame: Math.max(0, Number(track?.startFrame || 0)),
        gain: Math.max(0, Number(track?.gain ?? 1))
      });
      inputIndex += 1;
    }

    if (validAudio.length > 0) {
      const filterParts = [];
      const mixInputs = [];
      validAudio.forEach((track, idx) => {
        const delayMs = Math.round(track.startFrame / fps * 1000);
        filterParts.push(
          `[${track.inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${track.gain.toFixed(3)}[a${idx}]`
        );
        mixInputs.push(`[a${idx}]`);
      });
      ffmpegArgs.push(
        "-filter_complex",
        `${filterParts.join(";")};${mixInputs.join("")}amix=inputs=${validAudio.length}:duration=longest:dropout_transition=0[aout]`,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-shortest"
      );
    }

    ffmpegArgs.push(
      "-vsync",
      "vfr",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      `${bitrate}k`,
      "-r",
      String(fps),
      outputPath
    );

    await runCommand("ffmpeg", ffmpegArgs);
    await appendExportLog(projectDir, {
      timestamp: Date.now(),
      kind: "animatic-from-frames",
      status: "success",
      message: `Frame export completed. audio=${validAudio.length}`,
      outputPath
    });
    return { outputPath };
  } catch (error) {
    await appendExportLog(projectDir, {
      timestamp: Date.now(),
      kind: "animatic-from-frames",
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    await fs.rm(frameOutputDir, { recursive: true, force: true });
  }
}

async function concatVideoSegments(videoPaths) {
  const paths = Array.isArray(videoPaths) ? videoPaths.map((item) => path.resolve(String(item || ""))) : [];
  const valid = [];
  for (const item of paths) {
    if (await fileExists(item)) valid.push(item);
  }
  if (valid.length === 0) throw new Error("No valid video segments found");

  const projectDir = await resolveCurrentProjectDir();
  const tempDir = await createTempExportDir(projectDir, "concat");
  const outputPath = await nextExportFilePath(projectDir, ".mp4");
  try {
    const concatPath = path.join(tempDir, "video-concat.txt");
    const contents = valid.map((item) => `file '${escapeFfmpegPath(item)}'`).join("\n") + "\n";
    await fs.writeFile(concatPath, contents, "utf8");
    await runCommand("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      outputPath
    ]);
    await appendExportLog(projectDir, {
      timestamp: Date.now(),
      kind: "video-concat",
      status: "success",
      message: `Concatenated ${valid.length} video segments`,
      outputPath
    });
    return { outputPath };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function muxVideoWithAudioTracks(args) {
  const videoPath = path.resolve(String(args?.videoPath || ""));
  if (!(await fileExists(videoPath))) {
    throw new Error(`Source video not found: ${videoPath}`);
  }
  const fps = Math.max(1, Number(args?.fps || 24));
  const audioTracks = Array.isArray(args?.audioTracks) ? args.audioTracks : [];
  const validAudio = [];
  for (const track of audioTracks) {
    const filePath = path.resolve(String(track?.filePath || ""));
    if (!(await fileExists(filePath))) continue;
    validAudio.push({
      filePath,
      startFrame: Math.max(0, Number(track?.startFrame || 0)),
      gain: Math.max(0, Number(track?.gain ?? 1))
    });
  }
  if (validAudio.length === 0) {
    return { outputPath: videoPath };
  }

  const projectDir = await resolveCurrentProjectDir();
  const outputPath = await nextExportFilePath(projectDir, ".mp4");
  const ffmpegArgs = ["-y", "-i", videoPath];
  validAudio.forEach((track) => ffmpegArgs.push("-i", track.filePath));

  const filterParts = [];
  const mixInputs = [];
  validAudio.forEach((track, idx) => {
    const delayMs = Math.round(track.startFrame / fps * 1000);
    filterParts.push(`[${idx + 1}:a]adelay=${delayMs}|${delayMs},volume=${track.gain.toFixed(3)}[a${idx}]`);
    mixInputs.push(`[a${idx}]`);
  });

  ffmpegArgs.push(
    "-filter_complex",
    `${filterParts.join(";")};${mixInputs.join("")}amix=inputs=${validAudio.length}:duration=longest:dropout_transition=0[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outputPath
  );

  await runCommand("ffmpeg", ffmpegArgs);
  await appendExportLog(projectDir, {
    timestamp: Date.now(),
    kind: "video-audio-mux",
    status: "success",
    message: `Attached ${validAudio.length} audio tracks to video`,
    outputPath
  });
  return { outputPath };
}

async function generateLocalVideoFromImages(args) {
  const primary = path.resolve(String(args?.primaryImagePath || ""));
  if (!(await fileExists(primary))) {
    throw new Error(`Primary image not found: ${primary}`);
  }
  const secondaryRaw = String(args?.secondaryImagePath || "").trim();
  const mode = String(args?.mode || "single_frame");
  const motion = String(args?.motionPreset || "auto").toLowerCase();
  const width = Math.max(320, Number(args?.width || 1920));
  const height = Math.max(320, Number(args?.height || 1080));
  const fps = Math.max(1, Number(args?.fps || 24));
  const durationFrames = Math.max(1, Number(args?.durationFrames || 48));
  const totalSeconds = Math.max(0.4, durationFrames / fps);
  const fadeSeconds = Math.min(0.45, Math.max(0.15, totalSeconds));
  const fadeOutStart = Math.max(0, totalSeconds - fadeSeconds);
  const projectDir = await resolveCurrentProjectDir();
  const outputPath = await nextExportFilePath(projectDir, ".mp4");
  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

  if (mode === "first_last_frame") {
    const secondary = path.resolve(secondaryRaw || primary);
    if (!(await fileExists(secondary))) {
      throw new Error(`Secondary image not found: ${secondary}`);
    }
    const filter = `[0:v]${scalePad},trim=duration=${totalSeconds.toFixed(3)},setpts=PTS-STARTPTS[v0];[1:v]${scalePad},trim=duration=${totalSeconds.toFixed(3)},setpts=PTS-STARTPTS[v1];[v0][v1]xfade=transition=fade:duration=${fadeSeconds.toFixed(3)}:offset=${fadeOutStart.toFixed(3)},format=yuv420p[v]`;
    await runCommand("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-t",
      totalSeconds.toFixed(3),
      "-i",
      primary,
      "-loop",
      "1",
      "-t",
      totalSeconds.toFixed(3),
      "-i",
      secondary,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      outputPath
    ]);
  } else {
    const frameSpan = Math.max(1, durationFrames - 1);
    const zoomStep = (1.12 - 1.0) / frameSpan;
    let motionFilter;
    if (motion === "still" || motion === "fade" || motion === "auto") {
      motionFilter = `${scalePad},fade=t=in:st=0:d=${fadeSeconds.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)},format=yuv420p`;
    } else if (motion === "push_out") {
      motionFilter = `${scalePad},zoompan=z='max(1.0,1.12-on*${zoomStep.toFixed(6)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},fade=t=in:st=0:d=${fadeSeconds.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)},format=yuv420p`;
    } else if (motion === "pan_left") {
      motionFilter = `${scalePad},zoompan=z='1.06':x='(1-on/${frameSpan.toFixed(3)})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},fade=t=in:st=0:d=${fadeSeconds.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)},format=yuv420p`;
    } else if (motion === "pan_right") {
      motionFilter = `${scalePad},zoompan=z='1.06':x='(on/${frameSpan.toFixed(3)})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},fade=t=in:st=0:d=${fadeSeconds.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)},format=yuv420p`;
    } else {
      motionFilter = `${scalePad},zoompan=z='min(1.12,1.0+on*${zoomStep.toFixed(6)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},fade=t=in:st=0:d=${fadeSeconds.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)},format=yuv420p`;
    }
    await runCommand("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-t",
      totalSeconds.toFixed(3),
      "-i",
      primary,
      "-vf",
      motionFilter,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      outputPath
    ]);
  }

  await appendExportLog(projectDir, {
    timestamp: Date.now(),
    kind: "local-video",
    status: "success",
    message: `Generated local video mode=${mode}`,
    outputPath
  });
  return { outputPath };
}

async function comfyPing(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  for (const suffix of ["/system_stats", "/queue"]) {
    try {
      const response = await fetchWithTimeout(`${base}${suffix}`, { method: "GET" }, 6000);
      if (response.ok) {
        return {
          ok: true,
          statusCode: response.status,
          message: `ComfyUI available: ${base}${suffix}`
        };
      }
    } catch {
      // ignore
    }
  }
  try {
    const response = await fetchWithTimeout(`${base}/system_stats`, { method: "GET" }, 6000);
    return {
      ok: false,
      statusCode: response.status,
      message: `ComfyUI returned HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      message: `连接失败: ${String(error)}`
    };
  }
}

async function comfyQueuePrompt(baseUrl, prompt, clientId) {
  const sanitizedPrompt = sanitizePromptForKnownOptionalNodes(prompt);
  const response = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: sanitizedPrompt,
      client_id: String(clientId || "")
    })
  }, 15000);
  if (!response.ok) {
    throw new Error(`提交 Comfy 任务失败: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  const promptId = String(payload?.prompt_id || "");
  if (!promptId) throw new Error("Comfy 未返回 prompt_id");
  return promptId;
}

function sanitizePromptForKnownOptionalNodes(prompt) {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) {
    return prompt;
  }
  const cloned = JSON.parse(JSON.stringify(prompt));
  const nodeMap = cloned;

  rewirePromptReferences(nodeMap, {
    "177": ["203", 0],
    "179": ["203", 0],
    "178": ["204", 0],
    "180": ["204", 0],
    "133": ["152", 0],
    "149": ["152", 0],
    "134": ["153", 0],
    "154": ["153", 0],
    "142": ["141", 0],
    "194": ["192", 0]
  });

  const intScalar =
    extractScalarNodeValue(nodeMap["201"]) ??
    extractScalarNodeValue(nodeMap["202"]) ??
    extractScalarNodeValue(nodeMap["161"]) ??
    null;
  if (intScalar !== null) {
    replacePromptNodeReferenceWithScalar(nodeMap, "187", intScalar);
  }

  for (const obsoleteId of ["133", "134", "142", "149", "154", "177", "178", "179", "180", "187", "194"]) {
    delete nodeMap[obsoleteId];
  }

  return nodeMap;
}

function rewirePromptReferences(nodeMap, mapping) {
  for (const node of Object.values(nodeMap)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (!Array.isArray(value) || value.length < 2) continue;
      const refId = String(value[0]);
      if (!Object.prototype.hasOwnProperty.call(mapping, refId)) continue;
      inputs[key] = mapping[refId];
    }
  }
}

function replacePromptNodeReferenceWithScalar(nodeMap, sourceNodeId, scalarValue) {
  for (const node of Object.values(nodeMap)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (!Array.isArray(value) || value.length < 2) continue;
      if (String(value[0]) !== String(sourceNodeId)) continue;
      inputs[key] = scalarValue;
    }
  }
}

function extractScalarNodeValue(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const inputs = node.inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return null;
  for (const candidate of ["value", "number", "int", "integer"]) {
    const value = inputs[candidate];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  for (const value of Object.values(inputs)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  return null;
}

async function comfyGetHistory(baseUrl, promptId) {
  const response = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/history/${encodeURIComponent(String(promptId || ""))}`, {}, 12000);
  if (!response.ok) {
    throw new Error(`读取 Comfy history 失败: HTTP ${response.status}`);
  }
  return response.json();
}

async function comfyFetchViewBase64(url) {
  if (!String(url || "").trim()) throw new Error("url 不能为空");
  const response = await fetchWithTimeout(String(url), {}, 30000);
  if (!response.ok) {
    throw new Error(`下载 Comfy 图像失败: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

async function comfyDiscoverEndpoints() {
  const candidates = [
    "http://127.0.0.1:8188",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:17888",
    "http://127.0.0.1:17788",
    "http://127.0.0.1:7860",
    "http://localhost:8188",
    "http://localhost:8000"
  ];
  const found = [];
  for (const base of candidates) {
    try {
      const ping = await comfyPing(base);
      if (ping.ok) found.push(base);
    } catch {
      // ignore
    }
  }
  return { found };
}

async function comfyDiscoverLocalDirs() {
  const home = os.homedir();
  const roots = [
    path.join(home, "Documents", "ComfyUI"),
    path.join(home, "ComfyUI"),
    path.join(home, "Desktop", "ComfyUI"),
    path.join(home, "Downloads", "ComfyUI")
  ];
  let best = null;
  let bestScore = -1;
  for (const root of roots) {
    const score =
      ((await dirExists(path.join(root, "input"))) ? 3 : 0) +
      ((await dirExists(path.join(root, "output"))) ? 3 : 0) +
      ((await dirExists(path.join(root, "models"))) ? 1 : 0) +
      ((await dirExists(path.join(root, "custom_nodes"))) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = root;
    }
  }
  if (!best) {
    return { rootDir: "", inputDir: "", outputDir: "" };
  }
  return {
    rootDir: best,
    inputDir: path.join(best, "input"),
    outputDir: path.join(best, "output")
  };
}

async function comfyGetObjectInfo(baseUrl) {
  const response = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/object_info`, {}, 12000);
  if (!response.ok) {
    throw new Error(`读取 Comfy object_info 失败: HTTP ${response.status}`);
  }
  return response.json();
}

async function comfyInstallPlugins(comfyRootDir, repos) {
  const root = path.resolve(String(comfyRootDir || ""));
  if (!(await dirExists(root))) throw new Error(`ComfyUI 根目录无效: ${root}`);
  const customNodesDir = path.join(root, "custom_nodes");
  await ensureDir(customNodesDir);
  const repoList = Array.isArray(repos) ? repos : [];
  const installed = [];
  const skipped = [];
  const failed = [];
  const pythonCandidates = [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
    "python"
  ];

  for (const item of repoList) {
    const repo = String(item || "").trim();
    if (!repo) continue;
    if (!repo.startsWith("https://github.com/")) {
      failed.push({ repo, error: "仅支持 https://github.com/ 仓库地址" });
      continue;
    }
    const dirName = repo.replace(/\/+$/, "").split("/").pop()?.replace(/\.git$/i, "") || "";
    if (!dirName) {
      failed.push({ repo, error: "无法解析仓库目录名" });
      continue;
    }
    const target = path.join(customNodesDir, dirName);
    try {
      if (await dirExists(target)) {
        await runCommand("git", ["-C", target, "pull", "--ff-only"]);
      } else {
        await runCommand("git", ["clone", "--depth=1", repo, target]);
      }

      const requirements = path.join(target, "requirements.txt");
      if (await fileExists(requirements)) {
        let installedReq = false;
        for (const pythonBin of pythonCandidates) {
          try {
            await runCommand(pythonBin, ["-m", "pip", "install", "-r", requirements]);
            installedReq = true;
            break;
          } catch {
            // try next python
          }
        }
        if (!installedReq) {
          skipped.push(`${dirName}（requirements 未安装，未找到可用 Python）`);
        }
      }

      installed.push(dirName);
    } catch (error) {
      failed.push({
        repo,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { installed, skipped, failed };
}

async function comfyCheckModelHealth(comfyRootDir) {
  const root = path.resolve(String(comfyRootDir || ""));
  if (!(await dirExists(root))) throw new Error(`ComfyUI 根目录无效: ${root}`);
  const modelRoot = path.join(root, "models");
  const checksSpec = [
    ["checkpoints", "基础模型 Checkpoints", true, path.join(modelRoot, "checkpoints")],
    ["vae", "VAE", false, path.join(modelRoot, "vae")],
    ["loras", "Lora", false, path.join(modelRoot, "loras")],
    ["controlnet", "ControlNet", false, path.join(modelRoot, "controlnet")],
    ["ipadapter", "IPAdapter", false, path.join(modelRoot, "ipadapter")],
    ["clip_vision", "CLIP Vision", false, path.join(modelRoot, "clip_vision")],
    ["animatediff_models", "AnimateDiff Motion Models", false, path.join(modelRoot, "animatediff_models")],
    ["animatediff_models_plugin", "AnimateDiff 插件 Models", false, path.join(root, "custom_nodes", "ComfyUI-AnimateDiff-Evolved", "models")]
  ];

  const checks = [];
  for (const [key, label, required, dirPath] of checksSpec) {
    const exists = await dirExists(dirPath);
    checks.push({
      key,
      label,
      path: dirPath,
      exists,
      fileCount: exists ? await countModelFiles(dirPath) : 0,
      required
    });
  }
  return { checks };
}

async function comfyReadServerLogTail(comfyRootDir, baseUrl, maxLines) {
  const logPath = await resolveComfyServerLogPath(comfyRootDir, baseUrl);
  if (!logPath) {
    return "";
  }
  const raw = await fs.readFile(logPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const start = Math.max(0, lines.length - Math.max(1, Number(maxLines || 160)));
  return lines.slice(start).join("\n");
}

async function resolveComfyServerLogPath(comfyRootDir, baseUrl) {
  const roots = comfyLogRootCandidates(comfyRootDir);
  if (roots.length === 0) return "";
  const port = Number(normalizeBaseUrl(baseUrl).split(":").pop()) || 8188;
  for (const root of roots) {
    const candidate = path.join(root, "user", `comfyui_${port}.log`);
    if (await fileExists(candidate)) return candidate;
  }
  const discovered = await discoverComfyLogBySearch(port);
  if (discovered) return discovered;
  return "";
}

function comfyLogRootCandidates(comfyRootDir) {
  const raw = String(comfyRootDir || "").trim();
  const candidates = [];
  const push = (value) => {
    const resolved = path.resolve(String(value || "").trim());
    if (!resolved) return;
    if (candidates.includes(resolved)) return;
    candidates.push(resolved);
  };

  if (raw) {
    push(raw);
    push(path.join(raw, "ComfyUI"));
  }

  const home = os.homedir();
  if (home) {
    push(path.join(home, "Documents", "ComfyUI"));
    push(path.join(home, "Desktop", "ComfyUI"));
  }

  return candidates;
}

async function discoverComfyLogBySearch(port) {
  if (process.platform !== "win32") return "";
  const home = os.homedir();
  if (!home) return "";
  const searchRoots = [
    home,
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    "C:\\",
    "D:\\"
  ];
  for (const root of uniquePreserveOrder(searchRoots)) {
    try {
      const { stdout } = await runCommand("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Get-ChildItem -Path '${root.replace(/'/g, "''")}' -Filter 'comfyui_${port}.log' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`
      ]);
      const resolved = String(stdout || "").trim().split(/\r?\n/).find(Boolean) || "";
      if (resolved && (await fileExists(resolved))) return resolved;
    } catch {
      // ignore
    }
  }
  return "";
}

async function openUrl(targetUrl) {
  if (process.platform === "win32") {
    await runCommand("cmd", ["/c", "start", "", targetUrl], { detached: true });
    return;
  }
  if (process.platform === "darwin") {
    await runCommand("open", [targetUrl], { detached: true });
    return;
  }
  await runCommand("xdg-open", [targetUrl], { detached: true });
}

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "http://127.0.0.1:8188";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCurrentProjectDir() {
  const marker = await readCurrentProjectMarker();
  if (marker && (await dirExists(marker))) return marker;
  const fallback = fallbackProjectDir();
  await ensureDir(fallback);
  await setCurrentProjectPath(fallback);
  return fallback;
}

function fallbackProjectDir() {
  return path.join(workspaceRoot, "default.sbproj");
}

async function readCurrentProjectMarker() {
  if (!(await fileExists(currentProjectMarker))) return "";
  return String(await fs.readFile(currentProjectMarker, "utf8")).trim();
}

async function setCurrentProjectPath(projectDir) {
  await ensureDir(dataRoot);
  await fs.writeFile(currentProjectMarker, projectDir, "utf8");
}

function snapshotPath(projectDir) {
  return path.join(projectDir, "snapshot.json");
}

async function exportsDir(projectDir) {
  const target = path.join(projectDir, "exports");
  await ensureDir(target);
  return target;
}

async function nextExportFilePath(projectDir, extension) {
  return path.join(await exportsDir(projectDir), `animatic-${Date.now()}${extension}`);
}

async function createTempExportDir(projectDir, prefix) {
  const target = path.join(await exportsDir(projectDir), `${prefix}-${Date.now()}`);
  await ensureDir(target);
  return target;
}

async function appendExportLog(projectDir, entry) {
  const logPath = path.join(await exportsDir(projectDir), "export-log.jsonl");
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(logPath, line, "utf8");
}

function slugifyProjectName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "project";
}

function uniquePreserveOrder(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function safeResolveInside(rootDir, requestPath) {
  const relative = decodeURIComponent(String(requestPath || "").replace(/^\/+/, ""));
  const resolved = path.resolve(rootDir, relative);
  if (!normalizePath(resolved).startsWith(normalizePath(rootDir))) {
    return null;
  }
  return resolved;
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function safeStat(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function safeReadText(target) {
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

async function readJsonFile(target) {
  const text = await safeReadText(target);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function safeReadDir(target) {
  try {
    return await fs.readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function fileExists(target) {
  return Boolean(await safeStat(target));
}

async function dirExists(target) {
  const stat = await safeStat(target);
  return Boolean(stat?.isDirectory());
}

function pathExists(target) {
  try {
    return fsSync.existsSync(path.resolve(String(target || "")));
  } catch {
    return false;
  }
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function countModelFiles(targetDir) {
  const entries = await fs.readdir(targetDir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if ([".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx"].includes(ext)) {
      count += 1;
    }
  }
  return count;
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      detached: Boolean(options.detached),
      stdio: options.detached ? "ignore" : ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    if (!options.detached) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    } else {
      child.unref();
    }

    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${String(code)}${stderr ? `: ${stderr.trim()}` : ""}${stdout ? ` | ${stdout.trim()}` : ""}`
        )
      );
    });
  });
}

function escapeFfmpegPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

main().catch((error) => {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
