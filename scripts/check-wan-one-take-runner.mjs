import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

let source = "";
try {
  source = readFileSync("scripts/run-wan-one-take-chain.mjs", "utf8");
} catch {
  assert.fail("one-take runner is missing");
}

const expectedInitialFramePath = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png";
assert.ok(
  source.includes(`const initialFramePath = "${expectedInitialFramePath}";`),
  "runner must use the exact UTF-8 initial-frame path"
);

assert.match(source, /const generateSegment = Number\(valueAfter\("--generate-segment"\)\);/);
assert.match(source, /if \(!Number\.isInteger\(generateSegment\) \|\| generateSegment < 1 \|\| generateSegment > 6\)/);
assert.match(source, /const allowedSeedOffsets = new Set\(\[0, 1000, 2000\]\);/);
assert.match(source, /if \(!Number\.isInteger\(seedOffset\) \|\| !allowedSeedOffsets\.has\(seedOffset\)\)/);
assert.doesNotMatch(source, /for \(const segment of segments\)/);
assert.match(source, /const segment = segments\[generateSegment - 1\];/);
assert.match(source, /assertAcceptedPrefix\(\{/);
assert.equal(source.match(/existsFile: \(path\) => existsSync\(path\)/g)?.length, 2, "both accepted-prefix gates must verify files exist");
assert.match(source, /markTechnicalAccepted\(segmentReport, item\)/);
assert.match(source, /createSegmentContactSheet\(videoPath, contactSheetPath\)/);
assert.match(source, /report\.overallAccepted = false/);

assert.match(source, /const inputFramePath = segment\.order === 1 \? initialFramePath : preservedSegments\.at\(-1\)\.finalFramePath;/);
assert.match(source, /assertBoundaryHash/);
assert.match(source, /assertAcceptedPrefix/);
assert.match(source, /const initialFrameHash = sha256\(readFileSync\(initialFramePath\)\);/);
assert.match(source, /finalFrameSha256: sha256\(readFileSync\(finalFramePath\)\)/);
assert.match(source, /extractFinalFrame/);
assert.match(source, /const maxAttempts = 3/);
assert.match(source, /const item = \{ attempt, seed: segment\.seed \+ seedOffset, inputFramePath \};/);
assert.doesNotMatch(source, /seed: segment\.seed \+ seedOffset \+ \(attempt - 1\) \* 1000/);
assert.match(source, /wan-one-take-report\.json/);
assert.match(source, /video-wan21-i2v-14b-fp8\.json/);
assert.match(source, /function createRecoverySnapshot\(\)/);
assert.match(source, /if \(existsSync\(reportPath\)\) createRecoverySnapshot\(\);/);
assert.match(source, /createRecoverySnapshot\(\);\s*report = JSON\.parse\(readFileSync\(reportPath, "utf8"\)\);/);

const approvedMotionPrompts = [
  "Continue as one uninterrupted take. Extremely slow continuous forward camera push. Shen Yan makes one clearly visible small half-step forward with grounded foot contact while Jiang Lan performs only a subtle natural weight shift. Exactly two human characters: Shen Yan and Jiang Lan. One primary action once, then settle toward a natural pose. Preserve exact faces, hair, outfits and screen sides.",
  "Continue the exact same take and the same extremely slow forward camera push. Jiang Lan only turns her head toward Shen Yan and makes subtle natural speaking motion; both bodies stay on the same screen sides with grounded feet. Exactly two human characters. One primary action once, then settle naturally.",
  "Continue without a cut with the same extremely slow forward push. Jiang Lan makes one small single-hand explanatory gesture and then lowers that hand toward a relaxed position. Shen Yan only watches. Exactly two human characters; no synchronized gesture.",
  "Continue the same take and camera motion. Only Shen Yan raises his right hand once in a restrained warning gesture and begins lowering it. Jiang Lan keeps both hands relaxed and reacts only with her face and head. Exactly two human characters; no mirrored or synchronized gesture.",
  "Continue the uninterrupted extremely slow forward push. Shen Yan and Jiang Lan each take one clear small grounded step forward, with hands lowered and slight natural arm swing. Preserve exact identities, outfits, screen sides and human anatomy. Exactly two human characters. One walking action once, then settle.",
  "Continue to the end of the same take. Both characters naturally stop and plant their feet. Jiang Lan only looks toward the water while Shen Yan calmly scans the surroundings; both hands remain lowered. The extremely slow forward push eases into a stable final composition. Exactly two human characters."
];
const expectedMotionPromptSource = `const motionPrompts = [\n  ${approvedMotionPrompts.map((prompt) => JSON.stringify(prompt)).join(",\n  ")}\n];`;
assert.ok(source.includes(expectedMotionPromptSource), "runner must use the six approved motion prompts exactly");
assert.equal(approvedMotionPrompts.length, 6);
for (const [index, prompt] of approvedMotionPrompts.entries()) {
  assert.match(prompt, /Exactly two human characters/, `segment ${index + 1} prompt must carry its runtime human-only constraint`);
}
assert.doesNotMatch(source, /Human-only source contract for segments 2-6/);
assert.match(source, /beast traits, animal features, animal ears/);
assert.match(source, /synchronized gestures, both characters raising hands/);

assert.match(source, /const segmentMetadata = probeVideo\(videoPath\);/);
assert.match(source, /stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size/);
for (const field of ["nativeSha256", "deliverySha256", "fullContactSheetSha256", "boundarySheetSha256s"]) {
  assert.ok(source.includes(field), `assembly must record ${field}`);
}
assert.match(source, /codecName: "h264"/);
assert.match(source, /width: 832/);
assert.match(source, /height: 480/);
assert.match(source, /fps: 16/);
assert.match(source, /if \(Number\(segmentMetadata\.nb_frames\) !== 17\)/);
assert.match(source, /select=eq\(n\\\\,0\)\+eq\(n\\\\,8\)\+eq\(n\\\\,16\),scale=416:240,tile=3x1/);
assert.match(source, /const contactSheetPath = resolve\(reportDir, "contact-sheets", `\$\{segment\.id\}\.png`\);/);
assert.match(source, /contactSheetPath,/);
assert.match(source, /videoMetadata: segmentMetadata/);
assert.match(source, /report\.technicalAcceptedSegments = report\.segments\.filter\(\(entry\) => entry\.technicalAccepted\)\.length;/);
assert.match(source, /report\.acceptedSegments = report\.segments\.filter\(\(entry\) => entry\.accepted\)\.length;/);
const prefixTruncationIndex = source.indexOf("report.segments = preservedSegments;");
const prefixTechnicalCountIndex = source.indexOf(
  "report.technicalAcceptedSegments = report.segments.filter((entry) => entry.technicalAccepted).length;",
  prefixTruncationIndex
);
const prefixAcceptedCountIndex = source.indexOf(
  "report.acceptedSegments = report.segments.filter((entry) => entry.accepted).length;",
  prefixTruncationIndex
);
const firstReportWriteAfterTruncationIndex = source.indexOf("writeReport(report);", prefixTruncationIndex);
assert.notEqual(prefixTruncationIndex, -1, "runner must truncate report.segments to the preserved prefix");
assert.ok(prefixTechnicalCountIndex > prefixTruncationIndex, "technical count must be recomputed after prefix truncation");
assert.ok(prefixAcceptedCountIndex > prefixTechnicalCountIndex, "accepted count must be recomputed after technical count");
assert.ok(
  firstReportWriteAfterTruncationIndex > prefixAcceptedCountIndex,
  "both preserved-prefix counts must be recomputed before any report write"
);
assert.doesNotMatch(source, /stopping chain/);
assert.match(source, /failed after \$\{maxAttempts\} attempts; current segment generation stopped/);
assert.match(source, /Segment \$\{generateSegment\} technically accepted; creative review is pending: \$\{contactSheetPath\}/);

const invalidSeed = spawnSync(
  process.execPath,
  ["scripts/run-wan-one-take-chain.mjs", "--generate-segment", "1", "--seed-offset", "7"],
  {
    encoding: "utf8",
    env: { ...process.env, COMFYUI_URL: "http://127.0.0.1:1" },
    windowsHide: true
  }
);
assert.notEqual(invalidSeed.status, 0, "unsupported seed offset must fail");
assert.match(invalidSeed.stderr, /--seed-offset must be one of 0, 1000, or 2000/);
assert.doesNotMatch(invalidSeed.stderr, /ComfyUI unavailable|fetch failed/, "seed validation must run before ComfyUI access");

console.log("Wan chained one-take runner contract: PASS");
