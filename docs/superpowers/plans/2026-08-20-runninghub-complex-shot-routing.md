# RunningHub Complex Shot Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add approval-gated handoff of complex shots to the exact RunningHub MiniMaxH3 reference workflow, verified cloud-result import, and temporally stable removal of the burned-in RunningHub preview mark before the existing video quality gate.

**Architecture:** Keep local H3 routing as the default. Add small pure-runtime modules for complexity scoring, approval snapshots, and cloud state transitions; integrate them through the existing `VideoProductionPanel` rather than the legacy `ComfyPipelinePanel`. The first production transport opens the pinned custom-workflow page and exports a handoff packet because the installed RH OpenAPI plugin exposes standard-model APIs, not an authenticated contract for invoking this custom workflow. Cloud MP4 import and watermark repair run through project-scoped desktop commands and then rejoin the current normalization and quality pipeline.

**Tech Stack:** TypeScript 5.6, React 18, Zustand, Node ESM contract tests, Tauri 2/Rust, FFmpeg/FFprobe, ComfyUI `.venv` Python 3.13, OpenCV 5.

## Global Constraints

- Local MiniMax H3 R2V remains the default provider; cloud routing is advisory only.
- No RunningHub task or charge may be created by complexity detection or page rendering.
- The exact pinned workflow is `https://www.runninghub.cn/workflow/2090035427871903746?source=workspace` and uses exactly two active character references.
- The installed RH OpenAPI plugin is not treated as proof that the custom workflow can be submitted by API.
- The final RunningHub `运行` action remains inside RunningHub until a documented custom-workflow API contract is available and separately approved.
- Any shot-input change invalidates prior cloud approval.
- A downstream RIFE failure may be recovered only when an imported MP4 exists, decodes, and matches the shot contract.
- Watermark repair must preserve resolution, frame rate, duration, and audio; failed repair is `watermark_review_required`, never silent acceptance.
- API keys, cookies, request headers, and browser tokens must not enter project files, logs, receipts, or tests.
- Derived files are written only below a new task/shot-scoped directory under the project asset root.
- Preserve all existing dirty and untracked files; never use `reset`, `checkout`, `clean`, or `git add -A`.

## File Map

- Create `src/modules/video-production/cloudShotRoutingRuntime.mjs`: pure complexity classifier.
- Create `src/modules/video-production/cloudShotRouting.ts`: typed classifier facade and contracts.
- Create `src/modules/video-production/runningHubApprovalRuntime.mjs`: canonical approval snapshots, one-use capability validation, and state transitions.
- Create `src/modules/video-production/runningHubApproval.ts`: typed approval and handoff contracts.
- Create `src/modules/video-production/RunningHubApprovalPanel.tsx`: focused approval UI; no network calls during render.
- Create `src/modules/video-production/runningHubHandoff.ts`: build task-scoped handoff packet and open the pinned workflow page.
- Create `src/modules/video-production/runningHubResult.ts`: imported MP4/task receipt validation and recovery classification.
- Create `src/modules/video-production/watermarkRepair.ts`: typed desktop bridge orchestration and quality result mapping.
- Create `scripts/video-watermark-repair.py`: OpenCV temporal/spatial repair worker.
- Create `scripts/check-runninghub-cloud-routing.mjs`: classifier and approval contract tests.
- Create `scripts/check-runninghub-result.mjs`: result selection/recovery tests.
- Create `scripts/check-video-watermark-repair.py`: synthetic repair and metadata tests.
- Modify `src/modules/video-production/VideoProductionPanel.tsx`: display recommendation, launch approval, import result, and show repair status.
- Modify `src/modules/video-production/videoProductionEntry.ts`: expose cloud handoff/import actions through the existing gateway.
- Modify `src/modules/video-production/videoQuality.ts` and `videoQualityRuntime.mjs`: require successful watermark disposition for RunningHub artifacts.
- Modify `src/modules/storyboard-core/types.ts` and `store.ts`: persist cloud state and invalidate stale approval/result evidence.
- Modify `src/modules/platform/desktopBridge.ts`: validate and invoke task-scoped handoff/import/repair commands.
- Modify `src-tauri/src/video_continuity.rs` and `src-tauri/src/main.rs`: project-root confinement, probing, Python worker execution, and receipts.
- Modify `src/styles/global.css`: compact approval/status layout consistent with the existing workbench.
- Modify `package.json`: add focused test entries.

---

### Task 1: Pure Complex-Shot Recommendation

**Files:**
- Create: `src/modules/video-production/cloudShotRoutingRuntime.mjs`
- Create: `src/modules/video-production/cloudShotRouting.ts`
- Create: `scripts/check-runninghub-cloud-routing.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `CloudShotSignals` with character count, contact/occlusion/prop-transfer flags, ordered action beats, character/camera motion flags, crowd-action flag, and local quality failures.
- Produces: `recommendRunningHub(input): { status: "local_default" | "cloud_recommended"; reasons: CloudRecommendationReason[] }`.

- [ ] **Step 1: Write failing classifier tests**

```js
assert.deepEqual(recommendRunningHub({ namedCharacterCount: 1 }), {
  status: "local_default", reasons: []
});
assert.deepEqual(recommendRunningHub({
  namedCharacterCount: 2, hasCharacterContact: true
}), { status: "cloud_recommended", reasons: ["character_contact"] });
assert.equal(recommendRunningHub({ orderedActionBeatCount: 2 }).status, "cloud_recommended");
assert.equal(recommendRunningHub({ hasCharacterMotion: true, hasCameraMotion: true }).status, "cloud_recommended");
assert.equal(recommendRunningHub({ localQualityFailureCount: 2, localRetryLimit: 2 }).status, "cloud_recommended");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/check-runninghub-cloud-routing.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `cloudShotRoutingRuntime.mjs`.

- [ ] **Step 3: Implement deterministic recommendation**

```js
export function recommendRunningHub(input = {}) {
  const reasons = [];
  if (Number(input.namedCharacterCount) >= 2 && (input.hasCharacterContact || input.hasOcclusionExchange || input.hasPropTransfer)) reasons.push("character_contact");
  if (Number(input.orderedActionBeatCount) >= 2) reasons.push("ordered_fast_actions");
  if (input.hasCharacterMotion && input.hasCameraMotion) reasons.push("combined_subject_camera_motion");
  if (input.hasCrowdAction) reasons.push("crowd_spatial_action");
  if (Number(input.localRetryLimit) > 0 && Number(input.localQualityFailureCount) >= Number(input.localRetryLimit)) reasons.push("local_quality_exhausted");
  return { status: reasons.length ? "cloud_recommended" : "local_default", reasons: [...new Set(reasons)] };
}
```

- [ ] **Step 4: Add TypeScript contracts and package test entry**

Add `test:runninghub-cloud-routing` as `node scripts/check-runninghub-cloud-routing.mjs`. The TS facade casts the runtime function to `(input: Partial<CloudShotSignals>) => CloudShotRecommendation`.

- [ ] **Step 5: Run focused and existing router tests**

Run: `npm run test:runninghub-cloud-routing`

Expected: `PASS RunningHub cloud recommendation and approval contracts`.

Run: `npm run test:video-workflow-router`

Expected: existing local H3 routing PASS with unchanged decisions.

- [ ] **Step 6: Commit exact files**

```powershell
git add -- package.json scripts/check-runninghub-cloud-routing.mjs src/modules/video-production/cloudShotRoutingRuntime.mjs src/modules/video-production/cloudShotRouting.ts
git commit -m "feat: recommend RunningHub for complex shots"
```

### Task 2: Approval Snapshot and Persisted Cloud State

**Files:**
- Create: `src/modules/video-production/runningHubApprovalRuntime.mjs`
- Create: `src/modules/video-production/runningHubApproval.ts`
- Modify: `scripts/check-runninghub-cloud-routing.mjs`
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/storyboard-core/store.ts`
- Modify: `scripts/check-video-production-schema.mjs`

**Interfaces:**
- Consumes: `createRunningHubApprovalSnapshot({ shotId, workflowId, workflowUrl, references, prompt, width, height, durationSeconds, createdAt })`.
- Produces: canonical `RunningHubApprovalSnapshot`, SHA-256 `inputDigest`, and `RunningHubCloudState`.
- Produces: `validateRunningHubApproval(snapshot, currentInput, consumedDigests)` and `transitionRunningHubState(state, event)`.

- [ ] **Step 1: Add failing digest, one-use, and state tests**

```js
const approval = await createRunningHubApprovalSnapshot(validInput);
assert.equal(approval.workflowId, "2090035427871903746");
assert.equal(approval.references.length, 2);
assert.match(approval.inputDigest, /^[a-f0-9]{64}$/);
assert.equal(validateRunningHubApproval(approval, validInput, new Set()).ok, true);
assert.equal(validateRunningHubApproval(approval, { ...validInput, prompt: "changed" }, new Set()).reason, "approval_input_changed");
assert.equal(validateRunningHubApproval(approval, validInput, new Set([approval.inputDigest])).reason, "approval_already_consumed");
assert.throws(() => transitionRunningHubState({ status: "accepted" }, { type: "POLL_RUNNING" }), /cloud_state_terminal/);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node scripts/check-runninghub-cloud-routing.mjs`

Expected: FAIL because approval exports do not exist.

- [ ] **Step 3: Implement canonical snapshot and strict state machine**

Use stable key ordering before hashing. Require exactly two distinct absolute reference paths, positive even dimensions, duration `1..15`, the pinned workflow ID/URL, a non-empty prompt, and an ISO timestamp. Allow only the design transitions:

```js
const ALLOWED = {
  local_default: ["cloud_recommended"],
  cloud_recommended: ["awaiting_approval", "declined"],
  awaiting_approval: ["approved", "declined", "cancelled"],
  approved: ["submitted", "cancelled"],
  submitted: ["running", "output_collected", "failed", "timed_out", "cancelled"],
  running: ["output_collected", "recovered_primary_output", "failed", "timed_out", "cancelled"],
  recovered_primary_output: ["watermark_checked"],
  output_collected: ["watermark_checked"],
  watermark_checked: ["quality_review", "watermark_review_required"],
  quality_review: ["accepted", "failed"]
};
```

- [ ] **Step 4: Persist and invalidate cloud state**

Add `runningHubCloud?: RunningHubCloudRecord` to `Shot`. `updateShotFields` clears `approval`, imported output, watermark receipt, and acceptance when prompt, reference identity, dimensions, duration, workflow version, or generated media changes. Import/hydration deep-clones the record and defaults missing legacy records to `undefined`.

- [ ] **Step 5: Run schema and approval tests**

Run: `npm run test:runninghub-cloud-routing`

Expected: PASS.

Run: `npm run test:video-production-schema`

Expected: PASS and assertions prove stale approval/result evidence is removed without mutating imported snapshots.

- [ ] **Step 6: Commit exact files**

```powershell
git add -- scripts/check-runninghub-cloud-routing.mjs scripts/check-video-production-schema.mjs src/modules/storyboard-core/store.ts src/modules/storyboard-core/types.ts src/modules/video-production/runningHubApprovalRuntime.mjs src/modules/video-production/runningHubApproval.ts
git commit -m "feat: persist one-use RunningHub approvals"
```

### Task 3: Approval UI and Exact-Workflow Handoff

**Files:**
- Create: `src/modules/video-production/RunningHubApprovalPanel.tsx`
- Create: `src/modules/video-production/runningHubHandoff.ts`
- Modify: `src/modules/video-production/VideoProductionPanel.tsx`
- Modify: `src/modules/video-production/videoProductionEntry.ts`
- Modify: `src/modules/platform/desktopBridge.ts`
- Modify: `src/styles/global.css`
- Create: `scripts/check-runninghub-approval-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RunningHubApprovalSnapshot` and recommendation reasons.
- Produces: `prepareRunningHubHandoff({ projectAssetsDir, approval }): Promise<RunningHubHandoffReceipt>`.
- Produces: gateway actions `recommendCloud(shotId)`, `prepareCloudHandoff(shotId)`, and `declineCloud(shotId)`.

- [ ] **Step 1: Write failing UI/side-effect boundary test**

Render `RunningHubApprovalPanel` with two references and assert the workflow name, dimensions, duration, prompt, charge warning, watermark warning, and three commands are visible. Assert render and recommendation invoke neither `openExternal` nor a submit transport. Invoke confirmation once and assert one `prepareHandoff` call; a second invocation with the same approval is rejected.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-runninghub-approval-ui.mjs`

Expected: FAIL with missing component/module.

- [ ] **Step 3: Implement task-scoped handoff packet**

`prepareRunningHubHandoff` calls a desktop command that creates:

```json
{
  "schemaVersion": 1,
  "provider": "runninghub_manual_custom_workflow",
  "workflowId": "2090035427871903746",
  "workflowUrl": "https://www.runninghub.cn/workflow/2090035427871903746?source=workspace",
  "inputDigest": "<sha256>",
  "references": ["<absolute Lin Yue sheet>", "<absolute Lan sheet>"],
  "prompt": "<full prompt>",
  "width": 1344,
  "height": 768,
  "durationSeconds": 8
}
```

The desktop boundary writes below `projectAssetsDir/runninghub-handoffs/<shotId>/<inputDigest>/`, rejects existing non-matching content, and opens only the pinned HTTPS URL after the packet is durably written. It never reads browser storage or API credentials.

Successful handoff creation leaves the cloud lifecycle at `approved`; opening a page is not evidence that a paid task was submitted.

- [ ] **Step 4: Implement compact approval panel**

Show recommendation reasons, exactly two image previews, prompt, 16:9/0.9MP/8-second settings, and explicit buttons: `确认并打开 RunningHub`, `继续本地`, `取消`. The confirm button is disabled after successful handoff creation and re-enabled only after inputs change and a new approval snapshot is created.

- [ ] **Step 5: Integrate through `VideoProductionPanel`**

Build recommendation signals from shot metadata/tags and local quality history. Keep current local generation button behavior unchanged. Mount the focused approval panel only for `cloud_recommended` or later cloud states.

- [ ] **Step 6: Run UI, schema, and local routing tests**

Run: `npm run test:runninghub-approval-ui`

Expected: PASS with zero submission side effects before confirmation.

Run: `npm run test:video-production-schema`

Expected: PASS.

Run: `npm run test:minimax-h3-binding`

Expected: PASS; local H3 remains strict and unchanged.

- [ ] **Step 7: Commit exact files**

```powershell
git add -- package.json scripts/check-runninghub-approval-ui.mjs src/modules/platform/desktopBridge.ts src/modules/video-production/RunningHubApprovalPanel.tsx src/modules/video-production/VideoProductionPanel.tsx src/modules/video-production/runningHubHandoff.ts src/modules/video-production/videoProductionEntry.ts src/styles/global.css
git commit -m "feat: add approval-gated RunningHub handoff"
```

### Task 4: Cloud MP4 Import, Task Receipt, and RIFE Recovery

**Files:**
- Create: `src/modules/video-production/runningHubResult.ts`
- Create: `scripts/check-runninghub-result.mjs`
- Modify: `src/modules/platform/desktopBridge.ts`
- Modify: `src-tauri/src/video_continuity.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/modules/video-production/VideoProductionPanel.tsx`
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `recordRunningHubSubmission({ approval, taskId })` followed by `importRunningHubResult({ projectAssetsDir, shotId, approval, taskId, sourcePath, reportedTaskStatus, downstreamError })`.
- Produces: `RunningHubResultReceipt` containing source SHA-256, task ID, probe, isolated path, `output_collected | recovered_primary_output`, and optional RIFE warning.

- [ ] **Step 1: Write failing import/recovery tests**

```js
assert.equal(classifyRunningHubResult({ taskStatus: "SUCCESS", validMp4: true }).status, "output_collected");
assert.deepEqual(classifyRunningHubResult({
  taskStatus: "FAILED", validMp4: true, downstreamError: "RIFE VFI: Tensor type unknown to einops <class 'tuple'>"
}), { status: "recovered_primary_output", warning: "runninghub_downstream_rife_failed" });
assert.throws(() => classifyRunningHubResult({ taskStatus: "FAILED", validMp4: false }), /runninghub_primary_output_missing/);
```

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-runninghub-result.mjs`

Expected: FAIL with missing result module.

- [ ] **Step 3: Implement pure result classifier**

Only recognize the specific downstream RIFE signature as recoverable. Any other failed task needs an explicitly valid, decodable MP4 plus manual recovery selection; missing/zero-byte/non-video files fail.

- [ ] **Step 4: Implement project-confined desktop import**

Canonicalize the selected source, copy it to a new directory `runninghub-results/<taskId>/<sha256>/source.mp4`, probe using the existing FFprobe contract, and require even non-zero dimensions, finite FPS, monotonic timestamps, decoded frames, and duration within one second of the approved contract. Never delete or overwrite the selected source.

- [ ] **Step 5: Add result import UI**

Require a non-empty numeric RunningHub task ID. `recordRunningHubSubmission` validates it against the active approval and moves `approved -> submitted`; it never calls RunningHub. Import requires the same task ID and a selected MP4, then moves `submitted -> output_collected | recovered_primary_output`. Display recovered RIFE warning separately from video validity. Persist the receipt; do not write `generatedVideoPath` until watermark disposition is clean.

- [ ] **Step 6: Run focused and Rust tests**

Run: `npm run test:runninghub-result`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml runninghub_result`

Expected: tests prove project confinement, no overwrite, valid probe, duration rejection, and RIFE recovery.

- [ ] **Step 7: Commit exact files**

```powershell
git add -- package.json scripts/check-runninghub-result.mjs src-tauri/src/main.rs src-tauri/src/video_continuity.rs src/modules/platform/desktopBridge.ts src/modules/storyboard-core/types.ts src/modules/video-production/VideoProductionPanel.tsx src/modules/video-production/runningHubResult.ts
git commit -m "feat: verify and recover RunningHub video results"
```

### Task 5: Commercial-Safe Temporal Watermark Repair Worker

**Files:**
- Create: `scripts/video-watermark-repair.py`
- Create: `scripts/check-video-watermark-repair.py`
- Modify: `src-tauri/src/video_continuity.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/modules/platform/desktopBridge.ts`
- Create: `src/modules/video-production/watermarkRepair.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `repairRunningHubWatermark({ comfyRootDir, projectAssetsDir, sourceReceipt, runCapability })`.
- Produces: `WatermarkRepairReceipt` with source/output hashes, normalized ROI, sampled residual scores, temporal error scores, preserved media metadata, and `clean | watermark_review_required`.

- [ ] **Step 1: Write synthetic failing tests**

Create three 3-second 24fps fixtures with a fixed translucent `RunningHub AI生成` overlay over: moving sky gradient, translating tree texture, and a foreground rectangle crossing the ROI. Include a sine-wave audio track. Assert the worker does not exist before implementation.

- [ ] **Step 2: Implement normalized fixed-overlay mask and confidence checks**

Use the RunningHub ROI scaled from the verified 1280x736 sample, approximately `x=0..245`, `y=0..45`, with bounded dilation. Confirm a stable overlay by comparing edge structure across first/middle/last sampled frames. If stability is below threshold, return `watermark_detection_uncertain` without modifying video.

- [ ] **Step 3: Implement temporal/spatial reconstruction**

For each frame, compute Farneback optical flow from available neighboring frames into the current frame, warp unmasked neighbor pixels, take a confidence-weighted temporal median inside the mask, and fill remaining holes with OpenCV Telea inpainting. Blend only across a feathered mask edge. Run in a streaming window of at most 9 decoded frames so memory does not scale with video length.

Core worker signature:

```python
def repair_video(source: Path, output: Path, report: Path, roi: tuple[float, float, float, float], max_window: int = 9) -> dict:
    """Return hashes, metadata, residual score, temporal error, and disposition."""
```

- [ ] **Step 4: Preserve audio and metadata**

Write repaired silent frames to an isolated temporary MP4, then use FFmpeg to map repaired video plus optional original audio with `-map 0:v:0 -map 1:a? -c:v libx264 -pix_fmt yuv420p -c:a copy`. Probe before and after; reject any resolution/FPS/duration/audio-layout drift.

- [ ] **Step 5: Add Tauri worker boundary and preflight**

Resolve Python only from `<comfyRoot>/.venv/Scripts/python.exe`, `<comfyRoot>/.venv/bin/python`, or the already supported Comfy standalone environment. Preflight `import cv2`; never run a PATH-selected arbitrary Python. Pass arguments as separate `Command` arguments, set a bounded timeout, and write only under `runninghub-watermark/<taskId>/<sourceSha256>/`.

- [ ] **Step 6: Run synthetic repair tests**

Run: `& '<configured Comfy .venv python>' scripts/check-video-watermark-repair.py`

Expected: sky and trees report `clean`; foreground occlusion either reports `clean` within thresholds or deterministically reports `watermark_review_required`; all outputs preserve 24fps, dimensions, duration tolerance, and audio.

Run: `cargo test --manifest-path src-tauri/Cargo.toml runninghub_watermark`

Expected: PASS for Python resolution, argument safety, task directory confinement, timeout, and receipt validation.

- [ ] **Step 7: Commit exact files**

```powershell
git add -- package.json scripts/check-video-watermark-repair.py scripts/video-watermark-repair.py src-tauri/src/main.rs src-tauri/src/video_continuity.rs src/modules/platform/desktopBridge.ts src/modules/video-production/watermarkRepair.ts
git commit -m "feat: repair RunningHub watermark across video frames"
```

### Task 6: Watermark Disposition in the Existing Quality Gate

**Files:**
- Modify: `src/modules/video-production/videoQuality.ts`
- Modify: `src/modules/video-production/videoQualityRuntime.mjs`
- Modify: `src/modules/video-production/videoProductionController.ts`
- Modify: `src/modules/video-production/VideoProductionPanel.tsx`
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/storyboard-core/store.ts`
- Modify: `scripts/check-video-quality-gate.mjs`
- Modify: `scripts/check-video-production-schema.mjs`

**Interfaces:**
- Consumes: `providerArtifact?: { provider: "local_comfy" | "runninghub"; watermarkDisposition?: "not_applicable" | "clean" | "watermark_review_required"; receiptDigest?: string }`.
- Produces: structural issue `runninghub_watermark_not_clean` and blocks normalization/approval when disposition is not `clean`.

- [ ] **Step 1: Add failing quality-gate tests**

```js
assert.deepEqual(evaluateVideoQuality({
  normalized: true,
  providerArtifact: { provider: "runninghub", watermarkDisposition: "watermark_review_required" }
}).structuralIssues, ["runninghub_watermark_not_clean"]);
assert.equal(evaluateVideoQuality({
  normalized: true,
  providerArtifact: { provider: "runninghub", watermarkDisposition: "clean", receiptDigest: "a".repeat(64) }
}).structuralIssues.includes("runninghub_watermark_not_clean"), false);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:video-quality-gate`

Expected: new assertion FAIL.

- [ ] **Step 3: Implement fail-closed watermark evidence**

RunningHub evidence requires a verified repair/source-clean receipt digest. Local Comfy evidence uses `not_applicable` and preserves current behavior. Replacing cloud source, task ID, approval digest, or repair output invalidates the quality decision and generated media.

- [ ] **Step 4: Rejoin current processing pipeline**

Only after `clean` set the shot's `generatedVideoPath` to the verified clean/repaired path and invoke the existing controller normalization, review-frame extraction, semantic review, and manual approval. Show source and repaired previews separately; never overwrite the local approved version automatically.

- [ ] **Step 5: Run quality, schema, normalization, and continuity tests**

Run: `npm run test:video-quality-gate`

Run: `npm run test:video-production-schema`

Run: `npm run test:video-normalization`

Run: `npm run test:video-continuity-planner`

Expected: all PASS; cloud watermark evidence is fail-closed and local behavior is unchanged.

- [ ] **Step 6: Commit exact files**

```powershell
git add -- scripts/check-video-production-schema.mjs scripts/check-video-quality-gate.mjs src/modules/storyboard-core/store.ts src/modules/storyboard-core/types.ts src/modules/video-production/VideoProductionPanel.tsx src/modules/video-production/videoProductionController.ts src/modules/video-production/videoQuality.ts src/modules/video-production/videoQualityRuntime.mjs
git commit -m "feat: gate RunningHub videos on watermark evidence"
```

### Task 7: End-to-End Acceptance and Documentation

**Files:**
- Create: `docs/superpowers/verification/2026-08-20-runninghub-complex-shot-routing.md`
- Modify: `docs/superpowers/verification/minimax-h3-video-routing-checklist.md`
- Modify: `scripts/check-runninghub-approval-ui.mjs`

**Interfaces:**
- Consumes all contracts from Tasks 1-6.
- Produces an auditable verification report with commands, outputs, sample task ID/path, and explicit manual-review results.

- [ ] **Step 1: Add an end-to-end mocked lifecycle test**

Exercise `local_default -> cloud_recommended -> awaiting_approval -> approved -> submitted -> recovered_primary_output -> watermark_checked -> quality_review -> accepted`. Assert no submit side effect before approval, approval digest invalidation after prompt change, and terminal-state rollback rejection.

- [ ] **Step 2: Run the focused suite**

Run:

```powershell
npm run test:runninghub-cloud-routing
npm run test:runninghub-approval-ui
npm run test:runninghub-result
npm run test:video-quality-gate
npm run test:video-production-schema
npm run test:minimax-h3-binding
npm run test:video-normalization
npm run test:video-continuity-planner
```

Expected: every focused command PASS. Record any pre-existing Windows line-ending-only baseline failure separately; do not edit unrelated fixtures.

- [ ] **Step 3: Run the real watermark sample check**

Use `短剧示例-从一根木矛开始的文明/视频/MiniMaxH3高动态加速版-preview-20260819.mp4`. Write the repaired candidate only into a new task-scoped derived directory. Extract first/middle/last frames and inspect the former top-left watermark area for residual text, shimmer, and background damage.

- [ ] **Step 4: Run one manual cloud handoff without automatic charging**

Choose a complex wolf interaction shot. Confirm the panel shows the correct Lin Yue and Lan sheets, prompt, 1344x768, and 8 seconds. Click `确认并打开 RunningHub`; verify the pinned workflow opens and the app has not clicked `运行`. Stop before cloud submission unless the user separately confirms that paid run.

- [ ] **Step 5: Document evidence and limitations**

Record exact test commands, current branch/HEAD, generated receipt paths, and manual results. State that arbitrary custom-workflow API submission remains intentionally disabled until RunningHub exposes a documented contract; this is the approved manual fallback, not a hidden failure.

- [ ] **Step 6: Final build and diff check**

Run: `npm run build`

Expected: PASS, or only the already documented baseline failure unrelated to these files.

Run: `git diff --check`

Expected: no whitespace errors in changed feature files.

- [ ] **Step 7: Commit verification files only**

```powershell
git add -- docs/superpowers/verification/2026-08-20-runninghub-complex-shot-routing.md docs/superpowers/verification/minimax-h3-video-routing-checklist.md scripts/check-runninghub-approval-ui.mjs
git commit -m "test: verify RunningHub complex shot routing"
```

## Execution Order and Stop Conditions

Execute Tasks 1-4 before installing or invoking any repair dependency. Task 5 may use the already configured Comfy Python only after `cv2` preflight succeeds. Do not run a paid RunningHub task during automated tests. Stop and request user confirmation immediately before the first real cloud `运行` click. If the imported file is already watermark-free, record `source_clean` and skip repair. If watermark repair is uncertain or damages the subject, retain both files and stop at `watermark_review_required`.
