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

Pending final commit SHA.

## Known risks

- The presets use the verified MiniMax H3 node and model baseline recorded in the source manifest; availability still depends on the local ComfyUI installation matching that baseline.
- R2V intentionally supplies four optional `LoadImage` inputs. The future executor must prune unused reference nodes before queueing.
- `package.json` remains modified but unstaged: only the new MiniMax H3 test script is this task's change; existing edits make a minimal index patch unsafe on this Windows worktree.
