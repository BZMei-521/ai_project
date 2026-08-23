import assert from "node:assert/strict";
import {
  assertBoundaryHash,
  buildOneTakeConcatFilter,
  buildOneTakeSegments
} from "./lib/wan-one-take-chain.mjs";

const prompts = Array.from({ length: 6 }, (_, index) => `beat-${index + 1}`);
const segments = buildOneTakeSegments({
  initialFramePath: "first.png",
  prompts,
  baseSeed: 26083000
});
assert.equal(segments.length, 6);
assert.equal(segments[0].input.kind, "initial_frame");
assert.equal(segments[0].input.path, "first.png");
assert.equal(segments[1].input.kind, "previous_final_frame");
assert.equal(segments[5].seed, 26083006);
assert.doesNotThrow(() => assertBoundaryHash("abc", "abc", "segment_002"));
assert.throws(() => assertBoundaryHash("abc", "def", "segment_002"), /boundary hash mismatch/);

const assembly = buildOneTakeConcatFilter({
  segmentCount: 6,
  framesPerSegment: 17,
  inputFps: 16,
  outputFps: 24
});
assert.equal(assembly.nativeFrameCount, 97);
assert.match(assembly.filterGraph, /trim=start_frame=1:end_frame=17/);
assert.match(assembly.filterGraph, /concat=n=6:v=1:a=0/);
assert.match(assembly.filterGraph, /minterpolate=fps=24/);
assert.doesNotMatch(assembly.filterGraph, /xfade/);
console.log("Wan chained one-take contract: PASS");
