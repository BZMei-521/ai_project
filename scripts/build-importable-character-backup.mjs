import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ASSET_ID = "asset_1774017261433_390";
const DEFAULT_SOURCE = resolve("examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d-evidence.json");
const DEFAULT_OUTPUT = resolve("examples/character-consistency-benchmark/shen-yan-cinematic3d-evidence-importable-backup.json");

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function buildImportableCharacterBackup(currentSnapshot, verifiedAsset, options = {}) {
  if (!plain(currentSnapshot?.project) || !Array.isArray(currentSnapshot?.sequences) || !Array.isArray(currentSnapshot?.shots) || !Array.isArray(currentSnapshot?.assets)) {
    throw new Error("current snapshot is incomplete");
  }
  if (!plain(verifiedAsset) || typeof verifiedAsset.id !== "string" || !verifiedAsset.id.trim()) {
    throw new Error("verified asset is invalid");
  }
  const matchingIndexes = currentSnapshot.assets.flatMap((item, index) => item?.id === verifiedAsset.id ? [index] : []);
  if (matchingIndexes.length !== 1) throw new Error("current snapshot must contain exactly one matching asset");
  const snapshot = structuredClone(currentSnapshot);
  const index = matchingIndexes[0];
  const currentAsset = snapshot.assets[index];
  snapshot.assets[index] = {
    ...currentAsset,
    ...structuredClone(verifiedAsset),
    projectId: currentAsset.projectId ?? currentSnapshot.project.id
  };
  return {
    schemaVersion: 1,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    snapshot
  };
}

async function loadCurrentSnapshot(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/invoke/load_current_project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`StoryboardPro bridge failed: ${payload?.error ?? response.status}`);
  if (!plain(payload?.result)) throw new Error("StoryboardPro current project is unavailable; save it first");
  return payload.result;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((item) => {
    const split = item.indexOf("=");
    return split > 2 && item.startsWith("--") ? [item.slice(2, split), item.slice(split + 1)] : [item, ""];
  }));
  const sourcePath = resolve(args.source || DEFAULT_SOURCE);
  const outputPath = resolve(args.output || DEFAULT_OUTPUT);
  const assetId = args.asset || DEFAULT_ASSET_ID;
  const baseUrl = args["storyboard-url"] || "http://127.0.0.1:3210";
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const matches = source?.snapshot?.assets?.filter((item) => item?.id === assetId) ?? [];
  if (matches.length !== 1) throw new Error("verified project must contain exactly one matching asset");
  const verifiedAsset = matches[0];
  if (verifiedAsset?.characterIdentityPack?.version !== "shen-yan-hybrid-v5" || verifiedAsset?.characterZeroShotEvidence?.acceptedShots !== 8 || !plain(verifiedAsset?.characterZeroShotEvidence?.trustedReceipt)) {
    throw new Error("verified Shen Yan evidence is incomplete");
  }
  const currentSnapshot = await loadCurrentSnapshot(baseUrl);
  const backup = buildImportableCharacterBackup(currentSnapshot, verifiedAsset);
  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    outputPath,
    projectName: backup.snapshot.project.name,
    sequences: backup.snapshot.sequences.length,
    shots: backup.snapshot.shots.length,
    assets: backup.snapshot.assets.length,
    importedAssetId: assetId,
    identityVersion: verifiedAsset.characterIdentityPack.version,
    acceptedShots: verifiedAsset.characterZeroShotEvidence.acceptedShots
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
