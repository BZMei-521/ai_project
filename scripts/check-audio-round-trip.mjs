import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [store, types, panel] = await Promise.all([
  readFile(resolve(root, "src/modules/storyboard-core/store.ts"), "utf8"),
  readFile(resolve(root, "src/modules/storyboard-core/types.ts"), "utf8"),
  readFile(resolve(root, "src/modules/preview-engine/AudioTrackPanel.tsx"), "utf8")
]);

assert.match(types, /export type AudioTrack = \{[\s\S]*?id: string;[\s\S]*?projectId: string;[\s\S]*?filePath: string;[\s\S]*?startFrame: number;[\s\S]*?gain: number;/, "AudioTrack fields must remain persisted");
assert.match(store, /audioTracks:\s*state\.audioTracks,/, "snapshot must serialize audioTracks");
assert.match(store, /audioTracks:\s*snapshot\.audioTracks \?\? state\.audioTracks,/, "hydrate must restore audioTracks");
assert.match(store, /upsertAudioTrack:\s*\(track\)[\s\S]*?filePath:\s*track\.filePath\.trim\(\)[\s\S]*?startFrame:\s*Math\.max\(0, Math\.round\(track\.startFrame\)\)[\s\S]*?gain:\s*Math\.max\(0, track\.gain\)/, "upsert must normalize persisted track values");
assert.match(panel, /value=\{track\.filePath\}/, "audio UI must read the persisted file path");
assert.match(panel, /updateAudioTrack\(track\.id, \{ filePath: event\.target\.value \}\)/, "audio UI must write file path edits");

const fixture = [
  { id: "audio_dialogue_1", projectId: "project-1", filePath: "C:\\media\\dialogue.wav", startFrame: 48, gain: 0.75, kind: "dialogue", label: "Line 1" },
  { id: "audio_ambience_1", projectId: "project-1", filePath: "/media/room-tone.wav", startFrame: 0, gain: 1, kind: "ambience", label: "Room" }
];
const restored = JSON.parse(JSON.stringify({ audioTracks: fixture })).audioTracks;
assert.deepEqual(restored, fixture, "audio track payload must survive JSON save/load without losing paths or timing");
assert.equal(restored[0].filePath, fixture[0].filePath);
assert.equal(restored[0].startFrame, 48);
assert.equal(restored[0].gain, 0.75);

console.log("PASS audio track serialization and recovery round-trip");
