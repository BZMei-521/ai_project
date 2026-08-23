# Universal Spatial Stage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, capability-aware spatial-stage foundation with a full-size Three.js panorama/manual-proxy viewport, without changing the existing storyboard generation path.

**Architecture:** A new `spatial-stage` module owns versioned domain types, normalization, source digests, capability decisions, and the WebGL viewport. The existing Zustand snapshot persists stages as an additive field, while the app shell switches its central work surface between the existing storyboard preview and the new spatial stage. ComfyUI probing remains behind the existing service boundary and reports deterministic manual fallback when MoGe is unavailable.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, Three.js, Vite 5, Node.js executable contract tests, existing ComfyUI HTTP service.

## Global Constraints

- Use a right-handed coordinate system, Y-up, and metres as the world unit.
- Keep the panorama as the authoritative visual source; proxy geometry is structural guidance only.
- Old projects must open without creating or mutating a stage until the user explicitly creates one.
- Missing MoGe must produce `manual_fallback`; it must not queue a failing workflow.
- Editor panorama textures are capped at 4096x2048 and visible proxy geometry at 250,000 triangles.
- MoGe initialization and MiniMax H3 video generation must never run concurrently.
- Preserve all unrelated dirty and untracked files; stage only exact files belonging to the current task.
- Do not use `git reset`, `git checkout`, `git clean`, or `git add -A`.

---

## File Structure

- `src/modules/spatial-stage/types.ts`: versioned spatial-stage schema and public domain types.
- `src/modules/spatial-stage/normalizeStage.ts`: runtime normalization, legacy tolerance, defaults, and invariants.
- `src/modules/spatial-stage/stageDigest.ts`: stable source digest and stale detection.
- `src/modules/spatial-stage/capabilities.ts`: WebGL/ComfyUI/MoGe capability report and degradation decision.
- `src/modules/spatial-stage/stageStoreActions.ts`: pure create/update/remove helpers used by Zustand.
- `src/modules/spatial-stage/SpatialStageViewport.tsx`: Three.js lifecycle and panorama/manual-proxy rendering.
- `src/modules/spatial-stage/SpatialStageWorkbench.tsx`: stage creation, source selection, status, and viewport shell.
- `src/modules/spatial-stage/threeResourceTracker.ts`: deterministic disposal of Three.js resources.
- `scripts/check-spatial-stage-schema.mjs`: executable schema, migration, and store contract.
- `scripts/check-spatial-stage-capabilities.mjs`: mocked capability/degradation contract.
- `scripts/check-spatial-stage-viewport.mjs`: bundled React/Three lifecycle contract.
- `src/modules/storyboard-core/store.ts`: additive `spatialStages` state, actions, hydration, and reset behavior.
- `src/app/App.tsx`: central work-surface mode and snapshot persistence.
- `src/styles/global.css`: unframed stage viewport and compact toolbar layout.
- `package.json` and lockfile: Three.js dependency and focused test scripts.

## Task 1: Versioned Spatial-Stage Schema

**Files:**
- Create: `src/modules/spatial-stage/types.ts`
- Create: `src/modules/spatial-stage/normalizeStage.ts`
- Create: `scripts/check-spatial-stage-schema.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: no new project interface.
- Produces: `SceneStage`, `StageEntity`, `StageEnvironment`, `StageCapabilityReport`, `createEmptySceneStage(sceneId, now)`, and `normalizeSceneStage(value)`.

- [ ] **Step 1: Write the failing schema contract**

Create `scripts/check-spatial-stage-schema.mjs` with an esbuild bundle of `normalizeStage.ts`, then assert these cases:

```js
const empty = createEmptySceneStage("scene_01", "2026-08-19T00:00:00.000Z");
assert.equal(empty.schemaVersion, 1);
assert.equal(empty.coordinateFrame.handedness, "right");
assert.equal(empty.coordinateFrame.upAxis, "y");
assert.equal(empty.coordinateFrame.unit, "metre");
assert.equal(empty.environment.sources[0].kind, "empty_stage");
assert.equal(empty.capabilities.overall, "manual_fallback");

const normalized = normalizeSceneStage({
  ...empty,
  revision: -8,
  environment: { sources: [{ kind: "panorama", assetId: "sky_1", maxTextureWidth: 9000 }] }
});
assert.equal(normalized.revision, 1);
assert.equal(normalized.environment.sources[0].maxTextureWidth, 4096);
assert.equal(normalized.entities.length, 0);
assert.equal(normalizeSceneStage(null), null);
```

Add `"test:spatial-stage-schema": "node scripts/check-spatial-stage-schema.mjs"` to `scripts`.

- [ ] **Step 2: Run the contract and verify it fails**

Run: `npm run test:spatial-stage-schema`  
Expected: FAIL because `src/modules/spatial-stage/normalizeStage.ts` does not exist.

- [ ] **Step 3: Define the exact v1 schema**

Create `types.ts` with these discriminated unions and fields:

```ts
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type Transform3D = { position: Vec3; rotation: Quat; scale: Vec3 };
export type StageCapabilityStatus =
  | "available"
  | "missing_dependency"
  | "temporarily_unavailable"
  | "failed"
  | "manual_fallback";

export type StageEnvironmentSource =
  | { kind: "empty_stage" }
  | { kind: "panorama"; assetId: string; filePath?: string; maxTextureWidth: number }
  | { kind: "depth_mesh"; filePath: string; triangleCount: number }
  | { kind: "imported_mesh"; filePath: string; triangleCount?: number }
  | { kind: "procedural"; primitive: "ground" | "room" | "wall" | "stairs" }
  | { kind: "cards"; assetIds: string[] };

export type StageCapability = {
  status: StageCapabilityStatus;
  message: string;
  checkedAt: string;
};

export type StageCapabilityReport = {
  overall: StageCapabilityStatus;
  webgl2: StageCapability;
  comfyui: StageCapability;
  mogeNode: StageCapability;
  mogeModel: StageCapability;
  panoramaConversion: StageCapability;
  pose: StageCapability;
  systemMemory: StageCapability;
  gpuMemory: StageCapability;
};

export type StageEnvironment = { sources: StageEnvironmentSource[] };
export type AttachmentPoint = { id: string; label: string; localTransform: Transform3D };
export type RigBinding = {
  kind: "humanoid" | "quadruped" | "rigid_chain" | "custom";
  joints: Record<string, string>;
};
export type PoseSnapshot = {
  rootTransform: Transform3D;
  jointRotations: Record<string, Quat>;
  contacts: Array<{ attachmentId: string; targetEntityId?: string; targetAttachmentId?: string }>;
  source: "auto_pose" | "previous_snapshot" | "manual" | "imported";
  confidence: number;
};

export type StageEntity = {
  id: string;
  assetId?: string;
  label: string;
  tags: string[];
  transform: Transform3D;
  geometry: { kind: "box" | "capsule" | "sphere" | "plane"; size: Vec3 };
  rig?: RigBinding;
  attachments?: AttachmentPoint[];
  visibility: "visible" | "hidden";
  metadata: Record<string, unknown>;
};

export type StageConstraint = {
  id: string;
  kind: "attachment" | "contact" | "look_at" | "distance" | "orientation" | "path" | "visibility" | "occlusion" | "count" | "axis_limit";
  subjectEntityId: string;
  targetEntityId?: string;
  subjectAttachmentId?: string;
  targetAttachmentId?: string;
  parameters: Record<string, number | string | boolean | Vec3>;
  enabled: boolean;
};

export type StageCamera = {
  id: string;
  label: string;
  position: Vec3;
  rotation: Quat;
  target: Vec3;
  panoramaYaw: number;
  panoramaPitch: number;
  fov: number;
  near: number;
  far: number;
  continuityGroup?: string;
};

export type StageStateSnapshot = {
  id: string;
  beatId: string;
  previousSnapshotId?: string;
  cameraId?: string;
  entityStates: Array<{
    entityId: string;
    transform: Transform3D;
    pose?: PoseSnapshot;
    visibility: "visible" | "hidden";
  }>;
  constraintIds: string[];
  createdAt: string;
};

export type SceneStage = {
  schemaVersion: 1;
  id: string;
  sceneId: string;
  revision: number;
  coordinateFrame: {
    handedness: "right";
    upAxis: "y";
    unit: "metre";
    origin: Vec3;
    forward: Vec3;
    groundY: number;
    scaleMode: "metric" | "relative";
  };
  environment: StageEnvironment;
  entities: StageEntity[];
  constraints: StageConstraint[];
  cameras: StageCamera[];
  snapshots: StageStateSnapshot[];
  capabilities: StageCapabilityReport;
  sourceDigest: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Implement strict normalization and defaults**

Create `normalizeStage.ts` so invalid top-level values return `null`, numeric values are finite, quaternion defaults to `[0, 0, 0, 1]`, scale defaults to `[1, 1, 1]`, panorama width clamps to 4096, and mesh triangle counts clamp to 250000. Export:

```ts
export function createEmptySceneStage(sceneId: string, now = new Date().toISOString()): SceneStage;
export function normalizeSceneStage(value: unknown): SceneStage | null;
export function normalizeSceneStages(value: unknown): SceneStage[];
```

Use `manual_fallback` with message `"Automatic geometry is not configured; manual proxy stage is available."` for every automatic capability in a new empty stage.

- [ ] **Step 5: Run focused verification**

Run: `npm run test:spatial-stage-schema`  
Expected: PASS with `spatial stage schema checks passed`.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add -- package.json package-lock.json scripts/check-spatial-stage-schema.mjs src/modules/spatial-stage/types.ts src/modules/spatial-stage/normalizeStage.ts
git commit -m "feat: add spatial stage schema"
```

## Task 2: Stable Digest and Store Persistence

**Files:**
- Create: `src/modules/spatial-stage/stageDigest.ts`
- Create: `src/modules/spatial-stage/stageStoreActions.ts`
- Modify: `scripts/check-spatial-stage-schema.mjs`
- Modify: `src/modules/storyboard-core/store.ts`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `SceneStage`, `normalizeSceneStages` from Task 1.
- Produces: `computeStageSourceDigest(stage)`, `isStageSourceStale(stage)`, Zustand `spatialStages`, `createSpatialStage`, `updateSpatialStage`, and `removeSpatialStage`.

- [ ] **Step 1: Extend the failing contract**

Add assertions that equal semantic inputs produce equal digests regardless of object key order, changed environment paths produce different digests, hydrate normalizes malformed stages, and new-project reset clears stages:

```js
const a = createEmptySceneStage("scene_01", now);
const b = { ...a, updatedAt: "later" };
assert.equal(computeStageSourceDigest(a), computeStageSourceDigest(b));
assert.notEqual(
  computeStageSourceDigest(a),
  computeStageSourceDigest({ ...a, environment: { sources: [{ kind: "panorama", assetId: "other", maxTextureWidth: 4096 }] } })
);

useStoryboardStore.getState().hydrateFromSnapshot({ spatialStages: [a] });
assert.equal(useStoryboardStore.getState().spatialStages.length, 1);
useStoryboardStore.getState().resetForNewProject("Fresh");
assert.deepEqual(useStoryboardStore.getState().spatialStages, []);
```

- [ ] **Step 2: Run and verify the new assertions fail**

Run: `npm run test:spatial-stage-schema`  
Expected: FAIL because digest and store APIs are missing.

- [ ] **Step 3: Implement digest and pure updates**

`stageDigest.ts` must canonicalize only coordinate frame, environment sources, entity asset IDs, transforms, geometry, and visibility. It must exclude `updatedAt`, capabilities, revision, and `sourceDigest`. Use Web Crypto SHA-256 asynchronously where a receipt needs cryptographic identity, but expose a synchronous canonical FNV-1a digest for immediate stale UI:

```ts
export function canonicalStageSource(stage: SceneStage): string;
export function computeStageSourceDigest(stage: SceneStage): string;
export function isStageSourceStale(stage: SceneStage): boolean {
  return stage.sourceDigest !== computeStageSourceDigest(stage);
}
```

`stageStoreActions.ts` must export immutable helpers:

```ts
export function addStage(stages: SceneStage[], stage: SceneStage): SceneStage[];
export function patchStage(stages: SceneStage[], id: string, patch: Partial<SceneStage>, now: string): SceneStage[];
export function deleteStage(stages: SceneStage[], id: string): SceneStage[];
```

`patchStage` increments revision exactly once and recomputes `sourceDigest` after the patch.

- [ ] **Step 4: Persist stages in the existing snapshot**

Add `spatialStages: SceneStage[]` to `StoryboardState` and `StoryboardSnapshot`, initialize it to `[]`, normalize it in `hydrateFromSnapshot`, and reset it to `[]` in `resetForNewProject`. Add store actions with these exact signatures:

```ts
createSpatialStage: (sceneId: string) => string;
updateSpatialStage: (id: string, patch: Partial<SceneStage>) => void;
removeSpatialStage: (id: string) => void;
```

In `App.tsx`, include `spatialStages` in `readCurrentStoryboardSnapshot`, autosave dependencies, manual save, backup export, and every snapshot construction site found by `rg "generationTasks" src/app/App.tsx`.

- [ ] **Step 5: Run focused and existing persistence checks**

Run: `npm run test:spatial-stage-schema`  
Expected: PASS.

Run: `npm run test:video-production-schema`  
Expected: PASS; if the known Windows newline baseline fails, record the exact mismatch without changing unrelated fixtures.

Run: `npm run build`  
Expected: PASS, except for already documented shared-worktree baseline failures unrelated to these exact files.

- [ ] **Step 6: Commit only Task 2 files**

```powershell
git add -- scripts/check-spatial-stage-schema.mjs src/modules/spatial-stage/stageDigest.ts src/modules/spatial-stage/stageStoreActions.ts src/modules/storyboard-core/store.ts src/app/App.tsx
git commit -m "feat: persist spatial stages"
```

## Task 3: Deterministic Capability Preflight

**Files:**
- Create: `src/modules/spatial-stage/capabilities.ts`
- Create: `scripts/check-spatial-stage-capabilities.mjs`
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing ComfyUI base URL and `StageCapabilityReport`.
- Produces: `probeSpatialStageCapabilities(options): Promise<StageCapabilityReport>` and `getComfySystemStats(baseUrl, signal)`.

- [ ] **Step 1: Write mocked transport cases**

Create a transport-injected test with these cases:

```js
const offline = await probeSpatialStageCapabilities({
  baseUrl: "http://127.0.0.1:8188",
  webgl2: true,
  fetchJson: async () => { throw new TypeError("offline"); },
  now: () => now
});
assert.equal(offline.comfyui.status, "temporarily_unavailable");
assert.equal(offline.overall, "manual_fallback");

const missingModel = await probeSpatialStageCapabilities({
  baseUrl,
  webgl2: true,
  fetchJson: async (path) => path.includes("LoadMoGeModel")
    ? { LoadMoGeModel: { input: { required: { model_name: ["COMBO", { options: [] }] } } } }
    : healthySystemStats,
  now: () => now
});
assert.equal(missingModel.mogeNode.status, "available");
assert.equal(missingModel.mogeModel.status, "missing_dependency");
assert.equal(missingModel.overall, "manual_fallback");
```

Also assert a model option named `moge_2_vitl_normal_fp16.safetensors` produces `available`, and a never-resolving fetch is aborted within the injected 250ms timeout.

- [ ] **Step 2: Verify the test fails**

Run: `npm run test:spatial-stage-capabilities`  
Expected: FAIL because `capabilities.ts` is missing.

- [ ] **Step 3: Add bounded ComfyUI probes**

Implement:

```ts
export type ComfySystemStats = {
  system?: { ram_total?: number; ram_free?: number };
  devices?: Array<{ type?: string; vram_total?: number; vram_free?: number }>;
};

export async function getComfySystemStats(
  baseUrl: string,
  signal?: AbortSignal
): Promise<ComfySystemStats>;
```

Use `/system_stats` and `/object_info/{encoded node name}` with `AbortController`. Clamp the configurable timeout to 250..30000ms. Do not reuse Comfy settings UI state inside this module.

- [ ] **Step 4: Implement capability aggregation**

Check `LoadMoGeModel`, `MoGePanoramaInference`, `MoGePointMapToMesh`, `MoGeRender`, `Equirectangular to Perspective`, and `OpenposePreprocessor`. Parse model options structurally; do not search raw JSON strings. Mark GPU memory `temporarily_unavailable` below 6 GiB free, system memory `temporarily_unavailable` below 4 GiB free, and set overall to:

```ts
const overall = !webglAvailable
  ? "failed"
  : mogeNodeAvailable && mogeModelAvailable
    ? "available"
    : "manual_fallback";
```

- [ ] **Step 5: Run capability and workflow checks**

Run: `npm run test:spatial-stage-capabilities`  
Expected: PASS with offline, missing-model, online, and timeout cases.

Run: `npm run test:workflow-presets -- --offline`  
Expected: PASS without contacting ComfyUI.

- [ ] **Step 6: Commit only Task 3 files**

```powershell
git add -- package.json scripts/check-spatial-stage-capabilities.mjs src/modules/spatial-stage/capabilities.ts src/modules/comfy-pipeline/comfyService.ts
git commit -m "feat: add spatial stage preflight"
```

## Task 4: Three.js Resource Lifecycle and Panorama Viewport

**Files:**
- Create: `src/modules/spatial-stage/threeResourceTracker.ts`
- Create: `src/modules/spatial-stage/SpatialStageViewport.tsx`
- Create: `scripts/check-spatial-stage-viewport.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: normalized `SceneStage`, selected entity ID, and interaction callbacks.
- Produces: `SpatialStageViewport`, `ThreeResourceTracker`, context-loss recovery, and explicit `releaseGpuResources()`.

- [ ] **Step 1: Add Three.js and write lifecycle assertions**

Run: `npm install --save-exact three`  
Expected: npm resolves the current registry release and locks it exactly.

Run: `npm install --save-dev --save-exact @types/three`  
Expected: TypeScript declarations are locked exactly and `npm run build` can resolve Three.js imports.

Create a bundled test that supplies fake disposable resources and asserts every tracked geometry, material, texture, and render target is disposed exactly once, including repeated `dispose()` calls:

```js
const tracker = new ThreeResourceTracker();
const resource = { disposeCalls: 0, dispose() { this.disposeCalls += 1; } };
tracker.track(resource);
tracker.dispose();
tracker.dispose();
assert.equal(resource.disposeCalls, 1);
```

Assert source text contains listeners for `webglcontextlost` and `webglcontextrestored`, a 4096 texture cap, and cleanup of renderer animation and DOM canvas.

- [ ] **Step 2: Verify the viewport test fails**

Run: `npm run test:spatial-stage-viewport`  
Expected: FAIL because the tracker and viewport are missing.

- [ ] **Step 3: Implement idempotent resource tracking**

Use a `Set<{ dispose(): void }>` and remove resources after disposal. Traverse material texture properties before disposing a material. Export:

```ts
export class ThreeResourceTracker {
  track<T extends { dispose(): void }>(resource: T): T;
  untrack(resource: { dispose(): void }): void;
  dispose(): void;
}
```

- [ ] **Step 4: Implement the unframed viewport**

`SpatialStageViewport` props:

```ts
type SpatialStageViewportProps = {
  stage: SceneStage;
  panoramaUrl?: string;
  selectedEntityId?: string;
  paused: boolean;
  onContextStatusChange(status: "ready" | "lost" | "failed"): void;
};
```

Create one renderer, scene, perspective camera, resize observer, grid, ground plane, axes helper, panorama sphere with inward-facing material, proxy meshes, and camera orbit controls implemented with pointer drag and wheel. Do not add `OrbitControls` in Phase A. Clamp device pixel ratio to 1.5, stop rendering while paused or hidden, and expose a ref-backed `releaseGpuResources()` used before high-VRAM work in a later integration phase.

- [ ] **Step 5: Run focused verification**

Run: `npm run test:spatial-stage-viewport`  
Expected: PASS.

Run: `npm run build`  
Expected: TypeScript resolves Three.js and the production bundle succeeds, subject only to documented unrelated baseline failures.

- [ ] **Step 6: Commit only Task 4 files**

```powershell
git add -- package.json package-lock.json scripts/check-spatial-stage-viewport.mjs src/modules/spatial-stage/threeResourceTracker.ts src/modules/spatial-stage/SpatialStageViewport.tsx
git commit -m "feat: add spatial stage viewport"
```

## Task 5: Stage Workbench and App-Shell Entry

**Files:**
- Create: `src/modules/spatial-stage/SpatialStageWorkbench.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`
- Modify: `scripts/check-spatial-stage-viewport.mjs`

**Interfaces:**
- Consumes: store actions, `probeSpatialStageCapabilities`, `SpatialStageViewport`, scene assets, and current selected shot.
- Produces: a `storyboard | spatial_stage` central work-surface switch and manual-stage creation flow.

- [ ] **Step 1: Add UI contract assertions**

Assert the bundled workbench renders:

```tsx
<button aria-pressed={workspaceMode === "storyboard"}>分镜</button>
<button aria-pressed={workspaceMode === "spatial_stage"}>空间预演</button>
```

Assert an absent stage shows `建立空间预演`, an empty manual stage shows `手工代理模式`, capability errors remain visible, and returning to storyboard unmounts or pauses the WebGL viewport.

- [ ] **Step 2: Verify the UI contract fails**

Run: `npm run test:spatial-stage-viewport`  
Expected: FAIL because `SpatialStageWorkbench.tsx` and the app-shell switch do not exist.

- [ ] **Step 3: Implement the workbench states**

Select the active scene from `selectedShot.sceneRefId`; if absent, use a deterministic `scene:${currentSequenceId}` ID and label it as an unbound scene. The workbench must provide:

- create manual stage;
- choose a panorama asset from existing skybox assets;
- refresh capability report;
- show WebGL, ComfyUI, MoGe node/model, memory, and fallback statuses;
- add box, capsule, sphere, and plane proxies;
- delete only the selected proxy after confirmation;
- mark source stale immediately after environment/entity changes.

Do not add skeletons, constraint solving, MoGe queueing, or control-map rendering in this phase.

- [ ] **Step 4: Add the central mode switch**

In `App.tsx`, add:

```ts
type WorkspaceMode = "storyboard" | "spatial_stage";
const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("storyboard");
```

Place a compact two-option segmented control in the existing top toolbar. Render `SpatialStageWorkbench` in the existing center column when selected; retain the timeline only for storyboard mode. Keep auxiliary panels and project save actions available in both modes.

- [ ] **Step 5: Add responsive styles**

Use stable dimensions: viewport `min-height: 420px`, toolbar rows `minmax(36px, auto)`, and canvas `width/height: 100%`. The viewport is full-bleed inside the central work surface, not a card. At widths below 900px, move stage tools into a horizontally scrolling single row and ensure no text overlaps the viewport.

- [ ] **Step 6: Run focused and production verification**

Run: `npm run test:spatial-stage-schema`  
Expected: PASS.

Run: `npm run test:spatial-stage-capabilities`  
Expected: PASS.

Run: `npm run test:spatial-stage-viewport`  
Expected: PASS.

Run: `npm run build`  
Expected: PASS, with unrelated baseline failures reported separately and not repaired in this task.

- [ ] **Step 7: Commit only Task 5 files**

```powershell
git add -- scripts/check-spatial-stage-viewport.mjs src/modules/spatial-stage/SpatialStageWorkbench.tsx src/app/App.tsx src/styles/global.css
git commit -m "feat: expose spatial stage workbench"
```

## Task 6: Desktop and Browser Visual Verification

**Files:**
- Create: `docs/superpowers/verification/2026-08-19-spatial-stage-foundation.md`
- Modify only if a defect is found: files owned by Tasks 1-5.

**Interfaces:**
- Consumes: complete Phase A build.
- Produces: reproducible acceptance evidence and a clean handoff to Phase B.

- [ ] **Step 1: Start the existing web runtime**

Run: `npm run web:start`  
Expected: server starts on its configured loopback URL without replacing an occupied port.

- [ ] **Step 2: Exercise the acceptance path**

Use Playwright at 1440x900 and 390x844:

1. Open an existing project and confirm no stage is created automatically.
2. Switch to `空间预演` and create a manual stage.
3. Add box, capsule, sphere, and plane proxies.
4. Assign a panorama asset and rotate/zoom the view.
5. Switch back to storyboard and confirm preview/timeline state is preserved.
6. Save, reload, and confirm stage revision, entities, and environment persist.
7. Stop ComfyUI and confirm the workbench remains usable in `手工代理模式`.

- [ ] **Step 3: Capture objective evidence**

Save desktop/mobile screenshots and record console errors, WebGL context status, stage revision, and capability report in the verification document. Include canvas pixel checks proving the Three.js canvas is nonblank at both viewports.

- [ ] **Step 4: Run the final focused suite**

Run:

```powershell
npm run test:spatial-stage-schema
npm run test:spatial-stage-capabilities
npm run test:spatial-stage-viewport
npm run test:video-production-schema
npm run build
```

Expected: all three new spatial-stage tests pass. Record any pre-existing Windows newline or shared-worktree build failure verbatim and prove it is unchanged by running the same failing command against the isolated baseline.

- [ ] **Step 5: Commit verification evidence**

```powershell
git add -- docs/superpowers/verification/2026-08-19-spatial-stage-foundation.md
git commit -m "test: verify spatial stage foundation"
```

## Follow-On Plans

After Phase A passes review, write separate implementation plans for:

1. Phase B: humanoid/quadruped rigs, prop attachment points, pose editing, and inherited state snapshots.
2. Phase C: MoGe panorama workflow, mesh decimation, ground/scale calibration, and manual corrections.
3. Phase D: generic constraint graph, conflict diagnostics, camera control renders, and spatial receipts.
4. Phase E: storyboard injection, high-VRAM serial scheduler, wooden-spear vertical slice, and seven-scene acceptance matrix.
