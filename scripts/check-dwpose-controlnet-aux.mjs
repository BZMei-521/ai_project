import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "src", "modules", "comfy-pipeline", "presets", "dwpose-install-manifest.json");
const installerPath = join(root, "scripts", "install-dwpose-controlnet-aux.ps1");

assert.ok(existsSync(manifestPath), "DWPose install manifest must exist");
assert.ok(existsSync(installerPath), "DWPose installer must exist");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.repository, "https://github.com/Fannovel16/comfyui_controlnet_aux.git");
assert.equal(manifest.commit, "59b027e088c1c8facf7258f6e392d16d204b4d27");
assert.equal(manifest.nodeClass, "DWPreprocessor");
assert.deepEqual(manifest.models.map(({ file, sha256 }) => [file, sha256]), [
  ["yolox_l.torchscript.pt", "80bc14b13c260c24b3014cd42c02994bf52296ab8fa2d80a60b6afe08c93ef42"],
  ["dw-ll_ucoco_384_bs5.torchscript.pt", "d86a0b2b59fddc0901a7076e9f59c9f8602602133ed72511c693fd11eea23d91"]
]);
assert.deepEqual(manifest.models.map(({ file, relativePath }) => [file, relativePath]), [
  ["yolox_l.torchscript.pt", "hr16/yolox-onnx/yolox_l.torchscript.pt"],
  ["dw-ll_ucoco_384_bs5.torchscript.pt", "hr16/DWPose-TorchScript-BatchSize5/dw-ll_ucoco_384_bs5.torchscript.pt"]
]);

const installer = readFileSync(installerPath, "utf8");
for (const required of [
  "Get-FileHash",
  "-Algorithm SHA256",
  ".partial.",
  "[guid]::NewGuid()",
  "Move-Item",
  "requirements.txt",
  "dwpose-install-report.json"
]) assert.match(installer, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `installer must contain ${required}`);

function runInstaller(args, expectedStatus = 0) {
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installerPath, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, expectedStatus, `installer exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "dwpose-install-check-"));
try {
  const comfyRoot = join(fixtureRoot, "ComfyUI");
  const comfyPython = join(fixtureRoot, "python.exe");
  mkdirSync(comfyRoot, { recursive: true });
  const canonicalFixtureRoot = realpathSync.native(fixtureRoot);
  const canonicalComfyRoot = join(canonicalFixtureRoot, "ComfyUI");
  const canonicalComfyPython = join(canonicalFixtureRoot, "python.exe");

  const dryRun = runInstaller(["-ComfyRoot", comfyRoot, "-ComfyPython", comfyPython, "-DryRun"]);
  const plan = JSON.parse(dryRun.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.repository, manifest.repository);
  assert.equal(plan.commit, manifest.commit);
  assert.equal(plan.comfyPython, canonicalComfyPython);
  assert.equal(plan.requirementsPath, join(canonicalComfyRoot, "custom_nodes", "comfyui_controlnet_aux", "requirements.txt"));
  assert.deepEqual(plan.models.map(({ file, relativePath, url, sha256 }) => ({ file, relativePath, url, sha256 })), manifest.models);
  assert.equal(plan.models.length, 2);
  assert.equal(existsSync(join(comfyRoot, "custom_nodes")), false, "dry-run must not mutate ComfyUI root");

  const ckpts = join(comfyRoot, "custom_nodes", "comfyui_controlnet_aux", "ckpts");
  mkdirSync(ckpts, { recursive: true });
  const wrongTarget = join(ckpts, ...manifest.models[0].relativePath.split("/"));
  mkdirSync(resolve(wrongTarget, ".."), { recursive: true });
  const wrongBytes = Buffer.from("wrong hash fixture");
  writeFileSync(wrongTarget, wrongBytes);
  const before = createHash("sha256").update(wrongBytes).digest("hex");
  const rejected = runInstaller(["-ComfyRoot", comfyRoot, "-ComfyPython", comfyPython, "-DryRun"], 1);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /hash|sha-?256|integrity/i);
  assert.equal(createHash("sha256").update(readFileSync(wrongTarget)).digest("hex"), before, "wrong existing file must remain untouched");
  assert.equal(existsSync(`${wrongTarget}.partial`), false, "rejection must not promote a partial file");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("DWPose install contract: PASS");
