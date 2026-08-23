import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/windows-web-server.mjs", "utf8");
const start = source.indexOf("async function concatVideoSegments");
const end = source.indexOf("async function muxVideoWithAudioTracks", start);
assert.ok(start >= 0 && end > start, "concatVideoSegments function must exist");
const body = source.slice(start, end);

assert.match(body, /probeVideoDurationSeconds/);
assert.match(body, /xfade=transition=fade/);
assert.match(body, /tpad=stop_mode=clone/);
assert.match(body, /minterpolate=fps=24/);
assert.match(body, /transitionSeconds/);
assert.doesNotMatch(body, /"concat"/);

console.log("Smooth StoryboardPro video concat runtime: PASS");
