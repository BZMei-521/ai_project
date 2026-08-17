# MiniMax H3 Task 1 Implementation Report

## RED

Command:

```powershell
node scripts/check-minimax-h3-presets.mjs
```

Result: failed as expected with `ENOENT` for
`src/modules/comfy-pipeline/presets/minimax-h3-t2v-v1.json`.

## GREEN and regression checks

```powershell
node scripts/build-minimax-h3-presets.mjs; node scripts/check-minimax-h3-presets.mjs
npm.cmd run test:minimax-h3-presets
npm.cmd run test:workflow-presets
npm.cmd run build
```

Results:

- `PASS minimax h3 API presets`
- Existing workflow preset regression passed, including all four generated H3 API prompts.
- TypeScript and Vite production build passed. Vite reported its pre-existing large-chunk advisory only.

## Files

- `scripts/build-minimax-h3-presets.mjs`
- `scripts/check-minimax-h3-presets.mjs`
- `src/modules/comfy-pipeline/presets/minimax-h3-t2v-v1.json`
- `src/modules/comfy-pipeline/presets/minimax-h3-i2v-v1.json`
- `src/modules/comfy-pipeline/presets/minimax-h3-flf2v-v1.json`
- `src/modules/comfy-pipeline/presets/minimax-h3-r2v-v1.json`
- `src/modules/comfy-pipeline/presets/minimax-h3-source-manifest.json`
- `package.json` (one new `test:minimax-h3-presets` script entry, intentionally left uncommitted because the file already has unrelated edits)
- `.superpowers/sdd/minimax-h3-task-1-report.md`

## Commit

Initial implementation: `5a7cadcc757bb6b327f7c3ec0b89f430ba5a374a`.

## Review remediation

- RED evidence: changing the T2V `UNETLoader` model from `fl2va` to `ref2va` still produced `PASS minimax h3 API presets` with the original presence-only checker.
- The strengthened checker now verifies exact models, every required sampler/decode/mux link, full per-mode token surface at the consuming inputs, T2V/I2V/FLF2V/R2V frame/reference semantics, and the manifest's 24 fps / 124–362 / `17k+5` contract.
- It generates four presets into an isolated temporary directory and compares their bytes with the checked-in artifacts, without modifying checked-in presets.
- Remediation validation: `node scripts/check-minimax-h3-presets.mjs` and `npm.cmd run test:workflow-presets` passed.
- Remediation commit: `dcbce0963c09785553aba02f6214cd22c02a7939`.

## Import-safety remediation

- RED evidence: importing `build-minimax-h3-presets.mjs` from an isolated temporary current directory created `src/modules/comfy-pipeline/presets/minimax-h3-t2v-v1.json`; the new no-side-effect assertion failed as intended.
- The builder now exports `buildBase`, `buildPrompt`, `presets`, and `writePresets`. Writing occurs only when its file is invoked directly as a CLI entrypoint.
- GREEN validation: importing the builder leaves the isolated directory unchanged; direct CLI generation and both `test:minimax-h3-presets` and `test:workflow-presets` pass.

## Known risks

- The presets use the verified MiniMax H3 node and model baseline recorded in the source manifest; availability still depends on the local ComfyUI installation matching that baseline.
- R2V intentionally supplies four optional `LoadImage` inputs. The future executor must prune unused reference nodes before queueing.
- `package.json` remains modified but unstaged: only the new MiniMax H3 test script is this task's change; existing edits make a minimal index patch unsafe on this Windows worktree.
