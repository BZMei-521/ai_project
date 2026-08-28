# Codex Storyboard Task-Package Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable Codex task-package storyboard provider, preserve ComfyUI unchanged, and prove one review-only `E01-C01` generation round trip.

**Architecture:** The desktop application exports an immutable, hash-bound filesystem package through a dedicated Tauri command. The current Codex task validates that package, calls built-in image generation once, publishes a candidate plus receipt, and the application imports it into the existing `needs_review` gate without changing the accepted shot path.

**Tech Stack:** TypeScript, React, Zustand, Node.js contract tests, Rust/Tauri, `serde`, `sha2`, `image`, Codex built-in image generation.

## Global Constraints

- Keep all existing ComfyUI providers, settings, workflows, video, audio, panorama, character, quality, and export behavior unchanged.
- Do not call the OpenAI Images API from the desktop application and do not require or store `OPENAI_API_KEY`.
- The first live run is exactly one shot: `E01-C01`.
- Every attempt uses a new exclusive `jobId` and directory; no existing package or generated storyboard image is overwritten.
- References are an ordered, variable-length list of immutable copied snapshots with SHA-256, dimensions, MIME type, semantic usage, and a required per-image usage instruction.
- Publish `request.json` and `result.json` last with atomic create/rename semantics.
- A valid Codex result enters `needs_review`; only explicit human acceptance updates `generatedImagePath`.
- Cancelled, rejected, unknown, mismatched, mutated, or replayed jobs fail closed.
- Use built-in Codex image generation, one call per shot, and copy the chosen image into the project package.
- Preserve unrelated changes in the dirty working tree and stage only files owned by the active task.

## File Map

- Create `src/services/generation-providers/codexTaskPackageRuntime.mjs`: canonical request/result validation, prompt compilation, digest and state helpers with no filesystem or UI dependencies.
- Create `src/services/generation-providers/codexTaskPackage.ts`: TypeScript types and typed re-exports for the runtime contract.
- Create `src/services/generation-providers/codexTaskPackageProvider.ts`: `GenerationProvider` adapter that exports storyboard jobs and explicitly rejects unsupported kinds.
- Create `src-tauri/src/codex_storyboard.rs`: exclusive filesystem package export/import commands, image inspection, containment checks, hashes, and Rust unit tests.
- Modify `src-tauri/src/main.rs`: register the new module and two Tauri commands.
- Modify `src/modules/platform/desktopBridge.ts`: typed `prepareCodexStoryboardJob` and `importCodexStoryboardResult` wrappers.
- Modify `src/services/generation-providers/providerContracts.ts`: add optional package metadata to `JobResult` without changing existing required fields.
- Modify `src/modules/storyboard-core/types.ts`: add `exported` generation stage and package metadata fields.
- Modify `src/modules/storyboard-core/store.ts`: preserve exported task metadata and keep result import review-only.
- Modify `src/modules/comfy-pipeline/comfyService.ts`: extend the storyboard mode union and expose pure Codex request construction from shot/assets.
- Modify `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`: add selector option, provider description, export/import actions, and pending/result UI.
- Modify `src/features/advanced-tools/AdvancedToolsView.tsx`: pass the active project path to the lazy pipeline panel.
- Modify `src/app/App.tsx`: provide `activeWorkspacePath` to the advanced pipeline panel.
- Create `scripts/check-codex-storyboard-task-package.mjs`: pure contract and provider RED/GREEN tests.
- Create `scripts/check-codex-storyboard-ui.mjs`: settings migration, UI routing, state, and Comfy regression assertions.
- Create `scripts/run-codex-storyboard-job.mjs`: CLI inspection and completion receipt helper for the current Codex task; it never calls an external image API.
- Create `examples/codex-storyboard/e01-c01.json`: fixed initial live-trial selection of four annotated references; the contract supports additional references and repeated usages.
- Modify `package.json`: add focused test and job-inspection scripts.

---

### Task 1: Pure task-package contract and provider adapter

**Files:**
- Create: `src/services/generation-providers/codexTaskPackageRuntime.mjs`
- Create: `src/services/generation-providers/codexTaskPackage.ts`
- Create: `src/services/generation-providers/codexTaskPackageProvider.ts`
- Modify: `src/services/generation-providers/providerContracts.ts`
- Create: `scripts/check-codex-storyboard-task-package.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `GenerationProvider`, `ProviderJobPayload`, and `JobResult`.
- Produces: `CODEX_STORYBOARD_PROVIDER_ID`, `canonicalCodexStoryboardRequest`, `validateCodexStoryboardRequest`, `compileCodexStoryboardImageSpec`, `validateCodexStoryboardResult`, `CodexTaskPackageProvider`.

- [ ] **Step 1: Write the failing contract/provider test**

Create `scripts/check-codex-storyboard-task-package.mjs` with a valid ordered-reference fixture, including two references that share one usage, then assert:

```js
assert.equal(runtime.CODEX_STORYBOARD_PROVIDER_ID, "codex_task_package");
assert.equal(runtime.canonicalCodexStoryboardRequest(request), runtime.canonicalCodexStoryboardRequest(structuredClone(request)));
assert.deepEqual(runtime.compileCodexStoryboardImageSpec(request).referenceUsages, [
  "spatial_authority", "body_costume", "face_identity", "style_only", "style_only"
]);
assert.match(runtime.compileCodexStoryboardImageSpec(request).compiledPrompt, /Picture 5.*style_only/s);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, provider: "comfy" }), /provider_mismatch/);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, references: request.references.map((item, index) => index === 0 ? { ...item, relativePath: "../escape.png" } : item) }), /path_invalid/);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, references: request.references.map((item, index) => index === 0 ? { ...item, instruction: "" } : item) }), /instruction_invalid/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, shotId: "other" }, request), /identity_mismatch/);

const provider = new CodexTaskPackageProvider({
  exportStoryboardJob: async () => ({ jobId: request.jobId, packagePath: "C:/project/codex-storyboard-jobs/job-1", requestDigest: "a".repeat(64) })
});
assert.deepEqual(await provider.storyboard({ request }), {
  jobId: request.jobId,
  status: "queued",
  outputPath: "C:/project/codex-storyboard-jobs/job-1",
  metadata: { provider: "codex_task_package", requestDigest: "a".repeat(64) }
});
await assert.rejects(() => provider.video({}), /unsupported_job_kind/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/check-codex-storyboard-task-package.mjs`

Expected: FAIL because `codexTaskPackageRuntime.mjs` and `CodexTaskPackageProvider` do not exist.

- [ ] **Step 3: Implement the minimal pure runtime**

Implement these exact helpers and exports in `codexTaskPackageRuntime.mjs`:

```js
export const CODEX_STORYBOARD_PROVIDER_ID = "codex_task_package";
export const CODEX_STORYBOARD_REFERENCE_USAGES = Object.freeze([
  "spatial_authority", "pose_reference", "face_identity", "body_costume",
  "prop_detail", "style_only", "lighting_only", "negative_example"
]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys, code) => {
  if (!isPlainObject(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail(code);
};
const safeRelativePath = (value) => typeof value === "string" && value.length > 0 && !/^(?:[a-zA-Z]:|[\\/])/.test(value) && value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : isPlainObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;

export function validateCodexStoryboardRequest(value) {
  exactKeys(value, ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "createdAt", "prompt", "references", "acceptedImagePath", "expectedOutput"], "codex_storyboard_request_keys_invalid");
  if (value.schemaVersion !== 1 || value.provider !== CODEX_STORYBOARD_PROVIDER_ID) fail("codex_storyboard_provider_mismatch");
  for (const field of ["jobId", "projectId", "episodeId", "shotId"]) if (!/^[a-zA-Z0-9_-]{1,96}$/.test(value[field] ?? "")) fail(`codex_storyboard_${field}_invalid`);
  if (!Array.isArray(value.references) || value.references.length === 0 || value.references.length > 16) fail("codex_storyboard_references_invalid");
  const ids = new Set();
  for (const reference of value.references) {
    exactKeys(reference, ["id", "usage", "instruction", "relativePath", "sha256", "width", "height", "mimeType"], "codex_storyboard_reference_keys_invalid");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(reference.id) || ids.has(reference.id)) fail("codex_storyboard_reference_id_invalid");
    ids.add(reference.id);
    if (!CODEX_STORYBOARD_REFERENCE_USAGES.includes(reference.usage)) fail("codex_storyboard_reference_usage_invalid");
    if (!String(reference.instruction ?? "").trim()) fail("codex_storyboard_reference_instruction_invalid");
    if (!safeRelativePath(reference.relativePath) || !digest(reference.sha256) || !Number.isSafeInteger(reference.width) || reference.width <= 0 || !Number.isSafeInteger(reference.height) || reference.height <= 0 || !["image/png", "image/jpeg"].includes(reference.mimeType)) fail("codex_storyboard_reference_invalid");
  }
  if (!value.references.some((item) => item.usage === "spatial_authority") || !value.references.some((item) => item.usage === "face_identity" || item.usage === "body_costume")) fail("codex_storyboard_required_reference_usage_missing");
  if (!isPlainObject(value.prompt) || value.prompt.useCase !== "stylized-concept" || !String(value.prompt.primaryRequest ?? "").trim()) fail("codex_storyboard_prompt_invalid");
  if (value.acceptedImagePath !== null && typeof value.acceptedImagePath !== "string") fail("codex_storyboard_accepted_path_invalid");
  exactKeys(value.expectedOutput, ["candidatePath", "resultPath", "mimeTypes"], "codex_storyboard_expected_output_invalid");
  if (value.expectedOutput.candidatePath !== "outputs/candidate.png" || value.expectedOutput.resultPath !== "outputs/result.json" || JSON.stringify(value.expectedOutput.mimeTypes) !== JSON.stringify(["image/png"])) fail("codex_storyboard_expected_output_invalid");
  return Object.freeze(structuredClone(value));
}

export function canonicalCodexStoryboardRequest(value) {
  return JSON.stringify(canonicalize(validateCodexStoryboardRequest(value)));
}

export function compileCodexStoryboardImageSpec(value) {
  const request = validateCodexStoryboardRequest(value);
  const pictureInstructions = request.references.map((item, index) => `Picture ${index + 1} [${item.usage}]: ${item.instruction}`);
  return Object.freeze({ taxonomy: "stylized-concept", assetType: "AI comic-drama storyboard frame", referenceUsages: request.references.map((item) => item.usage), referencedRelativePaths: request.references.map((item) => item.relativePath), compiledPrompt: [...pictureInstructions, request.prompt.primaryRequest].join("\n") });
}

export function validateCodexStoryboardResult(result, requestValue) {
  const request = validateCodexStoryboardRequest(requestValue);
  exactKeys(result, ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "requestDigest", "referenceDigests", "generationMode", "finalPrompt", "output", "completedAt", "state"], "codex_storyboard_result_keys_invalid");
  if (result.schemaVersion !== 1 || result.provider !== CODEX_STORYBOARD_PROVIDER_ID || result.generationMode !== "codex_builtin_imagegen" || result.state !== "completed") fail("codex_storyboard_result_invalid");
  for (const field of ["jobId", "projectId", "episodeId", "shotId"]) if (result[field] !== request[field]) fail("codex_storyboard_result_identity_mismatch");
  if (!digest(result.requestDigest) || JSON.stringify(result.referenceDigests) !== JSON.stringify(request.references.map(({ id, sha256 }) => ({ id, sha256 })))) fail("codex_storyboard_result_lineage_mismatch");
  if (result.output?.relativePath !== "outputs/candidate.png" || !digest(result.output?.sha256) || !Number.isSafeInteger(result.output?.width) || result.output.width <= 0 || !Number.isSafeInteger(result.output?.height) || result.output.height <= 0 || result.output?.mimeType !== "image/png") fail("codex_storyboard_result_output_invalid");
  return Object.freeze(structuredClone(result));
}
```

Use an internal plain-object guard, a recursive canonicalizer, `/^[a-f0-9]{64}$/`, `/^[a-zA-Z0-9_-]{1,96}$/`, and a relative-path guard that rejects absolute paths, empty segments, `.` and `..`. Reject unknown top-level/reference keys, duplicate IDs, more than 16 references, empty instructions, unknown usages, and missing required usages. Preserve array order during canonicalization.

- [ ] **Step 4: Add TypeScript types and adapter**

Define `CodexStoryboardRequest`, `CodexStoryboardResult`, `CodexStoryboardImageSpec`, `CodexStoryboardExportReceipt`, and `CodexStoryboardImportReceipt` in `codexTaskPackage.ts`. Extend `JobResult` with:

```ts
metadata?: Record<string, string>;
```

Implement `CodexTaskPackageProvider` so `storyboard()` delegates to `exportStoryboardJob`, returns `queued`, uses the package path as `outputPath`, and every other job kind rejects `codex_task_package_unsupported_job_kind:{kind}`.

- [ ] **Step 5: Verify GREEN and register focused script**

Run: `node scripts/check-codex-storyboard-task-package.mjs`

Expected: `PASS Codex storyboard task-package contract and provider`.

Add to `package.json`:

```json
"test:codex-storyboard-package": "node scripts/check-codex-storyboard-task-package.mjs"
```

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/services/generation-providers/codexTaskPackageRuntime.mjs src/services/generation-providers/codexTaskPackage.ts src/services/generation-providers/codexTaskPackageProvider.ts src/services/generation-providers/providerContracts.ts scripts/check-codex-storyboard-task-package.mjs package.json
git commit -m "feat: add Codex storyboard package contract"
```

---

### Task 2: Secure Tauri package export and result import

**Files:**
- Create: `src-tauri/src/codex_storyboard.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/modules/platform/desktopBridge.ts`

**Interfaces:**
- Consumes: validated frontend request plus an ordered variable-length list of annotated absolute reference paths and an absolute active project directory.
- Produces: Tauri commands `prepare_codex_storyboard_job` and `import_codex_storyboard_result`; frontend wrappers with the same semantic names.

- [ ] **Step 1: Write Rust unit tests before commands**

Inside `codex_storyboard.rs`, create fixture PNGs with the `image` crate and tests that prove:

```rust
assert_eq!(receipt.status, "exported");
assert!(Path::new(&receipt.request_path).is_file());
assert!(Path::new(&receipt.package_path).join("inputs/01-spatial-authority.png").is_file());
assert_eq!(prepare_at_roots(&project, &assets, request.clone()).unwrap_err(), "codex_storyboard_destination_exists");
assert_eq!(prepare_at_roots(&project, &project.join("outside"), request.clone()).unwrap_err(), "codex_storyboard_assets_root_outside_project");
assert_eq!(import_at_roots(&project, &assets, cancelled_request).unwrap_err(), "codex_storyboard_task_cancelled");
assert_eq!(import_at_roots(&project, &assets, mismatched_result).unwrap_err(), "codex_storyboard_result_identity_mismatch");
assert_eq!(valid_import.status, "needs_review");
assert!(Path::new(&valid_import.candidate_path).ends_with("outputs/candidate.png"));
```

Also prove request publication occurs after every ordered snapshot, repeated usages get distinct deterministic filenames, tampering with any snapshot is detected, result replay is rejected, symlink/path escapes are rejected on supported platforms, and an accepted-image source is never opened for writing.

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_storyboard -- --nocapture`

Expected: FAIL because the module and functions do not exist.

- [ ] **Step 3: Implement the Rust module**

Create schema-1 request/receipt structs with `#[serde(rename_all = "camelCase", deny_unknown_fields)]`. Implement:

```rust
#[tauri::command]
pub fn prepare_codex_storyboard_job(app: tauri::AppHandle, request: PrepareCodexStoryboardJobRequest) -> Result<CodexStoryboardExportReceipt, String>;

#[tauri::command]
pub fn import_codex_storyboard_result(app: tauri::AppHandle, request: ImportCodexStoryboardResultRequest) -> Result<CodexStoryboardImportReceipt, String>;
```

Use `fs::create_dir` for exclusive package creation, `image::open(...).dimensions()` for PNG/JPEG inspection, streaming SHA-256 for every file, canonical project/asset containment, no-follow checks before writes, temp siblings plus `rename` for final JSON publication, and exact filenames from the design. On any export failure before request publication, leave no `request.json`; do not recursively delete user data.

- [ ] **Step 4: Register commands and typed desktop wrappers**

Add `mod codex_storyboard;` in `src-tauri/src/main.rs` and register:

```rust
codex_storyboard::prepare_codex_storyboard_job,
codex_storyboard::import_codex_storyboard_result,
```

Add wrappers in `desktopBridge.ts`:

```ts
export async function prepareCodexStoryboardJob(request: PrepareCodexStoryboardJobRequest): Promise<CodexStoryboardExportReceipt> {
  return invokeDesktopCommand("prepare_codex_storyboard_job", { request: createPrepareCodexStoryboardJobRequest(request) });
}

export async function importCodexStoryboardResult(request: ImportCodexStoryboardResultRequest): Promise<CodexStoryboardImportReceipt> {
  return invokeDesktopCommand("import_codex_storyboard_result", { request: createImportCodexStoryboardResultRequest(request) });
}
```

Keep the frontend `PrepareCodexStoryboardJobRequest` separate from the immutable package `CodexStoryboardRequest`: the prepare request carries absolute `sourcePath` values but no digest, dimensions, MIME type, or package-relative path. Frontend constructors must reject missing active workspace paths, non-absolute source paths, unknown usages, empty instructions, duplicate IDs, conflicting duplicate paths, and invalid job/shot IDs before invoking Tauri. Tauri alone reads the source bytes, verifies existence/containment/image metadata, computes SHA-256, assigns deterministic package-relative paths, and publishes the immutable `CodexStoryboardRequest`.

- [ ] **Step 5: Verify Rust and TypeScript boundaries**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml codex_storyboard -- --nocapture
npx tsc -b --pretty false
```

Expected: focused Rust tests PASS and TypeScript build has no new errors.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src-tauri/src/codex_storyboard.rs src-tauri/src/main.rs src/modules/platform/desktopBridge.ts
git commit -m "feat: add secure Codex storyboard handoff"
```

---

### Task 3: Storyboard state integration and request construction

**Files:**
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/storyboard-core/store.ts`
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Modify: `scripts/check-storyboard-generation-state.mjs`
- Modify: `scripts/check-storyboard-generation-flow.mjs`
- Extend: `scripts/check-codex-storyboard-task-package.mjs`

**Interfaces:**
- Consumes: current project, sequence, shot, assets, spatial frame path, and active project path.
- Produces: `buildCodexStoryboardPackageRequest`, exported task state, review-only import state, explicit acceptance through the existing completion action.

- [ ] **Step 1: Add failing state and request-construction assertions**

Extend tests to assert:

```js
const exportedTask = { ...task, stage: "exported", status: "queued", outputPath: "C:/project/codex-storyboard-jobs/job-1", externalProvider: "codex_task_package", externalJobId: "job-1" };
store.upsertGenerationTask(exportedTask);
assert.equal(store.getState().shots.find((item) => item.id === shot.id).generatedImagePath, acceptedBefore);
store.markGenerationTaskNeedsReview(exportedTask.id, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png", ["codex_candidate"]);
assert.equal(store.getState().shots.find((item) => item.id === shot.id).generatedImagePath, acceptedBefore);
store.completeGenerationTask(exportedTask.id, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png");
assert.equal(store.getState().shots.find((item) => item.id === shot.id).generatedImagePath, acceptedBefore, "needs_review remains terminal until a dedicated acceptance action");
```

Add a dedicated acceptance action assertion:

```js
store.acceptGenerationTaskCandidate(exportedTask.id);
assert.equal(store.getState().shots.find((item) => item.id === shot.id).generatedImagePath, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png");
```

For request construction, use an asset whose identity pack provides `bodyFrontPath`, `faceMasterPath`, and `approvedHeroFramePaths[0]`. Assert that default construction produces four ordered annotated references, and that appending a second `style_only` reference preserves both entries and emits distinct `Picture 4` and `Picture 5` instructions. Assert the style instructions say those images do not control composition.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node scripts/check-storyboard-generation-state.mjs
node scripts/check-storyboard-generation-flow.mjs
node scripts/check-codex-storyboard-task-package.mjs
```

Expected: FAIL on the missing `exported` stage, metadata, acceptance action, mode, and request builder.

- [ ] **Step 3: Implement state fields and acceptance action**

Extend `StoryboardGenerationStage` with `"exported"`. Add optional task fields:

```ts
externalProvider?: "codex_task_package";
externalJobId?: string;
externalRequestDigest?: string;
```

Add `acceptGenerationTaskCandidate(id)` to the store. It must require a known `needs_review` task, a known shot, a non-empty `bestPreviewPath`, then atomically set `generatedImagePath`, task `outputPath`, stage/status `completed`, and `finishedAt`. Calling `completeGenerationTask` on `needs_review` remains a no-op.

- [ ] **Step 4: Implement request construction in `comfyService.ts`**

Extend `ComfySettings.storyboardImageWorkflowMode` with `"codex_task_package"`. Export:

```ts
export function buildCodexStoryboardPackageRequest(input: {
  jobId: string;
  projectPath: string;
  project: Project;
  sequence: Sequence;
  shot: Shot;
  assets: Asset[];
  references: CodexStoryboardReferenceSelection[];
  createdAt: string;
}): PrepareCodexStoryboardJobRequest;

export function buildDefaultCodexStoryboardReferenceSelections(input: {
  shot: Shot;
  assets: Asset[];
  spatialFramePath: string;
  styleReferencePaths?: string[];
}): CodexStoryboardReferenceSelection[];
```

Define `CodexStoryboardReferenceSelection` as `{ id: string; sourcePath: string; usage: CodexStoryboardReferenceUsage; instruction: string }`. The default helper resolves exactly one shot character and its `CharacterIdentityPack`, then returns spatial authority, body/costume, face identity, and one or more explicit style references; when no explicit style list is supplied it uses the first distinct `approvedHeroFramePaths` entry. The request builder accepts any ordered list up to 16 entries, allows repeated usages, and rejects duplicate IDs, empty instructions, non-absolute source paths, conflicting duplicate paths, and missing required usages. Tauri performs file-existence and image-byte validation during export, then compiles every entry into `Picture N` in the immutable request. Build the base `stylized-concept` prompt from shot fields plus the cinematic style contract. Preserve `shot.generatedImagePath` only as `acceptedImagePath` overwrite-protection evidence.

- [ ] **Step 5: Verify GREEN**

Run the three focused Node tests again.

Expected: all PASS, including the original Comfy staged-success, partial-batch-failure, and isolated-retry assertions.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/modules/storyboard-core/types.ts src/modules/storyboard-core/store.ts src/modules/comfy-pipeline/comfyService.ts scripts/check-storyboard-generation-state.mjs scripts/check-storyboard-generation-flow.mjs scripts/check-codex-storyboard-task-package.mjs
git commit -m "feat: integrate Codex storyboard review state"
```

---

### Task 4: Selectable UI mode and explicit export/import controls

**Files:**
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
- Modify: `src/features/advanced-tools/AdvancedToolsView.tsx`
- Modify: `src/app/App.tsx`
- Create: `scripts/check-codex-storyboard-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `projectPath`, selected shot, an editable ordered list of annotated references, default identity-pack selections, request builder, desktop bridge, and store actions.
- Produces: selectable mode, export path/job ID display, copyable Codex instruction, result import, needs-review preview, accept/reject controls.

- [ ] **Step 1: Write the failing UI integration test**

Bundle/read the panel and assert:

```js
assert.match(panel, /<option value="codex_task_package">Codex 生图（任务包）<\/option>/);
assert.match(panel, /prepareCodexStoryboardJob\(/);
assert.match(panel, /importCodexStoryboardResult\(/);
assert.match(panel, /导出 Codex 任务包/);
assert.match(panel, /检查并导入结果/);
assert.match(panel, /添加参考图/);
assert.match(panel, /使用说明/);
assert.match(panel, /moveCodexReference/);
assert.match(panel, /acceptGenerationTaskCandidate/);
assert.match(panel, /Codex.*不会自动发布/);
assert.match(app, /<AdvancedPipelinePanel[^>]*projectPath=\{activeWorkspacePath\}/);
assert.match(advancedTools, /projectPath: string/);
```

Also assert settings migration retains `codex_task_package`, all other modes remain present, and the Codex branch does not call `inspectWorkflowDependencies`, `queuePrompt`, or substitute a Comfy workflow.

- [ ] **Step 2: Run UI test and verify RED**

Run: `node scripts/check-codex-storyboard-ui.mjs`

Expected: FAIL because the mode and controls are absent.

- [ ] **Step 3: Thread the active project path to the panel**

Change signatures to:

```tsx
export function AdvancedPipelinePanel({ hidden = false, projectPath }: { hidden?: boolean; projectPath: string })
export function ComfyPipelinePanel({ projectPath }: { projectPath: string })
```

Pass `activeWorkspacePath` from both App render sites. An empty path disables export with `codex_storyboard_project_path_missing`.

- [ ] **Step 4: Add mode, export, import, and review UI**

Add `codex_task_package` to `StoryboardImageWorkflowMode`, settings load/migration, the selector, and `buildStoryboardImageModeSpec`. Its model/node/plugin lists are empty and its notes state that a current Codex task is required.

When selected, replace Comfy workflow-template controls with:

```tsx
<button type="button" onClick={() => void exportSelectedCodexJob()}>导出 Codex 任务包</button>
<button type="button" onClick={() => void copyCodexJobInstruction()} disabled={!latestCodexTask?.outputPath}>复制 Codex 处理指令</button>
<button type="button" onClick={() => void importSelectedCodexResult()} disabled={!latestCodexTask?.outputPath}>检查并导入结果</button>
```

Add an ordered reference editor above the buttons. Each row has path, usage selector, required `使用说明`, move-up/move-down, and remove controls; `添加参考图` appends a row. Allow 1-16 rows and repeated usages. `从当前镜头填充默认参考` creates the initial spatial/body/face/style rows from `buildDefaultCodexStoryboardReferenceSelections`; the user supplies the spatial path, while body/face/style can prefill from the identity pack. Never infer spatial authority from `shot.generatedImagePath`. Validate the complete list before export and pass it to `buildCodexStoryboardPackageRequest` without reordering.

The export handler constructs a fresh ID with `createCodexStoryboardJobId({ shotId, now: Date.now(), randomBytes: crypto.getRandomValues(new Uint32Array(2)) })`, producing the prefix `codex-e01-c01-`, followed by base-36 milliseconds, a hyphen, and 16 hexadecimal random characters. It calls the provider and upserts an `exported/queued` task. The import handler calls the desktop bridge and then `markGenerationTaskNeedsReview` with reason `codex_candidate`. Display the candidate with explicit accept/reject buttons; acceptance calls `acceptGenerationTaskCandidate`, rejection calls the existing cancellation/rejection path and never deletes evidence.

- [ ] **Step 5: Verify UI and regression tests**

Run:

```powershell
node scripts/check-codex-storyboard-ui.mjs
node scripts/check-storyboard-generation-flow.mjs
node scripts/check-storyboard-generation-state.mjs
npm run build
```

Expected: focused checks PASS; production build completes without new warnings or errors.

Add to `package.json`:

```json
"test:codex-storyboard-ui": "node scripts/check-codex-storyboard-ui.mjs"
```

- [ ] **Step 6: Commit Task 4**

```powershell
git add src/modules/comfy-pipeline/ComfyPipelinePanel.tsx src/features/advanced-tools/AdvancedToolsView.tsx src/app/App.tsx scripts/check-codex-storyboard-ui.mjs package.json
git commit -m "feat: expose Codex storyboard task packages"
```

---

### Task 5: Codex operator CLI and fixed `E01-C01` fixture

**Files:**
- Create: `scripts/run-codex-storyboard-job.mjs`
- Create: `examples/codex-storyboard/e01-c01.json`
- Extend: `scripts/check-codex-storyboard-task-package.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: exported package directory and, for completion only, a generated local PNG path.
- Produces: verified inspection JSON or an exclusively published `outputs/candidate.png` and `outputs/result.json`.

- [ ] **Step 1: Add failing CLI contract tests**

Create a temporary valid package and run:

```powershell
$fixturePackage = Join-Path $env:TEMP 'codex-storyboard-contract-fixture'
node scripts/run-codex-storyboard-job.mjs inspect --package $fixturePackage
```

Assert stdout contains JSON with `jobId`, `shotId`, `requestDigest`, an ordered variable-length `referencedImagePaths` array, parallel usage/instruction metadata, and the compiled structured prompt. Include a repeated usage in the fixture and assert it is preserved as a distinct picture. Assert mutated reference, missing request, existing output, and path escape exit non-zero with deterministic codes.

For completion, inject a fixture PNG and assert:

```powershell
$fixturePackage = Join-Path $env:TEMP 'codex-storyboard-contract-fixture'
$fixtureCandidate = Join-Path $env:TEMP 'codex-storyboard-contract-candidate.png'
node scripts/run-codex-storyboard-job.mjs complete --package $fixturePackage --candidate $fixtureCandidate
```

The command must copy without overwrite and publish a result that the pure runtime validates.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `node scripts/check-codex-storyboard-task-package.mjs`

Expected: FAIL because the CLI and fixture do not exist.

- [ ] **Step 3: Implement the operator CLI**

Use only Node built-ins. `inspect` must read and validate the request and every ordered reference snapshot, then print the exact built-in-tool handoff with paths, usages, instructions, and `Picture N` mapping. `complete` must verify the supplied PNG signature and dimensions, create `outputs`, use exclusive `wx` writes/copies, calculate SHA-256, and write `result.json` last through a same-directory temporary file plus rename. It must never call OpenAI or any other network service.

- [ ] **Step 4: Add the `E01-C01` fixture selection**

Create `examples/codex-storyboard/e01-c01.json` with:

```json
{
  "schemaVersion": 1,
  "projectId": "yingdi-storyboard",
  "episodeId": "E01",
  "shotId": "E01-C01",
  "characterAssetId": "li-baozhu",
  "references": [
    {
      "id": "spatial-main",
      "path": ".superpowers/sdd/e01-c01-depth-refcontrol-20260827-v1/outputs/run-20260827-125315-241-7e50d4f6/container/color.png",
      "usage": "spatial_authority",
      "instruction": "锁定机位、棺木几何、人物投影位置、姿态、构图和遮挡关系。"
    },
    {
      "id": "style-main",
      "path": "影帝他总想对我图谋不轨_漫剧改编/分镜/E01-01/f1.png",
      "usage": "style_only",
      "instruction": "只参考材质、光影和电影感中式半写实 3D 动画语言，不沿用近景构图。"
    }
  ]
}
```

The fixture loader inserts Li Baozhu's persisted body and face identity references after the spatial reference and before the style references. It preserves the user-authored order of all other entries and allows more annotated entries to be added without a schema change.

- [ ] **Step 5: Verify GREEN and register CLI**

Run: `node scripts/check-codex-storyboard-task-package.mjs`

Expected: PASS.

Add:

```json
"codex:storyboard-job": "node scripts/run-codex-storyboard-job.mjs"
```

- [ ] **Step 6: Commit Task 5**

```powershell
git add scripts/run-codex-storyboard-job.mjs examples/codex-storyboard/e01-c01.json scripts/check-codex-storyboard-task-package.mjs package.json
git commit -m "feat: add Codex storyboard operator bridge"
```

---

### Task 6: Live `E01-C01` built-in generation and review-only import

**Files:**
- Create at runtime: `codex-storyboard-jobs/{jobId}/request.json` below the active project directory
- Create at runtime: `codex-storyboard-jobs/{jobId}/outputs/candidate.png` below the active project directory
- Create at runtime: `codex-storyboard-jobs/{jobId}/outputs/result.json` below the active project directory
- Create: `docs/superpowers/verification/2026-08-28-codex-storyboard-e01-c01.md`

**Interfaces:**
- Consumes: the implemented exporter, operator CLI inspection JSON, Codex built-in image generation, importer, and existing review gate.
- Produces: one auditable `E01-C01` candidate in `needs_review`, with the previously accepted image unchanged.

- [ ] **Step 1: Run all deterministic preflight tests**

```powershell
npm run test:codex-storyboard-package
npm run test:codex-storyboard-ui
node scripts/check-storyboard-generation-flow.mjs
node scripts/check-storyboard-generation-state.mjs
cargo test --manifest-path src-tauri/Cargo.toml codex_storyboard -- --nocapture
npm run build
```

Expected: all commands PASS before a live image call.

- [ ] **Step 2: Export a fresh package for `E01-C01`**

Use the application UI with `Codex 生图（任务包）`, selected shot `E01-C01`, and the active project path. Fill the initial four ordered rows from the fixture and identity pack, verify each row's usage and instruction, then export. Optionally add extra annotated references to prove the variable-length UI; the first live baseline may remain at four. Record the returned job ID and package path. Verify `request.json` is present, `outputs` is absent or empty, and the accepted shot path is unchanged. Copy the package path, open one persistent PowerShell terminal, and initialize `$packagePath = (Get-Clipboard).Trim()`; keep that terminal open through Step 5.

- [ ] **Step 3: Inspect the package and load every reference image**

Run:

```powershell
npm run codex:storyboard-job -- inspect --package $packagePath
```

Use `view_image` on every absolute path returned by inspection. Verify that its displayed `Picture N`, usage, and instruction match request order. The initial baseline labels spatial authority, body/costume, face identity, and style-only reference; additional entries retain their own annotations.

- [ ] **Step 4: Call Codex built-in image generation once**

Call the built-in tool with every inspected local path, in request order, and the exact compiled prompt. Use `referenced_image_paths`; do not use CLI/API fallback. The prompt taxonomy is `stylized-concept`, asset type is `AI comic-drama storyboard frame`, and every `Picture N` is governed by its own usage and instruction. For the initial four-reference baseline, Picture 1 is the immutable camera/geometry authority, Pictures 2/3 control Li Baozhu, and Picture 4 controls style only.

Expected: one generated candidate displayed in the Codex task. Copy the exact absolute path returned by image generation, return to the persistent PowerShell terminal, and initialize `$generatedImagePath = (Get-Clipboard).Trim()`.

- [ ] **Step 5: Publish the candidate into the package**

Run in the same persistent PowerShell terminal:

```powershell
npm run codex:storyboard-job -- complete --package $packagePath --candidate $generatedImagePath
```

Expected: `outputs/candidate.png` and `outputs/result.json` are created without replacing any existing file.

- [ ] **Step 6: Import and prove review-only state**

Click `检查并导入结果`. Assert the task is `needs_review`, `bestPreviewPath` equals the package candidate, and `generatedImagePath` still equals its pre-run accepted path. Do not click acceptance until the user reviews the image.

- [ ] **Step 7: Write verification evidence**

Record in `docs/superpowers/verification/2026-08-28-codex-storyboard-e01-c01.md`:

- commit IDs for Tasks 1-5
- exact package path and job ID
- request digest and every ordered reference ID, usage, instruction, and digest
- final prompt
- candidate digest, dimensions, and path
- deterministic test commands and results
- pre-import accepted path and post-import unchanged accepted path
- task state `needs_review`
- visual notes for subject count, camera, coffin, anatomy, costume, identity, and style

- [ ] **Step 8: Commit verification evidence only**

```powershell
git add docs/superpowers/verification/2026-08-28-codex-storyboard-e01-c01.md
git commit -m "test: verify Codex E01 C01 storyboard handoff"
```

Do not commit generated project media unless the user explicitly requests repository storage.

---

## Final Verification

- [ ] Run `git diff --check` for every task-owned change.
- [ ] Run all new focused tests and the existing storyboard flow/state tests.
- [ ] Run the focused Rust module tests and `npm run build`.
- [ ] Confirm no Comfy provider setting or workflow JSON was removed or rewritten.
- [ ] Confirm no API key field, OpenAI network client, watcher, automation, or batch mode was added.
- [ ] Confirm the live candidate is inside the active project package and not only under the Codex generated-image directory.
- [ ] Confirm `E01-C01` remains `needs_review` until the user explicitly accepts it.
