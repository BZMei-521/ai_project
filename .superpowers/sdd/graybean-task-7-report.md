# Graybean Task 7 Report

## Outcome

- Added a role-neutral `ComfyClient` boundary for HTTP object-info access, prompt queue/history transport, Comfy view reads, and desktop file writes/copies.
- Added a dead-code auditor that resolves static imports, dynamic imports, route-registry tokens, and package scripts. Referenced candidates are blocked with exit code 1.
- Preserved every existing `comfyService.ts` public export and added a compatibility re-export for `ComfyClient` and `normalizeComfyBaseUrl` in the working tree.
- Deleted zero files. No media, snapshots, presets, generated outputs, or user artifacts were touched.

## Transport And Export Map

`ComfyPipelinePanel.tsx` imports its generation/diagnostic API from `comfyService.ts`. It does not own direct HTTP or queue calls, but it still owns desktop file/log/config operations (`copy_file_to`, `write_base64_file`, cache/resolve helpers, and runtime config persistence). Extracting those calls would require moving stateful panel workflows and was not safe in the shared 18.6k-line dirty file.

`comfyService.ts` currently combines these public areas:

- queue state and retry: `queueStoryboardShot`, `queueStoryboardBatch`, `retryStoryboardTask`
- environment/diagnostics: ping, endpoint/dir discovery, object info, dependency inspection, plugins, model health
- character: redraw planning, preflight, identity materialization, three-view split
- storyboard: staged generation, retry snapshots, composite fallback
- video/audio: mode selection, lip-sync inspection, TTS, output generation, concatenation
- panorama/skybox: reference planning, faces/front plate/face update
- shared workflow and output helpers

Known external consumers remain `ComfyPipelinePanel`, `AssetPanel`, `ShotInspectorPanel`, `ShotListPanel`, `videoInventory`, `videoGeneration`, `VideoProductionPanel`, and `videoRoutedGeneration`. No export was removed or renamed.

The safe extraction delegates these low-level calls through `ComfyClient` in the working tree:

- `fetchObjectInfo` -> `getObjectInfo`
- `queueComfyPrompt` -> `queuePrompt`
- output polling -> `getHistory`
- source staging -> `fetchViewBase64`, `writeBase64File`, `copyFile`
- legacy URL normalization -> `normalizeComfyBaseUrl`

## TDD Evidence

Red state was observed before implementation:

- `node scripts/check-comfy-client.mjs` failed because `comfyClient.ts` could not be resolved.
- `node scripts/check-graybean-dead-code-contract.mjs` failed because `check-graybean-dead-code.mjs` did not exist.
- The compatibility assertion then failed before `comfyService.ts` imported/delegated to `ComfyClient`.

Green state:

- `node scripts/check-comfy-client.mjs` -> `PASS comfy client transport contract`
- `node scripts/check-comfy-service-client-boundary.mjs` -> `PASS comfy service compatibility boundary`
- `node scripts/check-graybean-dead-code-contract.mjs` -> `PASS graybean dead-code checker contract`

The dead-code contract uses a temporary repository and independently proves detection of all four required reference classes.

## Deletion Audit

Default repository audit:

```text
SAFE_REMOVAL_CANDIDATES=0
BLOCKED_REMOVAL_CANDIDATES=0
ZERO_DELETE: no removal candidate is proven safe in the current dirty workspace.
```

Explicitly auditing `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx` as a candidate fails with exit code 1 and reports:

```text
dynamic-import: src/features/advanced-tools/AdvancedToolsView.tsx
  (../../modules/comfy-pipeline/ComfyPipelinePanel)
```

Therefore neither the panel nor any compatibility branch was deleted. A forwarding-only `LegacyPipelinePanel.tsx` was not added because it would not extract a real responsibility and would not make the legacy panel unreachable.

## Verification

Passed:

- Comfy client transport contract
- Comfy service compatibility boundary
- dead-code checker contract and default zero-delete audit
- storyboard generation flow (preflight, staged success, partial batch failure, isolated retry)
- character provider registry
- video workflow router
- workbench feature routing
- `git diff --check` for Task 7 files

Full `npm.cmd run build` is blocked by a pre-existing error outside Task 7:

```text
src/modules/spatial-stage/mogeWorkflow.ts(15,43): error TS2550:
Property 'replaceAll' does not exist on type 'string'.
```

`comfyClient.ts` itself is bundled and executed by the focused esbuild contract.

## Commit And Dirty-Tree Handling

Commit `0c100dc` (`refactor: add comfy transport boundary audit`) contains exactly four standalone additions:

- `src/services/generation-providers/comfyClient.ts`
- `scripts/check-comfy-client.mjs`
- `scripts/check-graybean-dead-code.mjs`
- `scripts/check-graybean-dead-code-contract.mjs`

The narrow `comfyService.ts` compatibility/delegation edits and `scripts/check-comfy-service-client-boundary.mjs` remain unstaged. The shared service has approximately 30,760 added and 6,833 removed lines relative to HEAD from concurrent work; staging it would include unrelated changes. `ComfyPipelinePanel.tsx` was already dirty and was not edited or staged by Task 7.

## Remaining Extraction Debt

- Move Panel-owned desktop file/log/config operations behind a controller only after their stateful workflows have focused regression coverage.
- Split character, panorama, storyboard, video, quality, and diagnostics one responsibility at a time; the current dirty service cannot support safe physical moves.
- Route advanced tools through a real `LegacyPipelinePanel` only when focused subpanels exist.
- Re-run the full build after the spatial-stage TypeScript target/lib issue is resolved.
