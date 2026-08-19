export type ComfyWorkflow = Record<string, unknown>;

export type ComfyOutputFile = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type ComfyFileWriteResult = {
  filePath: string;
};

export type ComfyDesktopInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export type ComfyClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  desktopInvoke?: ComfyDesktopInvoke;
};

export const COMFY_DESKTOP_UNAVAILABLE_MESSAGE =
  "未检测到桌面运行环境。请使用 Tauri 桌面版或 Windows Web 启动脚本。";

export function normalizeComfyBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || "http://127.0.0.1:8188";
}

export class ComfyClient {
  readonly baseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly desktopInvoke?: ComfyDesktopInvoke;

  constructor(options: ComfyClientOptions) {
    this.baseUrl = normalizeComfyBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl;
    this.desktopInvoke = options.desktopInvoke;
  }

  async getObjectInfo(): Promise<Record<string, unknown>> {
    if (this.desktopInvoke) {
      return this.desktopInvoke<Record<string, unknown>>("comfy_get_object_info", {
        baseUrl: this.baseUrl
      });
    }
    const response = await this.fetch("/object_info", { method: "GET" });
    if (!response.ok) {
      throw new Error(`读取 object_info 失败：HTTP ${response.status}`);
    }
    const parsed = (await response.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("object_info 格式异常");
    }
    return parsed as Record<string, unknown>;
  }

  queuePrompt(prompt: ComfyWorkflow, clientId: string): Promise<string> {
    return this.invoke<string>("comfy_queue_prompt", {
      baseUrl: this.baseUrl,
      prompt,
      clientId
    });
  }

  getHistory(promptId: string): Promise<Record<string, unknown>> {
    return this.invoke<Record<string, unknown>>("comfy_get_history", {
      baseUrl: this.baseUrl,
      promptId
    });
  }

  fetchViewBase64(url: string): Promise<string> {
    return this.invoke<string>("comfy_fetch_view_base64", { url });
  }

  writeBase64File(filePath: string, base64Data: string): Promise<ComfyFileWriteResult> {
    return this.invoke<ComfyFileWriteResult>("write_base64_file", { filePath, base64Data });
  }

  copyFile(sourcePath: string, targetPath: string): Promise<ComfyFileWriteResult> {
    return this.invoke<ComfyFileWriteResult>("copy_file_to", { sourcePath, targetPath });
  }

  toViewUrl(file: ComfyOutputFile): string {
    const params = new URLSearchParams();
    params.set("filename", file.filename);
    params.set("subfolder", file.subfolder ?? "");
    params.set("type", file.type ?? "output");
    return `${this.baseUrl}/view?${params.toString()}`;
  }

  private fetch(path: string, init: RequestInit): Promise<Response> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      return Promise.reject(new Error("Fetch API unavailable"));
    }
    return fetchImpl(`${this.baseUrl}${path}`, init);
  }

  private invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
    if (!this.desktopInvoke) {
      return Promise.reject(new Error(COMFY_DESKTOP_UNAVAILABLE_MESSAGE));
    }
    return this.desktopInvoke<T>(command, args);
  }
}
