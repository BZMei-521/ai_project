# ComfyUI Storyboard Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Storyboard Pro project reliably generate single and batched storyboard images through the locally available ComfyUI workflows, write results back to shots, and expose actionable dependency diagnostics.

**Architecture:** Add a typed workflow registry and environment inspector beside the existing ComfyUI service. Keep generation orchestration in `comfyService`, task state in `storyboard-core`, and presentation in `ComfyPipelinePanel`; export modules remain consumers of `Shot.generatedImagePath`. Prefer existing workflow heuristics and presets, adding adapters only where the registry contract cannot represent them.

**Tech Stack:** React 18, TypeScript, Zustand, Vite, Tauri/Web bridge, ComfyUI HTTP/WebSocket API, Node test scripts.

## Global Constraints

- Preserve unrelated dirty-worktree changes.
- Do not overwrite existing ComfyUI models or custom nodes.
- Scan local ComfyUI before downloading anything.
- Block queueing when required checkpoint/VAE/node dependencies are missing.
- Keep Stage A, Stage B, and fallback workflows independently diagnosable.
- `npm run build` and existing workflow checks must pass before completion.

---

### Task 1: Establish the Workflow Registry Contract

**Files:**
- Create: `src/modules/comfy-pipeline/workflowRegistry.ts`
- Create: `scripts/check-workflow-registry.mjs`
- Test: `scripts/check-workflow-registry.mjs`

**Interfaces:**
- Produces `StoryboardWorkflowDefinition`, `WorkflowDependency`, `WorkflowTokenSpec`, `WorkflowOutputSpec`, and `WorkflowCapabilityReport`.
- Exports `BUILTIN_STORYBOARD_WORKFLOWS`, `inspectWorkflowDefinition(definition, environment)`, and `selectBestStoryboardWorkflow(reports)`.

- [ ] **Step 1: Write registry validation cases**

Use JSON fixtures containing one valid Stage A definition, one missing-token definition, and one definition requiring an unavailable node. Assert that validation returns stable error codes rather than throwing.

- [ ] **Step 2: Run the registry check and verify it fails before implementation**

Run `node scripts/check-workflow-registry.mjs`.
Expected: FAIL because the registry module and exported contract do not exist.

- [ ] **Step 3: Implement the typed registry**

Define workflow metadata with `id`, `stage`, `quality`, `workflowJson`, `requiredTokens`, `optionalTokens`, `dependencies`, and `output`. Register existing Qwen Stage A/B presets and the single-pass fallback without changing their JSON contents.

- [ ] **Step 4: Implement deterministic selection**

`selectBestStoryboardWorkflow` must rank `stageB > stageA > fallback`, then `mature_asset_guided > builtin_qwen > single_pass`, while returning a report explaining every rejected candidate.

- [ ] **Step 5: Run the check and commit the isolated task**

Run `node scripts/check-workflow-registry.mjs`.
Expected: PASS with valid, missing-token, and missing-dependency cases.

Commit command: `git add src/modules/comfy-pipeline/workflowRegistry.ts scripts/check-workflow-registry.mjs && git commit -m "feat: add storyboard workflow registry"`.

### Task 2: Add ComfyUI Environment and Dependency Inspection

**Files:**
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Create: `scripts/scan-comfy-storyboard-env.mjs`
- Test: `scripts/check-workflow-presets.mjs`

**Interfaces:**
- Add `inspectComfyEnvironment(baseUrl, comfyRootDir): Promise<ComfyEnvironmentReport>`.
- Add `inspectWorkflowDependencies(baseUrl, workflowJson): Promise<WorkflowDependencyReport>` using existing service conventions.
- `ComfyEnvironmentReport` includes `online`, `rootDir`, `models`, `customNodes`, `missingPaths`, and `checkedAt`.

- [ ] **Step 1: Add failing scanner cases**

Cover an offline URL, an online endpoint with an empty model directory, and a workflow referencing a missing checkpoint. Assert no network exception escapes the report boundary.

- [ ] **Step 2: Implement local filesystem scanning**

Scan only `models/checkpoints`, `models/vae`, `models/controlnet`, `models/ipadapter`, `models/clip_vision`, and `custom_nodes`. Return normalized relative paths and case-insensitive lookup keys.

- [ ] **Step 3: Implement ComfyUI endpoint checks**

Use the existing bridge/request helper to probe `/system_stats`, `/object_info`, and `/queue`; convert non-2xx responses into structured diagnostics.

- [ ] **Step 4: Connect dependency checks to registry reports**

Resolve checkpoint, VAE, ControlNet, IPAdapter, and custom node names against both `/object_info` and local paths. Report `missing_model`, `missing_node`, `missing_token`, and `offline` separately.

- [ ] **Step 5: Run build and scanner checks**

Run `node scripts/scan-comfy-storyboard-env.mjs --root "C:\Users\Administrator\Documents\ComfyUI"` and `npm run build`.
Expected: scanner prints JSON diagnostics; build passes without changing unrelated UI behavior.

Commit command: `git add src/modules/comfy-pipeline/comfyService.ts scripts/scan-comfy-storyboard-env.mjs scripts/check-workflow-presets.mjs && git commit -m "feat: inspect ComfyUI storyboard dependencies"`.

### Task 3: Add Generation Task State and Batch Binding

**Files:**
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/storyboard-core/store.ts`
- Test: `scripts/check-storyboard-generation-state.mjs`

**Interfaces:**
- Add `StoryboardGenerationStage = "preflight" | "stageA" | "stageB" | "fallback" | "completed" | "failed"`.
- Add `StoryboardGenerationTask` with `id`, `batchId`, `shotId`, `workflowId`, `stage`, `status`, `promptHash`, `outputPath`, `errorCode`, `errorMessage`, `startedAt`, and `finishedAt`.
- Add store actions `upsertGenerationTask(task)`, `markGenerationTaskFailed(id, error)`, and `completeGenerationTask(id, outputPath)`.

- [ ] **Step 1: Write state transition cases**

Assert that a task can move from `preflight` to `stageA`/`fallback` to `completed` or `failed`, that completion writes `Shot.generatedImagePath`, and that unrelated shots remain unchanged.

- [ ] **Step 2: Implement types and immutable Zustand actions**

Keep task records in the persisted storyboard snapshot. Reject completion for an unknown shot and preserve the original error code/message for failed tasks.

- [ ] **Step 3: Run state checks**

Run `node scripts/check-storyboard-generation-state.mjs`.
Expected: PASS for success, failure, retry, and restore scenarios.

Commit command: `git add src/modules/storyboard-core/types.ts src/modules/storyboard-core/store.ts scripts/check-storyboard-generation-state.mjs && git commit -m "feat: track storyboard generation tasks"`.

### Task 4: Integrate Single-Shot and Batch Orchestration

**Files:**
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
- Test: `scripts/check-storyboard-generation-flow.mjs`

**Interfaces:**
- Add `queueStoryboardShot(request): Promise<StoryboardGenerationTask>`.
- Add `queueStoryboardBatch(requests, options): Promise<StoryboardGenerationTask[]>`.
- Add `retryStoryboardTask(taskId): Promise<StoryboardGenerationTask>`.

- [ ] **Step 1: Write flow tests with mocked ComfyUI responses**

Cover preflight rejection, Stage A success, Stage B success, fallback success, one-shot failure in a batch, and retry of only the failed shot.

- [ ] **Step 2: Implement request normalization**

Build prompt text from `Shot.title`, `storyPrompt`, `dialogue`, `notes`, `tags`, character refs, scene refs, camera fields, global style, and negative prompt. Hash the normalized prompt for task identity.

- [ ] **Step 3: Implement staged queueing**

Run preflight once per batch, queue Stage A jobs in order, locate outputs, then queue Stage B only for successful Stage A jobs. Preserve failed jobs and continue the batch.

- [ ] **Step 4: Bind outputs to shots**

Use the state actions from Task 3 to write the resolved output path and stage metadata. Treat missing output files as `output_missing` failures.

- [ ] **Step 5: Add panel controls**

Add “测试当前镜头”, “批量生成”, “仅重试失败”, a workflow selector, dependency status, per-shot stage/status rows, and a report download/open action. Disable queue buttons while preflight is unresolved.

- [ ] **Step 6: Run flow tests and build**

Run `node scripts/check-storyboard-generation-flow.mjs` and `npm run build`.
Expected: PASS with mocked queue/history/view responses and no TypeScript errors.

Commit command: `git add src/modules/comfy-pipeline/comfyService.ts src/modules/comfy-pipeline/ComfyPipelinePanel.tsx scripts/check-storyboard-generation-flow.mjs && git commit -m "feat: orchestrate storyboard image generation"`.

### Task 5: Add Runtime Diagnostics and Documentation

**Files:**
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
- Create: `docs/comfyui-storyboard-setup.md`
- Create: `scripts/run-storyboard-smoke-test.mjs`

**Interfaces:**
- Smoke test accepts `--base-url`, `--comfy-root`, `--workflow-id`, and `--shot-script`.
- Documentation describes the exact scan output, workflow statuses, and model installation paths.

- [ ] **Step 1: Write smoke-test CLI behavior**

Assert that offline, missing-dependency, and successful output cases return exit codes `2`, `3`, and `0` respectively, with machine-readable JSON on stdout.

- [ ] **Step 2: Implement diagnostics panel**

Show endpoint status, last scan time, selected workflow, missing dependencies, and the next actionable fix. Never display “ready” when the selected workflow has unresolved required dependencies.

- [ ] **Step 3: Implement the smoke test**

Run one known example shot script through preflight and one queue request, then verify that an image appears in ComfyUI history/view and can be mapped to a shot ID.

- [ ] **Step 4: Document download/install boundaries**

Record the local root, expected subdirectories, workflow IDs, required files, and a checklist to run before downloading. Do not hard-code external URLs into runtime code.

- [ ] **Step 5: Run smoke test in dry-run mode**

Run `node scripts/run-storyboard-smoke-test.mjs --base-url http://127.0.0.1:8188 --comfy-root "C:\Users\Administrator\Documents\ComfyUI" --workflow-id storyboard-qwen-stageA --shot-script examples/river-dialogue-5s/river_dialogue_5s_shot_script.json --dry-run`.
Expected: clear preflight report and nonzero status if the local model set is incomplete.

Commit command: `git add src/modules/comfy-pipeline/ComfyPipelinePanel.tsx docs/comfyui-storyboard-setup.md scripts/run-storyboard-smoke-test.mjs && git commit -m "feat: add storyboard ComfyUI diagnostics"`.

### Task 6: Full Verification and Minimal Dependency Installation

**Files:**
- Modify: `docs/comfyui-storyboard-setup.md`
- Create: `docs/comfyui-storyboard-dependency-manifest.json`

- [ ] **Step 1: Run static checks**

Run `npm run build`, `npm run test:workflow-presets`, `npm run test:threeview-guards`, and every new `check-*.mjs` script.

- [ ] **Step 2: Produce the dependency manifest**

Populate it from the actual scanner output with workflow ID, model filename, node package, expected path, installed status, and source URL. Do not mark a dependency installed from configuration alone.

- [ ] **Step 3: Download only missing required dependencies**

After reviewing the manifest, download only the selected primary workflow's required files into the existing ComfyUI directories. Preserve existing files and record checksums.

- [ ] **Step 4: Run the live smoke test**

Run the same command without `--dry-run`, then generate 3-5 example shots and verify output paths, preview rendering, PDF export, and MP4 export.

- [ ] **Step 5: Record residual limitations**

Document unavailable Stage B or fallback capabilities, download failures, and any model-specific prompt limitations.

