# Wooden Spear 10-Second H3 Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the approved 10-second opening and the existing character report into Storyboard Pro, generate identity-anchored first/last frames, and create one local MiniMax H3 FLF2V sample with no segment splice.

**Architecture:** A small Node import compiler parses the Markdown beat sheet and the `cast-data` JSON embedded in `report.html`, then writes a deterministic Storyboard Pro snapshot and import manifest. Keyframes are generated from the authoritative character sheets, while a separate fail-closed Node runner uploads those frames to ComfyUI, binds the canonical FLF2V preset, queues exactly one prompt, polls it to completion, and records the output. FFmpeg performs delivery normalization and review-frame extraction before the completed path is written back to the imported project.

**Tech Stack:** Node.js ESM, Storyboard Pro Windows Web Bridge, ComfyUI REST API, canonical MiniMax H3 FLF2V JSON, current-session reference-image generation for the two still anchors, FFmpeg/FFprobe, PowerShell verification. Video generation remains local in ComfyUI; no cloud video service is used.

## Global Constraints

- The authoritative beat source is `C:/Users/Administrator/Desktop/ai_project/.worktrees/beastkin-civilization-story/docs/superpowers/specs/2026-08-18-wooden-spear-10s-opening-design.md`.
- The authoritative character source is `C:/Users/Administrator/Desktop/ai_project/短剧示例-从一根木矛开始的文明/角色设定/report.html` and its `cast-data` JSON.
- Character appearance is not redesigned; use `images/岚-sheet.png` and `images/林越-sheet.png` as the identity references.
- The generation is one `minimax_h3_flf2v` request, standard acceleration, 768×432, requested 10 seconds, H3 length 243, normalized to 24fps.
- No dialogue, narration, gore, cloud video generation, TE Speed, or multi-segment fallback.
- Missing assets, unresolved tokens, missing Comfy nodes/models, failed frame validation, or failed queue/history results stop the run before publication.
- Generated binaries live under `C:/Users/Administrator/Desktop/ai_project/短剧示例-从一根木矛开始的文明/10秒开场样片/` and are not committed to source control.

---

## File Structure

- Create `scripts/prepare-wooden-spear-opening.mjs`: parse the design/report, build the import package, and optionally apply/update the Storyboard Pro Web project.
- Create `scripts/check-wooden-spear-opening-package.mjs`: deterministic contract test for parsing, asset binding, shot timing, and snapshot shape.
- Create `scripts/run-wooden-spear-opening-h3.mjs`: preflight, upload, canonical FLF2V token binding, queue, polling, output retrieval, and run receipt.
- Create `scripts/check-wooden-spear-opening-h3.mjs`: pure runner tests with a fake Comfy transport; no GPU request.
- Create `scripts/finalize-wooden-spear-opening.mjs`: FFprobe validation, FFmpeg normalization/review frames, anomaly report, and snapshot update.
- Create `短剧示例-从一根木矛开始的文明/10秒开场样片/import/shot-script.json`: one-shot script import artifact.
- Create `短剧示例-从一根木矛开始的文明/10秒开场样片/import/project-backup.json`: complete project snapshot backup.
- Create `短剧示例-从一根木矛开始的文明/10秒开场样片/import/manifest.json`: source hashes and resolved character assets.
- Create `短剧示例-从一根木矛开始的文明/10秒开场样片/keyframes/first.png` and `last.png`: approved FLF2V anchors.
- Create `短剧示例-从一根木矛开始的文明/10秒开场样片/video/raw.mp4`, `opening-10s.mp4`, and `review/{first,middle,last}.png`.
- Create `短剧示例-从一根木矛开始的文明/10秒开场样片/generation-report.json` and `review-report.md`.

### Task 1: Deterministic report and beat-sheet import compiler

**Files:**
- Create: `scripts/prepare-wooden-spear-opening.mjs`
- Create: `scripts/check-wooden-spear-opening-package.mjs`
- Read: `src/modules/storyboard-core/types.ts`
- Read: `examples/river-dialogue-5s/river_dialogue_5s_project_backup.json`

**Interfaces:**
- Consumes: `compileOpeningPackage({ designMarkdown, reportHtml, reportDir, now })`.
- Produces: `{ shotScript, backup, manifest }`, with `backup.snapshot.project`, one sequence, one shot, two character assets, one scene asset, and complete empty canvas/audio collections.

- [ ] **Step 1: Write the failing contract test**

```js
import assert from "node:assert/strict";
import { compileOpeningPackage } from "./prepare-wooden-spear-opening.mjs";

const result = compileOpeningPackage({ designMarkdown, reportHtml, reportDir, now: "2026-08-19T00:00:00.000Z" });
assert.deepEqual(result.manifest.characters.map(item => item.name), ["林越", "岚"]);
assert.equal(result.backup.snapshot.project.width, 768);
assert.equal(result.backup.snapshot.project.height, 432);
assert.equal(result.backup.snapshot.project.fps, 24);
assert.equal(result.backup.snapshot.shots.length, 1);
const shot = result.backup.snapshot.shots[0];
assert.equal(shot.durationFrames, 243);
assert.equal(shot.videoMode, "first_last_frame");
assert.equal(shot.videoWorkflowProfileId, "minimax_h3_flf2v");
assert.equal(shot.videoAccelerationMode, "standard");
assert.deepEqual(shot.sourceCharacterNames, ["林越", "岚"]);
assert.match(shot.videoPrompt, /\[Shot 1\]/);
assert.match(shot.videoPrompt, /\[Shot 4\]/);
assert.doesNotMatch(shot.videoPrompt, /dialogue|narration|blood splatter/i);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check-wooden-spear-opening-package.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` or `compileOpeningPackage is not exported`.

- [ ] **Step 3: Implement the parser and snapshot builder**

Implement these exact exports:

```js
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const APPROVED_BEATS = [
  "林越仰倒泥地",
  "一根木矛从画外破空而至",
  "岚从草丛冲出",
  "其余灰狼压低身体形成包围"
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function parseCastData(reportHtml, reportDir) {
  const match = reportHtml.match(/<script type="application\/json" id="cast-data">([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("cast_data_missing");
  const cast = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  return cast.characters.map(character => ({
    ...character,
    sheetPath: path.resolve(reportDir, character.sheetImage)
  }));
}

export function compileOpeningPackage({ designMarkdown, reportHtml, reportDir, now }) {
  for (const phrase of APPROVED_BEATS) {
    if (!designMarkdown.includes(phrase)) throw new Error(`approved_beat_missing:${phrase}`);
  }
  const cast = parseCastData(reportHtml, reportDir);
  const characters = ["林越", "岚"].map(name => {
    const character = cast.find(item => item.name === name);
    if (!character) throw new Error(`character_missing:${name}`);
    if (!existsSync(character.sheetPath)) throw new Error(`character_sheet_missing:${name}`);
    return character;
  });
  const videoPrompt = buildApprovedPrompt();
  const snapshot = buildSnapshot({ characters, videoPrompt, now });
  if (snapshot.shots.length !== 1 || snapshot.shots[0].durationFrames !== 243) {
    throw new Error("opening_snapshot_contract_invalid");
  }
  return {
    shotScript: buildShotScript(snapshot),
    backup: { schemaVersion: 1, createdAt: now, snapshot },
    manifest: buildManifest({ designMarkdown, reportHtml, characters, snapshot, now, stableDigest })
  };
}
```

Implement `buildApprovedPrompt`, `buildSnapshot`, `buildShotScript`, and `buildManifest` in the same module. `buildSnapshot` must copy the exact empty collection shapes from `river_dialogue_5s_project_backup.json`; `buildManifest` must hash both source files, both character sheets, and the canonical snapshot with SHA-256. The checker must call the public compiler twice with the same `now` and require byte-identical canonical JSON.

The shot prompt must contain four timestamped blocks at 0.00, 2.00, 4.00, and 7.00 seconds, the approved actions, ambient sound only, and the no-gore constraint.

- [ ] **Step 4: Run package test and schema regression**

Run: `node scripts/check-wooden-spear-opening-package.mjs`

Expected: `PASS wooden spear opening package`.

Run: `npm.cmd run test:video-production-schema`

Expected: `PASS video production schema`.

- [ ] **Step 5: Generate import artifacts**

Run:

```powershell
node scripts/prepare-wooden-spear-opening.mjs `
  --design="C:\Users\Administrator\Desktop\ai_project\.worktrees\beastkin-civilization-story\docs\superpowers\specs\2026-08-18-wooden-spear-10s-opening-design.md" `
  --report="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\角色设定\report.html" `
  --output="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\import"
```

Expected: `PASS opening import package: 1 shot, 2 characters, 243 frames`.

- [ ] **Step 6: Commit only the compiler and checker**

```powershell
git add scripts/prepare-wooden-spear-opening.mjs scripts/check-wooden-spear-opening-package.mjs
git commit -m "feat: compile wooden spear opening package"
```

### Task 2: Apply the project to Storyboard Pro Web Bridge

**Files:**
- Modify: `scripts/prepare-wooden-spear-opening.mjs`
- Test: `scripts/check-wooden-spear-opening-package.mjs`

**Interfaces:**
- Consumes: `applyOpeningProject({ baseUrl, projectName, snapshot })`.
- Produces: `{ projectPath, savedSnapshotDigest }` from `create_workspace_project`, `save_current_project`, and `load_current_project`.

- [ ] **Step 1: Add a fake-bridge failing test**

The fake bridge must record commands and assert this exact order:

```js
assert.deepEqual(commands, [
  "create_workspace_project",
  "save_current_project",
  "load_current_project"
]);
assert.equal(savedSnapshot.shots[0].videoWorkflowProfileId, "minimax_h3_flf2v");
assert.equal(reloadedDigest, savedSnapshotDigest);
```

- [ ] **Step 2: Run test and verify RED**

Run: `node scripts/check-wooden-spear-opening-package.mjs`

Expected: FAIL with `applyOpeningProject is not exported`.

- [ ] **Step 3: Implement fail-closed bridge application**

```js
export async function applyOpeningProject({ baseUrl, projectName, snapshot, fetchImpl = fetch }) {
  const invoke = async (command, args) => {
    const response = await fetchImpl(`${baseUrl}/api/invoke/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args ?? {})
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(`bridge_${command}_failed:${body.error ?? response.status}`);
    return body.result;
  };
  const created = await invoke("create_workspace_project", { name: projectName });
  await invoke("save_current_project", { snapshot });
  const loaded = await invoke("load_current_project", {});
  if (stableDigest(loaded) !== stableDigest(snapshot)) throw new Error("bridge_snapshot_roundtrip_mismatch");
  return { projectPath: created.projectPath, savedSnapshotDigest: stableDigest(loaded) };
}
```

- [ ] **Step 4: Run tests**

Run: `node scripts/check-wooden-spear-opening-package.mjs`

Expected: PASS including `bridge roundtrip`.

- [ ] **Step 5: Start the web bridge and apply the import**

Run `npm.cmd run build`, then start `node scripts/windows-web-server.mjs --port 3210` in a persistent process.

Run the Task 1 command again with `--apply --storyboard-url=http://127.0.0.1:3210`.

Expected: `PASS opening project applied` with a `.sbproj` path and matching snapshot digest.

- [ ] **Step 6: Commit the bridge application support**

```powershell
git add scripts/prepare-wooden-spear-opening.mjs scripts/check-wooden-spear-opening-package.mjs
git commit -m "feat: import wooden spear opening project"
```

### Task 3: Generate and approve the FLF2V keyframes

**Files:**
- Create artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/keyframes/first.png`
- Create artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/keyframes/last.png`
- Modify artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/import/project-backup.json`

**Interfaces:**
- Consumes: authoritative sheet images and the approved first/last frame descriptions.
- Produces: two 16:9 keyframes whose absolute paths populate `videoStartFramePath` and `videoEndFramePath`.

- [ ] **Step 1: Generate the first frame with the 林越 sheet as reference**

Use image generation with `林越-sheet.png` as the reference and this prompt:

```text
16:9 cinematic 3D donghua animation frame, low-angle medium close shot in a cold wet prehistoric forest clearing. Preserve the exact face, short black hair, dark torn modern rescue jacket, rugged trousers and trail boots of the supplied male character sheet. He lies on his back in mud with his injured right ankle twisted away; one lean starving grey wolf pins his chest with its forepaws and lowers its jaws close to his throat. His expression is terrified but alert. Reserve clear negative space from the rear right edge for a spear trajectory. Restrained danger, no blood spray, no open wound, no text, no watermark.
```

- [ ] **Step 2: Generate the last frame with both character sheets as references**

Use `岚-sheet.png` and `林越-sheet.png` and this prompt:

```text
16:9 cinematic 3D donghua animation frame in the identical cold wet prehistoric forest clearing and lighting. Preserve both supplied characters exactly. The grey cat beastkin hunter stands centered in the foreground, body lowered defensively, grey feline ears pinned back, long muscular grey tail tense, holding her obsidian short spear horizontally; her layered grey hide outfit and green malachite pendant remain visible. The injured modern male survivor half-sits behind her. Three or four lean starving grey wolves form a low surrounding arc at the forest edge. Pre-attack standoff, restrained tension, no blood spray, no open wound, no text, no watermark.
```

- [ ] **Step 3: Inspect both images**

Use `view_image` for both files. Reject and regenerate if either character identity, 岚's ears/tail/spear/pendant, 林越's clothing, forest lighting, wolf count, or 16:9 composition is wrong.

- [ ] **Step 4: Bind approved paths into the import package**

Run the prepare script with `--first-frame=<absolute first.png>` and `--last-frame=<absolute last.png>`, then apply the updated snapshot through the bridge.

Expected: loaded shot contains both absolute paths and `videoQualityStatus: "pending"`.

### Task 4: Canonical MiniMax H3 FLF2V runner

**Files:**
- Create: `scripts/run-wooden-spear-opening-h3.mjs`
- Create: `scripts/check-wooden-spear-opening-h3.mjs`
- Read: `src/modules/comfy-pipeline/presets/minimax-h3-flf2v-v1.json`
- Read: `src/modules/video-production/videoGeneration.ts`

**Interfaces:**
- Consumes: `runOpeningH3({ baseUrl, firstFramePath, lastFramePath, prompt, seed, outputDir, fetchImpl })`.
- Produces: `{ promptId, rawVideoPath, workflowDigest, inputDigest, history }` and `generation-report.json`.

- [ ] **Step 1: Write fake-Comfy RED tests**

Assert all of these:

```js
assert.equal(uploadedNames.length, 2);
assert.equal(queuedPrompts.length, 1);
assert.equal(boundTokens.VIDEO_WIDTH, "768");
assert.equal(boundTokens.VIDEO_HEIGHT, "432");
assert.equal(boundTokens.H3_LENGTH, "243");
assert.equal(boundTokens.SEED, "73190819");
assert.equal(unresolvedTokens.length, 0);
assert.equal(result.promptId, "prompt-opening-001");
assert.match(result.rawVideoPath, /raw\.mp4$/);
```

Also assert zero queue calls for a missing node, missing model, failed upload, unresolved token, cancelled prompt, execution error, or history with no video output.

- [ ] **Step 2: Run test and verify RED**

Run: `node scripts/check-wooden-spear-opening-h3.mjs`

Expected: FAIL with missing runner module.

- [ ] **Step 3: Implement runner boundaries**

Export these exact functions and implement the following algorithms without delegating token replacement or output selection to the CLI layer:

```js
export function bindCanonicalWorkflow(template, tokens) {
  const replace = value => {
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [replace(key), replace(child)]));
    }
    if (typeof value !== "string") return value;
    return value.replace(/\{\{([^{}]+)\}\}/g, (whole, token) => {
      if (!Object.hasOwn(tokens, token)) throw new Error(`unresolved_workflow_token:${token}`);
      return String(tokens[token]);
    });
  };
  const built = replace(structuredClone(template));
  const residual = JSON.stringify(built).match(/\{\{[^{}]+\}\}/i);
  if (residual) throw new Error(`unresolved_workflow_token:${residual[0]}`);
  return built;
}

export function extractVideoOutput(history, promptId) {
  const prompt = history?.[promptId];
  if (!prompt || prompt.status?.status_str !== "success") throw new Error("comfy_prompt_not_successful");
  const videos = Object.values(prompt.outputs ?? {}).flatMap(output => output.videos ?? []);
  if (videos.length !== 1) throw new Error(`comfy_video_output_count:${videos.length}`);
  const video = videos[0];
  if (!video.filename || video.type !== "output") throw new Error("comfy_video_output_invalid");
  return video;
}

export async function runOpeningH3(options) {
  const transport = options.transport ?? createComfyTransport(options.baseUrl, options.fetchImpl);
  const inventory = await transport.readInventory();
  assertCanonicalH3Inventory(inventory);
  const [firstUpload, lastUpload] = await Promise.all([
    transport.uploadImage(options.firstFramePath, "first.png"),
    transport.uploadImage(options.lastFramePath, "last.png")
  ]);
  const workflow = bindCanonicalWorkflow(loadCanonicalPreset(), buildOpeningTokens(options, firstUpload, lastUpload));
  const queued = await transport.queuePrompt(workflow);
  const history = await pollPromptToTerminal(transport, queued.prompt_id, options);
  const video = extractVideoOutput(history, queued.prompt_id);
  const rawVideoPath = await transport.downloadOutput(video, options.outputDir, "raw.mp4");
  return buildRunReceipt({ options, workflow, history, promptId: queued.prompt_id, rawVideoPath });
}
```

`createComfyTransport`, `assertCanonicalH3Inventory`, `loadCanonicalPreset`, `buildOpeningTokens`, `pollPromptToTerminal`, and `buildRunReceipt` are private functions in the same module. `pollPromptToTerminal` must only call `/prompt` once, must stop on explicit execution error/cancelled status, and must preserve the prompt ID in a failure report. `buildRunReceipt` hashes canonical queued JSON, effective input tokens, and downloaded bytes.

Preflight must query `/system_stats`, `/object_info`, and the three model inventories. It must require `MiniMaxH3ImageToVideo`, `CreateVideo`, `SaveVideo`, all canonical node types, and the four FLF2V model files before upload/queue.

The CLI must require `--confirm-generate`, reject output overwrite, poll every five seconds, print progress at least once per minute, and stop after 30 minutes with the prompt ID preserved in the report.

- [ ] **Step 4: Run runner tests and H3 regressions**

Run: `node scripts/check-wooden-spear-opening-h3.mjs`

Expected: `PASS wooden spear H3 runner`.

Run: `npm.cmd run test:minimax-h3-binding`

Expected: PASS.

Run: `npm.cmd run test:minimax-h3-presets`

Expected: PASS.

- [ ] **Step 5: Commit runner and checker**

```powershell
git add scripts/run-wooden-spear-opening-h3.mjs scripts/check-wooden-spear-opening-h3.mjs
git commit -m "feat: run wooden spear H3 opening"
```

### Task 5: Execute the local GPU generation

**Files:**
- Create artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/video/raw.mp4`
- Create artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/generation-report.json`

**Interfaces:**
- Consumes: Task 3 keyframes and Task 1 prompt.
- Produces: one downloaded raw MP4 and immutable run metadata.

- [ ] **Step 1: Recheck live ComfyUI immediately before queueing**

Run: `npm.cmd run test:minimax-h3-video-smoke`

Expected: `PASS minimax h3 video smoke (online)` and `missingModels: []`.

- [ ] **Step 2: Queue exactly one FLF2V request**

```powershell
node scripts/run-wooden-spear-opening-h3.mjs `
  --confirm-generate `
  --base-url=http://127.0.0.1:8188 `
  --first-frame="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\keyframes\first.png" `
  --last-frame="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\keyframes\last.png" `
  --package="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\import\project-backup.json" `
  --output-dir="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\video"
```

Expected first terminal state: one returned `prompt_id`; no second request is submitted.

- [ ] **Step 3: Poll to completion**

Continue until `/history/{prompt_id}` reports completed or a terminal error. After ten minutes, report that generation is still running but keep polling; video generation is allowed up to thirty minutes.

Expected success: `raw.mp4` exists, is non-empty, and its SHA-256 is recorded in `generation-report.json`.

### Task 6: Normalize, inspect, and write the result back

**Files:**
- Create: `scripts/finalize-wooden-spear-opening.mjs`
- Create artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/video/opening-10s.mp4`
- Create artifacts: `短剧示例-从一根木矛开始的文明/10秒开场样片/review/first.png`, `middle.png`, `last.png`
- Create artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/review-report.md`
- Modify artifact: `短剧示例-从一根木矛开始的文明/10秒开场样片/import/project-backup.json`

**Interfaces:**
- Consumes: raw MP4, generation report, and Storyboard Web project snapshot.
- Produces: normalized MP4, three review images, anomaly report, and an updated shot with `generatedVideoPath` and `videoQualityStatus: "needs_review"`.

- [ ] **Step 1: Add finalizer self-test**

The self-test uses a generated two-second FFmpeg fixture and asserts the parser accepts only:

```js
{
  width: 768,
  height: 432,
  fpsNum: 24,
  fpsDen: 1,
  videoCodec: "h264",
  pixelFormat: "yuv420p",
  audioSampleRate: 48000,
  audioChannels: 2,
  hasMonotonicTimestamps: true,
  hasConstantFrameTimestamps: true
}
```

It must reject missing video, zero frames, non-monotonic timestamps, black intervals, or freeze intervals longer than 0.5 seconds.

- [ ] **Step 2: Run self-test and verify RED**

Run: `node scripts/finalize-wooden-spear-opening.mjs --self-test`

Expected: FAIL before implementation.

- [ ] **Step 3: Implement finalization**

Normalize with:

```text
ffmpeg -i raw.mp4 -vf fps=24,scale=768:432:flags=lanczos -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 -movflags +faststart opening-10s.mp4
```

Probe with `ffprobe -count_frames`, run `blackdetect` and `freezedetect`, and extract frame indices `0`, `floor(decodedFrames / 2)`, and `decodedFrames - 1`. Do not overwrite an existing final MP4.

- [ ] **Step 4: Run finalizer self-test and focused regressions**

Run: `node scripts/finalize-wooden-spear-opening.mjs --self-test`

Expected: `PASS wooden spear finalizer`.

Run: `npm.cmd run test:video-normalization`

Expected: `PASS video normalization contract`.

- [ ] **Step 5: Finalize the actual sample and update Storyboard Pro**

Run:

```powershell
node scripts/finalize-wooden-spear-opening.mjs `
  --input="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\video\raw.mp4" `
  --output="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\video\opening-10s.mp4" `
  --review-dir="C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\10秒开场样片\review" `
  --storyboard-url=http://127.0.0.1:3210 `
  --apply
```

Expected: the current shot keeps its two reference paths, gains `generatedVideoPath` pointing to `opening-10s.mp4`, and enters `videoQualityStatus: "needs_review"`.

- [ ] **Step 6: Inspect the review media**

Use `view_image` on all three PNGs and render the final MP4 for the user. Check identity, action order, spear contact readability, no long freeze/black frames, consistent forest, and the unresolved wolf-pack standoff ending.

- [ ] **Step 7: Commit only reusable finalizer code**

```powershell
git add scripts/finalize-wooden-spear-opening.mjs
git commit -m "feat: finalize wooden spear opening sample"
```

## Final Verification

Run all of the following freshly:

```powershell
node scripts/check-wooden-spear-opening-package.mjs
node scripts/check-wooden-spear-opening-h3.mjs
node scripts/finalize-wooden-spear-opening.mjs --self-test
npm.cmd run test:minimax-h3-presets
npm.cmd run test:minimax-h3-profile-registry
npm.cmd run test:video-workflow-router
npm.cmd run test:minimax-h3-binding
npm.cmd run test:video-production-schema
npm.cmd run test:video-normalization
npm.cmd run test:video-quality-gate
npm.cmd run build
```

Expected: every command exits zero. The delivery report must state the imported project path, Comfy prompt ID, raw/final SHA-256 values, actual duration/frame count, review image paths, and any visual issue that still requires regeneration.
