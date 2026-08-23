import assert from "node:assert/strict";

const importer = await import("./import-jiang-lan-hybrid.mjs");

const current = {
  project: { id: "proj_001", name: "test" },
  sequences: [],
  shots: [],
  assets: [
    { id: "other", projectId: "proj_001", type: "scene", name: "河边", filePath: "scene.png" },
    {
      id: "asset_1773997039637_416",
      projectId: "proj_001",
      type: "character",
      name: "江岚",
      filePath: "missing-front.png",
      characterFrontPath: "missing-front.png",
      characterSidePath: "missing-side.png",
      characterBackPath: "missing-back.png",
      characterFaceRefPath: "missing-face.png",
      characterDetailRefPath: "missing-detail.png",
      characterZeroShotEvidence: { stale: true },
      currentZeroContext: { stale: true }
    }
  ]
};

const paths = {
  selectedFace: "C:/approved/selected-face.png",
  front: "C:/approved/front.png",
  side: "C:/approved/side.png",
  back: "C:/approved/back.png"
};
const updated = importer.buildUpdatedSnapshot(current, paths, "2026-08-10T00:00:00.000Z");
assert.notEqual(updated, current);
assert.equal(updated.assets[0].filePath, "scene.png");

const asset = updated.assets[1];
assert.equal(asset.id, "asset_1773997039637_416");
assert.equal(asset.projectId, "proj_001");
assert.equal(asset.filePath, paths.front);
assert.equal(asset.characterFrontPath, paths.front);
assert.equal(asset.characterSidePath, paths.side);
assert.equal(asset.characterBackPath, paths.back);
assert.equal(asset.characterFaceRefPath, paths.selectedFace);
assert.equal(asset.characterDetailRefPath, paths.front);
assert.equal(asset.characterAnchorModelName, "flux-2-klein-4b-fp8.safetensors");
assert.equal(asset.characterIdentityPack.version, "jiang-lan-hybrid-v1");
assert.equal(asset.characterIdentityPack.faceMasterPath, paths.selectedFace);
assert.equal(asset.characterIdentityPack.neutralExpressionPath, paths.selectedFace);
assert.equal(asset.characterIdentityPack.bodyFrontPath, paths.front);
assert.equal(asset.characterIdentityPack.bodySidePath, paths.side);
assert.equal(asset.characterIdentityPack.bodyBackPath, paths.back);
assert.equal(asset.characterIdentityPack.hairBackPath, paths.back);
assert.equal(asset.characterIdentityPack.species, "human");
assert.deepEqual(asset.characterIdentityPack.speciesTraits, []);
assert.equal(asset.characterIdentityPack.approvedHeroFramePaths.includes(paths.selectedFace), true);
assert.equal("characterZeroShotEvidence" in asset, false);
assert.equal("currentZeroContext" in asset, false);

const missingAssetSnapshot = {
  ...current,
  assets: current.assets.filter((item) => item.id !== "asset_1773997039637_416")
};
const inserted = importer.buildUpdatedSnapshot(missingAssetSnapshot, paths, "2026-08-10T00:00:00.000Z");
const insertedMatches = inserted.assets.filter((item) => item.id === "asset_1773997039637_416");
assert.equal(insertedMatches.length, 1);
assert.equal(insertedMatches[0].name, "江岚");
assert.equal(insertedMatches[0].projectId, "proj_001");
assert.equal(insertedMatches[0].characterFrontPath, paths.front);
assert.equal(inserted.assets.length, missingAssetSnapshot.assets.length + 1);
const uiBackup = importer.buildUiImportBackup(missingAssetSnapshot, paths, "2026-08-10T00:00:00.000Z");
assert.equal(uiBackup.schemaVersion, 1);
assert.equal(uiBackup.exportedAt, "2026-08-10T00:00:00.000Z");
assert.equal(uiBackup.snapshot.assets.filter((item) => item.id === "asset_1773997039637_416").length, 1);

console.log("Jiang Lan hybrid project import contract: PASS");
process.exit(0);
