import assert from "node:assert/strict";

import { buildImportableCharacterBackup } from "./build-importable-character-backup.mjs";

const currentSnapshot = {
  project: { id: "proj_001", name: "Current Project" },
  sequences: [{ id: "seq_001", projectId: "proj_001", name: "Opening", order: 1 }],
  shots: [{ id: "shot_001", sequenceId: "seq_001", order: 1 }],
  assets: [
    { id: "asset_target", projectId: "proj_001", type: "character", name: "Old", voiceProfile: "keep-me" },
    { id: "asset_other", projectId: "proj_001", type: "character", name: "Other" }
  ],
  generationTasks: []
};
const verifiedAsset = {
  id: "asset_target",
  projectId: "benchmark_project",
  type: "character",
  name: "Shen Yan",
  characterIdentityPack: { version: "shen-yan-hybrid-v5" },
  characterZeroShotEvidence: { acceptedShots: 8 }
};

const backup = buildImportableCharacterBackup(currentSnapshot, verifiedAsset, {
  exportedAt: "2026-08-09T16:00:00.000Z"
});

assert.equal(backup.schemaVersion, 1);
assert.equal(backup.exportedAt, "2026-08-09T16:00:00.000Z");
assert.equal(backup.snapshot.project.name, "Current Project");
assert.deepEqual(backup.snapshot.sequences, currentSnapshot.sequences);
assert.deepEqual(backup.snapshot.shots, currentSnapshot.shots);
assert.deepEqual(backup.snapshot.assets.find((item) => item.id === "asset_other"), currentSnapshot.assets[1]);
const merged = backup.snapshot.assets.find((item) => item.id === "asset_target");
assert.equal(merged.projectId, "proj_001", "the current project ownership is preserved");
assert.equal(merged.voiceProfile, "keep-me", "current asset fields absent from the verified asset are preserved");
assert.equal(merged.characterIdentityPack.version, "shen-yan-hybrid-v5");
assert.equal(merged.characterZeroShotEvidence.acceptedShots, 8);
assert.notEqual(backup.snapshot, currentSnapshot, "the source snapshot is not mutated");

assert.throws(
  () => buildImportableCharacterBackup({ ...currentSnapshot, assets: [] }, verifiedAsset),
  /exactly one matching asset/
);

process.stdout.write("PASS importable backup schema and non-destructive verified-asset merge\n");
