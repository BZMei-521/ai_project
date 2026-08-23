import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "src/modules/comfy-pipeline/presets/qwen-image-edit-2511-model-manifest.json");
const downloaderPath = resolve(root, "scripts/download-qwen-image-edit-2511-models.ps1");
assert.ok(existsSync(manifestPath), "Qwen 2511 manifest must exist");
assert.ok(existsSync(downloaderPath), "Qwen 2511 downloader must exist");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.minimumFreeBytesAfterDownload, 5368709120);
assert.deepEqual(manifest.files.map(({ targetSubdirectory, fileName, sha256, byteSize }) => ({ targetSubdirectory, fileName, sha256, byteSize })), [
  { targetSubdirectory: "diffusion_models", fileName: "qwen_image_edit_2511_fp8mixed.safetensors", sha256: "c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e", byteSize: 20533762817 },
  { targetSubdirectory: "text_encoders", fileName: "qwen_2.5_vl_7b_fp8_scaled.safetensors", sha256: "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4", byteSize: 9384670680 },
  { targetSubdirectory: "vae", fileName: "qwen_image_vae.safetensors", sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f", byteSize: 253806246 },
  { targetSubdirectory: "loras", fileName: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", sha256: "22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f", byteSize: 849608296 }
]);
for (const file of manifest.files) {
  assert.match(file.downloadUrl, /^https:\/\/huggingface\.co\//);
  assert.ok(!file.downloadUrl.includes("/blob/"));
}

function sha(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function run(args, expectSuccess = true) {
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", downloaderPath, ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  if (expectSuccess && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (!expectSuccess) assert.notEqual(result.status, 0, "downloader must fail closed");
  return result;
}

const tempRoot = mkdtempSync(join(tmpdir(), "qwen2511-download-"));
try {
  const sourceDir = join(tempRoot, "source");
  const modelsRoot = join(tempRoot, "models");
  mkdirSync(sourceDir, { recursive: true });
  const one = Buffer.from("qwen-one\n");
  const two = Buffer.from("qwen-two-resume\n");
  const oneSource = join(sourceDir, "one.bin");
  const twoSource = join(sourceDir, "two.bin");
  writeFileSync(oneSource, one);
  writeFileSync(twoSource, two);
  const localManifestPath = join(tempRoot, "manifest.json");
  const localManifest = {
    schemaVersion: 1,
    minimumFreeBytesAfterDownload: 0,
    files: [
      { targetSubdirectory: "diffusion_models", fileName: "one.bin", downloadUrl: new URL(`file:///${oneSource.replace(/\\/g, "/")}`).href, sha256: sha(one), byteSize: one.length },
      { targetSubdirectory: "vae", fileName: "two.bin", downloadUrl: new URL(`file:///${twoSource.replace(/\\/g, "/")}`).href, sha256: sha(two), byteSize: two.length }
    ]
  };
  writeFileSync(localManifestPath, JSON.stringify(localManifest));
  const productionDry = run(["-ModelsRoot", modelsRoot, "-DryRun"]);
  assert.match(productionDry.stdout, /qwen_image_edit_2511_fp8mixed\.safetensors/);
  const mirrorDry = run(["-ModelsRoot", modelsRoot, "-MirrorBase", "https://hf-mirror.com", "-DryRun"]);
  assert.match(mirrorDry.stdout, /https:\/\/hf-mirror\.com\/Comfy-Org\/Qwen-Image-Edit_ComfyUI/);
  const dry = run(["-ManifestPath", localManifestPath, "-ModelsRoot", modelsRoot, "-DryRun"]);
  assert.match(dry.stdout, /one\.bin/);
  assert.equal(existsSync(modelsRoot), false, "dry run must not create the models root");

  mkdirSync(join(modelsRoot, "vae"), { recursive: true });
  writeFileSync(join(modelsRoot, "vae", "two.bin.part"), two.subarray(0, 5));
  run(["-ManifestPath", localManifestPath, "-ModelsRoot", modelsRoot]);
  assert.deepEqual(readFileSync(join(modelsRoot, "diffusion_models", "one.bin")), one);
  assert.deepEqual(readFileSync(join(modelsRoot, "vae", "two.bin")), two);
  assert.equal(existsSync(join(modelsRoot, "vae", "two.bin.part")), false);
  run(["-ManifestPath", localManifestPath, "-ModelsRoot", modelsRoot]);

  const wrongRoot = join(tempRoot, "wrong");
  mkdirSync(join(wrongRoot, "diffusion_models"), { recursive: true });
  writeFileSync(join(wrongRoot, "diffusion_models", "one.bin"), "wrong-final");
  run(["-ManifestPath", localManifestPath, "-ModelsRoot", wrongRoot], false);
  assert.equal(readFileSync(join(wrongRoot, "diffusion_models", "one.bin"), "utf8"), "wrong-final");

  const badHash = structuredClone(localManifest);
  badHash.files = [{ ...badHash.files[0], sha256: "0".repeat(64) }];
  const badHashPath = join(tempRoot, "bad-hash.json");
  writeFileSync(badHashPath, JSON.stringify(badHash));
  const badRoot = join(tempRoot, "bad-hash-models");
  run(["-ManifestPath", badHashPath, "-ModelsRoot", badRoot], false);
  assert.equal(existsSync(join(badRoot, "diffusion_models", "one.bin")), false);
  assert.equal(existsSync(join(badRoot, "diffusion_models", "one.bin.part")), true);

  const escaped = structuredClone(localManifest);
  escaped.files = [{ ...escaped.files[0], targetSubdirectory: "..\\escape" }];
  const escapedPath = join(tempRoot, "escaped.json");
  writeFileSync(escapedPath, JSON.stringify(escaped));
  run(["-ManifestPath", escapedPath, "-ModelsRoot", join(tempRoot, "escape-models")], false);
  assert.equal(existsSync(join(tempRoot, "escape", "one.bin")), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Qwen Image Edit 2511 model download contract: PASS");
