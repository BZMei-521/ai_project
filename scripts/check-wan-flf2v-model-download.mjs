import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const downloaderPath = join(repositoryRoot, "scripts", "download-wan-flf2v-model.ps1");
const productionManifestPath = join(
  repositoryRoot,
  "src",
  "modules",
  "comfy-pipeline",
  "presets",
  "wan-flf2v-model-manifest.json",
);
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function runDownloader(args, expectedStatus = 0, environment = {}) {
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", downloaderPath, ...args],
    { encoding: "utf8", env: { ...process.env, ...environment } },
  );
  assert.equal(
    result.status,
    expectedStatus,
    `downloader exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function writeManifest(path, values) {
  await writeFile(path, `${JSON.stringify({ schemaVersion: 1, targetSubdirectory: "diffusion_models", ...values }, null, 2)}\n`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "wan-flf2v-download-check-"));

try {
  const productionManifest = JSON.parse(await readFile(productionManifestPath, "utf8"));
  assert.equal(productionManifest.fileName, "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors");
  assert.equal(productionManifest.schemaVersion, 1);
  assert.equal(productionManifest.downloadUrl, "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors?download=true");
  assert.equal(productionManifest.sha256, "d68ca694a695274e48e00974128337e06e497d95a1dc09e86fd2a01a405f455f");
  assert.equal(productionManifest.minimumFreeBytes, 26843545600);
  assert.equal(productionManifest.targetSubdirectory, "diffusion_models");

  const fakeLocalAppData = join(temporaryRoot, "fake-local-appdata");
  const fakeSharedRoot = join(fakeLocalAppData, "Comfy-Desktop", "ComfyUI-Shared");
  await mkdir(fakeSharedRoot, { recursive: true });
  const defaultDryRun = runDownloader(["-DryRun"], 0, { LOCALAPPDATA: fakeLocalAppData });
  const defaultDryRunInfo = JSON.parse(defaultDryRun.stdout);
  assert.equal(defaultDryRunInfo.finalPath, join(fakeSharedRoot, "models", productionManifest.targetSubdirectory, productionManifest.fileName));
  assert.equal(defaultDryRunInfo.partialPath, `${defaultDryRunInfo.finalPath}.part`);
  const mirrorDryRun = runDownloader(["-DryRun", "-MirrorBase", "https://hf-mirror.com"], 0, { LOCALAPPDATA: fakeLocalAppData });
  assert.match(JSON.parse(mirrorDryRun.stdout).downloadUrl, /^https:\/\/hf-mirror\.com\/Comfy-Org\/Wan_2\.1_ComfyUI_repackaged/);
  await assert.rejects(stat(join(fakeSharedRoot, "models")));

  const missingRuntimeRoot = join(temporaryRoot, "missing-local-appdata");
  const noRuntime = runDownloader(["-DryRun"], 1, { LOCALAPPDATA: missingRuntimeRoot });
  assert.match(noRuntime.stderr, /No verified Comfy Desktop shared runtime root.*TargetDir/);
  await assert.rejects(stat(join(missingRuntimeRoot, "Comfy-Desktop", "ComfyUI-Shared")));

  const sourcePath = join(temporaryRoot, "tiny-source.safetensors");
  const contents = Buffer.from("tiny local FLF2V acquisition fixture\n");
  await writeFile(sourcePath, contents);
  const targetDir = join(temporaryRoot, "models");
  const manifestPath = join(temporaryRoot, "fixture-manifest.json");
  const fileName = "tiny-model.safetensors";
  const finalPath = join(targetDir, fileName);
  const partialPath = `${finalPath}.part`;
  const commonManifest = {
    fileName,
    downloadUrl: pathToFileURL(sourcePath).href,
    sha256: sha256(contents),
    minimumFreeBytes: 1,
  };

  await writeManifest(manifestPath, commonManifest);

  const dryRun = runDownloader(["-ManifestPath", manifestPath, "-TargetDir", targetDir, "-DryRun"]);
  const dryRunInfo = JSON.parse(dryRun.stdout);
  assert.equal(dryRunInfo.finalPath, finalPath);
  assert.equal(dryRunInfo.partialPath, partialPath);
  assert.equal(dryRunInfo.sha256, commonManifest.sha256);
  await assert.rejects(stat(finalPath));
  await assert.rejects(stat(partialPath));

  await mkdir(targetDir, { recursive: true });
  await writeFile(partialPath, contents.subarray(0, 10));
  runDownloader(["-ManifestPath", manifestPath, "-TargetDir", targetDir]);
  assert.deepEqual(await readFile(finalPath), contents);
  await assert.rejects(stat(partialPath));

  runDownloader(["-ManifestPath", manifestPath, "-TargetDir", targetDir]);
  assert.deepEqual(await readFile(finalPath), contents);

  await rm(finalPath);
  await writeManifest(manifestPath, { ...commonManifest, sha256: "0".repeat(64) });
  runDownloader(["-ManifestPath", manifestPath, "-TargetDir", targetDir], 1);
  await assert.rejects(stat(finalPath));
  assert.deepEqual(await readFile(partialPath), contents);

  await rm(partialPath);
  await writeManifest(manifestPath, { ...commonManifest, minimumFreeBytes: 9007199254740991 });
  runDownloader(["-ManifestPath", manifestPath, "-TargetDir", targetDir], 1);
  await assert.rejects(stat(finalPath));
  await assert.rejects(stat(partialPath));

  for (const minimumFreeBytes of [undefined, null, -1, 0, 1.5]) {
    const malformedTargetDir = join(temporaryRoot, `malformed-${String(minimumFreeBytes)}`);
    const malformedManifest = { ...commonManifest };
    if (minimumFreeBytes === undefined) {
      delete malformedManifest.minimumFreeBytes;
    } else {
      malformedManifest.minimumFreeBytes = minimumFreeBytes;
    }
    await writeManifest(manifestPath, malformedManifest);
    runDownloader(["-ManifestPath", manifestPath, "-TargetDir", malformedTargetDir], 1);
    await assert.rejects(stat(malformedTargetDir));
  }

  console.log("PASS: WAN FLF2V downloader manifest contract, runtime discovery, dry-run, resume, verified promotion, idempotence, hash failure, and free-space policy");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
