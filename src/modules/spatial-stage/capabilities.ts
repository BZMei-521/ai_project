import type {
  StageCapability,
  StageCapabilityReport,
  StageCapabilityStatus
} from "./types";

export type ComfySystemStats = {
  system?: {
    ram_total?: number;
    ram_free?: number;
  };
  devices?: Array<{
    type?: string;
    name?: string;
    vram_total?: number;
    vram_free?: number;
  }>;
};

type FetchJson = (url: string, signal?: AbortSignal) => Promise<unknown>;

export type SpatialStageCapabilityOptions = {
  baseUrl: string;
  webgl2: boolean;
  fetchJson?: FetchJson;
  now?: () => string;
  timeoutMs?: number;
};

const GIB = 1024 ** 3;
const REQUIRED_MOGE_MODEL = "moge_2_vitl_normal_fp16.safetensors";
const REQUIRED_MOGE_NODES = [
  "LoadMoGeModel",
  "MoGePanoramaInference",
  "MoGePointMapToMesh",
  "MoGeRender"
] as const;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function capability(
  status: StageCapabilityStatus,
  message: string,
  checkedAt: string
): StageCapability {
  return { status, message, checkedAt };
}

function clampTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5000;
  return Math.min(30_000, Math.max(250, Math.round(value)));
}

async function defaultFetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { method: "GET", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function extractModelOptions(objectInfo: Record<string, unknown>): string[] {
  const loader = objectInfo.LoadMoGeModel;
  if (!isRecord(loader)) return [];
  const input = loader.input;
  if (!isRecord(input)) return [];
  const required = input.required;
  if (!isRecord(required)) return [];
  const modelName = required.model_name;
  if (!Array.isArray(modelName)) return [];

  const direct = modelName[0];
  if (Array.isArray(direct)) {
    return direct.filter((item): item is string => typeof item === "string");
  }
  const descriptor = modelName[1];
  if (!isRecord(descriptor) || !Array.isArray(descriptor.options)) return [];
  return descriptor.options.filter((item): item is string => typeof item === "string");
}

function hasNode(objectInfo: Record<string, unknown>, nodeName: string): boolean {
  return isRecord(objectInfo[nodeName]);
}

function manualReport(checkedAt: string, webgl2: boolean, message: string): StageCapabilityReport {
  const unavailable = () => capability("temporarily_unavailable", message, checkedAt);
  return {
    overall: webgl2 ? "manual_fallback" : "failed",
    webgl2: webgl2
      ? capability("available", "WebGL2 is available.", checkedAt)
      : capability("failed", "WebGL2 is unavailable.", checkedAt),
    comfyui: unavailable(),
    mogeNode: unavailable(),
    mogeModel: unavailable(),
    panoramaConversion: unavailable(),
    pose: unavailable(),
    systemMemory: unavailable(),
    gpuMemory: unavailable()
  };
}

export async function getComfySystemStats(
  baseUrl: string,
  signal?: AbortSignal,
  fetchJson: FetchJson = defaultFetchJson
): Promise<ComfySystemStats> {
  const result = await fetchJson(`${normalizeBaseUrl(baseUrl)}/system_stats`, signal);
  return isRecord(result) ? result as ComfySystemStats : {};
}

export async function probeSpatialStageCapabilities(
  options: SpatialStageCapabilityOptions
): Promise<StageCapabilityReport> {
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const timeoutMs = clampTimeout(options.timeoutMs);
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  if (!options.webgl2) {
    return manualReport(checkedAt, false, "WebGL2 is required for the spatial viewport.");
  }

  let stats: ComfySystemStats;
  let objectInfo: Record<string, unknown>;
  try {
    [stats, objectInfo] = await Promise.all([
      withTimeout(
        (signal) => getComfySystemStats(baseUrl, signal, fetchJson),
        timeoutMs
      ),
      withTimeout(async (signal) => {
        const value = await fetchJson(`${baseUrl}/object_info`, signal);
        if (!isRecord(value)) throw new Error("object_info is not an object");
        return value;
      }, timeoutMs)
    ]);
  } catch (error) {
    return manualReport(
      checkedAt,
      true,
      `ComfyUI probe failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const missingMoGeNodes = REQUIRED_MOGE_NODES.filter((name) => !hasNode(objectInfo, name));
  const modelOptions = extractModelOptions(objectInfo);
  const modelAvailable = modelOptions.includes(REQUIRED_MOGE_MODEL);
  const panoramaAvailable = hasNode(objectInfo, "Equirectangular to Perspective");
  const poseAvailable = hasNode(objectInfo, "OpenposePreprocessor");
  const ramFree = stats.system?.ram_free;
  const cudaDevice = stats.devices?.find((device) => device.type?.toLowerCase().includes("cuda"));
  const vramFree = cudaDevice?.vram_free;
  const enoughRam = typeof ramFree === "number" && ramFree >= 4 * GIB;
  const enoughVram = typeof vramFree === "number" && vramFree >= 6 * GIB;
  const mogeNodesAvailable = missingMoGeNodes.length === 0;

  return {
    overall: mogeNodesAvailable && modelAvailable ? "available" : "manual_fallback",
    webgl2: capability("available", "WebGL2 is available.", checkedAt),
    comfyui: capability("available", `ComfyUI is available at ${baseUrl}.`, checkedAt),
    mogeNode: mogeNodesAvailable
      ? capability("available", "All required MoGe nodes are available.", checkedAt)
      : capability("missing_dependency", `Missing nodes: ${missingMoGeNodes.join(", ")}`, checkedAt),
    mogeModel: modelAvailable
      ? capability("available", `${REQUIRED_MOGE_MODEL} is available.`, checkedAt)
      : capability("missing_dependency", `${REQUIRED_MOGE_MODEL} is not installed.`, checkedAt),
    panoramaConversion: panoramaAvailable
      ? capability("available", "Panorama conversion node is available.", checkedAt)
      : capability("missing_dependency", "Panorama conversion node is missing.", checkedAt),
    pose: poseAvailable
      ? capability("available", "OpenPose preprocessor is available.", checkedAt)
      : capability("missing_dependency", "OpenPose preprocessor is missing.", checkedAt),
    systemMemory: enoughRam
      ? capability("available", `${Math.round((ramFree ?? 0) / GIB)} GiB system memory is free.`, checkedAt)
      : capability("temporarily_unavailable", "Less than 4 GiB system memory is free.", checkedAt),
    gpuMemory: enoughVram
      ? capability("available", `${Math.round((vramFree ?? 0) / GIB)} GiB GPU memory is free.`, checkedAt)
      : capability("temporarily_unavailable", "Less than 6 GiB GPU memory is free.", checkedAt)
  };
}
