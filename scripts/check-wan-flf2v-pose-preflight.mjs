import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scriptPath = resolve("scripts/run-wan-flf2v-pose-preflight.mjs");
assert.ok(existsSync(scriptPath), "DWPose-only preflight runner must exist");
const source = readFileSync(scriptPath, "utf8");
for (const forbidden of ["generateRawEdit", "runEndpointCandidate", "runVideoCandidate", "image-qwen", "KSampler", "FLF2V"]) {
  assert.equal(source.includes(forbidden), false, `DWPose-only preflight must not reference ${forbidden}`);
}
const module = await import(`${pathToFileURL(scriptPath).href}?contract=${Date.now()}`);
assert.equal(typeof module.runDWPosePreflight, "function");
console.log("Wan DWPose-only live preflight contract: PASS");
