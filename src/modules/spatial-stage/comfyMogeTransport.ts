import type { MogeOutputReferences } from "./mogeRunner";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ComfyMogeTransportOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pollMs?: number;
};

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value as number : fallback));

async function jsonRequest(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`ComfyUI ${response.status} at ${url}`);
    return await response.json() as Record<string, unknown>;
  } finally { clearTimeout(timer); }
}

export function createComfyMogeTransport(options: ComfyMogeTransportOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const timeoutMs = clamp(options.timeoutMs, 15000, 250, 120000);
  const pollMs = clamp(options.pollMs, 500, 100, 5000);
  const outputUrl = (image: Record<string, unknown>) => {
    const params = new URLSearchParams({ filename: String(image.filename ?? ""), subfolder: String(image.subfolder ?? ""), type: String(image.type ?? "output") });
    return `${baseUrl}/view?${params.toString()}`;
  };
  const outputImage = (item: Record<string, unknown>, nodeId: string) => {
    const outputs = item.outputs as Record<string, Record<string, unknown>> | undefined;
    const images = outputs?.[nodeId]?.images;
    return Array.isArray(images) && images[0] && typeof images[0] === "object" ? outputUrl(images[0] as Record<string, unknown>) : "";
  };
  return {
    async queue(workflow: Record<string, unknown>) {
      const result = await jsonRequest(fetchImpl, `${baseUrl}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow }) }, timeoutMs);
      const promptId = result.prompt_id;
      if (typeof promptId !== "string" || !promptId) throw new Error("ComfyUI did not return prompt_id");
      return promptId;
    },
    async wait(promptId: string) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const history = await jsonRequest(fetchImpl, `${baseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, timeoutMs);
        const item = history[promptId] as Record<string, unknown> | undefined;
        if (item) {
          const outputs: MogeOutputReferences = { depthUrl: outputImage(item, "8"), normalUrl: outputImage(item, "9"), maskUrl: outputImage(item, "10") };
          return { history: item, ...(outputs.depthUrl && outputs.normalUrl && outputs.maskUrl ? { outputs } : {}) };
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw new Error(`ComfyUI history timeout for ${promptId}`);
    }
  };
}
