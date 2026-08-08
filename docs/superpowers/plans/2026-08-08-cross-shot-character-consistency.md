# Cross-Shot Character Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercially usable character-identity pipeline that keeps faces and hairstyles stable across storyboard shots on an RTX 5070 Ti 16GB machine running ComfyUI Desktop.

**Architecture:** Add versioned identity packs to character assets, then derive a deterministic per-character pass plan from shot yaw and scale. Keep Qwen-Image-Edit-2511 as the default provider and FLUX.2 Klein 4B as a commercially permitted challenger; generation, validation, retries, and UI consume shared pure planning functions so behavior is testable without a running ComfyUI instance.

**Tech Stack:** React 18, TypeScript 5.6, Zustand, Vite, dependency-free Node.js regression scripts, ComfyUI workflow JSON.

## Global Constraints

- Production model licenses must permit commercial release or monetization.
- Target hardware is NVIDIA GeForce RTX 5070 Ti 16GB with about 48GB system RAM.
- Qwen-Image-Edit-2511 is the default production baseline; FLUX.2 Klein 4B is the only FLUX.2 local production candidate.
- Generate and validate one character layer at a time; later passes must not redraw an accepted earlier character.
- A previous shot is a low-priority continuity reference and never replaces the canonical identity pack.
- Never publish a cutout-rescue fallback as a successful model generation.
- Preserve unrelated dirty-worktree edits and stage only task-owned hunks.

---

### Task 1: Versioned Character Identity Data

**Files:**
- Modify: `src/modules/storyboard-core/types.ts:50-125`
- Modify: `src/modules/storyboard-core/store.ts:122-169`
- Modify: `src/modules/storyboard-core/store.ts:688-777`
- Create: `scripts/check-character-identity-schema.mjs`
- Modify: `package.json:6-17`

**Interfaces:**
- Produces: `CharacterIdentityPack`, `CharacterLoraProfile`, `CharacterConsistencyBaseline`, `CharacterGenerationMetadata`.
- Produces: `Asset.characterIdentityPack`, `Asset.characterLora`, `Asset.characterConsistencyBaseline`.
- Produces: optional character metadata on `ShotLayer`.

- [ ] **Step 1: Write the failing schema guard**

Create `scripts/check-character-identity-schema.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const types = await readFile(new URL("../src/modules/storyboard-core/types.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../src/modules/storyboard-core/store.ts", import.meta.url), "utf8");

for (const symbol of [
  "CharacterIdentityPack",
  "CharacterLoraProfile",
  "CharacterConsistencyBaseline",
  "CharacterGenerationMetadata"
]) {
  assert.match(types, new RegExp(`export type ${symbol}\\b`), `missing ${symbol}`);
}
for (const field of ["characterIdentityPack", "characterLora", "characterConsistencyBaseline"]) {
  assert.match(types, new RegExp(`${field}\\?`), `Asset is missing ${field}`);
  assert.match(store, new RegExp(field), `store does not persist ${field}`);
}
console.log("PASS character identity schema and store persistence");
```

- [ ] **Step 2: Run the guard and verify failure**

Run: `node scripts/check-character-identity-schema.mjs`

Expected: FAIL with `missing CharacterIdentityPack`.

- [ ] **Step 3: Add the identity types**

Add to `types.ts` before `Asset`:

```ts
export type CharacterIdentityPack = {
  version: string;
  triggerWord: string;
  faceMasterPath: string;
  faceLeftPath?: string;
  faceRightPath?: string;
  hairBackPath?: string;
  bodyFrontPath: string;
  bodySidePath?: string;
  bodyBackPath?: string;
  neutralExpressionPath?: string;
  immutableTraits: string[];
  forbiddenChanges: string[];
  approvedHeroFramePaths: string[];
  updatedAt: string;
};

export type CharacterLoraProfile = {
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  modelName: string;
  loraName: string;
  strength: number;
  version: string;
  status: "unconfigured" | "dataset_ready" | "training" | "ready" | "failed";
};

export type CharacterConsistencyBaseline = {
  version: string;
  closeThreshold: number;
  mediumThreshold: number;
  wideThreshold: number;
  lastRegressionAt?: string;
  lastRegressionScore?: number;
};

export type CharacterGenerationMetadata = {
  characterAssetId: string;
  identityPackVersion: string;
  loraVersion?: string;
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  referencePaths: string[];
  retryCount: number;
  consistencyScore?: number;
  status: "generated" | "accepted" | "needs_review";
};
```

Extend `Asset` and `ShotLayer` with the corresponding optional fields. Extend the `addAsset` input and `updateAsset` pick list, then copy these values unchanged for character assets in both store mutations.

- [ ] **Step 4: Add the npm script and verify**

Add:

```json
"test:character-identity": "node scripts/check-character-identity-schema.mjs"
```

Run: `npm run test:character-identity && npm run build`

Expected: schema guard prints PASS and the TypeScript/Vite build exits 0.

- [ ] **Step 5: Commit only owned hunks**

```powershell
git add -- scripts/check-character-identity-schema.mjs package.json src/modules/storyboard-core/types.ts
git add -p -- src/modules/storyboard-core/store.ts
git commit -m "feat: add versioned character identity data"
```

### Task 2: Reference Routing and Shot Evaluation Profiles

**Files:**
- Create: `src/modules/comfy-pipeline/characterConsistencyRuntime.mjs`
- Create: `src/modules/comfy-pipeline/characterConsistency.ts`
- Create: `scripts/check-character-consistency-runtime.mjs`
- Modify: `package.json:6-18`

**Interfaces:**
- Consumes: `Asset.characterIdentityPack`, `Shot.cameraYaw`, shot prompt fields.
- Produces: `inferCharacterView(yaw)`, `inferShotScale(text)`, `routeCharacterReferences(input)`, `buildCharacterPassPlan(input)`.
- Produces type: `CharacterPassPlan`.

- [ ] **Step 1: Write failing routing tests**

Create `scripts/check-character-consistency-runtime.mjs` with fixtures that assert:

```js
import assert from "node:assert/strict";
import {
  inferCharacterView,
  inferShotScale,
  routeCharacterReferences,
  buildCharacterPassPlan
} from "../src/modules/comfy-pipeline/characterConsistencyRuntime.mjs";

assert.equal(inferCharacterView(0), "front");
assert.equal(inferCharacterView(-55), "left_profile");
assert.equal(inferCharacterView(55), "right_profile");
assert.equal(inferCharacterView(170), "back");
assert.equal(inferShotScale("面部特写，眼神变化"), "close");
assert.equal(inferShotScale("河边远景，两人全身"), "wide");

const identityPack = {
  version: "v1",
  triggerWord: "char_shen",
  faceMasterPath: "face.png",
  faceLeftPath: "left.png",
  hairBackPath: "hair-back.png",
  bodyFrontPath: "front.png",
  bodySidePath: "side.png",
  bodyBackPath: "back.png",
  immutableTraits: [], forbiddenChanges: [], approvedHeroFramePaths: [], updatedAt: "2026-08-08"
};
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "left_profile", shotScale: "close" }).map((item) => item.kind),
  ["face_angle", "face_master", "body_view"]
);
const passes = buildCharacterPassPlan({
  shot: { id: "s1", cameraYaw: 0, title: "双人近景" },
  characters: [
    { id: "a", name: "A", characterIdentityPack: identityPack },
    { id: "b", name: "B", characterIdentityPack: { ...identityPack, triggerWord: "char_b" } }
  ],
  provider: "qwen_image_edit_2511"
});
assert.deepEqual(passes.map((item) => item.characterAssetId), ["a", "b"]);
assert.equal(passes.every((item) => item.references.length <= 3), true);
assert.equal(passes[0].protectPreviousCharacters, false);
assert.equal(passes[1].protectPreviousCharacters, true);
console.log("PASS character reference routing and pass planning");
```

- [ ] **Step 2: Run the test and verify module-not-found failure**

Run: `node scripts/check-character-consistency-runtime.mjs`

Expected: FAIL because `characterConsistencyRuntime.mjs` does not exist.

- [ ] **Step 3: Implement the dependency-free runtime**

Implement these exact exports in `characterConsistencyRuntime.mjs`:

```js
const uniqueReferences = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const path = String(item?.path ?? "").trim();
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  }).slice(0, 3);
};

export function inferCharacterView(yaw = 0) {
  const normalized = ((((Number(yaw) || 0) + 180) % 360) + 360) % 360 - 180;
  if (normalized >= -25 && normalized <= 25) return "front";
  if (normalized > 25 && normalized <= 50) return "right_three_quarter";
  if (normalized < -25 && normalized >= -50) return "left_three_quarter";
  if (normalized > 50 && normalized <= 135) return "right_profile";
  if (normalized < -50 && normalized >= -135) return "left_profile";
  return "back";
}

export function inferShotScale(text = "") {
  const value = String(text).toLowerCase();
  if (/特写|近景|close[- ]?up|close shot|portrait/.test(value)) return "close";
  if (/远景|全景|建立镜头|wide shot|long shot|establishing/.test(value)) return "wide";
  return "medium";
}

export function routeCharacterReferences({ identityPack, view, shotScale, continuityPath = "" }) {
  const anglePath = view.startsWith("left")
    ? identityPack.faceLeftPath
    : view.startsWith("right")
      ? identityPack.faceRightPath
      : view === "back"
        ? identityPack.hairBackPath
        : identityPack.faceMasterPath;
  const bodyPath = view === "back"
    ? identityPack.bodyBackPath
    : view === "front"
      ? identityPack.bodyFrontPath
      : identityPack.bodySidePath;
  const candidates = shotScale === "close"
    ? [
        { kind: "face_angle", path: anglePath },
        { kind: "face_master", path: identityPack.faceMasterPath },
        { kind: "body_view", path: bodyPath }
      ]
    : shotScale === "wide"
      ? [
          { kind: "body_view", path: bodyPath },
          { kind: "hair_back", path: view === "back" ? identityPack.hairBackPath : "" },
          { kind: "face_master", path: identityPack.faceMasterPath }
        ]
      : [
          { kind: "body_view", path: bodyPath },
          { kind: "face_angle", path: anglePath },
          { kind: "face_master", path: identityPack.faceMasterPath }
        ];
  const canonical = uniqueReferences(candidates);
  return uniqueReferences([
    ...canonical,
    canonical.length < 3 ? { kind: "continuity", path: continuityPath } : null
  ]);
}

export function buildCharacterPassPlan({ shot, characters, provider }) {
  const shotText = [shot.title, shot.storyPrompt, shot.notes, ...(shot.tags ?? [])].filter(Boolean).join(" ");
  const view = inferCharacterView(shot.cameraYaw);
  const shotScale = inferShotScale(shotText);
  return characters
    .filter((character) => character.characterIdentityPack)
    .map((character, roleIndex) => ({
      characterAssetId: character.id,
      characterName: character.name,
      roleIndex,
      provider,
      view,
      shotScale,
      references: routeCharacterReferences({ identityPack: character.characterIdentityPack, view, shotScale }),
      triggerWord: character.characterIdentityPack.triggerWord,
      protectPreviousCharacters: roleIndex > 0,
      refineHead: shotScale !== "wide"
    }));
}
```

Use yaw bands: front `[-25,25]`, left/right three-quarter `(25,50]`, profiles `(50,135]`, and back outside `[-135,135]`. For close shots, order face angle, face master, body view. For medium shots, order body view, face angle, face master. For wide shots, order body view, hair back when applicable, face master. Add a continuity path only when fewer than three canonical references exist.

- [ ] **Step 4: Add the typed façade**

In `characterConsistency.ts`, declare `CharacterView`, `ShotScale`, `CharacterReferenceSelection`, and `CharacterPassPlan`, then type-cast imports from the runtime using the established `workflowRegistry.ts` pattern.

Add:

```json
"test:character-consistency": "node scripts/check-character-consistency-runtime.mjs"
```

- [ ] **Step 5: Run tests and build**

Run: `node scripts/check-character-consistency-runtime.mjs && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- src/modules/comfy-pipeline/characterConsistencyRuntime.mjs src/modules/comfy-pipeline/characterConsistency.ts scripts/check-character-consistency-runtime.mjs package.json
git commit -m "feat: route character identity references by shot"
```

### Task 3: Commercial Provider Registry

**Files:**
- Create: `src/modules/comfy-pipeline/characterProviderRegistryRuntime.mjs`
- Create: `src/modules/comfy-pipeline/characterProviderRegistry.ts`
- Create: `scripts/check-character-provider-registry.mjs`
- Modify: `package.json:6-19`

**Interfaces:**
- Produces: `CharacterGenerationProviderDefinition`.
- Produces: `CHARACTER_GENERATION_PROVIDERS`, `inspectCharacterProvider`, `selectCharacterProvider`.

- [ ] **Step 1: Write the failing provider test**

Assert that `qwen_image_edit_2511` ranks first when both providers are available, Klein 4B is selectable, and a synthetic non-commercial provider is rejected when `commercialRequired` is true.

```js
const environment = {
  commercialRequired: true,
  models: ["qwen_image_edit_2511_bf16.safetensors", "flux2_klein_4b_fp8.safetensors"],
  nodes: ["TextEncodeQwenImageEdit", "ReferenceLatent", "FluxGuidance"]
};
assert.equal(selectCharacterProvider(environment).selected?.id, "qwen_image_edit_2511");
assert.equal(inspectCharacterProvider({ ...CHARACTER_GENERATION_PROVIDERS[0], commercialUse: false }, environment).available, false);
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/check-character-provider-registry.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement provider definitions**

Declare Qwen with Apache-2.0, native `TextEncodeQwenImageEdit`, BF16 model name, score 100, and 16GB/offload note. Declare Klein 4B with Apache-2.0, multi-reference support, FP8 model name, score 80, and 10GB minimum VRAM. Inspection must report `license_blocked`, `missing_model`, and `missing_node` separately.

- [ ] **Step 4: Add typed façade, npm script, and verify**

Add:

```json
"test:character-providers": "node scripts/check-character-provider-registry.mjs"
```

Run: `node scripts/check-character-provider-registry.mjs && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 5: Commit**

```powershell
git add -- src/modules/comfy-pipeline/characterProviderRegistryRuntime.mjs src/modules/comfy-pipeline/characterProviderRegistry.ts scripts/check-character-provider-registry.mjs package.json
git commit -m "feat: register commercial character generation providers"
```

### Task 4: Settings and ComfyUI Desktop Preflight

**Files:**
- Modify: `src/modules/comfy-pipeline/comfyService.ts:188-333`
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx:68-75`
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx:2730-2825`
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx:10450-10690`
- Modify: `package.json:6-22`
- Create: `scripts/check-character-provider-settings.mjs`

**Interfaces:**
- Consumes: provider registry from Task 3.
- Produces settings: `characterGenerationProvider`, `characterGenerationWorkflowJson`, `characterConsistencyEnabled`, `commercialUseRequired`.
- Produces diagnostics with license, model, node, and workflow status.

- [ ] **Step 1: Write a source-level failing guard**

The guard must assert all four setting names exist in `ComfySettings`, default settings, local-storage migration, and diagnostic summary copy.

- [ ] **Step 2: Verify failure**

Run: `node scripts/check-character-provider-settings.mjs`

Expected: FAIL naming `characterGenerationProvider`.

- [ ] **Step 3: Add settings and migration defaults**

Use these defaults:

```ts
characterGenerationProvider: "qwen_image_edit_2511",
characterGenerationWorkflowJson: "",
characterConsistencyEnabled: true,
commercialUseRequired: true
```

Do not silently change an explicitly saved Klein 4B selection. Reject unknown provider IDs during load and fall back to Qwen.

Add:

```json
"test:character-provider-settings": "node scripts/check-character-provider-settings.mjs"
```

- [ ] **Step 4: Add preflight diagnostics**

Map `ComfyEnvironmentReport.models` and live object-info node names into `inspectCharacterProvider`. Display separate Chinese messages for missing model, missing node, unsupported commercial license, offline Desktop, and missing workflow JSON.

- [ ] **Step 5: Verify**

Run: `node scripts/check-character-provider-settings.mjs && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit only owned hunks**

```powershell
git add -- scripts/check-character-provider-settings.mjs
git add -p -- src/modules/comfy-pipeline/comfyService.ts src/modules/comfy-pipeline/ComfyPipelinePanel.tsx
git commit -m "feat: add character provider preflight settings"
```

### Task 5: Per-Character Generation Tokens and Sequential Passes

**Files:**
- Modify: `src/modules/comfy-pipeline/comfyService.ts:21000-24200`
- Modify: `src/modules/comfy-pipeline/comfyService.ts:29278-30804`
- Modify: `src/modules/comfy-pipeline/workflowRegistryRuntime.mjs:1-30`
- Modify: `src/modules/comfy-pipeline/workflowRegistry.ts:1-45`
- Modify: `package.json:6-23`
- Create: `scripts/check-sequential-character-passes.mjs`

**Interfaces:**
- Consumes: `buildCharacterPassPlan` from Task 2 and provider selection from Task 3.
- Produces tokens: `ACTIVE_CHARACTER_ID`, `ACTIVE_CHARACTER_NAME`, `ACTIVE_CHARACTER_TRIGGER`, `ACTIVE_FACE_REF_PATH`, `ACTIVE_BODY_REF_PATH`, `ACTIVE_HAIR_REF_PATH`, `ACTIVE_LORA_NAME`, `ACTIVE_LORA_STRENGTH`, `PROTECT_PREVIOUS_CHARACTERS`.
- Produces one accepted output path per character pass.

- [ ] **Step 1: Write a failing source and runtime guard**

The guard must assert that generation imports `buildCharacterPassPlan`, loops over `characterPasses`, limits staged identity references to three, sets all active-character tokens, and never calls the old dual-character Stage B path when consistency mode is enabled.

- [ ] **Step 2: Verify failure**

Run: `node scripts/check-sequential-character-passes.mjs`

Expected: FAIL because the active-character tokens are absent.

- [ ] **Step 3: Extend workflow token declarations**

Add the ten tokens above as optional tokens on character-capable workflow definitions. Extend `WorkflowTokenSpec` descriptions so diagnostics explain which path or scalar each token carries.

- [ ] **Step 4: Build and run sequential passes**

At the start of `generateStoryboardImageStaged`, when `characterConsistencyEnabled` and at least one identity pack are present:

```ts
const characterPasses = buildCharacterPassPlan({ shot: repairedShot, characters: selectedCharacters, provider });
let acceptedFramePath = cleanScenePath;
for (const pass of characterPasses) {
  const output = await runCharacterPass({ pass, baseFramePath: acceptedFramePath });
  acceptedFramePath = await validateAndAcceptCharacterPass(pass, output, acceptedFramePath);
}
return publishAcceptedCharacterFrame(acceptedFramePath);
```

`runCharacterPass` must stage only the pass's references, use a mask for that character, and set `PROTECT_PREVIOUS_CHARACTERS=1` after the first pass. If no identity pack exists, retain the current pipeline for backward compatibility and log `character_consistency_skip=missing_identity_pack`.

For medium and close passes, call `runHeadHairRefinement` after the full character passes validation. Crop the mask bounding box with 24% padding, resize its longest edge to 768 for close shots and 512 for medium shots, generate with only `face_master`, the angle reference, and the character LoRA, then composite through the same mask. Store the isolated RGBA character layer, mask path, accepted composite path, placement rectangle, and generation metadata on a `ShotLayer`; later passes use the accepted composite as their base while protecting every earlier mask.

Add:

```json
"test:sequential-character-passes": "node scripts/check-sequential-character-passes.mjs"
```

- [ ] **Step 5: Verify**

Run: `node scripts/check-sequential-character-passes.mjs && npm run test:workflow-presets && npm run build`

Expected: all commands exit 0.

- [ ] **Step 6: Commit owned hunks**

```powershell
git add -- scripts/check-sequential-character-passes.mjs src/modules/comfy-pipeline/workflowRegistryRuntime.mjs src/modules/comfy-pipeline/workflowRegistry.ts
git add -p -- src/modules/comfy-pipeline/comfyService.ts
git commit -m "feat: generate storyboard characters sequentially"
```

### Task 6: Dynamic Consistency Scoring and Bounded Retry

**Files:**
- Modify: `src/modules/comfy-pipeline/characterConsistencyRuntime.mjs`
- Modify: `src/modules/comfy-pipeline/characterConsistency.ts`
- Modify: `scripts/check-character-consistency-runtime.mjs`
- Modify: `src/modules/comfy-pipeline/comfyService.ts:26650-29980`

**Interfaces:**
- Produces: `scoreCharacterConsistency(metrics, profile)`, `nextCharacterRetryDecision(input)`.
- Consumes scores normalized to 0–1 or `null`: face, hair, outfit, body, quality.
- Produces retry actions: `retry_seed`, `expand_head_crop`, `add_hero_reference`, `switch_provider`, `needs_review`.

- [ ] **Step 1: Extend failing runtime tests**

Add assertions that close shots weight face/hair most, back shots omit face, wide shots do not fail because face is null, and retry attempt five returns `needs_review`.

```js
const wide = scoreCharacterConsistency(
  { face: null, hair: 0.9, outfit: 0.85, body: 0.8, quality: 0.9 },
  { shotScale: "wide", view: "front", threshold: 0.75 }
);
assert.equal(wide.passed, true);
assert.equal(wide.weights.face, 0);
assert.equal(nextCharacterRetryDecision({ attempt: 4, hasHeroReference: true, hasFallbackProvider: true }).action, "needs_review");
```

- [ ] **Step 2: Verify failure**

Run: `node scripts/check-character-consistency-runtime.mjs`

Expected: FAIL because scoring exports are absent.

- [ ] **Step 3: Implement scoring and retry ladder**

Normalize weights after excluding null metrics. Use close weights `face .38, hair .30, outfit .12, body .05, quality .15`; medium weights `.25, .25, .20, .12, .18`; wide weights `0, .30, .28, .22, .20`. For back view set face to zero and transfer half of its original weight to hair and half to outfit.

Retry sequence is exactly: attempts 0–1 `retry_seed`, attempt 2 `expand_head_crop`, attempt 3 `add_hero_reference` when available otherwise `switch_provider`, attempt 4 `switch_provider` when available otherwise `needs_review`, later attempts `needs_review`.

- [ ] **Step 4: Integrate with existing image validators**

Translate existing lane coverage, color-distance, structure, upper-body, boundary, and artifact metrics into the normalized inputs. Persist score and failure dimensions in `CharacterGenerationMetadata`. Remove the path that publishes `storyboard_composite_still_fallback` as success after validation failure; return `needs_review` with the best preview path instead.

- [ ] **Step 5: Verify**

Run: `npm run test:character-consistency && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit owned hunks**

```powershell
git add -- src/modules/comfy-pipeline/characterConsistencyRuntime.mjs src/modules/comfy-pipeline/characterConsistency.ts scripts/check-character-consistency-runtime.mjs
git add -p -- src/modules/comfy-pipeline/comfyService.ts
git commit -m "feat: score and retry character consistency"
```

### Task 7: Character Identity and LoRA Controls in Asset Manager

**Files:**
- Modify: `src/modules/asset-manager/AssetPanel.tsx:920-1380`
- Modify: `src/styles/global.css`
- Modify: `package.json:6-24`
- Create: `scripts/check-character-identity-ui.mjs`

**Interfaces:**
- Consumes and edits the Task 1 identity types.
- Produces complete identity packs and LoRA settings through `addAsset` and `updateAsset`.

- [ ] **Step 1: Write failing UI guard**

Require labels for identity version, trigger word, master face, left/right face, back hair, LoRA file, LoRA strength, provider, training status, immutable traits, and forbidden changes. Require `updateAsset(asset.id, { characterIdentityPack:` and `characterLora:` calls.

- [ ] **Step 2: Verify failure**

Run: `node scripts/check-character-identity-ui.mjs`

Expected: FAIL on the first missing label.

- [ ] **Step 3: Add the identity editor**

Reuse the existing character asset form and card. Default identity version to `v1`; derive the trigger by lowercasing the asset name, replacing non-alphanumeric runs with `_`, trimming `_`, and prefixing `char_` (for example, `沈砚` falls back to `char_character` until the user enters `char_shenyan`). Seed face/body paths from existing front/side/back paths, and default LoRA status to `unconfigured`. Clamp LoRA strength to `0..1.5`.

Add:

```json
"test:character-identity-ui": "node scripts/check-character-identity-ui.mjs"
```

- [ ] **Step 4: Add status presentation**

Show completeness as `已完成 N/7`, identity/LoRA versions, provider, training status, and last regression score. Use existing panel and button classes, adding only focused grid and status-chip CSS.

- [ ] **Step 5: Verify**

Run: `node scripts/check-character-identity-ui.mjs && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit owned hunks**

```powershell
git add -- scripts/check-character-identity-ui.mjs
git add -p -- src/modules/asset-manager/AssetPanel.tsx src/styles/global.css
git commit -m "feat: edit character identity packs and LoRA profiles"
```

### Task 8: Shot Consistency Inspection and Single-Character Redraw

**Files:**
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx:13680-14220`
- Modify: `src/modules/editor-shell/ShotInspectorPanel.tsx`
- Modify: `src/styles/global.css`
- Modify: `package.json:6-25`
- Create: `scripts/check-character-consistency-ui.mjs`

**Interfaces:**
- Consumes: character generation metadata and generation task errors.
- Produces actions: redraw face/hair, upper body, or full character layer.

- [ ] **Step 1: Write failing UI guard**

Require score labels `脸部一致性`, `发型一致性`, `服装一致性`, `总体一致性`; require buttons `只重绘脸和头发`, `重绘上半身`, `重绘完整人物`; require the redraw call to carry one `characterAssetId` and one `redrawScope`.

- [ ] **Step 2: Verify failure**

Run: `node scripts/check-character-consistency-ui.mjs`

Expected: FAIL on missing score labels.

- [ ] **Step 3: Add inspection card**

For the selected shot, list each character layer with provider, identity version, LoRA version, references, retry count, status, and per-dimension scores. Use `需要人工审核` for exhausted retries, never `生成成功`.

- [ ] **Step 4: Add scoped redraw**

Extend the generation request with:

```ts
characterRedraw?: {
  characterAssetId: string;
  scope: "face_hair" | "upper_body" | "full_character";
};
```

Route it to a single character pass and preserve the scene plus every other accepted character layer.

Add:

```json
"test:character-consistency-ui": "node scripts/check-character-consistency-ui.mjs"
```

- [ ] **Step 5: Verify**

Run: `node scripts/check-character-consistency-ui.mjs && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit owned hunks**

```powershell
git add -- scripts/check-character-consistency-ui.mjs
git add -p -- src/modules/comfy-pipeline/ComfyPipelinePanel.tsx src/modules/editor-shell/ShotInspectorPanel.tsx src/styles/global.css
git commit -m "feat: inspect and redraw individual characters"
```

### Task 9: LoRA Dataset Export and Training Configuration

**Files:**
- Create: `scripts/export-character-lora-dataset.mjs`
- Create: `scripts/check-character-lora-dataset.mjs`
- Create: `examples/character-consistency-benchmark/lora-dataset.example.json`
- Modify: `package.json:6-24`
- Modify: `docs/comfyui-storyboard-setup.md`

**Interfaces:**
- Consumes: a project backup JSON, one character asset ID, and an output directory.
- Produces: `dataset/metadata.jsonl`, copied approved images, `qwen-diffsynth-training.json`, and `klein-ai-toolkit-training.json`.

- [ ] **Step 1: Write the failing dataset test**

Create a fixture with 15 approved images spanning front, three-quarter, profile, back, close, medium, and full-body tags. Assert that export rejects fewer than 15 or more than 30 images, duplicate paths, missing trigger word, mixed identity-pack versions, unapproved generated frames, and missing front/profile/back coverage.

- [ ] **Step 2: Verify failure**

Run: `node scripts/check-character-lora-dataset.mjs`

Expected: module-not-found failure for the exporter.

- [ ] **Step 3: Implement deterministic export**

The exporter accepts:

```powershell
node scripts/export-character-lora-dataset.mjs --project examples/river-dialogue-5s/river_dialogue_5s_project_backup.json --character asset_1774017261433_390 --manifest examples/character-consistency-benchmark/lora-dataset.example.json --output .tmp/character-lora-dataset
```

Copy only paths present in the manifest's `approvedImages` array. Write one JSONL record per image with `file_name`, `caption`, `view`, `scale`, `identity_pack_version`, and `approved: true`. Captions must include the unique trigger word and visible immutable traits, but must omit background style when the background is incidental.

- [ ] **Step 4: Emit exact provider configs**

The Qwen config must select `Qwen/Qwen-Image-Edit-2511`, enable model CPU offload, use LoRA rank 16, batch size 1, gradient accumulation 4, 768 resolution, and seed 20260808. The Klein config must select `black-forest-labs/FLUX.2-klein-base-4B`, LoRA rank 16, batch size 1, 768 resolution, 1800 steps, and seed 20260808. Mark Klein training as requiring a 24GB training host even though inference returns to the 16GB desktop machine.

- [ ] **Step 5: Add scripts and verify**

Add:

```json
"test:character-lora-dataset": "node scripts/check-character-lora-dataset.mjs",
"export:character-lora-dataset": "node scripts/export-character-lora-dataset.mjs"
```

Run: `npm run test:character-lora-dataset`

Expected: PASS with validation coverage for size, view diversity, approval, version, and config output.

- [ ] **Step 6: Document training/import flow**

Document DiffSynth-Studio as the Qwen training path and AI Toolkit as the Klein training path. Require the resulting `.safetensors` filename, provider, trigger word, version, and chosen checkpoint step to be copied into `CharacterLoraProfile`; never set status to `ready` until the eight-shot regression passes.

- [ ] **Step 7: Commit**

```powershell
git add -- scripts/export-character-lora-dataset.mjs scripts/check-character-lora-dataset.mjs examples/character-consistency-benchmark/lora-dataset.example.json package.json docs/comfyui-storyboard-setup.md
git commit -m "feat: export character LoRA training datasets"
```

### Task 10: Eight-Shot Provider Benchmark

**Files:**
- Create: `examples/character-consistency-benchmark/benchmark.json`
- Create: `scripts/run-character-consistency-benchmark.mjs`
- Create: `scripts/check-character-consistency-benchmark.mjs`
- Modify: `package.json:6-22`
- Modify: `docs/comfyui-storyboard-setup.md`

**Interfaces:**
- Consumes: one character asset ID, provider ID, Comfy endpoint, and eight declared shot fixtures.
- Produces timestamped reports such as `logs/character-consistency-benchmark-20260808T120000Z.json` with score, duration, retries, provider, references, output, and final status per shot.

- [ ] **Step 1: Create the benchmark fixture and failing schema test**

The fixture must contain exactly these IDs: `front_close`, `three_quarter_medium`, `left_profile`, `right_profile`, `back_view`, `full_body_action`, `strong_expression`, `different_lighting`. The schema test rejects duplicate IDs, missing camera yaw, missing scale, and fewer or more than eight shots.

- [ ] **Step 2: Run the schema test**

Run: `node scripts/check-character-consistency-benchmark.mjs`

Expected: PASS after the exact fixture is present.

- [ ] **Step 3: Implement the benchmark runner**

Accept `--character`, `--provider`, `--base-url`, and `--output`. Run shots serially, stop only for offline/preflight errors, retain per-shot validation failures, and write the JSON report. Exit 0 only when all eight shots complete and no shot ends as `needs_review`; otherwise exit 1 after writing the report.

- [ ] **Step 4: Document Desktop setup**

Add exact folders and model filenames for Qwen 2511 and Klein 4B, explain that Desktop stable may lag core nightly nodes, and document the provider preflight plus benchmark commands. Clearly label Klein 9B and Dev as excluded from commercial production.

- [ ] **Step 5: Add scripts and verify static behavior**

Add:

```json
"test:character-benchmark": "node scripts/check-character-consistency-benchmark.mjs",
"benchmark:characters": "node scripts/run-character-consistency-benchmark.mjs"
```

Run: `npm run test:character-benchmark && npm run build`

Expected: PASS and build exit 0. Do not require a running ComfyUI instance for the schema test.

- [ ] **Step 6: Commit**

```powershell
git add -- examples/character-consistency-benchmark/benchmark.json scripts/run-character-consistency-benchmark.mjs scripts/check-character-consistency-benchmark.mjs package.json docs/comfyui-storyboard-setup.md
git commit -m "test: add character consistency provider benchmark"
```

### Task 11: Full Verification and Release Gate

**Files:**
- Modify: `docs/stable-storyboard-workflow-20260319.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces a verified migration note and a clean list of environment-only blockers.

- [ ] **Step 1: Run all deterministic checks**

```powershell
npm run test:character-identity
npm run test:character-consistency
npm run test:character-providers
npm run test:character-provider-settings
npm run test:sequential-character-passes
npm run test:character-identity-ui
npm run test:character-consistency-ui
npm run test:character-lora-dataset
npm run test:character-benchmark
npm run test:workflow-presets
npm run test:threeview-guards
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Run ComfyUI preflight**

Start ComfyUI Desktop, then run the app's environment inspection. Expected result is either a fully available provider or explicit missing-model/missing-node diagnostics; offline, license, model, and node failures must not collapse into one generic error.

- [ ] **Step 3: Run Qwen benchmark**

```powershell
npm run benchmark:characters -- --character asset_1774017261433_390 --provider qwen_image_edit_2511 --base-url http://127.0.0.1:8188 --output logs/qwen-2511-character-benchmark.json
```

Expected: report contains eight shots. If models are not installed, record the exact preflight diagnostics and do not claim visual verification.

- [ ] **Step 4: Run Klein benchmark when installed**

```powershell
npm run benchmark:characters -- --character asset_1774017261433_390 --provider flux2_klein_4b --base-url http://127.0.0.1:8188 --output logs/klein-4b-character-benchmark.json
```

Expected: report contains eight shots. Keep Qwen as default unless Klein passes every hard gate and has the higher weighted score or materially lower time at no more than a 0.03 score deficit.

- [ ] **Step 5: Update production workflow documentation**

Replace the old dual-IPAdapter-first recommendation with the new provider-neutral sequential character flow. Retain SD1.5/IPAdapter only as a legacy fallback and document that previous-shot continuity never overrides the canonical identity pack.

- [ ] **Step 6: Inspect the final diff**

Run: `git status --short` and `git diff --check`.

Expected: no whitespace errors; unrelated pre-existing modifications remain untouched.

- [ ] **Step 7: Commit the verification documentation**

```powershell
git add -p -- docs/stable-storyboard-workflow-20260319.md
git commit -m "docs: publish character consistency workflow"
```
