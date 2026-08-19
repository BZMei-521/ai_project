# 灰豆式空间导演工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有故事板应用渐进重构为灰豆式六阶段空间导演工作台，并加入可保存、可复现的轻量三维预演，同时保持现有生成和旧项目兼容。

**Architecture:** 新工作台通过 `app-shell` 和 `features/*` 负责产品流程，`domains/*` 保存与 UI 和 ComfyUI 无关的领域契约，`services/*` 通过适配器复用现有生成、媒体和持久化能力。旧面板先降级到 `advanced-tools`，迁移完成并通过引用扫描与回归测试后，再按职责删除旧代码。

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, Zustand, Three.js, Tauri 2, Vitest-compatible Node checks, existing ComfyUI and FFmpeg adapters.

## Global Constraints

- 默认一级导航必须是 `项目 → 剧本 → 资产 → 预演 → 分镜 → 成片`。
- 默认界面不显示 ComfyUI 节点、模型清单或长篇诊断信息；这些内容只在“高级工具”中出现。
- 页面组件目标不超过 300 行，领域服务目标不超过 500 行。
- 领域层不得依赖 ComfyUI、Tauri 或具体模型名称。
- 不改变现有生成队列协议、媒体文件、角色图、视频、项目快照或未相关的 dirty/untracked 文件。
- 旧项目必须先读取、备份，再迁移；迁移失败不得改写原项目。
- 不执行 `git reset`、`git checkout`、`git clean` 或批量删除。
- 每个删除批次必须有静态引用扫描、替代模块和回归命令作为证据。
- Three.js 画布必须在桌面和窄屏通过截图与像素检查确认非空、无重叠、可交互。

---

### Task 1: 建立基线与模块边界清单

**Files:**
- Create: `docs/superpowers/plans/2026-08-19-graybean-workbench-baseline.md`
- Modify: `package.json` only if the baseline script needs an existing script alias
- Test: `scripts/check-graybean-workbench-baseline.mjs`

**Interfaces:**
- Produces a checked-in baseline report with current build status, line counts, entry imports, snapshot schema version, and the exact legacy panels moved behind the future advanced-tools boundary.

- [ ] **Step 1: Write the failing baseline assertions**

```js
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const app = await readFile("src/app/App.tsx", "utf8");
const pipeline = await readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
const service = await readFile("src/modules/comfy-pipeline/comfyService.ts", "utf8");
assert.match(app, /LazyAuxPanelContent/);
assert.ok(pipeline.split("\\n").length > 10000);
assert.ok(service.split("\\n").length > 20000);
console.log("baseline captured");
```

- [ ] **Step 2: Run the baseline check and build**

Run: `node scripts/check-graybean-workbench-baseline.mjs` and `npm.cmd run build`.
Expected: baseline check prints `baseline captured`; build completes with exit code 0, or the report records the pre-existing failure without changing source.

- [ ] **Step 3: Record imports, routes, line counts, and schema facts**

Write `docs/superpowers/plans/2026-08-19-graybean-workbench-baseline.md` with the exact paths found by `rg`, the current `StoryboardSnapshot` fields, and the commands that reproduce the measurements.

- [ ] **Step 4: Commit only the baseline artifacts**

```bash
git add scripts/check-graybean-workbench-baseline.mjs docs/superpowers/plans/2026-08-19-graybean-workbench-baseline.md
git commit -m "chore: capture workbench refactor baseline"
```

### Task 2: Add domain contracts for director and spatial scenes

**Files:**
- Create: `src/domains/director/types.ts`
- Create: `src/domains/spatial-scene/types.ts`
- Create: `src/domains/spatial-scene/sceneMath.ts`
- Create: `scripts/check-spatial-scene-domain.mjs`

**Interfaces:**
- `SpatialScene`, `SpatialObject`, `PoseKeyframe`, `CameraPlan`, `PreviewReferenceSet`, `DirectorPlanRevision`.
- `normalizeCameraPlan(input): CameraPlan` clamps FOV and normalizes angles without importing UI or generation modules.
- `computeSceneBounds(objects): Bounds3` returns deterministic min/max coordinates.

- [ ] **Step 1: Add domain tests that initially fail because types/functions do not exist**

```js
import assert from "node:assert/strict";
import { normalizeCameraPlan, computeSceneBounds } from "../src/domains/spatial-scene/sceneMath.ts";

const camera = normalizeCameraPlan({ yaw: 450, pitch: 100, fov: 2 });
assert.equal(camera.yaw, 90);
assert.equal(camera.pitch, 89);
assert.equal(camera.fov, 20);
assert.deepEqual(computeSceneBounds([
  { position: { x: -1, y: 0, z: 2 }, scale: { x: 1, y: 1, z: 1 } },
  { position: { x: 3, y: 2, z: -2 }, scale: { x: 2, y: 1, z: 1 } }
]), { min: { x: -2, y: 0, z: -3 }, max: { x: 4, y: 3, z: 3 } });
```

- [ ] **Step 2: Run the domain check and verify the expected missing-module failure**

Run: `node scripts/check-spatial-scene-domain.mjs`.
Expected before implementation: failure naming `src/domains/spatial-scene/sceneMath.ts` or the missing exports.

- [ ] **Step 3: Implement serializable domain types and pure math**

Define explicit `position`, `rotation`, `scale`, `visibility`, `objectKind`, pose tracks, camera plans, panorama references, and revision status. Keep functions pure and deterministic; reject non-finite coordinates with a thrown `RangeError`.

- [ ] **Step 4: Run the domain check**

Run: `node scripts/check-spatial-scene-domain.mjs`.
Expected: PASS with normalized camera values and deterministic bounds.

- [ ] **Step 5: Commit the domain contract**

```bash
git add src/domains/director src/domains/spatial-scene scripts/check-spatial-scene-domain.mjs
git commit -m "feat: add director and spatial scene contracts"
```

### Task 3: Versioned snapshot migration and backup

**Files:**
- Create: `src/services/persistence/workbenchMigration.ts`
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/persistence/projectFile.ts`
- Modify: `src/modules/persistence/backupSnapshot.ts`
- Create: `scripts/check-workbench-migration.mjs`

**Interfaces:**
- `CURRENT_WORKBENCH_SCHEMA_VERSION = 2`.
- `migrateStoryboardSnapshot(input): MigrationResult` never mutates `input` and returns `{ snapshot, migrated, warnings }`.
- `createMigrationBackup(snapshot, destination): Promise<string>` writes a timestamped backup before first new-format save.

- [ ] **Step 1: Add migration tests for legacy snapshots, idempotence, and failure safety**

```js
const legacy = { project: { id: "p1" }, shots: [], assets: [] };
const first = migrateStoryboardSnapshot(legacy);
assert.equal(first.snapshot.schemaVersion, 2);
assert.ok(first.snapshot.spatialScenes);
assert.deepEqual(migrateStoryboardSnapshot(first.snapshot).snapshot, first.snapshot);
assert.throws(() => migrateStoryboardSnapshot({ project: null }), /project/);
assert.deepEqual(legacy, { project: { id: "p1" }, shots: [], assets: [] });
```

- [ ] **Step 2: Run migration tests and verify failure before implementation**

Run: `node scripts/check-workbench-migration.mjs`.
Expected: failure naming the missing migration export.

- [ ] **Step 3: Implement non-mutating migration**

Clone the snapshot, add `schemaVersion`, `directorPlan`, `spatialScenes`, `spatialObjects`, `poseKeyframes`, and `cameraPlans` defaults, preserve all unknown legacy fields, and return warnings for fields that cannot be inferred. Integrate backup creation into the existing first-save path without changing file names or media locations.

- [ ] **Step 4: Run migration and existing persistence checks**

Run: `node scripts/check-workbench-migration.mjs` and the existing persistence/state checks listed by `npm.cmd run`.
Expected: PASS; legacy input remains byte-equivalent in memory and backup path is returned before the new snapshot path is written.

- [ ] **Step 5: Commit migration support**

```bash
git add src/services/persistence/workbenchMigration.ts src/modules/storyboard-core/types.ts src/modules/persistence/projectFile.ts src/modules/persistence/backupSnapshot.ts scripts/check-workbench-migration.mjs
git commit -m "feat: migrate legacy snapshots to spatial workbench"
```

### Task 4: Build the Three.js spatial preview engine

**Files:**
- Modify: `package.json`
- Create: `src/features/spatial-preview/SpatialPreviewCanvas.tsx`
- Create: `src/features/spatial-preview/spatialPreviewStore.ts`
- Create: `src/features/spatial-preview/previewReferenceRenderer.ts`
- Create: `src/features/spatial-preview/SpatialPreviewInspector.tsx`
- Create: `scripts/check-spatial-preview-runtime.mjs`

**Interfaces:**
- `SpatialPreviewCanvas({ scene, selection, onSelectionChange, onSceneChange }): JSX.Element`.
- `createPreviewReferenceSet(scene, camera): PreviewReferenceSet` produces paths/metadata for color, depth, normal, mask, pose, and JSON channels.
- `useSpatialPreviewStore` owns selection/tool/undo state and does not own the global storyboard snapshot.

- [ ] **Step 1: Add Three.js dependency and runtime contract test**

Run: `npm install three @types/three` and add a test that imports the renderer and asserts it produces six named channels for a minimal scene.

- [ ] **Step 2: Run the runtime check before implementation**

Run: `node scripts/check-spatial-preview-runtime.mjs`.
Expected: failure for the missing renderer export or channel count.

- [ ] **Step 3: Implement the canvas with stable dimensions and cleanup**

Create the renderer, scene, camera, lights, grid, panorama background hook, transform controls, resize observer, pointer selection, and disposal path. Use simple proxy geometry for characters, wolves, and props; keep references in domain IDs. Do not put generation calls in the canvas.

- [ ] **Step 4: Implement preview state and deterministic reference metadata**

Store selected object, active tool, undo/redo stacks, camera plan, and dirty state locally. Generate the five image-channel descriptors plus JSON parameters from the same scene revision; use placeholder render targets only until the media service is wired.

- [ ] **Step 5: Verify desktop and narrow layout**

Run: `npm.cmd run build`; start Vite; capture 1280px and 390px screenshots. Expected: nonblank canvas, no overlapping inspector controls, and keyboard focus visible.

- [ ] **Step 6: Commit the spatial preview engine**

```bash
git add package.json package-lock.json src/features/spatial-preview scripts/check-spatial-preview-runtime.mjs
git commit -m "feat: add interactive spatial preview engine"
```

### Task 5: Add the six-stage app shell

**Files:**
- Create: `src/app-shell/WorkbenchShell.tsx`
- Create: `src/app-shell/workbenchRoutes.ts`
- Create: `src/app-shell/workbenchStatus.ts`
- Create: `src/shared/ui/StageNavigation.tsx`
- Create: `src/shared/ui/CompactStatusBar.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`
- Create: `scripts/check-workbench-shell.mjs`

**Interfaces:**
- `WorkbenchStage = "project" | "script" | "assets" | "preview" | "storyboard" | "production"`.
- `WorkbenchShell({ stage, children, inspector, advancedTools }): JSX.Element`.
- `getWorkbenchStatus(snapshot): { save: ..., engine: ..., task: ... }`.

- [ ] **Step 1: Add shell contract checks**

Assert that the rendered shell exposes six navigation labels, a central stage slot, a current-object inspector slot, and an advanced-tools entry while not rendering model/node diagnostic text by default.

- [ ] **Step 2: Run the shell check before implementation**

Run: `node scripts/check-workbench-shell.mjs`.
Expected: failure naming the missing shell exports.

- [ ] **Step 3: Implement the shell and route registry**

Move top-level navigation and project status responsibilities out of `App.tsx`. Keep existing Zustand selectors, persistence callbacks, keyboard shortcuts, dialogs, and toast hosts intact. Route old auxiliary panel sections to advanced-tools instead of deleting them.

- [ ] **Step 4: Implement the compact visual system**

Add scoped workbench variables, three-column desktop layout, focused center stage, restrained inspector, reduced diagnostic padding, keyboard focus states, reduced-motion fallback, and responsive collapse below 1100px/820px. Avoid adding new gradients, decorative blobs, or nested cards.

- [ ] **Step 5: Run shell and build checks**

Run: `node scripts/check-workbench-shell.mjs` and `npm.cmd run build`.
Expected: PASS and successful production build.

- [ ] **Step 6: Commit the app shell**

```bash
git add src/app-shell src/shared/ui src/app/App.tsx src/styles/global.css scripts/check-workbench-shell.mjs
git commit -m "feat: add graybean-style workbench shell"
```

### Task 6: Wire director, assets, preview, storyboard, and production features

**Files:**
- Create: `src/features/script-director/ScriptDirectorView.tsx`
- Create: `src/features/assets/AssetWorkspaceView.tsx`
- Create: `src/features/storyboard/StoryboardWorkspaceView.tsx`
- Create: `src/features/production/ProductionWorkspaceView.tsx`
- Create: `src/features/advanced-tools/AdvancedToolsView.tsx`
- Create: `src/services/generation-providers/localComfyProvider.ts`
- Create: `src/services/generation-providers/providerContracts.ts`
- Modify: `src/modules/comfy-pipeline/videoGeneration.ts`
- Modify: `src/modules/comfy-pipeline/workflowRegistry.ts`
- Create: `scripts/check-workbench-feature-routing.mjs`

**Interfaces:**
- `LocalComfyProvider` implements `GenerationProvider` for character, panorama, storyboard, video, audio, and export jobs through existing adapters.
- Feature views consume domain snapshots and provider interfaces; they must not import `ComfyPipelinePanel` directly.
- `AdvancedToolsView` is the only default route that may import legacy panels.

- [ ] **Step 1: Add routing assertions**

Test that each of the six stages renders its focused view, that `preview` renders `SpatialPreviewCanvas`, and that legacy pipeline content is reachable only through `advanced-tools`.

- [ ] **Step 2: Run routing check before implementation**

Run: `node scripts/check-workbench-feature-routing.mjs`.
Expected: failure naming missing feature views/provider exports.

- [ ] **Step 3: Implement focused views**

Each view should keep its first viewport to the stage-specific action and status. Use existing store actions and snapshot selectors, but expose generation controls through `LocalComfyProvider` rather than raw workflow JSON.

- [ ] **Step 4: Implement provider adapters**

Wrap the existing video, image, character, audio, quality, and export entry points with typed methods. Preserve payloads, workflow IDs, task persistence, and output paths exactly; adapter tests should compare generated request shapes with existing dry-run fixtures.

- [ ] **Step 5: Run feature routing, workflow, and build checks**

Run: `node scripts/check-workbench-feature-routing.mjs`, existing video/character/workflow checks, and `npm.cmd run build`.
Expected: all targeted checks pass and no generation contract diff is reported.

- [ ] **Step 6: Commit feature routing and adapters**

```bash
git add src/features src/services/generation-providers src/modules/comfy-pipeline/videoGeneration.ts src/modules/comfy-pipeline/workflowRegistry.ts scripts/check-workbench-feature-routing.mjs
git commit -m "feat: route workbench stages through generation adapters"
```

### Task 7: Extract legacy panels into advanced tools and remove dead branches

**Files:**
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Create: `src/features/advanced-tools/LegacyPipelinePanel.tsx`
- Create: `src/services/generation-providers/comfyClient.ts`
- Create: `scripts/check-graybean-dead-code.mjs`

**Interfaces:**
- `LegacyPipelinePanel` preserves the existing public props and callbacks while importing focused legacy subpanels.
- `ComfyClient` owns HTTP/queue/file transport only; role-specific services depend on its typed methods.

- [ ] **Step 1: Extract one responsibility at a time**

Move client transport, workflow registry access, character generation, panorama generation, storyboard generation, video generation, quality checks, and diagnostic rendering into focused files. Preserve public exports with compatibility re-exports until all feature views use adapters.

- [ ] **Step 2: Run existing contracts after each extraction**

Run the smallest relevant command after each move: character checks for character extraction, panorama/skybox checks for panorama extraction, video checks for video extraction, and `npm.cmd run build` after the batch.

- [ ] **Step 3: Prove dead branches are unreachable**

`check-graybean-dead-code.mjs` scans imports, dynamic imports, route registry entries, and package scripts. It must print each removal candidate with its replacement path and fail if a candidate is still imported.

- [ ] **Step 4: Delete only proven dead code**

Delete compatibility branches and duplicated UI code only after the check passes. Do not delete the compatibility re-exports until all consumers have moved. Do not delete the original media or snapshot files.

- [ ] **Step 5: Commit each deletion batch**

```bash
git add src/modules/comfy-pipeline src/features/advanced-tools src/services/generation-providers scripts/check-graybean-dead-code.mjs
git commit -m "refactor: split legacy pipeline into focused services"
```

### Task 8: End-to-end migration, visual QA, and release gate

**Files:**
- Create: `scripts/check-graybean-workbench-acceptance.mjs`
- Create: `docs/superpowers/verification/graybean-spatial-director-workbench.md`
- Modify: `package.json` to add `test:graybean-workbench`

**Interfaces:**
- Acceptance script runs migration, shell, spatial, provider, dead-code, and build checks and emits a machine-readable summary.

- [ ] **Step 1: Add acceptance command with explicit checks**

The command must run `check-workbench-migration`, `check-spatial-scene-domain`, `check-spatial-preview-runtime`, `check-workbench-shell`, `check-workbench-feature-routing`, `check-graybean-dead-code`, existing character/video/workflow checks, and `npm.cmd run build`.

- [ ] **Step 2: Run desktop and narrow visual QA**

Start Vite and capture 1280px and 390px screenshots. Verify six-stage navigation, central nonblank preview, current-object inspector, no first-viewport model/node diagnostics, no text overflow, no overlapping controls, and visible focus rings.

- [ ] **Step 3: Verify old project round-trip**

Open a representative legacy snapshot, confirm a timestamped backup appears before save, close/reopen it, compare project/shots/assets/media references, and force a migration error to confirm the original file remains unchanged.

- [ ] **Step 4: Verify generation round-trip**

Run existing dry-run checks for character identity, panorama, storyboard, H3 video, audio, timeline, and export. Confirm the new provider adapters produce the same queue payloads and output references as the old entry points.

- [ ] **Step 5: Write the verification report and commit the release gate**

```bash
git add scripts/check-graybean-workbench-acceptance.mjs docs/superpowers/verification/graybean-spatial-director-workbench.md package.json
git commit -m "test: verify graybean spatial director workbench"
```

## Self-Review

- Spec coverage: product structure is Task 5; Three.js preview is Task 4; migration is Task 3; module boundaries and legacy deletion are Tasks 6-7; status/error and acceptance criteria are Task 8.
- Placeholder scan: no `TODO`, `TBD`, or unspecified implementation task is used; every task has concrete files, commands, interfaces, and expected outcomes.
- Type consistency: `SpatialScene`, `CameraPlan`, `PreviewReferenceSet`, `GenerationProvider`, `WorkbenchStage`, and `MigrationResult` are introduced before consumers and are referenced consistently.
- Scope: the plan is one coordinated workbench project but each task has an independently testable deliverable and commit.
