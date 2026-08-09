# Cinematic 3D Donghua Style Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a versioned cinematic semi-realistic 3D donghua style to character assets, storyboard stills, redraws, and videos while allowing animal anatomy only for explicitly tagged beastfolk, then migrate Shen Yan to a newly approved identity pack and run the strict eight-shot Klein gate.

**Architecture:** Add a small pure runtime that owns the immutable style contract, explicit species allowlist, conflict detection, prompt clauses, and digest. Bind the style/species payload into character identity metadata and evidence, then make the existing Comfy token assembly call the runtime for every visual scope without adding style images to the reference graph. A separate fail-closed CLI generates non-destructive Shen Yan migration candidates; only operator-selected files update the identity pack before the existing benchmark/attestation pipeline runs.

**Tech Stack:** TypeScript 5.6, React 18, Node.js ESM, ComfyUI Desktop HTTP API, official FLUX.2 Klein 4B FP8 graph, pinned offline SigLIP2 evaluator, Tauri 2/Rust verification backend.

## Global Constraints

- Style contract ID/version: `cinematic_3d_donghua_v1` / `1.0.0`.
- Hardware target: NVIDIA GeForce RTX 5070 Ti with 16 GB VRAM; do not add a style model, ControlNet, IP-Adapter, or style LoRA.
- The three supplied screenshots are design references only and must never become `LoadImage`, `ReferenceLatent`, IP-Adapter, identity-reference, or benchmark-reference inputs.
- Klein keeps exactly two active immutable character-reference inputs per attempt.
- Species anatomy is explicit-only. Missing or ambiguous metadata defaults to human.
- Supported explicit species IDs are `human`, `beastfolk`, `catfolk`, `foxfolk`, and `wolffolk`.
- Shen Yan (`asset_1774017261433_390`) is human and must receive `human ears only, no animal ears, no tail, no horns, no animal muzzle`.
- Never overwrite old reference images, benchmark reports, or artifacts.
- Any style-contract, species, identity metadata, or approved-reference change invalidates evidence bound to the old bytes/digests.
- Keep evaluator model `google/siglip2-base-patch16-224` at revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`; do not edit evaluator scores or floors.
- Production unlock still requires eight accepted model-generation shots, `evidenceEligible: true`, and a backend-issued private receipt.

---

## File Structure

- Create `src/modules/comfy-pipeline/characterStyleContractRuntime.mjs`: pure contract, digest, label parser, conflict detection, and prompt composition.
- Create `src/modules/comfy-pipeline/characterStyleContract.ts`: typed facade and species/style types.
- Create `scripts/check-character-style-contract.mjs`: executable behavior tests for human/beastfolk routing and token injection.
- Modify `src/modules/storyboard-core/types.ts`: persist `species`, `speciesTraits`, `styleContractId`, `styleContractVersion`, and `styleContractDigest` in `CharacterIdentityPack`.
- Modify `src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs`: include canonical species/style fields in the identity metadata digest.
- Modify `src/modules/asset-manager/AssetPanel.tsx`: expose an explicit species selector and read-only canonical style status.
- Modify `src/modules/asset-manager/characterIdentityUiRuntime.mjs` and `characterIdentityUi.ts`: defaults, validation, display state, and evidence invalidation reason.
- Modify `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`: use the canonical style contract as the default global prompt and warn on unversioned custom edits.
- Modify `src/modules/comfy-pipeline/comfyService.ts`: apply the style to character assets and inject per-character species clauses into image/video tokens.
- Modify `src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs`: require and bind the canonical style/species digest.
- Modify `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`: verify that stored evidence still matches the expanded identity metadata digest.
- Create `scripts/run-character-style-migration.mjs`: non-destructive three-view candidate generator and manifest publisher.
- Create `scripts/check-character-style-migration.mjs`: mocked HTTP, path safety, graph proof, and no-auto-approval tests.
- Create `examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json`: official two-reference migration graph.
- Modify `package.json`: add focused style-contract and migration test scripts.
- Modify `docs/comfyui-storyboard-setup.md`: document the preset, species gate, migration, approval, invalidation, and release procedure.

---

### Task 1: Pure Style Contract and Explicit Species Resolver

**Files:**
- Create: `src/modules/comfy-pipeline/characterStyleContractRuntime.mjs`
- Create: `src/modules/comfy-pipeline/characterStyleContract.ts`
- Create: `scripts/check-character-style-contract.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `CINEMATIC_3D_DONGHUA_CONTRACT`, `computeCharacterStyleContractDigest(contract)`, `resolveCharacterSpecies(input)`, `buildCharacterSpeciesClauses(result)`, and `applyCharacterStyleContractToTokens(input)`.
- Consumes no UI, filesystem, or Comfy dependencies; later tasks import this pure runtime from Node and TypeScript.

- [ ] **Step 1: Add a failing executable contract test**

Create `scripts/check-character-style-contract.mjs` with assertions equivalent to:

```js
import assert from "node:assert/strict";
import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  applyCharacterStyleContractToTokens,
  computeCharacterStyleContractDigest,
  resolveCharacterSpecies
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";

assert.equal(CINEMATIC_3D_DONGHUA_CONTRACT.id, "cinematic_3d_donghua_v1");
assert.equal(CINEMATIC_3D_DONGHUA_CONTRACT.version, "1.0.0");
assert.match(computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT), /^[a-f0-9]{64}$/);

assert.deepEqual(resolveCharacterSpecies({ identitySpecies: "human", explicitLabels: ["forest camp"] }), {
  ok: true, species: "human", source: "identity"
});
assert.equal(resolveCharacterSpecies({ explicitLabels: [] }).species, "human");
assert.equal(resolveCharacterSpecies({ explicitLabels: ["species:catfolk"] }).species, "catfolk");
assert.equal(resolveCharacterSpecies({ explicitLabels: ["猫耳发箍", "毛领"] }).species, "human");
assert.deepEqual(resolveCharacterSpecies({ identitySpecies: "human", explicitLabels: ["species:wolffolk"] }), {
  ok: false, reason: "species_metadata_conflict"
});

const human = applyCharacterStyleContractToTokens({
  tokens: { PROMPT: "Shen Yan front view", NEGATIVE_PROMPT: "" },
  kind: "image",
  characters: [{ name: "Shen Yan", species: "human" }]
});
assert.match(human.PROMPT, /cinematic semi-realistic 3D donghua/i);
assert.match(human.NEGATIVE_PROMPT, /human ears only.*no animal ears.*no tail/i);
assert.doesNotMatch(human.PROMPT, /cat ears|fox ears|wolf ears/i);

const catfolk = applyCharacterStyleContractToTokens({
  tokens: { VIDEO_PROMPT: "walks through camp", NEGATIVE_PROMPT: "" },
  kind: "video",
  characters: [{ name: "Miao", species: "catfolk", speciesTraits: ["black cat ears", "black tail"] }]
});
assert.match(catfolk.VIDEO_PROMPT, /Miao.*black cat ears.*black tail/i);
assert.doesNotMatch(catfolk.NEGATIVE_PROMPT, /no animal ears/i);

console.log("PASS cinematic 3D donghua style contract and explicit species gate");
```

- [ ] **Step 2: Register and run the test to prove RED**

Add:

```json
"test:character-style": "node scripts/check-character-style-contract.mjs"
```

Run: `npm.cmd run test:character-style`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `characterStyleContractRuntime.mjs`.

- [ ] **Step 3: Implement the pure runtime**

Implement a deeply frozen contract whose positive prompt contains the approved rendering/material/lighting language and whose negative prompt contains the exclusions from the spec. Use a stable key-sorted serializer plus SHA-256. Parse only exact normalized labels from this allowlist:

```js
const LABEL_TO_SPECIES = Object.freeze({
  "species:human": "human",
  "人类": "human",
  "species:beastfolk": "beastfolk",
  "兽族": "beastfolk",
  "species:catfolk": "catfolk",
  "猫族": "catfolk",
  "species:foxfolk": "foxfolk",
  "狐族": "foxfolk",
  "species:wolffolk": "wolffolk",
  "狼族": "wolffolk"
});
```

Do not scan free-form story prose. `resolveCharacterSpecies` accepts only `identitySpecies` and an `explicitLabels` array; zero matches means human, multiple distinct matches or disagreement with identity metadata returns `{ ok: false, reason: "species_metadata_conflict" }`.

`applyCharacterStyleContractToTokens` must:

```js
return {
  ...tokens,
  PROMPT: kind === "image" ? append(tokens.PROMPT, contract.positivePrompt, speciesPositive) : tokens.PROMPT,
  NEXT_SCENE_PROMPT: kind === "image" ? append(tokens.NEXT_SCENE_PROMPT, contract.positivePrompt, speciesPositive) : tokens.NEXT_SCENE_PROMPT,
  VIDEO_PROMPT: kind === "video" ? append(tokens.VIDEO_PROMPT, contract.positivePrompt, speciesPositive) : tokens.VIDEO_PROMPT,
  NEGATIVE_PROMPT: append(tokens.NEGATIVE_PROMPT, contract.negativePrompt, speciesNegative),
  GLOBAL_VISUAL_STYLE: contract.positivePrompt,
  GLOBAL_STYLE_NEGATIVE: contract.negativePrompt,
  STYLE_CONTRACT_ID: contract.id,
  STYLE_CONTRACT_VERSION: contract.version,
  STYLE_CONTRACT_DIGEST: computeCharacterStyleContractDigest(contract)
};
```

- [ ] **Step 4: Add the typed facade**

Expose:

```ts
export type CharacterSpeciesId = "human" | "beastfolk" | "catfolk" | "foxfolk" | "wolffolk";
export type CharacterSpeciesResolution =
  | { ok: true; species: CharacterSpeciesId; source: "identity" | "script_label" | "default_human" }
  | { ok: false; reason: "species_metadata_conflict" };
export type CharacterStyleContract = {
  id: "cinematic_3d_donghua_v1";
  version: "1.0.0";
  positivePrompt: string;
  negativePrompt: string;
};
```

Re-export runtime functions with matching signatures from `characterStyleContract.ts`.

- [ ] **Step 5: Run focused and existing prompt tests**

Run independently:

```powershell
npm.cmd run test:character-style
npm.cmd run test:character-consistency
npm.cmd run test:storyboard-generation-flow
```

If `test:storyboard-generation-flow` is not registered, run `node scripts/check-storyboard-generation-flow.mjs` directly. Expected: all exit 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- package.json scripts/check-character-style-contract.mjs src/modules/comfy-pipeline/characterStyleContractRuntime.mjs src/modules/comfy-pipeline/characterStyleContract.ts
git commit -m "feat: add cinematic donghua style contract"
```

---

### Task 2: Persist Style and Species in Identity Metadata and Evidence

**Files:**
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs`
- Modify: `src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs`
- Modify: `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`
- Modify: `src/modules/asset-manager/characterIdentityUiRuntime.mjs`
- Modify: `src/modules/asset-manager/characterIdentityUi.ts`
- Modify: `src/modules/asset-manager/AssetPanel.tsx`
- Modify: `scripts/check-character-identity-schema.mjs`
- Modify: `scripts/check-character-identity-ui.mjs`
- Modify: `scripts/check-character-generation-evidence.mjs`

**Interfaces:**
- Consumes the Task 1 contract digest and `CharacterSpeciesId`.
- Produces identity packs and evidence contexts that bind `species`, `speciesTraits`, `styleContractId`, `styleContractVersion`, and `styleContractDigest`.

- [ ] **Step 1: Extend failing identity/evidence fixtures**

Update every complete identity fixture to include:

```js
species: "human",
speciesTraits: [],
styleContractId: "cinematic_3d_donghua_v1",
styleContractVersion: "1.0.0",
styleContractDigest: computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT)
```

Add negative assertions:

```js
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, species: "dragonfolk" }).ok, false);
assert.equal(buildTrustedCharacterEvidenceContext({ ...asset, characterIdentityPack: { ...identity, styleContractDigest: "0".repeat(64) } }).reason, "style_contract_mismatch");
assert.equal(validateStoredCharacterEvidence(evidence, { ...context, species: "catfolk" }).reason, "identity_metadata_mismatch");
```

- [ ] **Step 2: Run the focused tests to prove RED**

Run:

```powershell
npm.cmd run test:character-identity
npm.cmd run test:character-identity-ui
npm.cmd run test:character-generation-evidence
```

Expected: at least one failure for missing style/species validation and one for missing evidence invalidation.

- [ ] **Step 3: Extend the persisted types and canonical digest**

Add to `CharacterIdentityPack`:

```ts
species: CharacterSpeciesId;
speciesTraits: string[];
styleContractId: "cinematic_3d_donghua_v1";
styleContractVersion: "1.0.0";
styleContractDigest: string;
```

Update `validateAndCanonicalizeCharacterIdentityMetadata` so the canonical payload is:

```js
{
  triggerWord,
  immutableTraits,
  forbiddenChanges,
  species,
  speciesTraits: normalizedSpeciesTraits,
  styleContractId,
  styleContractVersion,
  styleContractDigest
}
```

Require an empty `speciesTraits` list for `human`; require one to eight non-empty traits for non-human species. Require the style ID/version/digest to equal the Task 1 canonical contract.

For old stored assets, the editor may display a missing species value as `human`, but evidence context construction remains invalid until the canonical style fields are explicitly persisted. This prevents old flat-reference evidence from being relabeled as the new style merely by loading the project.

- [ ] **Step 4: Bind the fields into evidence contexts**

Make `buildTrustedCharacterEvidenceContext` return the canonical fields and fail closed with:

```js
if (identity.styleContractId !== contract.id ||
    identity.styleContractVersion !== contract.version ||
    identity.styleContractDigest !== canonicalDigest) {
  return { ok: false, reason: "style_contract_mismatch" };
}
```

The existing `identityMetadataDigest` remains the single receipt claim carrying these fields; do not add a second independently mutable digest.

- [ ] **Step 5: Add identity editor controls**

Add a species `<select>` with exactly the five supported IDs. For human, clear `speciesTraits`; for non-human, show a newline-separated species-traits editor. Show `cinematic_3d_donghua_v1 · 1.0.0` and the first 12 digest characters as read-only status. Use `persistCharacterIdentity` so edits refresh `updatedAt` and invalidate both existing evidence tracks through the metadata digest.

- [ ] **Step 6: Run focused tests and build**

```powershell
npm.cmd run test:character-identity
npm.cmd run test:character-identity-ui
npm.cmd run test:character-generation-evidence
npm.cmd run test:character-evidence-attestation
npm.cmd run build
```

Expected: all exit 0; only the existing Vite chunk-size advisory may remain.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/modules/storyboard-core/types.ts src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs src/modules/asset-manager/characterIdentityUiRuntime.mjs src/modules/asset-manager/characterIdentityUi.ts src/modules/asset-manager/AssetPanel.tsx scripts/check-character-identity-schema.mjs scripts/check-character-identity-ui.mjs scripts/check-character-generation-evidence.mjs
git commit -m "feat: bind character evidence to style and species"
```

---

### Task 3: Inject the Contract Across Character, Storyboard, Redraw, and Video Paths

**Files:**
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
- Modify: `scripts/check-storyboard-generation-flow.mjs`
- Modify: `scripts/check-character-consistency-ui.mjs`
- Modify: `scripts/check-character-style-contract.mjs`

**Interfaces:**
- Consumes Task 1 prompt composition and Task 2 persisted identity fields.
- Produces exact style/species tokens for every visual generation scope while preserving the existing identity-reference graph.

- [ ] **Step 1: Add failing integration assertions**

Extend the executable tests to prove:

```js
assert.match(characterAssetTokens.PROMPT, /cinematic semi-realistic 3D donghua/i);
assert.match(characterAssetTokens.NEGATIVE_PROMPT, /human ears only.*no animal ears/i);
assert.match(storyboardTokens.PROMPT, /Shen Yan.*human ears only/i);
assert.match(videoTokens.VIDEO_PROMPT, /Miao.*cat ears.*tail/i);
assert.equal(compiledKleinReferenceLoaders.length, 2);
assert.equal(compiledKleinReferenceLoaders.some((node) => /codex-clipboard|style.reference/i.test(node.inputs.image)), false);
```

Add a conflict case where the identity says human and the shot tag says `species:wolffolk`; generation must reject before `/prompt` with `species_metadata_conflict`.

- [ ] **Step 2: Run integration checks to prove RED**

```powershell
node scripts/check-storyboard-generation-flow.mjs
npm.cmd run test:character-consistency-ui
npm.cmd run test:character-style
```

Expected: character-asset style inheritance and conflict rejection fail before implementation.

- [ ] **Step 3: Replace the character-asset exclusion**

In `comfyService.ts`, remove:

```ts
const shouldInjectVisualStyle = scope !== "character_asset";
const shouldInjectStyleNegative = scope !== "character_asset";
```

Build a per-request character list from the matched `Asset` records and explicit `Shot.tags`, call `resolveCharacterSpecies`, and then call `applyCharacterStyleContractToTokens`. Do not read species from `storyPrompt`, `notes`, dialogue, costume strings, or scene descriptions.

For character-asset shots, match the asset by the existing `assetOutputContext.assetName` and require exactly one match. For storyboard/video shots, use `shot.characterRefs`; missing referenced assets fail existing reference validation before species routing.

- [ ] **Step 4: Make the panel default canonical and diagnose custom text**

Set the default positive/negative values from `CINEMATIC_3D_DONGHUA_CONTRACT`. If a saved operator prompt differs, preserve it for editing but show `自定义风格未版本化，不能生成发布证据`; do not label it `cinematic_3d_donghua_v1` or reuse the canonical digest.

- [ ] **Step 5: Verify graph separation**

Ensure style tokens only enter string fields. `verifyCompiledCharacterReferenceBindings` must still see exactly the view-selected identity references. Add a regression where an extra style `LoadImage` reaches `ReferenceLatent`; expected result is `compiled_reference_binding_mismatch`.

- [ ] **Step 6: Run all affected tests and build**

```powershell
npm.cmd run test:character-style
npm.cmd run test:character-consistency
npm.cmd run test:sequential-character-passes
npm.cmd run test:character-reference-snapshot
npm.cmd run test:character-consistency-ui
node scripts/check-storyboard-generation-flow.mjs
npm.cmd run build
```

Expected: all exit 0.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- src/modules/comfy-pipeline/comfyService.ts src/modules/comfy-pipeline/ComfyPipelinePanel.tsx scripts/check-storyboard-generation-flow.mjs scripts/check-character-consistency-ui.mjs scripts/check-character-style-contract.mjs
git commit -m "feat: apply cinematic style across visual generation"
```

---

### Task 4: Non-Destructive Klein Style-Migration CLI

**Files:**
- Create: `scripts/run-character-style-migration.mjs`
- Create: `scripts/check-character-style-migration.mjs`
- Create: `examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json`
- Modify: `package.json`

**Interfaces:**
- Consumes a complete project identity pack, the canonical style contract, existing front/side/back source images, and a live Comfy endpoint.
- Produces a new exclusive output directory containing three candidate PNGs and `migration-manifest.json`; it never edits the project or approves candidates.

- [ ] **Step 1: Write failing CLI tests with mocked transport**

Cover parsing and validation:

```js
const args = parseStyleMigrationArgs([
  "--project", "examples/character-consistency-benchmark/current-project-klein-release-subject.json",
  "--character", "asset_1774017261433_390",
  "--provider", "flux2_klein_4b",
  "--base-url", "http://127.0.0.1:8188",
  "--workflow", "examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json",
  "--output", "logs/shen-yan-style-migration-v1"
]);
assert.equal(args.character, "asset_1774017261433_390");
```

Also assert rejection of output overwrite, paths outside the workspace, symlinks/reparse points, malformed image magic, non-human Shen Yan metadata, non-Klein model binding, fewer or more than two active reference loaders, unresolved tokens, a screenshot/style reference loader, fallback output, and any attempt to mutate the project JSON. The legacy migration source may omit target-style fields because it is an audit-only source pack; the CLI always imports the canonical target contract from Task 1 and records its digest in the new manifest.

- [ ] **Step 2: Register and run the migration test to prove RED**

Add:

```json
"test:character-style-migration": "node scripts/check-character-style-migration.mjs",
"migrate:character-style": "node scripts/run-character-style-migration.mjs"
```

Run: `npm.cmd run test:character-style-migration`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the official two-reference workflow**

Base it on `flux2-klein-4b-reference-smoke-api.json`. Keep the authoritative bindings:

```json
{
  "class_type": "UNETLoader",
  "inputs": {
    "unet_name": "flux-2-klein-4b-fp8.safetensors",
    "weight_dtype": "default"
  }
}
```

The only active `LoadImage` nodes use `{{REFERENCE_IMAGE_A}}` and `{{REFERENCE_IMAGE_B}}`; the prompt must use `{{PROMPT}}`, `{{VIEW}}`, `{{STYLE_CONTRACT_ID}}`, `{{STYLE_CONTRACT_VERSION}}`, and `{{CHARACTER_ASSET_ID}}`. Keep one selected `SaveImage` terminal and no LoRA node.

- [ ] **Step 4: Implement the CLI**

Export testable helpers:

```js
export function parseStyleMigrationArgs(argv) {}
export async function loadStyleMigrationSubject(projectPath, character, dependencies = {}) {}
export function compileStyleMigrationWorkflow(template, tokens) {}
export async function runCharacterStyleMigration(options, dependencies = {}) {}
export async function writeMigrationManifestExclusive(outputDirectory, manifest, dependencies = {}) {}
```

Use three fixed passes:

```js
const PASSES = Object.freeze([
  { id: "front", sourceSlots: ["face_master", "body_front"], seed: 2026080901 },
  { id: "side", sourceSlots: ["face_left", "body_side"], seed: 2026080902 },
  { id: "back", sourceSlots: ["hair_back", "body_back"], seed: 2026080903 }
]);
```

Each prompt names the immutable traits, exact view, canonical style, and human-only constraint. Stage immutable copies under a run-owned temporary directory, upload them to Comfy, queue serially, materialize output bytes under the exclusive output directory, hash every source and output, and clean only the owned temporary directory.

Publish `migration-manifest.json` last with:

```js
{
  schemaVersion: 1,
  status: "awaiting_operator_approval",
  characterAssetId,
  sourceIdentityPackVersion,
  proposedIdentityPackVersion: `${sourceIdentityPackVersion}-cinematic3d-v1`,
  styleContract: { id, version, digest },
  species: "human",
  provider: "flux2_klein_4b",
  modelName: "flux-2-klein-4b-fp8.safetensors",
  workflowDigest,
  candidates: [{ view, sourceSha256, outputSha256, outputPath, seed }]
}
```

- [ ] **Step 5: Run focused tests**

```powershell
npm.cmd run test:character-style-migration
npm.cmd run test:character-providers
npm.cmd run test:character-reference-snapshot
```

Expected: all exit 0 without contacting live ComfyUI.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- package.json scripts/run-character-style-migration.mjs scripts/check-character-style-migration.mjs examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json
git commit -m "feat: add controlled character style migration"
```

---

### Task 5: Generate and Approve Shen Yan Migration Candidates

**Files:**
- Generated, not committed: `logs/shen-yan-style-migration-v1/`
- Generated after approval, not committed: `examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d.json`
- Create after approval: `.superpowers/sdd/shen-yan-cinematic3d-migration-report.md`

**Interfaces:**
- Consumes Task 4 CLI and the live ComfyUI Desktop instance.
- Produces operator-selected front/side/back/hero paths and a new exported project backup; this task must pause for user approval between generation and identity update.

- [ ] **Step 1: Verify live preflight**

Confirm `/system_stats` reports the RTX 5070 Ti and `/object_info` contains `UNETLoader`, `ReferenceLatent`, `CFGGuider`, `Flux2Scheduler`, and the exact selectable `flux-2-klein-4b-fp8.safetensors`. Confirm the three legacy source hashes still match the migration subject.

- [ ] **Step 2: Run the live migration once**

```powershell
npm.cmd run migrate:character-style -- --project examples/character-consistency-benchmark/current-project-klein-release-subject.json --character asset_1774017261433_390 --provider flux2_klein_4b --base-url http://127.0.0.1:8188 --workflow examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json --output logs/shen-yan-style-migration-v1
```

Expected: exit 0, three output PNGs, and manifest status `awaiting_operator_approval`.

- [ ] **Step 3: Inspect and present candidates**

Open all three outputs at original resolution. Check face shape, blue eyes when visible, short dark-brown side-swept hair, teal tunic, navy long coat, brown belt, brown boots, adult male proportions, matching materials, and absence of animal anatomy. Present the three images to the user and ask for explicit approval or view-specific regeneration instructions.

- [ ] **Step 4: Apply only approved view-specific remediation**

If a view is rejected, keep the first manifest and output directory unchanged. Increment the output path (`v2`, `v3`), change only the failed view's prompt/seed or approved source pairing, and run a new complete manifest. Never replace bytes in an existing directory.

- [ ] **Step 5: Create a new exported identity pack after approval**

Read the approved manifest, assign its candidate records by `view`, and use `apply_patch` to create the new project JSON while preserving the asset ID. Derive every changed value exactly as follows before writing it:

```js
const candidates = Object.fromEntries(manifest.candidates.map((candidate) => [candidate.view, candidate]));
if (!["front", "side", "back"].every((view) => candidates[view]?.outputPath)) {
  throw new Error("approved migration manifest is missing a required view");
}
const nextIdentity = {
  ...currentIdentity,
  version: "shen-yan-identity-v1-cinematic3d-v1",
  species: "human",
  speciesTraits: [],
  styleContractId: manifest.styleContract.id,
  styleContractVersion: manifest.styleContract.version,
  styleContractDigest: manifest.styleContract.digest,
  faceMasterPath: candidates.front.outputPath,
  bodyFrontPath: candidates.front.outputPath,
  faceLeftPath: candidates.side.outputPath,
  faceRightPath: candidates.side.outputPath,
  bodySidePath: candidates.side.outputPath,
  hairBackPath: candidates.back.outputPath,
  bodyBackPath: candidates.back.outputPath,
  neutralExpressionPath: candidates.front.outputPath,
  approvedHeroFramePaths: [candidates.front.outputPath],
  updatedAt: new Date().toISOString()
};
```

Before applying the patch, print `nextIdentity` and compare its three paths and digest to the approved manifest. Do not invent paths or digests.

- [ ] **Step 6: Prove old evidence invalidates**

Run the evidence validator with the old stored evidence and the new context. Expected: invalid with `identity_pack_version_mismatch`, `identity_metadata_mismatch`, or `reference_manifest_mismatch`; it must never return valid.

- [ ] **Step 7: Record and commit only the migration report**

Write the exact manifest path, hashes, user approval, new identity version, invalidation result, and unresolved visual issues to `.superpowers/sdd/shen-yan-cinematic3d-migration-report.md`.

```powershell
git add -- .superpowers/sdd/shen-yan-cinematic3d-migration-report.md
git commit -m "docs: record Shen Yan cinematic style migration"
```

Do not commit generated PNGs or the machine-specific exported project JSON.

---

### Task 6: Strict Eight-Shot Release Gate and Documentation

**Files:**
- Modify: `docs/comfyui-storyboard-setup.md`
- Create: `.superpowers/sdd/shen-yan-cinematic3d-release-report.md`
- Generated, not committed: `logs/character-consistency-benchmark-klein-cinematic3d-zero-shot.json`
- Generated, not committed: `logs/character-consistency-benchmark-klein-cinematic3d-zero-shot-artifacts/`

**Interfaces:**
- Consumes the user-approved identity pack from Task 5 and the existing trusted benchmark/evaluator/attestor chain.
- Produces either an evidence-eligible imported receipt or an exact blocked report; it never manually changes readiness.

- [ ] **Step 1: Run the full automated suite**

Run independently:

```powershell
npm.cmd run test:character-style
npm.cmd run test:character-style-migration
npm.cmd run test:character-identity
npm.cmd run test:character-consistency
npm.cmd run test:character-providers
npm.cmd run test:character-provider-settings
npm.cmd run test:sequential-character-passes
npm.cmd run test:character-identity-ui
npm.cmd run test:character-consistency-ui
npm.cmd run test:character-generation-evidence
npm.cmd run test:character-evidence-attestation
npm.cmd run test:character-reference-snapshot
npm.cmd run test:character-benchmark
npm.cmd run test:character-evaluator
npm.cmd run build
```

Also run:

```powershell
& "C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe" -m py_compile scripts/evaluators/siglip2-character-worker.py scripts/evaluators/siglip2-character-attestor.py scripts/check-character-attestor-snapshot.py
& "C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe" scripts/check-character-attestor-snapshot.py
& "C:\Users\Administrator\.cargo\bin\cargo.exe" fmt --manifest-path src-tauri/Cargo.toml --check
& "C:\Users\Administrator\.cargo\bin\cargo.exe" check --manifest-path src-tauri/Cargo.toml --locked
& "C:\Users\Administrator\.cargo\bin\cargo.exe" test --manifest-path src-tauri/Cargo.toml --locked
```

Expected: every command exits 0; the existing Vite chunk-size warning is non-blocking.

- [ ] **Step 2: Run the strict benchmark to a new path**

```powershell
npm.cmd run benchmark:characters -- --mode zero-shot --project examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d.json --character asset_1774017261433_390 --provider flux2_klein_4b --base-url http://127.0.0.1:8188 --output logs/character-consistency-benchmark-klein-cinematic3d-zero-shot.json --workflow examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json --output-node 19 --evaluator-module scripts/evaluators/siglip2-character-evaluator.mjs
```

Expected release result: exit 0, `aggregate.status: "accepted"`, `accepted: 8`, zero retries unless recorded by policy, `evidenceEligible: true`, 64-character evidence digest, zero authoritative LoRA bindings, and eight new model-generation artifact hashes.

- [ ] **Step 3: Import only an accepted report**

If and only if Step 2 is fully accepted, import through the zero-shot evidence control. Confirm backend SigLIP2 re-evaluation and receipt registry publication succeed, the UI shows the zero-shot verified badge, and the production resolver returns Klein with `appliedLora: null`.

Change a copied reference byte and confirm the copied context reports `reference_manifest_mismatch`; restore the untouched real reference without editing evidence.

- [ ] **Step 4: Preserve an honest blocked outcome**

If any shot is not accepted, do not import it. Record each failed dimension and state `production gate remains closed`. Apply only view-specific remediation supported by the report, version the changed workflow/fixture, and use a new report path.

- [ ] **Step 5: Update documentation and release report**

Document the canonical style contract, explicit species labels, human default, no-screenshot-input rule, migration/approval flow, evidence invalidation, CLI commands, model/evaluator revisions, reference/output hashes, per-shot scores, retries, aggregate status, receipt ID if issued, and unresolved failures.

- [ ] **Step 6: Final diff verification**

```powershell
git diff --check -- src/modules/comfy-pipeline/characterStyleContractRuntime.mjs src/modules/comfy-pipeline/characterStyleContract.ts src/modules/storyboard-core/types.ts src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs src/modules/asset-manager/characterIdentityUiRuntime.mjs src/modules/asset-manager/characterIdentityUi.ts src/modules/asset-manager/AssetPanel.tsx src/modules/comfy-pipeline/ComfyPipelinePanel.tsx src/modules/comfy-pipeline/comfyService.ts scripts/check-character-style-contract.mjs scripts/run-character-style-migration.mjs scripts/check-character-style-migration.mjs scripts/run-character-consistency-benchmark.mjs scripts/evaluators/siglip2-character-attestor.py scripts/character-evidence-attestation.mjs src-tauri/src/main.rs package.json docs/comfyui-storyboard-setup.md
```

Expected: exit 0 with no whitespace errors in scoped files.

- [ ] **Step 7: Commit Task 6 documentation**

```powershell
git add -- docs/comfyui-storyboard-setup.md .superpowers/sdd/shen-yan-cinematic3d-release-report.md
git commit -m "docs: publish cinematic 3D character release evidence"
```

Do not stage generated images, benchmark artifacts, machine-specific project exports, or unrelated dirty files.
