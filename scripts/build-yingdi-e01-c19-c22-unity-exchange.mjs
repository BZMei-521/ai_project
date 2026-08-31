import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { buildYingdiUnityExchanges } from "./lib/unity-previs/yingdi-tomb-adapter.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new TypeError(`missing_argument:${name}`);
  return value;
};
const stagePath = resolve(required("--stage"));
const panoramaPath = resolve(required("--panorama"));
const outputDir = resolve(required("--output"));
const width = Number(required("--panorama-width"));
const height = Number(required("--panorama-height"));
const expectedHash = required("--panorama-sha256").toLowerCase();
const stage = JSON.parse(await readFile(stagePath, "utf8"));
const panoramaBytes = await readFile(panoramaPath);
const actualHash = createHash("sha256").update(panoramaBytes).digest("hex");
if (actualHash !== expectedHash) throw new TypeError(`panorama_hash_mismatch:${actualHash}`);
const bundle = buildYingdiUnityExchanges(stage, {
  assetId: "yingdi-e01-tomb-codex-v1",
  path: panoramaPath.replaceAll("\\", "/"),
  sha256: actualHash,
  width,
  height
});

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

await mkdir(outputDir, { recursive: true });
const inputs = [];
for (const item of bundle.exchanges) {
  const fileName = `${item.shotId}.unity-exchange.json`;
  const path = join(outputDir, fileName);
  await atomicJson(path, item.exchange);
  const bytes = await readFile(path);
  inputs.push({ shotId: item.shotId, fileName, sha256: createHash("sha256").update(bytes).digest("hex"), cameraDigest: item.cameraDigest });
}
const manifest = {
  schemaVersion: 1,
  workflow: bundle.workflow,
  state: "ready_for_unity_export",
  sourceStage: { path: stagePath.replaceAll("\\", "/"), id: bundle.stageId, revision: bundle.stageRevision, digest: bundle.stageDigest },
  panorama: bundle.panorama,
  authority: bundle.sourceAudit,
  inputs,
  generatedAt: new Date().toISOString()
};
await atomicJson(join(outputDir, "..", "unity-input-bundle.json"), manifest);
console.log(JSON.stringify({ outputDir, manifest: join(dirname(outputDir), "unity-input-bundle.json"), inputs: inputs.map((item) => basename(item.fileName)) }));
