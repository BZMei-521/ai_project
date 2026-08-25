import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  createLayeredSpatialControlPack,
  validateLayeredSpatialControlPack,
  classifySpatialControlPackVersion,
  sha256Bytes
} from "../src/modules/spatial-stage/layeredSpatialControlPackRuntime.mjs";

const sha = "a".repeat(64);
const current = {
  stageId: "stage", stageRevision: 3, stageDigest: sha, shotId: "shot", snapshotId: "snapshot",
  cameraId: "camera", cameraDigest: sha
};
const input = {
  ...current,
  contractDigest: sha, preflightDigest: sha,
  layers: [
    { layerId: "front", order: 20, role: "foreground_occluder", entityIds: ["table"], artifacts: [{ kind: "mask", filePath: "front.png", sha256: sha, width: 1280, height: 720 }] },
    { layerId: "actor", order: 10, role: "subject", entityIds: ["actor"], artifacts: [{ kind: "normal", filePath: "normal.png", sha256: sha, width: 1280, height: 720 }, { kind: "mask", filePath: "actor.png", sha256: sha, width: 1280, height: 720 }] },
    { layerId: "back", order: 0, role: "environment", entityIds: ["room"], artifacts: [{ kind: "color", filePath: "back.png", sha256: sha, width: 1280, height: 720 }] }
  ],
  skeletonArtifacts: [{ entityId: "actor", kind: "openpose", filePath: "pose.png", sha256: sha, width: 1280, height: 720 }]
};
const pack = createLayeredSpatialControlPack(input);
assert.equal(pack.schemaVersion, 2);
assert.deepEqual(pack.layers.map(({ layerId }) => layerId), ["back", "actor", "front"]);
assert.deepEqual(pack.layers[1].artifacts.map(({ kind }) => kind), ["normal", "mask"]);
assert.equal(pack.layers[1].artifacts[0].layerId, "actor");
assert.equal(validateLayeredSpatialControlPack(pack, current).valid, true);
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: pack.layers.slice(1) }, current).reason, "layered_control_environment_missing");
assert.equal(validateLayeredSpatialControlPack({ ...pack, packDigest: sha }, current).reason, "layered_control_digest_invalid");
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: [...pack.layers, pack.layers[0]] }, current).reason, "layered_control_layer_duplicate:back");
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: pack.layers.map((layer) => layer.layerId === "back" ? { ...layer, artifacts: [{ ...layer.artifacts[0], layerId: "actor" }] } : layer) }, current).reason, "layered_control_artifact_layer_mismatch:back:color");
assert.equal(validateLayeredSpatialControlPack({ ...pack, skeletonArtifacts: [] }, current).reason, "layered_control_subject_skeleton_missing:actor");
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: pack.layers.map((layer) => layer.layerId === "back" ? { ...layer, artifacts: [{ ...layer.artifacts[0], width: 0 }] } : layer) }, current).reason, "layered_control_artifact_invalid:back:color");
assert.equal(validateLayeredSpatialControlPack({ ...pack, skeletonArtifacts: [{ ...pack.skeletonArtifacts[0], sha256: "missing" }] }, current).reason, "layered_control_skeleton_invalid:actor:openpose");
assert.equal(validateLayeredSpatialControlPack(pack, { ...current, cameraId: "other" }).reason, "layered_control_camera_stale");
assert.equal(validateLayeredSpatialControlPack(createLayeredSpatialControlPack({ ...input, stageDigest: "bad" }), { ...current, stageDigest: "bad" }).reason, "layered_control_provenance_invalid:stageDigest");
assert.equal(validateLayeredSpatialControlPack(createLayeredSpatialControlPack({ ...input, cameraDigest: "bad" }), { ...current, cameraDigest: "bad" }).reason, "layered_control_provenance_invalid:cameraDigest");
assert.equal(validateLayeredSpatialControlPack(createLayeredSpatialControlPack({ ...input, contractDigest: "bad" }), current).reason, "layered_control_provenance_invalid:contractDigest");
assert.equal(validateLayeredSpatialControlPack(createLayeredSpatialControlPack({ ...input, preflightDigest: "bad" }), current).reason, "layered_control_provenance_invalid:preflightDigest");
assert.equal(validateLayeredSpatialControlPack({ ...pack, contractDigest: "b".repeat(64) }, current).reason, "layered_control_digest_invalid");
assert.equal(validateLayeredSpatialControlPack({ ...pack, preflightDigest: "b".repeat(64) }, current).reason, "layered_control_digest_invalid");
const normalizedDuplicate = createLayeredSpatialControlPack({ ...input, skeletonArtifacts: [...input.skeletonArtifacts, { ...input.skeletonArtifacts[0], entityId: " actor " }] });
assert.equal(validateLayeredSpatialControlPack(normalizedDuplicate, current).reason, "layered_control_skeleton_duplicate:actor:openpose");
assert.deepEqual(createLayeredSpatialControlPack({ ...input, layers: input.layers.map((layer) => layer.layerId === "actor" ? { ...layer, entityIds: ["actor", " actor "] } : layer) }).layers.find((layer) => layer.layerId === "actor")?.entityIds, ["actor"]);
assert.equal(classifySpatialControlPackVersion(pack), "layered_v2");
assert.equal(classifySpatialControlPackVersion({ schemaVersion: 1 }), "legacy_v1");
assert.equal(classifySpatialControlPackVersion({ schemaVersion: 3 }), "unsupported");

const result = await build({
  stdin: { contents: 'export * from "./src/modules/spatial-stage/layeredStageRenderPasses.ts";', loader: "ts", resolveDir: process.cwd(), sourcefile: "layered-render-check.ts" },
  absWorkingDir: process.cwd(), bundle: true, format: "esm", platform: "node", target: "node20", write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "layered renderer bundle should be available");
const { renderLayeredStagePasses } = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const png = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082", "hex"));
const pngHash = "43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6";
const pngCrc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data = Uint8Array.of()) => {
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set([...type].map((character) => character.charCodeAt(0)), 4);
  chunk.set(data, 8);
  new DataView(chunk.buffer).setUint32(8 + data.length, pngCrc32(chunk.slice(4, 8 + data.length)));
  return chunk;
};
const joinPngChunks = (...chunks) => Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
const pngSignature = png.slice(0, 8);
const pngIhdr = png.slice(8, 33);
const pngIdat = png.slice(33, 56);
const pngIend = png.slice(56);
assert.equal(sha256Bytes(Uint8Array.from([97, 98, 99])), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
assert.equal(sha256Bytes(png), pngHash);
const specs = [{ layerId: "back", kind: "color", entityIds: ["room"] }, { layerId: "actor", kind: "mask", entityIds: ["actor"] }];
const artifacts = await renderLayeredStagePasses({
  stageId: "stage", shotId: "shot", width: 1, height: 1, passes: specs,
  render: async () => png,
  writeArtifact: async ({ layerId, kind, width, height }) => ({ layerId, kind, filePath: `${layerId}-${kind}.png`, sha256: pngHash, width, height })
});
assert.deepEqual(artifacts.map(({ layerId, kind }) => `${layerId}:${kind}`), ["back:color", "actor:mask"]);
const renderRequest = (bytes, receiptHash = pngHash, width = 1, height = 1) => ({ stageId: "stage", shotId: "shot", width, height, render: async () => bytes, writeArtifact: async ({ layerId, kind, width: receiptWidth, height: receiptHeight }) => ({ layerId, kind, filePath: "x.png", sha256: receiptHash, width: receiptWidth, height: receiptHeight }) });
await assert.rejects(() => renderLayeredStagePasses({ ...renderRequest(png), passes: [specs[0], specs[0]] }), /layered_render_pass_duplicate:back:color/);
let malformedWriteAttempts = 0;
const neverWrite = async ({ layerId, kind, width, height }) => {
  malformedWriteAttempts += 1;
  return { layerId, kind, filePath: "unexpected.png", sha256: pngHash, width, height };
};
for (const malformed of [
  png.slice(0, 8), png.slice(0, 20), Uint8Array.from(png, (value, index) => index === 29 ? value ^ 1 : value), png.slice(0, -12), Uint8Array.from([...png, 0]),
  joinPngChunks(pngSignature, pngIhdr, pngIend),
  joinPngChunks(pngSignature, pngIhdr, pngIhdr, pngIdat, pngIend),
  joinPngChunks(pngSignature, pngIhdr, pngIdat, pngChunk("tEXt"), pngIdat, pngIend),
  joinPngChunks(pngSignature, pngIhdr, pngChunk("ABCD"), pngIdat, pngIend)
]) {
  await assert.rejects(() => renderLayeredStagePasses({ ...renderRequest(malformed), writeArtifact: neverWrite, passes: [specs[0]] }), /layered_render_png_invalid/);
}
await assert.rejects(() => renderLayeredStagePasses({ ...renderRequest(png, pngHash, 2, 1), writeArtifact: neverWrite, passes: [specs[0]] }), /layered_render_png_invalid/);
assert.equal(malformedWriteAttempts, 0, "malformed PNG bytes must be rejected before writeArtifact");
await assert.rejects(() => renderLayeredStagePasses({ ...renderRequest(png, sha), passes: [specs[0]] }), /layered_render_receipt_hash_mismatch/);
await assert.rejects(() => renderLayeredStagePasses({ ...renderRequest(png), writeArtifact: async ({ kind, width, height }) => ({ layerId: "wrong", kind, filePath: "x.png", sha256: pngHash, width, height }), passes: [specs[0]] }), /layered_render_receipt_layer_mismatch/);
await assert.rejects(() => renderLayeredStagePasses({ ...renderRequest(png), passes: Array.from({ length: 129 }, (_, index) => ({ layerId: `layer${index}`, kind: "mask", entityIds: ["entity"] })) }), /layered_render_pass_count_invalid/);

console.log("PASS layered spatial control pack v2");
