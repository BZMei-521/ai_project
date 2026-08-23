import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const { resolveNovelOutputRoot, resolveApplicationProjectsRoot } = await import(
  "./novel-paths.mjs"
);

const windowsHome = "C:\\Users\\Example";
assert.equal(
  resolveNovelOutputRoot({ homeDir: windowsHome }),
  path.join(windowsHome, "Desktop", "小说"),
  "novel output root must live in the user's Desktop/小说 folder"
);
assert.equal(
  resolveApplicationProjectsRoot({ homeDir: windowsHome }),
  path.join(windowsHome, "Desktop", "小说", "应用项目"),
  "application projects must stay grouped below Desktop/小说/应用项目"
);
const portableRoot = "D:\\PortableNovels";
assert.equal(
  resolveNovelOutputRoot({ homeDir: windowsHome, env: { STORYBOARD_NOVEL_OUTPUT_DIR: portableRoot } }),
  path.resolve(portableRoot),
  "an explicit novel root must support isolated tests and portable deployments"
);

const webServer = readFileSync(path.join(repoRoot, "scripts", "windows-web-server.mjs"), "utf8");
assert.match(webServer, /resolveApplicationProjectsRoot\(\)/, "web runtime must use the shared novel project root");
assert.doesNotMatch(webServer, /const workspaceRoot = path\.join\(dataRoot, "workspace"\)/);
const webSyntax = spawnSync(process.execPath, ["--check", path.join(repoRoot, "scripts", "windows-web-server.mjs")], {
  encoding: "utf8"
});
assert.equal(webSyntax.status, 0, webSyntax.stderr || webSyntax.stdout);

const dashboardServer = readFileSync(
  path.join(repoRoot, ".agents", "skills", "story", "scripts", "dashboard-server.mjs"),
  "utf8"
);
assert.match(dashboardServer, /resolveNovelOutputRoot\(\)/, "story Dashboard must default to Desktop/小说");

const tauriMain = readFileSync(path.join(repoRoot, "src-tauri", "src", "main.rs"), "utf8");
assert.match(tauriMain, /desktop_dir\(\)/, "Tauri must resolve the operating-system Desktop directory");
assert.match(tauriMain, /join\("小说"\)\.join\("应用项目"\)/, "Tauri projects must be below Desktop/小说/应用项目");

const projectInstructions = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
assert.match(projectInstructions, /C:\\Users\\Administrator\\Desktop\\小说/);

process.stdout.write("PASS novel output root contract\n");
