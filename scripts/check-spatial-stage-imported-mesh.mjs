import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
      export * from "./src/modules/spatial-stage/importedMesh.ts";
      export * from "./src/modules/spatial-stage/threeResourceTracker.ts";
      export * as THREE from "three";
    `,
    loader: "ts",
    resolveDir: process.cwd(),
    sourcefile: "spatial-stage-imported-mesh-check-entry.ts"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});

const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "imported mesh bundle should be available");
const runtime = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const {
  THREE,
  ThreeResourceTracker,
  loadStageMesh,
  validateStageMeshResource
} = runtime;

const valid = {
  filePath: "C:\\assets\\coffin.glb",
  sha256: "a".repeat(64),
  triangleCount: 12000,
  materialCount: 2,
  bounds: [2.05, 0.5, 0.68]
};

assert.deepEqual(validateStageMeshResource(valid), { ok: true });
assert.deepEqual(validateStageMeshResource({ ...valid, filePath: "coffin.gltf" }), { ok: true });
assert.equal(
  validateStageMeshResource({ ...valid, filePath: "coffin.fbx" }).reason,
  "stage_mesh_format_unsupported"
);
assert.equal(
  validateStageMeshResource({ ...valid, sha256: "bad" }).reason,
  "stage_mesh_hash_invalid"
);
assert.equal(
  validateStageMeshResource({ ...valid, bounds: [2, 0, 1] }).reason,
  "stage_mesh_bounds_invalid"
);
assert.equal(
  validateStageMeshResource({ ...valid, triangleCount: 250001 }).reason,
  "stage_mesh_triangle_budget_exceeded"
);

const original = new THREE.Group();
const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
const sharedTexture = new THREE.Texture();
const sharedMaterial = new THREE.MeshStandardMaterial({ map: sharedTexture });
const firstMesh = new THREE.Mesh(sharedGeometry, sharedMaterial);
const secondMesh = new THREE.Mesh(sharedGeometry, sharedMaterial);
original.add(firstMesh, secondMesh);

const loaded = await loadStageMesh(valid, {
  loadAsync: async () => ({ scene: original })
});
assert.notEqual(loaded, original, "loader-owned scene must be cloned");
assert.equal(firstMesh.castShadow, false, "loader-owned meshes must not be mutated");
assert.equal(loaded.children.length, 2);
for (const child of loaded.children) {
  assert.equal(child.castShadow, true);
  assert.equal(child.receiveShadow, true);
}

await assert.rejects(
  () => loadStageMesh(valid, { loadAsync: async () => ({ scene: new THREE.Group() }) }),
  /stage_mesh_contains_no_mesh/
);
await assert.rejects(
  () => loadStageMesh(valid, { loadAsync: async () => { throw new Error("bad"); } }),
  /stage_mesh_load_failed/
);

let geometryDisposeCount = 0;
let materialDisposeCount = 0;
let textureDisposeCount = 0;
const geometry = new THREE.BoxGeometry(1, 1, 1);
const texture = new THREE.Texture();
const material = new THREE.MeshStandardMaterial({ map: texture });
geometry.dispose = () => { geometryDisposeCount += 1; };
material.dispose = () => { materialDisposeCount += 1; };
texture.dispose = () => { textureDisposeCount += 1; };
const resourceGroup = new THREE.Group();
resourceGroup.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));

const tracker = new ThreeResourceTracker();
tracker.trackObject3D(resourceGroup);
tracker.dispose();
tracker.dispose();
assert.equal(geometryDisposeCount, 1);
assert.equal(materialDisposeCount, 1);
assert.equal(textureDisposeCount, 1);

console.log("spatial stage imported mesh checks passed");
