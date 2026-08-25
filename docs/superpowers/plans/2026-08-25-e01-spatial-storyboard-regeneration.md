# E01-01 Spatially Constrained Storyboard Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild E01-01 with the latest `novel-storyboard` continuity/action contract, export five camera-bound spatial control packs, generate five locally constrained storyboard frames, quality-gate them, and import only accepted frames into StoryboardPro.

**Architecture:** Treat the restored worktree assets as immutable source material and the desktop `main` project as the delivery workspace. The latest storyboard skill owns beats, boundaries, and prompts; `SceneStage` snapshots own camera/entity state; a new small export coordinator connects the existing WebGL six-pass renderer to the existing safe desktop artifact writer. A fail-closed local Comfy runner consumes references and controls one shot at a time, then writes auditable QC and comparison artifacts.

**Tech Stack:** Node.js 22, TypeScript, React, Zustand, Three.js/WebGL, Tauri/Rust, ComfyUI HTTP API, `novel-storyboard` zero-dependency CLI, existing storyboard-quality evaluators.

## Global Constraints

- Scope is exactly E01-01 C01–C05, five 16:9 still frames; no later segment or video generation.
- Script dialogue, beats, character identity, and story facts are immutable.
- Spatial snapshots `E01-01-C01` through `E01-01-C05` are the authority for camera, transform, visibility, contact, and prop state.
- Every visible hand must have five fingers; shoulder-girdle, clavicle, scapula, upper-arm, wrist, and hand connections must be anatomically credible.
- The coffin shell, lid, continuous white silk, one bronze nail, and Li Baozhu are shared assets across all five shots.
- Generation is sequential, one candidate per call; two controlled repairs maximum per shot.
- Local ComfyUI is mandatory for this trial. Missing models/nodes, an occupied queue, or an unsafe 16 GiB VRAM budget stops before queueing.
- Do not submit RunningHub, do not silently use cloud image generation, and do not fabricate a provider error to avoid billing.
- Existing files with different content are never overwritten during input recovery.

---

## File Responsibility Map

- `scripts/check-e01-spatial-storyboard-trial-inputs.mjs` — validates and, with an explicit flag, copies only missing canonical inputs into desktop `main`.
- `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.json` — latest skill output for the five cuts.
- `src/modules/spatial-stage/spatialControlExport.ts` — pure coordinator that binds snapshot/camera metadata to six rendered PNG receipts and returns a validated pack.
- `src/modules/spatial-stage/SpatialStageWorkbench.tsx` — exposes one explicit “export current shot controls” action and visible result JSON.
- `src/features/spatial-preview/PreviewWorkspaceView.tsx` and `src/app/App.tsx` — pass the trusted project asset directory into the workbench.
- `scripts/check-spatial-control-export.mjs` — tests fail-closed export behavior without WebGL or filesystem mutation.
- `scripts/e01-spatial-storyboard-local.mjs` — CLI entry point for preflight, one-shot generation, repair, resume, and finalization.
- `scripts/lib/e01-spatial-storyboard-local.mjs` — inventory/profile selection, workflow binding, queue/capture journal, and sequential state machine.
- `scripts/check-e01-spatial-storyboard-local.mjs` — offline tests with fake inventory and fake Comfy transport.
- `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/qc.json` — canonical per-shot gate results and evidence hashes.
- `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/comparison/index.html` — old/new/reference/control comparison.

---

### Task 1: Recover and verify canonical trial inputs

**Files:**
- Create: `scripts/check-e01-spatial-storyboard-trial-inputs.mjs`
- Create when missing: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/source.script.json`
- Create when missing: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard-actions.json`
- Create when missing: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json`
- Create when missing: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard.json`
- Create when missing: `影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json`
- Create when missing: `影帝他总想对我图谋不轨_漫剧改编/人物/images/李宝珠-sheet.png`
- Test: `scripts/check-e01-spatial-storyboard-trial-inputs.mjs`

**Interfaces:**
- Consumes: `--source-root`, `--target-root`, optional `--copy-missing`.
- Produces: JSON on stdout with `ok`, `copied`, `verified`, `conflicts`, and SHA-256 for every canonical input.

- [ ] **Step 1: Write the failing input contract check**

Implement exact required relative paths and reject any target whose existing SHA-256 differs from the source:

```js
const required = [
  "分镜/rework-e01-01-new-skills/source.script.json",
  "分镜/rework-e01-01-new-skills/storyboard-actions.json",
  "分镜/rework-e01-01-new-skills/action.json",
  "分镜/rework-e01-01-new-skills/storyboard.json",
  "人物/影帝他总想对我图谋不轨-cast.json",
  "人物/images/李宝珠-sheet.png",
  "分镜/work/E01-01.spatial-stage.seed.json"
];
```

Copy with `COPYFILE_EXCL`, verify source/target hashes after the copy, and exit `2` for missing source or `3` for conflict. Never delete or replace.

- [ ] **Step 2: Run the check without mutation**

Run:

```powershell
node scripts/check-e01-spatial-storyboard-trial-inputs.mjs --source-root C:\Users\Administrator\.codex\worktrees\aebb\ai_project\影帝他总想对我图谋不轨_漫剧改编 --target-root C:\Users\Administrator\Desktop\ai_project\影帝他总想对我图谋不轨_漫剧改编
```

Expected: FAIL with a JSON list of missing target inputs, and no target file created.

- [ ] **Step 3: Copy only missing inputs**

Run the same command with `--copy-missing`. Expected: `ok: true`, `conflicts: []`, and each required path has a 64-character SHA-256.

- [ ] **Step 4: Re-run without mutation**

Expected: PASS with `copied: []`; hashes must equal Step 3.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/check-e01-spatial-storyboard-trial-inputs.mjs 影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills 影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json 影帝他总想对我图谋不轨_漫剧改编/人物/images/李宝珠-sheet.png
git commit -m "chore: recover E01 spatial storyboard inputs"
```

### Task 2: Materialize the latest five-cut storyboard contract

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.seed.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.md`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard-report.html`

**Interfaces:**
- Consumes: latest `novel-storyboard` CLI, source script, action summary, cast, and spatial seed.
- Produces: one episode, one segment `E01-01`, five cuts with action projections and exact continuity boundaries.

- [ ] **Step 1: Seed from the immutable script and actions**

```powershell
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs seed 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\source.script.json --eps 1 --actions 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\storyboard-actions.json > 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.seed.json
```

Expected: seed includes `continuityVersion: 1`, `seedScenes`, and action references on matched beats.

- [ ] **Step 2: Write the five-cut segment from the approved spatial mapping**

Use exactly these cut identities and cameras:

```json
[
  {"shotId":"E01-01-C01","beatId":"C01-Awake","cameraId":"E01-01-C01-camera","size":"close","camera":"Push In"},
  {"shotId":"E01-01-C02","beatId":"C02-Call","cameraId":"E01-01-C02-camera","size":"close","camera":"Static Shot"},
  {"shotId":"E01-01-C03","beatId":"C03-Strike","cameraId":"E01-01-C03-camera","size":"extreme-close","camera":"Shake Slightly"},
  {"shotId":"E01-01-C04","beatId":"C04-Listen","cameraId":"E01-01-C04-camera","size":"close","camera":"Static Shot"},
  {"shotId":"E01-01-C05","beatId":"Nail-Found","cameraId":"E01-01-C05-camera","size":"extreme-close","camera":"Push In"}
]
```

Populate `assetDecisions`, one critical-scene `scenePlan`, `purpose`, complete start/end boundaries, `actionRefs`, `actionStateProjection`, and one English `h3Prompt`. Every boundary must reference stable asset-decision IDs; adjacent end/start boundaries must be byte-equivalent JSON after canonical key ordering.

- [ ] **Step 3: Validate until all gates pass**

```powershell
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs validate 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.json --script 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\source.script.json --cast 影帝他总想对我图谋不轨_漫剧改编\人物\影帝他总想对我图谋不轨-cast.json --actions 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\storyboard-actions.json
node scripts/check-e01-01-spatial-stage.mjs
```

Expected: both commands PASS; there are exactly five cuts and five distinct snapshot camera IDs.

- [ ] **Step 4: Render human-review outputs**

```powershell
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs render 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.json --md --script 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\source.script.json > 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.md
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs render 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.json --html --script 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\source.script.json > 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard-report.html
```

- [ ] **Step 5: Commit**

```powershell
git add -- 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.seed.json 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.json 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard.md 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/storyboard-report.html
git commit -m "feat: rematerialize E01 with directing continuity"
```

### Task 3: Add a fail-closed current-shot control-pack export

**Files:**
- Create: `src/modules/spatial-stage/spatialControlExport.ts`
- Modify: `src/modules/spatial-stage/spatialControlPack.ts`
- Modify: `src/modules/spatial-stage/SpatialStageWorkbench.tsx`
- Modify: `src/features/spatial-preview/PreviewWorkspaceView.tsx`
- Modify: `src/app/App.tsx`
- Test: `scripts/check-spatial-control-export.mjs`

**Interfaces:**
- Consumes: `SceneStage`, `StageStateSnapshot`, `StageCamera`, `projectAssetsDir`, `renderControlArtifacts`, and `writeSpatialControlArtifact`.
- Produces: `computeSpatialCameraDigest(camera): string`, `exportShotControlPack(input): Promise<SpatialControlPack>`, and visible canonical JSON for the exported pack.

- [ ] **Step 1: Write the failing pure coordinator test**

The test must assert six ordered calls, 1280×720, matching shot/snapshot/camera IDs, pack validation, and zero writer calls when snapshot or project directory is missing.

```js
const pack = await exportShotControlPack({
  stage, shotId: "E01-01-C03", snapshot, camera,
  projectAssetsDir: "C:/trial",
  width: 1280, height: 720,
  expectedHands: [{ side: "left", visible: true }, { side: "right", visible: true, contactTargetId: "coffin-lid" }],
  expectedProps: [{ entityId: "bronze-nail", count: 1, state: "fixed until C05 contact" }],
  renderControlArtifacts: fakeRender,
  writeArtifact: fakeWrite
});
assert.deepEqual(pack.artifacts.map(x => x.kind), ["color","depth","normal","character_id","prop_id","pose"]);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node scripts/check-spatial-control-export.mjs`

Expected: FAIL because `spatialControlExport.ts` does not exist.

- [ ] **Step 3: Implement the coordinator**

First export the camera digest helper from `spatialControlPack.ts`, reusing that module's existing canonicalization and SHA-256 implementation so identical camera state always produces an identical digest:

```ts
export function computeSpatialCameraDigest(camera: StageCamera): string {
  return sha256(JSON.stringify(canonicalize(camera)));
}
```

Then implement the fail-closed coordinator:

```ts
export async function exportShotControlPack(input: ExportShotControlPackInput): Promise<SpatialControlPack> {
  if (!input.projectAssetsDir.trim()) throw new Error("spatial_control_project_assets_dir_missing");
  if (input.snapshot.shotId !== input.shotId) throw new Error("spatial_control_snapshot_mismatch");
  if (input.snapshot.cameraId !== input.camera.id) throw new Error("spatial_control_camera_mismatch");
  const artifacts = await input.renderControlArtifacts({
    stageId: input.stage.id,
    shotId: input.shotId,
    width: input.width,
    height: input.height,
    writeArtifact: input.writeArtifact
  });
  const pack = createSpatialControlPack({
    stageId: input.stage.id,
    stageRevision: input.stage.revision,
    stageDigest: input.stage.sourceDigest,
    shotId: input.shotId,
    snapshotId: input.snapshot.id,
    cameraId: input.camera.id,
    cameraDigest: computeSpatialCameraDigest(input.camera),
    artifacts,
    expectedHands: input.expectedHands,
    expectedProps: input.expectedProps
  });
  const validation = validateSpatialControlPack(pack, pack);
  if (!validation.valid) throw new Error(validation.reason);
  return pack;
}
```

The Workbench button must be disabled in plain web mode with an explanatory label; Tauri or trusted Windows Web Bridge is required for safe writes. Adapt the bridge at the UI boundary instead of letting the coordinator know about transport details:

```ts
writeArtifact: (request) => writeSpatialControlArtifact({
  projectAssetsDir,
  ...request
})
```

Display success as `<pre data-spatial-control-pack>{canonical JSON}</pre>` so browser acceptance can verify it without reaching into React state.

- [ ] **Step 4: Run focused and existing regression checks**

```powershell
node scripts/check-spatial-control-export.mjs
node scripts/check-spatial-control-pack.mjs
node scripts/check-spatial-stage-viewport.mjs
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all PASS; only pre-existing dead-code or chunk-size warnings are acceptable.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/check-spatial-control-export.mjs src/modules/spatial-stage/spatialControlExport.ts src/modules/spatial-stage/spatialControlPack.ts src/modules/spatial-stage/SpatialStageWorkbench.tsx src/features/spatial-preview/PreviewWorkspaceView.tsx src/app/App.tsx
git commit -m "feat: export current spatial shot controls"
```

### Task 4: Build the local Comfy profile gate and resumable shot runner

**Files:**
- Create: `scripts/lib/e01-spatial-storyboard-local.mjs`
- Create: `scripts/e01-spatial-storyboard-local.mjs`
- Create: `scripts/check-e01-spatial-storyboard-local.mjs`
- Read: `src/modules/comfy-pipeline/presets/storyboard-image-storyboard-composer-v1.json`
- Read: `src/modules/comfy-pipeline/presets/storyboard-image-flux2-klein-multiref.json`
- Read: `src/modules/comfy-pipeline/presets/storyboard-image-qwen-stageA-v1.json`

**Interfaces:**
- Consumes: Comfy `/system_stats`, `/queue`, `/object_info`, loader model lists, storyboard frame prompt, character sheet, six control artifacts, and a shot ID.
- Produces: `preflightLocalTrial`, `selectConstrainedProfile`, `bindShotWorkflow`, `runShotCandidate`, plus durable `.attempt.json` and `.queued.json` journals.

- [ ] **Step 1: Write offline failing tests**

Cover these exact cases:

```js
assert.throws(() => selectConstrainedProfile(zImageOnlyInventory), /LOCAL_PROFILE_UNAVAILABLE/);
assert.throws(() => preflightLocalTrial({ queueRunning: 1, queuePending: 0, freeVramBytes: 12e9 }), /COMFY_QUEUE_BUSY/);
assert.throws(() => preflightLocalTrial({ queueRunning: 0, queuePending: 0, freeVramBytes: 3e9 }), /LOCAL_VRAM_UNSAFE/);
assert.equal(selectConstrainedProfile(composerInventory).id, "storyboard-composer-v1");
assert.deepEqual(bindings.referenceRoles, ["environment","character","depth","normal","character_id","prop_id","pose"]);
```

The selected graph must consume a character reference and at least depth plus pose. A text-only Z-Image workflow is always rejected for this trial.

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/check-e01-spatial-storyboard-local.mjs`

Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement profile selection and resource policy**

Use ordered candidates `storyboard-composer-v1`, `flux2-klein-multiref`, then `qwen-stageA-v1`. Validate every `class_type` against `/object_info` and every loader filename against its live option list. Require queue counts to be zero and free VRAM to be at least the selected profile's declared load floor plus 2 GiB safety margin.

```js
const PROFILE_FLOORS = {
  "storyboard-composer-v1": 12 * 1024 ** 3,
  "flux2-klein-multiref": 14 * 1024 ** 3,
  "qwen-stageA-v1": 14 * 1024 ** 3
};
```

Run exactly one prompt at a time. Write the queued marker before polling; on restart, recover the existing prompt ID rather than queueing a duplicate. Capture exactly one PNG at 1280×720 and verify its signature, dimensions, SHA-256, output node, and subfolder.

- [ ] **Step 4: Make all offline tests pass**

Run: `node scripts/check-e01-spatial-storyboard-local.mjs`

Expected: PASS, including queue-crash recovery and no-second-queue assertions.

- [ ] **Step 5: Run live read-only preflight**

```powershell
node scripts/e01-spatial-storyboard-local.mjs preflight --base-url http://127.0.0.1:8188 --output 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\preflight.json
```

Expected success: one constrained profile selected, queue idle, VRAM safe, no prompt queued. Expected blocked outcome: exit `4` with `LOCAL_PROFILE_UNAVAILABLE`, `COMFY_QUEUE_BUSY`, or `LOCAL_VRAM_UNSAFE`; stop the plan here and report the exact missing resources.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/lib/e01-spatial-storyboard-local.mjs scripts/e01-spatial-storyboard-local.mjs scripts/check-e01-spatial-storyboard-local.mjs
git commit -m "feat: add fail-closed local spatial storyboard runner"
```

### Task 5: Export controls and generate five candidates sequentially

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/controls/E01-01-C01/control-pack.json` through `E01-01-C05/control-pack.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/images/E01-01-C01.png` through `E01-01-C05.png`
- Create on rejection: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/rejected/<shotId>/`

**Interfaces:**
- Consumes: Task 2 storyboard, Task 3 exporter, Task 4 selected local profile.
- Produces: five immutable accepted candidate PNGs or an explicit blocked/rejected result per shot.

- [ ] **Step 1: Launch the trusted desktop runtime and export C01 controls**

Open E01-01 in the final Preview workspace, select C01, click “导出当前镜头控制包”, and verify visible JSON contains `shotId: E01-01-C01`, `cameraId: E01-01-C01-camera`, six unique artifacts, and one expected bronze nail.

- [ ] **Step 2: Repeat export for C02–C05**

After each shot, run `node scripts/check-spatial-control-pack.mjs` and compare control-pack camera ID against the selected UI camera. Do not continue after a mismatch.

- [ ] **Step 3: Generate C01 and inspect before continuing**

```powershell
node scripts/e01-spatial-storyboard-local.mjs run-shot --base-url http://127.0.0.1:8188 --shot E01-01-C01 --storyboard 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.json --controls 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\controls\E01-01-C01\control-pack.json --character 影帝他总想对我图谋不轨_漫剧改编\人物\images\李宝珠-sheet.png --output 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\images\E01-01-C01.png
```

Expected: one queue entry, one 1280×720 PNG, one completed journal. Visually confirm identity, coffin geometry, and absence of extra limbs before C02.

- [ ] **Step 4: Generate C02–C05 one at a time**

Use the same command with matching shot/control/output paths. Before each command, preflight must recheck queue and free VRAM. C03 must emphasize credible two-arm upward force; C05 must preserve exactly one nail and correct fingertip contact.

- [ ] **Step 5: Apply at most two controlled repairs per failed shot**

```powershell
node scripts/e01-spatial-storyboard-local.mjs repair-shot --shot E01-01-C03 --reason shoulder_girdle --attempt 2 --output-root 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration
```

Allowed reasons are `identity`, `hand_anatomy`, `shoulder_girdle`, `spatial_structure`, `prop_count`, and `shot_semantics`. Repair changes only the matching negative/constraint block or control strength; it never changes camera, beat, boundary, identity reference, or prop count contract.

- [ ] **Step 6: Commit generated evidence only after all five have terminal states**

```powershell
git add -- 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/controls 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/images 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/rejected
git commit -m "feat: generate E01 spatial storyboard trial frames"
```

### Task 6: Quality-gate, compare, and import accepted frames

**Files:**
- Create: `scripts/check-e01-spatial-storyboard-qc.mjs`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/qc.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/comparison/index.html`
- Modify through app state only: StoryboardPro E01-01 C01–C05 image bindings

**Interfaces:**
- Consumes: accepted/rejected images, character sheet, storyboard boundaries, control packs, old E01-01 images.
- Produces: per-shot `accepted | rejected`, dimension/identity/anatomy/spatial/prop/semantic evidence, comparison page, and final UI bindings.

- [ ] **Step 1: Write the failing QC manifest check**

Require exactly these dimensions and gates:

```js
const REQUIRED_GATES = [
  "identity", "five_fingers", "shoulder_girdle", "extra_limbs",
  "coffin_geometry", "single_bronze_nail", "camera_semantics"
];
assert.equal(qc.shots.length, 5);
assert.ok(qc.shots.every(shot => REQUIRED_GATES.every(gate => gate in shot.gates)));
assert.ok(qc.shots.filter(shot => shot.status === "accepted").every(shot => shot.imageSha256.length === 64));
```

- [ ] **Step 2: Run the check and verify failure**

Run: `node scripts/check-e01-spatial-storyboard-qc.mjs`

Expected: FAIL because `qc.json` and comparison report do not exist.

- [ ] **Step 3: Produce QC and comparison output**

Use existing identity and anatomy evaluators where installed, but record human review for fingers, shoulder load path, coffin topology, and nail count. A machine score cannot override a visible anatomical or spatial defect. The comparison page must show character sheet, old frame, new frame, depth, pose, and prop ID side by side for every shot.

- [ ] **Step 4: Import only accepted frames into StoryboardPro**

Open 5174 final UI, bind each accepted PNG to its exact shot ID, then visit Preview and Storyboard stages. Rejected shots remain unbound and display their rejection reason; never substitute an old image silently.

- [ ] **Step 5: Run final verification**

```powershell
node scripts/check-e01-spatial-storyboard-qc.mjs
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs validate 影帝他总想对我图谋不轨_漫剧改编\分镜\e01-01-spatial-regeneration\storyboard.json --script 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\source.script.json --cast 影帝他总想对我图谋不轨_漫剧改编\人物\影帝他总想对我图谋不轨-cast.json --actions 影帝他总想对我图谋不轨_漫剧改编\分镜\rework-e01-01-new-skills\storyboard-actions.json
node scripts/check-e01-01-spatial-stage.mjs
node scripts/check-spatial-control-export.mjs
npm run build
```

Browser acceptance must show five shot nodes, correct C01–C05 camera IDs, and accepted images on their matching nodes.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/check-e01-spatial-storyboard-qc.mjs 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/qc.json 影帝他总想对我图谋不轨_漫剧改编/分镜/e01-01-spatial-regeneration/comparison/index.html
git commit -m "test: verify E01 spatial storyboard trial"
```

---

## Completion Criteria

- Latest storyboard validation passes with action and continuity gates enabled.
- Five control packs each contain six valid, uniquely hashed artifacts bound to the correct snapshot and camera.
- Local preflight proves a reference-and-control-capable profile, idle queue, and safe VRAM before any prompt is queued.
- Five shots have terminal QC records; only accepted images are imported.
- C01–C05 browser switching restores the matching beat, camera, spatial state, and image.
- No RunningHub or other cloud generation task was submitted.
