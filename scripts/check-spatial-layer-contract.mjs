import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeSpatialShotContract,
  orderedLayerIds,
  validateSpatialShotContract
} from "../src/modules/spatial-stage/spatialLayerContractRuntime.mjs";

const typedWrapperSource = readFileSync(
  fileURLToPath(new URL("../src/modules/spatial-stage/spatialLayerContract.ts", import.meta.url)),
  "utf8"
);
assert.equal(/@ts-(?:ignore|expect-error)/.test(typedWrapperSource), false);
assert.equal(/runtime(?:Normalize|OrderedLayerIds|Validate)\s+as/.test(typedWrapperSource), false);

const contract = normalizeSpatialShotContract({
  schemaVersion: 1,
  shotId: "fixture-shot",
  cameraId: "fixture-camera",
  layers: [
    { id: "foreground", order: 30, role: "foreground_occluder", entityIds: ["table"] },
    { id: "interaction", order: 25, role: "interaction", entityIds: ["cup"] },
    { id: "subject", order: 20, role: "subject", entityIds: ["actor", "hand"] },
    { id: "background", order: 10, role: "environment", entityIds: ["room"] }
  ],
  relations: [
    { kind: "behind", subjectEntityId: "actor", targetEntityId: "table" },
    { kind: "contact", subjectEntityId: "hand", targetEntityId: "cup" }
  ],
  expectedHands: [{ entityId: "actor", side: "right", visible: true, contactTargetId: "cup" }],
  riskFlags: ["hand", "foreground_occlusion"]
});

assert.deepEqual(orderedLayerIds(contract), ["background", "subject", "interaction", "foreground"]);
assert.deepEqual(validateSpatialShotContract(contract), { valid: true });
assert.equal(JSON.stringify(contract).includes("coffin"), false);
assert.equal(
  validateSpatialShotContract({ ...contract, relations: [{ kind: "inside", subjectEntityId: "actor", targetEntityId: "missing" }] }).reason,
  "spatial_contract_relation_target_missing:missing"
);

for (const invalidId of [undefined, null, {}]) {
  const invalidContract = normalizeSpatialShotContract({
    ...contract,
    layers: [{ id: invalidId, order: 10, role: "environment", entityIds: ["room"] }],
    relations: []
  });
  const validation = validateSpatialShotContract(invalidContract);
  assert.equal(validation.valid, false);
  assert.match(validation.reason, /^spatial_contract_layer_invalid:/);
}

console.log("PASS generic spatial layer contract");
