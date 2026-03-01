import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __STORYBOARD_WEB_BRIDGE__?: boolean;
  }
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export function isTauriRuntime(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function isWebBridgeRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return window.__STORYBOARD_WEB_BRIDGE__ === true;
}

export function isDesktopRuntime(): boolean {
  return isTauriRuntime() || isWebBridgeRuntime();
}

export async function invokeDesktopCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(cmd, args);
  }
  if (!isWebBridgeRuntime()) {
    throw new Error("未检测到桌面运行桥接。请使用 Tauri 桌面版或 Windows Web 启动脚本。");
  }
  const response = await fetch(`/api/invoke/${encodeURIComponent(cmd)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args ?? {})
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && !Array.isArray(payload) && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "Unknown bridge error")
        : `Bridge HTTP ${response.status}`;
    throw new Error(message);
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload) && "result" in payload) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

export function toDesktopMediaSource(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (/^(https?:|blob:|data:|file:)/i.test(value)) return value;
  if (!isAbsoluteLocalPath(value)) return value;
  if (isTauriRuntime()) {
    try {
      return convertFileSrc(value);
    } catch {
      // ignore and fallback
    }
  }
  if (isWebBridgeRuntime()) {
    return `/api/local-file?path=${encodeURIComponent(value)}`;
  }
  if (value.startsWith("/")) return `file://${value}`;
  return `file:///${value.replace(/\\/g, "/")}`;
}
