import os from "node:os";
import path from "node:path";

export function resolveNovelOutputRoot({ homeDir = os.homedir(), env = process.env } = {}) {
  const configuredRoot = String(env.STORYBOARD_NOVEL_OUTPUT_DIR || "").trim();
  if (configuredRoot) return path.resolve(configuredRoot);
  return path.join(homeDir, "Desktop", "小说");
}

export function resolveApplicationProjectsRoot(options = {}) {
  return path.join(resolveNovelOutputRoot(options), "应用项目");
}
