import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  stdin: {
    contents: `
      export * from "./src/modules/spatial-stage/normalizeStage.ts";
      export * from "./src/modules/spatial-stage/stageDigest.ts";
      export * from "./src/modules/spatial-stage/stageStoreActions.ts";
      export { useStoryboardStore } from "./src/modules/storyboard-core/store.ts";
    `,
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "spatial-stage-schema-check-entry.ts"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "spatial stage normalization bundle should be available");

const runtime = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);
const {
  addStage,
  computeStageSourceDigest,
  createEmptySceneStage,
  deleteStage,
  isStageSourceStale,
  normalizeSceneStage,
  normalizeSceneStages,
  patchStage,
  useStoryboardStore
} = runtime;

const now = "2026-08-19T00:00:00.000Z";
const empty = createEmptySceneStage("scene_01", now);
assert.equal(empty.schemaVersion, 2);
assert.equal(empty.sceneId, "scene_01");
assert.equal(empty.coordinateFrame.handedness, "right");
assert.equal(empty.coordinateFrame.upAxis, "y");
assert.equal(empty.coordinateFrame.unit, "metre");
assert.deepEqual(empty.coordinateFrame.forward, [0, 0, -1]);
assert.equal(empty.environment.sources[0].kind, "empty_stage");
assert.equal(empty.capabilities.overall, "manual_fallback");
assert.equal(empty.updatedAt, now);

const normalized = normalizeSceneStage({
  ...empty,
  revision: -8,
  environment: {
    sources: [
      { kind: "panorama", assetId: "sky_1", maxTextureWidth: 9000 },
      { kind: "depth_mesh", filePath: "mesh.glb", triangleCount: 900000 },
      { kind: "depth_map", depthUrl: "http://127.0.0.1:8188/view?filename=depth.png", normalUrl: "normal.png", maskUrl: "mask.png", promptId: "prompt-1", width: 99999, height: 0 }
    ]
  },
  entities: [
    {
      id: "hero",
      label: "Hero",
      tags: ["lead"],
      transform: {
        position: [Number.NaN, 2, 3],
        rotation: [0, 0, 0, 0],
        scale: [1, Number.POSITIVE_INFINITY, 1]
      },
      geometry: { kind: "capsule", size: [0.5, 1.8, 0.5] },
      visibility: "visible",
      metadata: {}
    }
  ]
});
assert.ok(normalized);
assert.equal(normalized.revision, 1);
assert.equal(normalized.environment.sources[0].maxTextureWidth, 4096);
assert.equal(normalized.environment.sources[1].triangleCount, 250000);
assert.equal(normalized.environment.sources[2].kind, "depth_map");
assert.equal(normalized.environment.sources[2].width, 8192);
assert.equal(normalized.environment.sources[2].height, 1);
assert.deepEqual(normalized.entities[0].transform.position, [0, 2, 3]);
assert.deepEqual(normalized.entities[0].transform.rotation, [0, 0, 0, 1]);
assert.deepEqual(normalized.entities[0].transform.scale, [1, 1, 1]);

assert.equal(normalizeSceneStage(null), null);
assert.equal(normalizeSceneStage({}), null);
assert.deepEqual(normalizeSceneStages([empty, null, {}, normalized]), [empty, normalized]);
assert.deepEqual(normalizeSceneStages("not-an-array"), []);

const migrated = normalizeSceneStage({
  ...empty,
  schemaVersion: 1,
  snapshots: [{
    id: "legacy-c01",
    beatId: "C01",
    entityStates: [],
    constraintIds: [],
    createdAt: now
  }]
});
assert.ok(migrated);
assert.equal(migrated.schemaVersion, 2);
assert.equal(migrated.snapshots[0].shotId, "C01");

const meshStage = normalizeSceneStage({
  ...migrated,
  entities: [{
    id: "coffin",
    label: "Coffin shell",
    tags: ["prop"],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    geometry: {
      kind: "imported_mesh",
      resource: {
        filePath: "C:\\assets\\coffin.glb",
        sha256: "a".repeat(64),
        triangleCount: 12000,
        materialCount: 2,
        bounds: [2.05, 0.5, 0.68]
      }
    },
    rig: { kind: "humanoid", joints: { left_wrist: "wrist.L" } },
    attachments: [{
      id: "nail_socket",
      label: "Nail socket",
      localTransform: { position: [0, 0.2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
    }],
    visibility: "visible",
    metadata: {}
  }]
});
assert.ok(meshStage);
assert.equal(meshStage.entities[0].geometry.kind, "imported_mesh");
assert.equal(meshStage.entities[0].geometry.resource.triangleCount, 12000);
assert.equal(meshStage.entities[0].rig.kind, "humanoid");
assert.equal(meshStage.entities[0].attachments[0].id, "nail_socket");
assert.equal(normalizeSceneStage({ ...meshStage, entities: [{ ...meshStage.entities[0], geometry: { ...meshStage.entities[0].geometry, resource: { ...meshStage.entities[0].geometry.resource, sha256: "bad" } } }] }).entities[0].geometry.kind, "box");
const changedMeshHash = structuredClone(meshStage);
changedMeshHash.entities[0].geometry.resource.sha256 = "b".repeat(64);
assert.notEqual(computeStageSourceDigest(meshStage), computeStageSourceDigest(changedMeshHash));

const digestA = createEmptySceneStage("scene_digest", now);
const digestB = { ...digestA, updatedAt: "2026-08-20T00:00:00.000Z", revision: 99 };
assert.equal(computeStageSourceDigest(digestA), computeStageSourceDigest(digestB));
assert.equal(
  computeStageSourceDigest({ ...digestA, capabilities: { ...digestA.capabilities, overall: "available" } }),
  computeStageSourceDigest(digestA)
);
const changedSource = {
  ...digestA,
  environment: {
    sources: [{ kind: "panorama", assetId: "other", maxTextureWidth: 4096 }]
  }
};
assert.notEqual(computeStageSourceDigest(digestA), computeStageSourceDigest(changedSource));
assert.equal(isStageSourceStale({ ...digestA, sourceDigest: "wrong" }), true);
const currentDigest = computeStageSourceDigest(digestA);
assert.equal(isStageSourceStale({ ...digestA, sourceDigest: currentDigest }), false);

const stageWithDigest = { ...digestA, sourceDigest: currentDigest };
const added = addStage([], stageWithDigest);
assert.deepEqual(added, [stageWithDigest]);
assert.deepEqual(addStage(added, stageWithDigest), added, "duplicate stage IDs should replace, not append");
const patched = patchStage(
  added,
  stageWithDigest.id,
  { environment: changedSource.environment },
  "2026-08-19T01:00:00.000Z"
);
assert.equal(patched[0].revision, 2);
assert.equal(patched[0].updatedAt, "2026-08-19T01:00:00.000Z");
assert.equal(isStageSourceStale(patched[0]), false);
assert.notEqual(patched, added);
assert.deepEqual(deleteStage(patched, stageWithDigest.id), []);

useStoryboardStore.getState().hydrateFromSnapshot({ spatialStages: [stageWithDigest, null, {}] });
assert.equal(useStoryboardStore.getState().spatialStages.length, 1);
const createdId = useStoryboardStore.getState().createSpatialStage("scene_created");
assert.ok(useStoryboardStore.getState().spatialStages.some((stage) => stage.id === createdId));
useStoryboardStore.getState().updateSpatialStage(createdId, {
  environment: { sources: [{ kind: "procedural", primitive: "ground" }] }
});
assert.equal(
  useStoryboardStore.getState().spatialStages.find((stage) => stage.id === createdId)?.revision,
  2
);
useStoryboardStore.getState().removeSpatialStage(createdId);
assert.equal(useStoryboardStore.getState().spatialStages.some((stage) => stage.id === createdId), false);
useStoryboardStore.getState().resetForNewProject("Fresh");
assert.deepEqual(useStoryboardStore.getState().spatialStages, []);

console.log("spatial stage schema checks passed");
