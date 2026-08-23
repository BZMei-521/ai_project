import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "novel-shot-import-"));
const projectRoot = resolve(temporaryDirectory, "fixture-project");
const storyboardPath = resolve(projectRoot, "分镜", "影帝他总想对我图谋不轨-storyboard.json");
const scriptPath = resolve(projectRoot, "剧本", "影帝他总想对我图谋不轨-script.json");
const outlinePath = resolve(projectRoot, "大纲", "影帝他总想对我图谋不轨-outline.json");
const frameDirectory = resolve(projectRoot, "分镜", "E01-01");
const runtimePath = resolve(repositoryRoot, "scripts", "novel-storyboard-shot-import-runtime.mjs");
const cliPath = resolve(repositoryRoot, "scripts", "convert-novel-storyboard-shot-import.mjs");

const fixtureBoard = {
  source: "影帝他总想对我图谋不轨",
  episodes: [{
    ep: 1,
    segments: [{
      id: "E01-01",
      sceneIndex: 1,
      h3Prompt: "A continuous five-cut cinematic sequence inside an ancient tomb.",
      cuts: [
        { seconds: 2.8, size: "wide", camera: "push", beats: [1, 1], frame: "cold tomb opening", characters: ["libaozhu"] },
        { seconds: 2.8, size: "medium", camera: "track", beats: [2, 2], frame: "heroine wakes", characters: ["libaozhu"] },
        { seconds: 2.8, size: "close", camera: "hold", beats: [3, 3], frame: "dust in torchlight", characters: ["libaozhu"] },
        { seconds: 2.8, size: "medium", camera: "orbit", beats: [4, 4], frame: "searching the cave", characters: ["libaozhu"] },
        { seconds: 3, size: "wide", camera: "pull", beats: [5, 5], frame: "sealed stone door", characters: ["libaozhu"] }
      ]
    }]
  }]
};
const fixtureScript = {
  episodes: [{ ep: 1, scenes: [{ sceneId: "tomb", flow: [
    { speaker: "libaozhu", line: "放我出去！有人吗！" },
    { speaker: "VO", line: "冷。这里不是寝殿。" },
    {}, {}, {}
  ] }] }]
};
const fixtureOutline = {
  characters: [{ id: "libaozhu", name: "李宝珠" }],
  scenes: [{ id: "tomb", name: "皇陵墓室与山洞" }]
};
mkdirSync(dirname(storyboardPath), { recursive: true });
mkdirSync(dirname(scriptPath), { recursive: true });
mkdirSync(dirname(outlinePath), { recursive: true });
mkdirSync(frameDirectory, { recursive: true });
writeFileSync(storyboardPath, JSON.stringify(fixtureBoard), "utf8");
writeFileSync(scriptPath, JSON.stringify(fixtureScript), "utf8");
writeFileSync(outlinePath, JSON.stringify(fixtureOutline), "utf8");
for (let index = 1; index <= 5; index += 1) writeFileSync(resolve(frameDirectory, `f${index}.png`), "fixture", "utf8");

assert.equal(existsSync(runtimePath), true, "converter runtime must exist");

const { buildSegmentShotScript } = await import(pathToFileURL(runtimePath));
const board = JSON.parse(readFileSync(storyboardPath, "utf8"));
const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const outline = JSON.parse(readFileSync(outlinePath, "utf8"));
const sourceSegment = board.episodes[0].segments.find((item) => item.id === "E01-01");
const result = buildSegmentShotScript({
  board,
  script,
  outline,
  segmentId: "E01-01",
  frameDirectory,
  frameExists: existsSync
});

assert.equal(result.project.title, "影帝他总想对我图谋不轨 · E01-01 导入试验");
assert.equal(result.shots.length, 1);
assert.equal(result.transitions.length, 0);
assert.equal(result.shots[0].id, "E01-01");
assert.equal(result.shots[0].duration, 14.2);
assert.equal(result.shots[0].video_prompt, sourceSegment.h3Prompt);
assert.deepEqual(result.shots[0].character_names, ["李宝珠"]);
assert.equal(result.shots[0].scene_name, "皇陵墓室与山洞");
assert.match(result.shots[0].dialogue, /李宝珠：放我出去！有人吗！/);
assert.match(result.shots[0].dialogue, /旁白：冷。这里不是寝殿。/);
assert.match(result.shots[0].notes, /5 cuts; 14\.2s/);
assert.match(result.shots[0].notes, /f5\.png/);
assert.equal(result.shots[0].thumbnail, resolve(frameDirectory, "f1.png"));
assert.equal(existsSync(result.shots[0].thumbnail), true);
assert.throws(
  () => buildSegmentShotScript({ board, script, outline, segmentId: "missing", frameDirectory, frameExists: existsSync }),
  /segment not found: missing/
);

assert.equal(existsSync(cliPath), true, "converter CLI must exist");
const outputPath = resolve(temporaryDirectory, "E01-01.shot-script.json");
try {
  const run = spawnSync(
    process.execPath,
    [
      cliPath,
      "--storyboard", storyboardPath,
      "--script", scriptPath,
      "--outline", outlinePath,
      "--segment", "E01-01",
      "--frames", frameDirectory,
      "--out", outputPath
    ],
    { encoding: "utf8" }
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /PASS E01-01: 1 shot \/ 341 frames \/ 0 transitions/);
  assert.equal(existsSync(outputPath), true);
  const generated = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(generated.shots[0].id, "E01-01");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("PASS novel storyboard segment import: E01-01 -> 1 shot / 14.2s / 5 cuts");
