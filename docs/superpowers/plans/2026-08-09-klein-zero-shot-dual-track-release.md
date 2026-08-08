# Klein Zero-Shot / LoRA Dual-Track Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an eight-shot, evidence-bearing FLUX.2 Klein 4B multi-reference benchmark to unlock local production without a character LoRA, while preserving the existing LoRA release gate as a stricter independent track.

**Architecture:** Extend the existing benchmark evidence envelope with an explicit generation mode and content-addressed identity-reference manifest. Keep one validator/importer with mode-specific invariants, store zero-shot evidence on the character asset and LoRA evidence on the LoRA profile, and resolve production mode from revalidated evidence rather than mutable UI state. The benchmark runner remains the sole evidence issuer and uses a pinned local SigLIP2 worker for reference-aware automatic scoring.

**Tech Stack:** TypeScript 5.6, React 18, dependency-free ESM runtime modules, Node.js benchmark CLI, ComfyUI Desktop API, Python 3.13 from ComfyUI Desktop, PyTorch 2.10, Transformers 5.8, `google/siglip2-base-patch16-224`.

## Global Constraints

- Target hardware is NVIDIA RTX 5070 Ti 16GB with about 48GB system RAM and ComfyUI Desktop.
- The exact production checkpoint is `flux-2-klein-4b-fp8.safetensors`.
- Generation modes are exactly `zero_shot_multi_reference` and `lora_augmented`.
- Zero-shot evidence must contain no active character LoRA on any final `MODEL` path; LoRA evidence keeps the existing all-consumer terminal-path proof.
- Both modes require eight accepted model-generated shots, current identity references, exact workflow/model proof, and a versioned evaluator proof.
- Old reports and existing visual smoke outputs are diagnostic only and are never auto-promoted.
- No manual UI control may set either mode to ready.
- All behavior changes use red-green TDD and preserve the existing LoRA test suite.

## File Structure

- `src/modules/storyboard-core/types.ts`: shared generation-mode, evidence, reference-manifest, and asset storage types.
- `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`: canonical evidence payloads, digests, import, mode-specific validation, and invalidation reasons.
- `src/modules/asset-manager/characterIdentityUi.ts`: typed facade for evidence runtime functions.
- `scripts/run-character-consistency-benchmark.mjs`: mode-aware CLI, project subject/reference loading, workflow proof, evaluator context, and report issuance.
- `scripts/prepare-character-reference.py`: deterministic PIL crop/mirror preprocessing for references before Comfy upload.
- `scripts/evaluators/siglip2-character-worker.py`: persistent GPU/CPU image-embedding worker.
- `scripts/evaluators/siglip2-character-evaluator.mjs`: trusted ESM evaluator loaded by the benchmark runner.
- `scripts/check-character-generation-evidence.mjs`: focused dual-track evidence tests.
- `scripts/check-character-siglip2-evaluator.mjs`: evaluator protocol, weighting, threshold, and fail-closed tests with an injected deterministic worker.
- `src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs`: production track selection and application.
- `src/modules/asset-manager/characterIdentityUiRuntime.mjs`: independent evidence invalidation helpers.
- `src/modules/asset-manager/AssetPanel.tsx`: import and display of zero-shot and LoRA evidence.
- `scripts/check-character-identity-ui.mjs`: UI and import regression tests.
- `scripts/check-sequential-character-passes.mjs`: production resolver regression tests.
- `examples/character-consistency-benchmark/benchmark.json`: reference routing and evaluator policy for all eight shots.
- `examples/character-consistency-benchmark/siglip2-evaluator.example.json`: pinned evaluator/model policy.
- `package.json`: focused test scripts.
- `docs/comfyui-storyboard-setup.md`: operator commands and release interpretation.

---

### Task 1: Mode-Aware Evidence Envelope

**Files:**
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`
- Modify: `src/modules/asset-manager/characterIdentityUi.ts`
- Create: `scripts/check-character-generation-evidence.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `CharacterGenerationMode`, `CharacterIdentityReferenceEvidence`, `CharacterGenerationEvidence`.
- Produces: `validateStoredCharacterGenerationEvidence(evidence, context)` and `importCharacterGenerationEvidence(report, context, options)`.
- Preserves: existing `CharacterBenchmarkEvidence` exports as aliases during migration.

- [ ] **Step 1: Write the failing evidence tests**

Create `scripts/check-character-generation-evidence.mjs` with fixtures for one valid zero-shot report and one valid LoRA report. Assert the mode-specific boundaries explicitly:

```js
assert.equal(validateCharacterGenerationReport(validZeroShotReport).valid, true);
assert.equal(importCharacterGenerationEvidence(validZeroShotReport, zeroShotContext).valid, true);
assert.equal(validateCharacterGenerationReport({
  ...validZeroShotReport,
  preflight: { providerProof: validLoraReport.preflight.providerProof }
}).valid, false, "zero-shot evidence rejects any active terminal LoRA");
assert.equal(importCharacterGenerationEvidence(validLoraReport, loraContext).valid, true);
assert.equal(
  validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, identityPackVersion: "v2" }).reason,
  "identity_version_mismatch"
);
assert.equal(
  validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, referenceManifestDigest: "f".repeat(64) }).reason,
  "reference_manifest_mismatch"
);
assert.equal(
  validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, evaluatorImplementationHash: "e".repeat(64) }).reason,
  "evaluator_implementation_mismatch"
);
```

The fixture must also mutate generation mode, provider, exact model, workflow digest, fixture digest, each reference digest/transform, evaluator ID/version/policy hash, one shot status, provenance, fallback flag, dimension threshold, and evidence digest, asserting a stable rejection reason for each mutation.

Add one frozen pre-change LoRA evidence fixture with no `generationMode`. Assert that the compatibility validator accepts it only through the legacy LoRA branch, returns `legacy: true`, and never exposes it as zero-shot evidence. A newly imported report must always use the new envelope.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/check-character-generation-evidence.mjs`

Expected: FAIL because `validateCharacterGenerationReport`, `importCharacterGenerationEvidence`, and the new mode-aware types do not exist.

- [ ] **Step 3: Add the shared types**

Add these shapes to `src/modules/storyboard-core/types.ts`; LoRA-only fields remain optional but are required by the LoRA validator:

```ts
export type CharacterGenerationMode = "zero_shot_multi_reference" | "lora_augmented";

export type CharacterIdentityReferenceEvidence = {
  shotId: "front_close" | "three_quarter_medium" | "left_profile" | "right_profile" | "back_view" | "full_body_action" | "strong_expression" | "different_lighting";
  slot: "face_master" | "face_left" | "face_right" | "hair_back" | "body_front" | "body_side" | "body_back" | "expression_neutral";
  sourceSha256: string;
  transformedSha256: string;
  transform: "none" | "mirror_x" | "head_shoulders_crop";
};

export type CharacterShotEvidence = {
  id: CharacterIdentityReferenceEvidence["shotId"];
  outputSha256: string;
  score: number;
  dimensionScores: Record<"face" | "hair" | "outfit" | "body" | "quality", number>;
  retries: number;
  finalStatus: "accepted";
  provenance: "model_generation";
  actualProvider: "qwen_image_edit_2511" | "flux2_klein_4b";
  terminalOutputNode: string;
};

export type CharacterGenerationEvidence = {
  reportLabel: string;
  evidenceDigest: string;
  generationMode: CharacterGenerationMode;
  benchmarkVersion: string;
  promptTemplateVersion: string;
  fixtureDigest: string;
  generationParametersDigest: string;
  characterAssetId: string;
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  identityPackVersion: string;
  referenceManifestDigest: string;
  references: CharacterIdentityReferenceEvidence[];
  modelName: string;
  workflowDigest: string;
  terminalOutputNode: string;
  terminalModel: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
  shots: CharacterShotEvidence[];
  aggregateScore: number;
  acceptedShots: 8;
  verifiedAt: string;
  importedAt: string;
  loraName?: string;
  loraVersion?: string;
  loraStrength?: number;
  candidateStatus?: "dataset_ready" | "training";
  terminalLoraName?: string;
  terminalLoraStrengthModel?: number;
  terminalLoraStrengthClip?: number | null;
  terminalLoraClassType?: "LoraLoader" | "LoraLoaderModelOnly";
  terminalLoraClipPolicy?: "equal_to_model" | "not_applicable";
};

export type CharacterBenchmarkEvidence = CharacterGenerationEvidence;
```

Add `characterZeroShotEvidence?: CharacterGenerationEvidence` to `Asset`; retain `CharacterLoraProfile.benchmarkEvidence` for migration compatibility.

- [ ] **Step 4: Implement canonical payloads and mode-specific validation**

In `characterBenchmarkEvidenceRuntime.mjs`, add mode constants and make the digest include every security-relevant field:

```js
export const CHARACTER_GENERATION_MODES = Object.freeze([
  "zero_shot_multi_reference",
  "lora_augmented"
]);

const modeHasValidLora = (mode, subject, proof) => mode === "lora_augmented"
  ? validateRequiredTerminalLora(subject, proof)
  : noActiveTerminalLora(subject, proof);

export function validateCharacterGenerationReport(report) {
  const eligible = isCharacterGenerationEvidenceEligible(report);
  const expectedDigest = eligible ? recomputeCharacterGenerationEvidenceDigest(report) : null;
  return {
    valid: eligible && report?.evidenceDigest === expectedDigest,
    eligible,
    expectedDigest
  };
}
```

`noActiveTerminalLora` must require `subject.loraName/loraVersion/loraStrength/candidateStatus` to be absent and `providerProof.authoritativeLoraBindings` to be an empty array. The LoRA branch must call the existing terminal-path checks without loosening strength, class, clip-policy, or all-consumer requirements. Validate reference entries as nonempty, unique `shotId + slot` pairs with 64-character source and transformed SHA-256 values plus allowed transforms. Require all eight ordered shot records, 64-character output hashes, finite scores, all five finite dimension scores, accepted/model-generation provenance, exact provider and terminal output node. Bind the sorted reference entries, prompt template version, generation-parameter digest, complete shot records, aggregate score, and `referenceManifestDigest` into stored/report digests.

Export compatibility aliases:

```js
export const validateCharacterBenchmarkEvidence = validateCharacterGenerationReport;
export const importCharacterBenchmarkEvidence = importCharacterGenerationEvidence;
export const recomputeCharacterBenchmarkEvidenceDigest = recomputeCharacterGenerationEvidenceDigest;
```

Keep the current stored-evidence validator body as `validateLegacyStoredCharacterBenchmarkEvidence`. The public dispatcher calls it only when `generationMode` is absent and the caller requests `lora_augmented`; zero-shot contexts reject legacy evidence with `legacy_evidence_not_zero_shot`. This preserves already-valid LoRA assets without granting them any new capability. The next accepted LoRA benchmark replaces the legacy envelope with the new format.

- [ ] **Step 5: Run RED-to-GREEN verification**

Run: `node scripts/check-character-generation-evidence.mjs`

Expected: PASS and print `character generation evidence checks passed`.

Run: `npm.cmd run test:character-identity-ui` and `npm.cmd run test:sequential-character-passes`

Expected: both PASS, proving legacy LoRA evidence behavior remains intact.

- [ ] **Step 6: Register and commit the focused test**

Add to `package.json`:

```json
"test:character-generation-evidence": "node scripts/check-character-generation-evidence.mjs"
```

Commit only task-owned files:

```powershell
git add -- src/modules/storyboard-core/types.ts src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs src/modules/asset-manager/characterIdentityUi.ts scripts/check-character-generation-evidence.mjs package.json
git commit -m "feat: add dual-track character evidence"
```

---

### Task 2: Zero-Shot Benchmark Mode and Reference Manifest

**Files:**
- Modify: `scripts/run-character-consistency-benchmark.mjs`
- Create: `scripts/prepare-character-reference.py`
- Modify: `scripts/check-character-consistency-benchmark.mjs`
- Modify: `examples/character-consistency-benchmark/benchmark.json`
- Modify: `examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json`

**Interfaces:**
- Consumes: `CharacterGenerationMode` values and evidence validator from Task 1.
- Produces: `loadIdentityReferenceManifest`, `routeShotIdentityReferences`, and mode-aware `compileBenchmarkWorkflow`.
- Produces benchmark reports containing `generationMode`, `referenceManifest`, and `referenceManifestDigest`.

- [ ] **Step 1: Add failing CLI, project, reference, and workflow tests**

Extend `scripts/check-character-consistency-benchmark.mjs` with these assertions:

```js
const zeroArgs = parseBenchmarkCliArgs([
  "--mode", "zero-shot", "--project", projectPath,
  "--character", "asset_ada", "--provider", "flux2_klein_4b",
  "--base-url", "http://127.0.0.1:8188", "--output", outputPath,
  "--workflow", workflowPath, "--evaluator-module", evaluatorPath
]);
assert.equal(zeroArgs.generationMode, "zero_shot_multi_reference");
assert.deepEqual(zeroArgs.workflowTokens.ACTIVE_LORA_NAME, undefined);
assert.equal(zeroSubject.subject.loraName, undefined);
assert.equal(zeroSubject.identityReferenceManifest.length >= 3, true);
assert.equal(zeroSubject.identityReferenceManifest.every((item) => /^[a-f0-9]{64}$/.test(item.sourceSha256)), true);
assert.throws(
  () => compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", ...loraWorkflowInput }),
  (error) => error?.code === "EZERO_SHOT_LORA"
);
```

Add routing expectations: front/strong-expression use `head_shoulders_crop`, the missing opposite profile uses `mirror_x`, back uses hair/body back, and full-body action uses body references. Assert that changing one image byte or one transform changes `referenceManifestDigest`.

Use an injected fake transformer/uploader in tests to assert that exactly two routed references are preprocessed serially, uploaded through Comfy's `/upload/image` endpoint under content-addressed names, and compiled into `REFERENCE_IMAGE_A` and `REFERENCE_IMAGE_B`. Assert that a failed transform/upload stops before `/prompt` and cannot issue evidence.

- [ ] **Step 2: Run the benchmark test and verify RED**

Run: `npm.cmd run test:character-benchmark`

Expected: FAIL because `--mode` and the reference manifest are unsupported.

- [ ] **Step 3: Implement explicit mode parsing and project loading**

Extend the CLI allow-list and return shape:

```js
const CLI_MODES = Object.freeze({
  "zero-shot": "zero_shot_multi_reference",
  lora: "lora_augmented"
});

if (!CLI_MODES[values.mode]) {
  throw fail("EMODE", "--mode must be zero-shot or lora");
}

return {
  ...parsed,
  generationMode: CLI_MODES[values.mode]
};
```

Change `loadBenchmarkProjectSubject` so both modes require a complete identity pack. Only `lora_augmented` reads and validates `characterLora`; the zero-shot subject contains no LoRA fields and emits no active LoRA tokens. Resolve each reference with `realpath`, require a regular `.png`, `.jpg`, `.jpeg`, or `.webp` file no larger than 40 MiB, hash its bytes, and never copy the original absolute path into the published report.

- [ ] **Step 4: Implement deterministic shot routing**

Add transform metadata to each benchmark shot:

```json
"promptTemplateVersion": "klein-character-v2",
"referencePolicy": {
  "preferredSlots": ["face_master", "body_front"],
  "transforms": { "face_master": "head_shoulders_crop", "body_front": "none" }
}
```

Use explicit policies for all eight shots. Each policy resolves exactly two logical slots. `routeShotIdentityReferences(shot, manifest)` must fail with `EREFERENCE_REQUIRED` when either slot is unavailable, except that `face_left` may satisfy `face_right` and vice versa with an explicit `mirror_x` transform. Return a sorted, immutable two-entry list so reference order is deterministic.

Implement `scripts/prepare-character-reference.py` with `--input`, `--output`, and `--transform`. `none` converts to RGB PNG without changing composition, `mirror_x` uses `ImageOps.mirror`, and `head_shoulders_crop` takes the centered full width and top 58% of the image before resizing the longest edge to 768 with Lanczos. Refuse images above 8192×8192 and write only to an exclusively reserved staging path. The Node runner hashes the transformed bytes, uploads them as `character-benchmark/<transformed-sha256>.png` using multipart form data with `overwrite=false`, and records source hash, transformed hash, logical slot, and transform in the public evidence manifest while omitting absolute paths.

- [ ] **Step 5: Enforce workflow mode at the final model consumers**

Pass `generationMode` into `compileBenchmarkWorkflow`. After tracing every final model consumer, enforce:

```js
if (generationMode === "zero_shot_multi_reference" && authoritativeLoraBindings.length > 0) {
  throw fail("EZERO_SHOT_LORA", "zero-shot workflow contains an active terminal character LoRA");
}
if (generationMode === "lora_augmented" && !allConsumersHaveApprovedLora) {
  throw fail("EPROVIDER_PROOF", "character_lora_binding_missing");
}
```

Update the Klein API workflow to require `{{REFERENCE_IMAGE_A}}` and `{{REFERENCE_IMAGE_B}}` in two `LoadImage` branches. Encode both with the same VAE, chain two `ReferenceLatent` nodes on positive conditioning and two on zeroed negative conditioning, and retain the exact `UNETLoader` model binding. Keep `{{PROMPT}}`, `{{SEED}}`, and the existing shot metadata tokens active in the terminal ancestry. Do not introduce a LoRA node in the zero-shot workflow.

- [ ] **Step 6: Bind manifest and mode into reports**

Construct reports with:

```js
const report = {
  generationMode,
  promptTemplateVersion: String(fixture.promptTemplateVersion),
  generationParametersDigest: hash(stable(compiled.generationParameters)),
  referenceManifest: safeReferenceManifest(options.identityReferenceManifest),
  referenceManifestDigest: hash(stable(options.identityReferenceManifest)),
  ...existingReportFields
};
```

Pass each shot's routed references to the workflow compiler and evaluator. The published manifest includes slot, SHA-256, transform, and sanitized logical label only; it excludes local absolute paths.

- [ ] **Step 7: Run tests and commit**

Run: `npm.cmd run test:character-benchmark`

Expected: PASS, including old LoRA terminal-path attacks and new zero-shot rejection cases.

```powershell
git add -- scripts/run-character-consistency-benchmark.mjs scripts/prepare-character-reference.py scripts/check-character-consistency-benchmark.mjs examples/character-consistency-benchmark/benchmark.json examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json
git commit -m "feat: benchmark zero-shot character references"
```

---

### Task 3: Trusted Local SigLIP2 Evaluator

**Files:**
- Create: `scripts/evaluators/siglip2-character-worker.py`
- Create: `scripts/evaluators/siglip2-character-evaluator.mjs`
- Create: `scripts/check-character-siglip2-evaluator.mjs`
- Create: `examples/character-consistency-benchmark/siglip2-evaluator.example.json`
- Modify: `scripts/run-character-consistency-benchmark.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: ESM exports `evaluatorId`, `evaluatorVersion`, `evaluatorPolicyHash`, `evaluateCharacterShot(context)`, and `closeEvaluator()`.
- Consumes from runner: local staged output path, routed local reference paths, shot ID/scale/view, required dimensions, provider proof, and abort signal.
- Python worker protocol: one JSON object per input/output line, request IDs echoed exactly.

- [ ] **Step 1: Write failing evaluator protocol and scoring tests**

Create `scripts/check-character-siglip2-evaluator.mjs` using an injected worker that returns fixed normalized embeddings. Cover weighted scoring and all hard failures:

```js
const result = await createSiglip2Evaluator({ worker: fakeWorker, policy }).evaluateCharacterShot(context);
assert.deepEqual(Object.keys(result.dimensionScores).sort(), ["body", "face", "hair", "outfit", "quality"]);
assert.equal(result.provenance, "model_generation");
assert.equal(result.actualProvider, "flux2_klein_4b");
assert.equal(result.status, "accepted");

await assert.rejects(() => evaluator.evaluateCharacterShot({ ...context, outputPath: "" }), /output/i);
await assert.rejects(() => evaluator.evaluateCharacterShot({ ...context, references: [] }), /reference/i);
await assert.rejects(() => evaluator.evaluateCharacterShot({ ...context, workerModelRevision: "wrong" }), /revision/i);
assert.equal(lowQuality.status, "needs_review");
assert.deepEqual(lowQuality.failureDimensions, ["quality"]);
```

Also assert timeout/cancellation kills the worker, malformed NDJSON fails closed, non-finite embeddings are rejected, model/policy hashes are reported, and no score supplied by the caller is trusted.

- [ ] **Step 2: Run the evaluator test and verify RED**

Run: `node scripts/check-character-siglip2-evaluator.mjs`

Expected: FAIL because the evaluator module is absent.

- [ ] **Step 3: Implement the persistent Python embedding worker**

Implement a line-oriented worker that loads the pinned model once:

```py
MODEL_ID = "google/siglip2-base-patch16-224"
MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
MODEL_DIR = r"C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\character_evaluators\siglip2-base-patch16-224-75de2d5"

processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)
model = AutoModel.from_pretrained(MODEL_DIR, local_files_only=True).eval().to(device)

def embed(path_value):
    image = Image.open(path_value).convert("RGB")
    inputs = processor(images=image, return_tensors="pt").to(device)
    with torch.inference_mode():
        vector = model.get_image_features(**inputs)[0].float().cpu()
    vector = vector / vector.norm().clamp_min(1e-12)
    return vector.tolist()
```

Validate every request path as an existing regular image before opening it, cap decoded dimensions at 8192×8192, reject decompression-bomb warnings, and return `{ "id", "ok", "embedding" }` or a sanitized `{ "id", "ok": false, "errorCode" }`. The worker never downloads at runtime; missing cached weights produce `EMODEL_MISSING`.

- [ ] **Step 4: Implement deterministic dimension scoring**

The ESM evaluator starts the worker with the ComfyUI Python path from `COMFYUI_PYTHON` or the detected Desktop `.venv`. It computes cosine similarities for the routed reference set, maps cosine from `[-1, 1]` to `[0, 1]`, and uses the policy file:

```json
{
  "evaluatorId": "siglip2-character-consistency",
  "evaluatorVersion": "1.0.0",
  "modelId": "google/siglip2-base-patch16-224",
  "modelRevision": "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  "dimensionFloors": { "face": 0.78, "hair": 0.76, "outfit": 0.74, "body": 0.72, "quality": 0.8 },
  "weightsByScale": {
    "close": { "face": 0.42, "hair": 0.28, "outfit": 0.08, "body": 0.04, "quality": 0.18 },
    "medium": { "face": 0.28, "hair": 0.24, "outfit": 0.2, "body": 0.12, "quality": 0.16 },
    "full_body": { "face": 0.08, "hair": 0.2, "outfit": 0.25, "body": 0.29, "quality": 0.18 }
  }
}
```

Download and load only Hugging Face revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`, and include that exact SHA in `evaluatorPolicyHash`. `quality` is computed from deterministic sharpness, clipping, entropy, and decoded-image checks in the Python worker; it must not be inferred from reference similarity. A required dimension below its floor returns `needs_review` even if the weighted average passes.

Compute `evaluatorImplementationHash` from the exact bytes of `siglip2-character-evaluator.mjs`, `siglip2-character-worker.py`, the policy JSON, and the pinned model revision string. `loadTrustedEvaluator` must use this exported content hash instead of treating a hash of the module path as implementation proof.

- [ ] **Step 5: Stage Comfy outputs for local evaluation**

Extend the runner transport with `getBytes`, download only the sanitized proven terminal `/view` URL, enforce `image/png`, `image/jpeg`, or `image/webp` and a 40 MiB limit, and save with exclusive creation beneath the benchmark report's sibling artifact directory. Pass this local path to the evaluator and record only its SHA-256 plus sanitized Comfy artifact in the report.

- [ ] **Step 6: Install the pinned evaluator snapshot**

With approval for the external model directory and network download, run:

```powershell
& 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe' -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='google/siglip2-base-patch16-224', revision='75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2', local_dir=r'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\character_evaluators\siglip2-base-patch16-224-75de2d5')"
```

Expected: the local directory contains `config.json`, processor/tokenizer files, and model safetensors from exactly the pinned revision. The worker still uses `local_files_only=True`, so production scoring never silently upgrades or downloads.

- [ ] **Step 7: Run tests and a local model-load smoke check**

Run: `node scripts/check-character-siglip2-evaluator.mjs`

Expected: PASS with the injected worker and no network access.

After the model snapshot is installed, run:

```powershell
& 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe' scripts/evaluators/siglip2-character-worker.py --self-test
```

Expected: one JSON line with `"ok": true`, CUDA when available, exact model ID, exact revision, and a finite normalized embedding length.

- [ ] **Step 8: Register and commit**

Add:

```json
"test:character-evaluator": "node scripts/check-character-siglip2-evaluator.mjs"
```

```powershell
git add -- scripts/evaluators/siglip2-character-worker.py scripts/evaluators/siglip2-character-evaluator.mjs scripts/check-character-siglip2-evaluator.mjs examples/character-consistency-benchmark/siglip2-evaluator.example.json scripts/run-character-consistency-benchmark.mjs package.json
git commit -m "feat: score character consistency with local SigLIP2"
```

---

### Task 4: Production Track Resolution and Independent Invalidation

**Files:**
- Modify: `src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs`
- Modify: `src/modules/asset-manager/characterIdentityUiRuntime.mjs`
- Modify: `src/modules/asset-manager/characterIdentityUi.ts`
- Modify: `scripts/check-sequential-character-passes.mjs`
- Modify: `scripts/check-character-identity-ui.mjs`

**Interfaces:**
- Produces: `resolveCharacterGenerationTrack(input)` returning `{ mode, providerId, modelName, appliedLora } | null`.
- Produces: `invalidateCharacterGenerationEvidence(asset, changeKind)` with independent mode effects.
- Preserves: `resolveAppliedCharacterLora` as a compatibility wrapper.

- [ ] **Step 1: Add failing resolver and invalidation tests**

Add exact priority and invalidation assertions:

```js
assert.deepEqual(resolveCharacterGenerationTrack(validZeroAsset), {
  mode: "zero_shot_multi_reference",
  providerId: "flux2_klein_4b",
  modelName: "flux-2-klein-4b-fp8.safetensors",
  appliedLora: null
});
assert.equal(resolveCharacterGenerationTrack(staleZeroAsset), null);
assert.equal(resolveCharacterGenerationTrack(assetWithBoth).mode, "lora_augmented");
const afterLoraEdit = invalidateCharacterGenerationEvidence(assetWithBoth, "lora");
assert.equal(afterLoraEdit.characterZeroShotEvidence.evidenceDigest, zeroDigest);
assert.equal(afterLoraEdit.characterLora.benchmarkEvidence.evidenceDigest, loraDigest, "stale evidence remains auditable");
assert.equal(validateStoredCharacterGenerationEvidence(afterLoraEdit.characterLora.benchmarkEvidence, afterLoraEdit.currentLoraContext).valid, false);
const afterIdentityEdit = invalidateCharacterGenerationEvidence(assetWithBoth, "identity");
assert.equal(afterIdentityEdit.characterZeroShotEvidence.evidenceDigest, zeroDigest);
assert.equal(afterIdentityEdit.characterLora.benchmarkEvidence.evidenceDigest, loraDigest);
assert.equal(validateStoredCharacterGenerationEvidence(afterIdentityEdit.characterZeroShotEvidence, afterIdentityEdit.currentZeroContext).valid, false);
```

Also test model/workflow/evaluator/reference changes invalidate both tracks, while a LoRA filename/strength/status change invalidates only LoRA evidence.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd run test:sequential-character-passes` and `npm.cmd run test:character-identity-ui`

Expected: at least one FAIL because the generic track resolver and zero-shot storage are absent.

- [ ] **Step 3: Implement fail-closed production selection**

Implement:

```js
export function resolveCharacterGenerationTrack(input = {}) {
  const lora = resolveValidatedLoraTrack(input);
  if (lora) return lora;
  const zero = validateStoredCharacterGenerationEvidence(input.characterZeroShotEvidence, {
    generationMode: "zero_shot_multi_reference",
    ...input.currentEvidenceContext
  });
  return zero.valid ? {
    mode: "zero_shot_multi_reference",
    providerId: input.providerId,
    modelName: input.modelName,
    appliedLora: null
  } : null;
}
```

Prefer LoRA only when its evidence matches the same current identity version; otherwise allow a still-valid zero-shot track. Never fall back from a malformed/tampered LoRA workflow into zero-shot if the compiled workflow contains an active LoRA.

- [ ] **Step 4: Implement independent invalidation**

Add change kinds `identity`, `reference`, `provider`, `model`, `workflow`, `fixture`, `evaluator`, and `lora`. Evidence objects are immutable audit history and are not deleted on configuration edits. All except `lora` change the current validation context so both tracks report their exact mismatch reason. `lora` changes only the LoRA context and downgrades LoRA status to `dataset_ready` or `unconfigured`; the zero-shot context and validation stay unchanged. A later imported report explicitly replaces only the matching track's stale evidence.

- [ ] **Step 5: Run regression tests and commit**

Run: `npm.cmd run test:sequential-character-passes`

Expected: PASS, including all existing terminal MODEL path proof cases.

Run: `npm.cmd run test:character-identity-ui`

Expected: PASS.

```powershell
git add -- src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs src/modules/asset-manager/characterIdentityUiRuntime.mjs src/modules/asset-manager/characterIdentityUi.ts scripts/check-sequential-character-passes.mjs scripts/check-character-identity-ui.mjs
git commit -m "feat: resolve verified character generation tracks"
```

---

### Task 5: Dual-Track Asset UI

**Files:**
- Modify: `src/modules/asset-manager/AssetPanel.tsx`
- Modify: `src/styles/global.css`
- Modify: `scripts/check-character-identity-ui.mjs`
- Modify: `scripts/check-character-consistency-ui.mjs`

**Interfaces:**
- Consumes: mode-aware import/validation and independent invalidation from Tasks 1 and 4.
- Produces: separate zero-shot and LoRA evidence imports, read-only badges, and specific invalidation messages.

- [ ] **Step 1: Write failing UI source-contract tests**

Require accessible labels and read-only status text:

```js
assert.match(editor, /导入零样本基准证据/);
assert.match(editor, /导入 LoRA 基准证据/);
assert.match(editor, /零样本已验证/);
assert.match(editor, /LoRA 已验证/);
assert.match(editor, /待复核/);
assert.match(editor, /证据已失效/);
assert.doesNotMatch(editor, /设为已就绪|手动就绪/);
assert.match(editor, /reference_manifest_mismatch/);
assert.match(editor, /evaluator_implementation_mismatch/);
```

Assert a zero-shot report cannot be imported into the LoRA slot and vice versa, and that changing LoRA controls leaves the displayed valid zero-shot badge intact.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm.cmd run test:character-identity-ui` and `npm.cmd run test:character-consistency-ui`

Expected: FAIL on missing dual-track controls/statuses.

- [ ] **Step 3: Implement separate imports and validation contexts**

Replace the single importer with:

```ts
const onImportCharacterGenerationEvidence = async (
  asset: Asset,
  mode: CharacterGenerationMode,
  file?: File
) => {
  const report = JSON.parse(await file!.text());
  const result = importCharacterGenerationEvidence(report, resolveEvidenceContext(asset, mode));
  if (!result.valid || !result.evidence) return setEvidenceError(asset.id, result.reason);
  if (mode === "zero_shot_multi_reference") {
    updateAsset(asset.id, { characterZeroShotEvidence: result.evidence });
  } else {
    updateAsset(asset.id, { characterLora: { ...asset.characterLora!, status: "ready", benchmarkEvidence: result.evidence } });
  }
};
```

Mode mismatch must display a specific error and make no asset mutation.

- [ ] **Step 4: Render independent read-only state**

Render badges from validator results, not from mutable status alone. Show report label, mode, model, identity version, evaluator version, verified time, and exact invalidation reason. Keep LoRA training status controls limited to `unconfigured`, `dataset_ready`, `training`, and `failed`; `ready` remains derived.

- [ ] **Step 5: Style and verify**

Add focused badge variants using existing colors and spacing; do not redesign the panel. Run:

`npm.cmd run test:character-identity-ui`

`npm.cmd run test:character-consistency-ui`

`npm.cmd run build`

Expected: all PASS; Vite chunk-size advisory is acceptable, TypeScript errors are not.

- [ ] **Step 6: Commit**

```powershell
git add -- src/modules/asset-manager/AssetPanel.tsx src/styles/global.css scripts/check-character-identity-ui.mjs scripts/check-character-consistency-ui.mjs
git commit -m "feat: show dual-track character readiness"
```

---

### Task 6: Full Regression, Real Eight-Shot Gate, and Operator Documentation

**Files:**
- Modify: `docs/comfyui-storyboard-setup.md`
- Create: `.superpowers/sdd/klein-zero-shot-release-report.md`
- Generated, not committed: `logs/character-consistency-benchmark-*.json`
- Generated, not committed: `logs/character-consistency-benchmark-*-artifacts/`

**Interfaces:**
- Consumes the completed CLI, evaluator, Klein workflow, identity pack, and ComfyUI Desktop instance.
- Produces the first genuinely evidence-eligible zero-shot report or an explicit blocked report with exact failed dimensions.

- [ ] **Step 1: Run the complete automated suite**

Run these commands independently so a failure is attributable:

```powershell
npm.cmd run test:character-generation-evidence
npm.cmd run test:character-evaluator
npm.cmd run test:character-benchmark
npm.cmd run test:character-providers
npm.cmd run test:sequential-character-passes
npm.cmd run test:character-identity-ui
npm.cmd run test:character-consistency-ui
npm.cmd run build
```

Expected: every command exits 0. The existing Vite chunk-size advisory is non-blocking.

- [ ] **Step 2: Verify the live Desktop preflight**

Confirm `/system_stats` reports the RTX 5070 Ti, `/object_info` includes `ReferenceLatent`, `CFGGuider`, and `Flux2Scheduler`, and the exact Klein model is selectable. Abort before queueing if the provider proof, model, evaluator revision, reference hashes, or output node differs from the evidence context.

- [ ] **Step 3: Run the strict zero-shot benchmark**

Discover an exported project backup that already contains a complete identity pack, without inventing an asset ID:

```powershell
$eligibleSubjects = foreach ($candidate in Get-ChildItem -LiteralPath . -Filter '*.json' -File -Recurse) {
  try {
    $document = Get-Content -LiteralPath $candidate.FullName -Raw | ConvertFrom-Json
    $snapshot = if ($document.snapshot) { $document.snapshot } else { $document }
    foreach ($asset in @($snapshot.assets)) {
      if ($asset.type -eq 'character' -and $asset.characterIdentityPack.version -and $asset.characterIdentityPack.faceMasterPath -and $asset.characterIdentityPack.bodyFrontPath) {
        [pscustomobject]@{ Project = $candidate.FullName; Character = $asset.id }
      }
    }
  } catch {}
}
$benchmarkSubject = $eligibleSubjects | Select-Object -First 1
if (-not $benchmarkSubject) { throw 'No exported project backup contains a complete character identity pack.' }
npm.cmd run benchmark:characters -- --mode zero-shot --project $benchmarkSubject.Project --character $benchmarkSubject.Character --provider flux2_klein_4b --base-url http://127.0.0.1:8188 --output logs/character-consistency-benchmark-klein-zero-shot.json --workflow examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json --output-node 19 --evaluator-module scripts/evaluators/siglip2-character-evaluator.mjs
```

If discovery finds no eligible identity pack, export the current project after completing its identity fields and rerun the same discovery block; the release gate remains closed until a real subject exists. Expected release result: exit 0, `aggregate.status: "accepted"`, `accepted: 8`, `evidenceEligible: true`, a 64-character evidence digest, zero authoritative LoRA bindings, and eight model-generation outputs.

- [ ] **Step 4: Apply bounded remediation only when evidence identifies a failure**

For a failed profile direction, use the recorded mirrored side reference; for close/strong-expression failures, use the recorded head-and-shoulders crop; for action failure, strengthen the explicit limb/motion prompt. Increment the workflow or fixture version, preserve the failed report, and rerun to a new output path. Never edit scores, reuse prior outputs, or mark the asset ready manually.

- [ ] **Step 5: Import and revalidate the accepted report**

Import through the zero-shot evidence control. Confirm the asset shows `零样本已验证`, the production resolver returns Klein with `appliedLora: null`, and changing a reference makes the UI show `证据已失效` with `reference_manifest_mismatch`.

- [ ] **Step 6: Document the operator workflow and final evidence**

Update `docs/comfyui-storyboard-setup.md` with the two CLI modes, required evaluator cache/revision, separate badge meanings, invalidation rules, bounded remediation, and the rule that visual smoke results are not release evidence.

Write `.superpowers/sdd/klein-zero-shot-release-report.md` containing exact commands, model/evaluator revisions, identity/reference digests, report path, total duration, per-shot scores/retries, aggregate status, and unresolved failures. If the strict run does not pass, state `production gate remains closed` instead of claiming completion.

- [ ] **Step 7: Final diff and regression verification**

Run:

```powershell
git diff --check -- src/modules/storyboard-core/types.ts src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs src/modules/asset-manager/characterIdentityUiRuntime.mjs src/modules/asset-manager/characterIdentityUi.ts src/modules/asset-manager/AssetPanel.tsx src/styles/global.css scripts/run-character-consistency-benchmark.mjs scripts/check-character-consistency-benchmark.mjs scripts/check-character-generation-evidence.mjs scripts/check-character-siglip2-evaluator.mjs scripts/evaluators/siglip2-character-evaluator.mjs scripts/evaluators/siglip2-character-worker.py examples/character-consistency-benchmark/benchmark.json examples/character-consistency-benchmark/siglip2-evaluator.example.json docs/comfyui-storyboard-setup.md
```

Expected: exit 0 with no whitespace errors.

- [ ] **Step 8: Commit documentation and report**

```powershell
git add -- docs/comfyui-storyboard-setup.md .superpowers/sdd/klein-zero-shot-release-report.md
git commit -m "docs: publish Klein zero-shot release evidence"
```

Do not stage unrelated dirty workspace files or generated image artifacts.
