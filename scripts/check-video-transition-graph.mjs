import assert from "node:assert/strict";
import { buildXfadeGraph } from "./lib/video-transition-graph.mjs";

const result = buildXfadeGraph({
  clipCount: 6,
  clipDuration: 17 / 16,
  transitionDuration: 3 / 16,
  inputFps: 16,
  outputFps: 24
});

assert.deepEqual(result.offsets, [0.875, 1.75, 2.625, 3.5, 4.375]);
assert.match(result.filterGraph, /xfade=transition=fade:duration=0\.1875:offset=0\.875/);
assert.match(result.filterGraph, /xfade=transition=fade:duration=0\.1875:offset=4\.375/);
assert.match(result.filterGraph, /minterpolate=fps=24/);
assert.equal(result.expectedDuration, 5.4375);

console.log("Smooth six-shot transition graph: PASS");
