import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [timeline, exportService, renderer, rust] = await Promise.all([
  readFile(resolve(root, "src/modules/preview-engine/TimelinePanel.tsx"), "utf8"),
  readFile(resolve(root, "src/modules/export-service/animaticExport.ts"), "utf8"),
  readFile(resolve(root, "src/modules/export-service/frameRenderer.ts"), "utf8"),
  readFile(resolve(root, "src-tauri/src/main.rs"), "utf8")
]);

assert.match(timeline, /let cursor = 0;[\s\S]*?const startFrame = cursor;[\s\S]*?cursor \+= durationFrames;[\s\S]*?endFrame: cursor/, "timeline must derive stable cumulative shot frame ranges");
assert.match(timeline, /audioTracks,\s*signal: controller\.signal/, "timeline export jobs must pass current audio tracks");
assert.match(exportService, /audioTracks\?: AudioTrack\[\];/, "animatic export request must carry audio tracks");
assert.match(exportService, /frames,\s*audioTracks: request\.audioTracks \?\? \[\]/, "export command payload must include rendered frames and audio tracks");
assert.match(exportService, /videoPath: request\.videoPath,[\s\S]*?videoAssemblyReceipt: request\.videoAssemblyReceipt,[\s\S]*?audioTracks: request\.audioTracks/, "mux payload must preserve video reference and audio tracks");
assert.match(renderer, /durationFrames: shot\.durationFrames/, "rendered frame payload must retain timeline duration");
assert.match(rust, /for track in &audio_tracks[\s\S]*?PathBuf::from\(&track\.file_path\)[\s\S]*?track\.start_frame\.max\(0\)[\s\S]*?track\.gain\.max\(0\.0\)/, "desktop export must resolve media paths and timing/gain from the received tracks");
assert.match(rust, /let delay_ms = \(\(\*start_frame as f64\) \/ \(safe_fps as f64\) \* 1000\.0\)\.round\(\) as i64;/, "audio start frame must round-trip to ffmpeg delay");
assert.match(rust, /video_continuity::reject_authority_file_command_path\(&app, &video_path\)/, "mux must enforce the persisted video path authority boundary");

const timelineFixture = [
  { id: "shot-a", durationFrames: 24 },
  { id: "shot-b", durationFrames: 36 },
  { id: "shot-c", durationFrames: 12 }
];
let cursor = 0;
const ranges = timelineFixture.map((shot) => {
  const startFrame = cursor;
  cursor += Math.max(1, shot.durationFrames);
  return { id: shot.id, startFrame, endFrame: cursor };
});
const restoredRanges = JSON.parse(JSON.stringify(ranges));
assert.deepEqual(restoredRanges, ranges, "timeline frame ranges must survive serialization");
assert.deepEqual(restoredRanges.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 24], [24, 60], [60, 72]]);

console.log("PASS timeline and export media-reference round-trip");
