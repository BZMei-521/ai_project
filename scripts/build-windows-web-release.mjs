#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const releaseRoot = path.join(projectRoot, "release", "storyboard-pro-windows-web");

async function main() {
  await ensureExists(path.join(distDir, "index.html"), "dist/index.html not found. Run npm run web:build first.");

  await fs.rm(releaseRoot, { recursive: true, force: true });
  await fs.mkdir(releaseRoot, { recursive: true });

  await copyDir(distDir, path.join(releaseRoot, "dist"));
  await copyFile("check-storyboard-windows-env.bat");
  await copyFile("update-storyboard-windows.bat");
  await copyFile("start-storyboard-windows.bat");
  await copyFile("start-storyboard-windows-debug.bat");
  await copyFile("start-storyboard-web.bat");
  await copyFile(path.join("scripts", "windows-web-server.mjs"));

  await fs.writeFile(
    path.join(releaseRoot, "README-Windows-Web.txt"),
    [
      "Storyboard Pro Windows Web Release",
      "",
      "1. Install Node.js 18+",
      "2. If you need video export, install ffmpeg and make sure ffmpeg.exe is in PATH",
      "3. Install Tailscale if you need remote access or log sync across different networks",
      "4. If you need AI generation, launch ComfyUI separately",
      "5. After pulling new source changes, run update-storyboard-windows.bat to rebuild dist locally",
      "6. Double-click check-storyboard-windows-env.bat if you want a preflight check",
      "7. Double-click start-storyboard-windows.bat",
      "8. If startup still fails, run start-storyboard-windows-debug.bat and inspect logs\\windows-web-latest.log",
      "",
      "Default URL: http://127.0.0.1:3210",
      "Default data dir: %APPDATA%\\StoryboardProWeb",
      "Remote log URL: http://<tailscale-ip>:3210/api/runtime-log/latest"
    ].join("\r\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(releaseRoot, "release-manifest.json"),
    JSON.stringify(
      {
        name: "storyboard-pro-windows-web",
        createdAt: new Date().toISOString(),
        files: [
          "dist/",
          "check-storyboard-windows-env.bat",
          "update-storyboard-windows.bat",
          "scripts/windows-web-server.mjs",
          "start-storyboard-windows.bat",
          "start-storyboard-windows-debug.bat",
          "start-storyboard-web.bat",
          "README-Windows-Web.txt"
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[INFO] Windows web release ready: ${releaseRoot}`);
}

async function copyFile(relativePath) {
  const source = path.join(projectRoot, relativePath);
  const target = path.join(releaseRoot, relativePath);
  await ensureExists(source, `Missing file: ${relativePath}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(src, dst);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
    }
  }
}

async function ensureExists(target, message) {
  try {
    await fs.stat(target);
  } catch {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
