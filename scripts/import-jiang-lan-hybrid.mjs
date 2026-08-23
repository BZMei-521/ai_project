import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "http://127.0.0.1:3210";
const ASSET_ID = "asset_1773997039637_416";
const OUTPUT_DIRECTORY = resolve("logs/jiang-lan-hybrid-v1");
const MANIFEST_PATH = resolve(OUTPUT_DIRECTORY, "manifest.json");
const BACKUP_PATH = resolve(OUTPUT_DIRECTORY, "pre-import-current-project.json");
const RECEIPT_PATH = resolve(OUTPUT_DIRECTORY, "project-import-receipt.json");
const UI_BACKUP_PATH = resolve(OUTPUT_DIRECTORY, "jiang-lan-hybrid-v1-ui-import-20260810.json");
const STYLE_CONTRACT = Object.freeze({
  id: "cinematic_3d_donghua_v1",
  version: "1.0.0",
  digest: "27db8be0b246c9b931217e24caffc9606c0959b035f7a0d9714ed0c058828b88"
});

export function buildUpdatedSnapshot(currentSnapshot, paths, updatedAt = new Date().toISOString()) {
  if (!currentSnapshot || typeof currentSnapshot !== "object" || !Array.isArray(currentSnapshot.assets)) {
    throw new Error("Current StoryboardPro snapshot is invalid.");
  }
  const matches = currentSnapshot.assets.flatMap((asset, index) => asset?.id === ASSET_ID ? [index] : []);
  if (matches.length > 1) throw new Error("Current project contains duplicate Jiang Lan assets.");
  for (const key of ["selectedFace", "front", "side", "back"]) {
    if (typeof paths?.[key] !== "string" || !paths[key].trim()) throw new Error(`Missing canonical path: ${key}`);
  }

  const snapshot = structuredClone(currentSnapshot);
  const index = matches.length === 1 ? matches[0] : snapshot.assets.length;
  const current = snapshot.assets[index] ?? {
    id: ASSET_ID,
    projectId: String(snapshot.project?.id ?? ""),
    type: "character",
    name: "江岚",
    voiceProfile: ""
  };
  const next = {
    ...current,
    filePath: paths.front,
    characterFrontPath: paths.front,
    characterSidePath: paths.side,
    characterBackPath: paths.back,
    characterFaceRefPath: paths.selectedFace,
    characterDetailRefPath: paths.front,
    characterAnchorModelName: "flux-2-klein-4b-fp8.safetensors",
    characterIdentityPack: {
      version: "jiang-lan-hybrid-v1",
      triggerWord: "char_jiang_lan_v1",
      species: "human",
      speciesTraits: [],
      styleContractId: STYLE_CONTRACT.id,
      styleContractVersion: STYLE_CONTRACT.version,
      styleContractDigest: STYLE_CONTRACT.digest,
      faceMasterPath: paths.selectedFace,
      faceLeftPath: paths.side,
      faceRightPath: paths.side,
      hairBackPath: paths.back,
      bodyFrontPath: paths.front,
      bodySidePath: paths.side,
      bodyBackPath: paths.back,
      neutralExpressionPath: paths.selectedFace,
      immutableTraits: [
        "adult Chinese female face, age 25 to 30",
        "calm dark brown almond-shaped eyes",
        "center-parted long straight black hair below the waist",
        "light gray-blue long-sleeve ankle-length dress with gray-blue waist band",
        "simple black flats",
        "slender healthy adult human proportions"
      ],
      forbiddenChanges: [
        "preserve recognizable adult facial identity and eye shape",
        "preserve center part, black hair color, straight texture, and below-waist length",
        "preserve the gray-blue dress, waist band, ankle-length skirt, and black flats",
        "preserve mature adult female proportions",
        "human ears only, no animal ears, tail, horns, muzzle, or beast traits",
        "no childlike face or body proportions"
      ],
      approvedHeroFramePaths: [paths.selectedFace, paths.front],
      updatedAt
    }
  };
  delete next.characterZeroShotEvidence;
  delete next.currentZeroContext;
  snapshot.assets[index] = next;
  return snapshot;
}

export function buildUiImportBackup(currentSnapshot, paths, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    exportedAt,
    snapshot: buildUpdatedSnapshot(currentSnapshot, paths, exportedAt)
  };
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function invoke(command, body) {
  const response = await fetch(`${BASE_URL}/api/invoke/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`StoryboardPro ${command} failed: ${payload?.error ?? response.status}`);
  return payload?.result;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (manifest.status !== "approved_for_project_import" || manifest.approval !== "explicit_user_selection_seed_2026080932") {
    throw new Error("Jiang Lan view manifest is not approved for import.");
  }
  if (manifest.characterAssetId !== ASSET_ID || manifest.species !== "human") {
    throw new Error("Jiang Lan manifest identity contract mismatch.");
  }

  const byView = Object.fromEntries((manifest.candidates ?? []).map((item) => [item.view, item]));
  if (!byView.front || !byView.side || !byView.back) throw new Error("Manifest is missing canonical views.");
  const paths = {
    selectedFace: resolve(manifest.identityReference.path),
    front: resolve(OUTPUT_DIRECTORY, byView.front.outputPath),
    side: resolve(OUTPUT_DIRECTORY, byView.side.outputPath),
    back: resolve(OUTPUT_DIRECTORY, byView.back.outputPath)
  };
  const expectedHashes = {
    selectedFace: manifest.identityReference.sha256,
    front: byView.front.sha256,
    side: byView.side.sha256,
    back: byView.back.sha256
  };
  for (const key of Object.keys(paths)) {
    const actual = await sha256File(paths[key]);
    if (actual !== expectedHashes[key]) throw new Error(`Canonical ${key} hash mismatch.`);
  }

  const currentSnapshot = await invoke("load_current_project", {});
  const importedAt = new Date().toISOString();
  const updatedSnapshot = buildUpdatedSnapshot(currentSnapshot, paths, importedAt);
  if (process.argv.includes("--ui-backup")) {
    const uiBackup = buildUiImportBackup(currentSnapshot, paths, importedAt);
    await writeFile(UI_BACKUP_PATH, `${JSON.stringify(uiBackup, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({
      schemaVersion: uiBackup.schemaVersion,
      status: "ready_for_ui_import",
      outputPath: UI_BACKUP_PATH,
      assetCount: uiBackup.snapshot.assets.length,
      jiangLanAssetCount: uiBackup.snapshot.assets.filter((item) => item.id === ASSET_ID).length
    }, null, 2));
    return;
  }
  await writeFile(BACKUP_PATH, `${JSON.stringify(currentSnapshot, null, 2)}\n`, { flag: "wx" });
  const saved = await invoke("save_current_project", { snapshot: updatedSnapshot });
  const receipt = {
    schemaVersion: 1,
    status: "imported",
    importedAt,
    characterAssetId: ASSET_ID,
    identityPackVersion: "jiang-lan-hybrid-v1",
    projectPath: saved?.projectPath ?? "",
    backupPath: BACKUP_PATH,
    canonicalPaths: paths,
    canonicalHashes: expectedHashes
  };
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
