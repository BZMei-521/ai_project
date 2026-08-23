import assert from "node:assert/strict";
import {
  createSurfaceEvictedCaptureAttestation,
  validateSurfaceEvictedCaptureAttestation,
} from "./lib/surface-empty-plate-v2-comfy.mjs";
import { parseArguments } from "./run-surface-empty-plate-v2.mjs";
import path from "node:path";

assert.equal(typeof createSurfaceEvictedCaptureAttestation, "function");
assert.equal(typeof validateSurfaceEvictedCaptureAttestation, "function");
assert.deepEqual(parseArguments(["--report", "run.json", "--stage", "upper_background", "--candidate", "1", "--evicted-attestation", path.resolve("attempt", "evicted-capture-attestation.json")]), { reportPath: path.resolve("run.json"), stage: "upper_background", candidate: "1", evictedAttestationPath: path.resolve("attempt", "evicted-capture-attestation.json") });
console.log("surface evicted capture attestation checker passed");
