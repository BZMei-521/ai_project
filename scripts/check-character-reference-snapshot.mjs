import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as snapshotRuntime from "../src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs";

assert.equal(
  typeof snapshotRuntime.stageImmutableCharacterReferenceSnapshot,
  "function",
  "production must expose an immutable reference snapshot constructor"
);
assert.equal(
  typeof snapshotRuntime.verifyImmutableCharacterReferenceSnapshot,
  "function",
  "production must expose a queue-time immutable snapshot verifier"
);
assert.equal(
  typeof snapshotRuntime.verifyCompiledCharacterReferenceBindings,
  "function",
  "production must prove the exact compiled workflow reference filenames"
);

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fields = {
  face_master: "faceMasterPath",
  face_left: "faceLeftPath",
  body_front: "bodyFrontPath"
};
const originals = new Map([
  ["original/front.png", Buffer.from("old-front")],
  ["original/side.png", Buffer.from("old-side")],
  ["original/body.png", Buffer.from("old-body")],
  ["original/hero.png", Buffer.from("old-hero")]
]);
const staged = new Map();
const events = [];
const identity = {
  version: "identity-v1",
  faceMasterPath: "original/front.png",
  faceLeftPath: "original/side.png",
  bodyFrontPath: "original/body.png"
};
const hashIdentity = async (candidate) => {
  events.push("hash");
  return Object.fromEntries(Object.entries(fields).map(([slot, field]) => {
    const bytes = staged.get(candidate[field]);
    assert.ok(bytes, `hashing must read staged bytes for ${slot}`);
    return [slot, hash(bytes)];
  }));
};
const hashReferencePaths = async (paths) => Object.fromEntries(Object.entries(paths).map(([slot, sourcePath]) => {
  const bytes = staged.get(sourcePath);
  assert.ok(bytes, `hashing must read supplemental staged bytes for ${slot}`);
  return [slot, hash(bytes)];
}));

const snapshot = await snapshotRuntime.stageImmutableCharacterReferenceSnapshot({
  identity,
  supplementalReferences: { approved_hero: "original/hero.png" },
  stageReference: async ({ slot, sourcePath }) => {
    events.push(`stage:${slot}`);
    const target = `run-owned/${slot}.png`;
    staged.set(target, Buffer.from(originals.get(sourcePath)));
    return target;
  },
  hashIdentity,
  hashReferencePaths
});

assert.equal(events.at(-1), "hash", "all canonical references must be staged before the first trusted hash pass");
assert.equal(events.slice(0, -1).every((event) => event.startsWith("stage:")), true);
originals.set("original/front.png", Buffer.from("replacement-front"));
assert.equal(staged.get(snapshot.stagedIdentity.faceMasterPath).toString(), "old-front", "generation must remain bound to the pre-replacement staged bytes");
assert.equal(snapshot.pathBySource["original/front.png"], snapshot.stagedIdentity.faceMasterPath, "later workflow references must resolve through the immutable staging map");
assert.equal(snapshot.pathBySource["original/hero.png"], snapshot.supplementalPaths.approved_hero, "retry hero references must be part of the same immutable snapshot");

assert.deepEqual(
  await snapshotRuntime.verifyImmutableCharacterReferenceSnapshot(snapshot, hashIdentity, hashReferencePaths),
  { valid: true, reason: "ok" },
  "an unchanged immutable snapshot passes the queue gate"
);

staged.set(snapshot.stagedIdentity.faceMasterPath, Buffer.from("old-front"));
const compiledWorkflow = {
  "1": { class_type: "LoadImage", inputs: { image: "run-owned/face_master.png" } },
  "2": { class_type: "LoadImage", inputs: { image: "run-owned/face_left.png" } },
  "3": { class_type: "ImageScaleToTotalPixels", inputs: { image: ["1", 0] } },
  "4": { class_type: "ImageScaleToTotalPixels", inputs: { image: ["2", 0] } },
  "5": { class_type: "VAEEncode", inputs: { pixels: ["3", 0], vae: ["30", 0] } },
  "6": { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["30", 0] } },
  "7": { class_type: "ReferenceLatent", inputs: { conditioning: ["31", 0], latent: ["5", 0] } },
  "8": { class_type: "ReferenceLatent", inputs: { conditioning: ["7", 0], latent: ["6", 0] } },
  "9": { class_type: "CFGGuider", inputs: { model: ["32", 0], positive: ["8", 0] } },
  "10": { class_type: "SamplerCustomAdvanced", inputs: { guider: ["9", 0], latent_image: ["33", 0] } },
  "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["30", 0] } },
  "12": { class_type: "LoadImage", inputs: { image: "scene/background.png" } },
  "13": { class_type: "ImageCompositeMasked", inputs: { destination: ["12", 0], source: ["11", 0] } },
  "14": { class_type: "SaveImage", inputs: { images: ["13", 0] } },
  "30": { class_type: "VAELoader", inputs: {} },
  "31": { class_type: "CLIPTextEncode", inputs: {} },
  "32": { class_type: "UNETLoader", inputs: {} },
  "33": { class_type: "EmptyFlux2LatentImage", inputs: {} }
};
const expectedWorkflowInputs = ["run-owned/face_master.png", "run-owned/face_left.png"];
assert.deepEqual(
  snapshotRuntime.verifyCompiledCharacterReferenceBindings(compiledWorkflow, expectedWorkflowInputs),
  { valid: true, reason: "ok" },
  "snapshot references must reach the active character conditioning chain while an active scene LoadImage remains legal"
);
const orphanBypassWorkflow = structuredClone(compiledWorkflow);
orphanBypassWorkflow["1"] = { class_type: "LoadImage", inputs: { image: "run-owned/face_master.png" } };
orphanBypassWorkflow["2"] = { class_type: "LoadImage", inputs: { image: "run-owned/face_left.png" } };
orphanBypassWorkflow["15"] = { class_type: "LoadImage", inputs: { image: "attacker/live.png" } };
orphanBypassWorkflow["3"].inputs.image = ["15", 0];
orphanBypassWorkflow["4"].inputs.image = ["15", 0];
assert.deepEqual(
  snapshotRuntime.verifyCompiledCharacterReferenceBindings(orphanBypassWorkflow, expectedWorkflowInputs),
  { valid: false, reason: "compiled_reference_binding_mismatch" },
  "orphan snapshot LoadImage nodes cannot cover an attacker reference on the active conditioning chain"
);
staged.set(snapshot.stagedIdentity.faceMasterPath, Buffer.from("tampered-stage"));
assert.deepEqual(
  await snapshotRuntime.verifyImmutableCharacterReferenceSnapshot(snapshot, hashIdentity, hashReferencePaths),
  { valid: false, reason: "staged_reference_hash_mismatch" },
  "a mutated staged reference is rejected before queueing"
);

console.log("character reference snapshot checks passed");
