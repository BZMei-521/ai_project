import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runnerPath = resolve("scripts/run-wan-six-shot-benchmark.mjs");
let source = "";
try {
  source = readFileSync(runnerPath, "utf8");
} catch {
  assert.fail("six-shot benchmark runner is missing");
}

assert.match(source, /river_continuity_001/);
assert.match(source, /river_continuity_006/);
assert.match(source, /Wan2_1-I2V-ATI-14B_fp8_e4m3fn\.safetensors/);
assert.match(source, /const\s+frameCount\s*=\s*17/);
assert.match(source, /for\s*\(const shot of selectedShots\)/, "shots must be queued serially");
assert.match(source, /\/history\/\$\{promptId\}/, "runner must poll Comfy history");
assert.match(source, /wan-six-shot-report\.json/, "runner must persist benchmark evidence");
assert.match(source, /--shot/, "runner must support rerunning one failed or corrected shot");
assert.match(source, /selectedShotId/, "runner must apply the single-shot selector");
assert.match(source, /--seed/, "runner must support deterministic quality retries with a different seed");
assert.match(source, /seedOverride/, "runner must record and apply the requested seed override");

console.log("Wan six-shot benchmark runner contract: PASS");
