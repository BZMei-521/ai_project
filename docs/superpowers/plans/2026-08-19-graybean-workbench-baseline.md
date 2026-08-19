# Graybean Workbench Baseline

Captured on 2026-08-19 before the spatial director workbench refactor. Measurements describe the dirty working tree as it existed at capture time; no application source was changed for this baseline.

## Build and baseline status

- Baseline assertion: PASS. `node scripts/check-graybean-workbench-baseline.mjs` exited 0 and printed `baseline captured`.
- Production build: PASS. `npm.cmd run build` exited 0 after transforming 481 modules.
- The build emitted only the existing chunk-size warnings: `ComfyPipelinePanel` was 552.57 kB and `comfyService` was 640.18 kB, both above Vite's 500 kB warning threshold.
- The baseline check deliberately asserts only stable boundary facts: `App.tsx` references `LazyAuxPanelContent`, `ComfyPipelinePanel.tsx` exceeds 10,000 lines, and `comfyService.ts` exceeds 20,000 lines.

## Current entry and navigation wiring

- Application entry: `src/main.tsx` renders the app exported by `src/app/App.tsx`.
- `src/app/App.tsx:58` statically imports `LazyAuxPanelContent` and `preloadAuxPanel` from `src/app/LazyAuxPanelContent.tsx`.
- `src/app/App.tsx:60` defines the current navigation union as `"shots" | "inspector" | "layers" | "audio" | "assets" | "health" | "pipeline"`.
- `src/app/App.tsx:80` and `src/app/App.tsx:90` define the panel metadata and display order.
- `src/app/App.tsx:1449` renders the single-screen workbench layout; `src/app/App.tsx:1518` renders the selected `LazyAuxPanelContent`.
- There is no separate route registry in the current app. Top-level auxiliary navigation is local React state persisted under `storyboard-pro/aux-panel-state/v1` (`src/app/App.tsx:100`).

## Entry imports and future advanced-tools boundary

`src/app/LazyAuxPanelContent.tsx:9-37` is the current lazy-import boundary. These exact legacy panels must remain reachable only behind the future `advanced-tools` boundary during migration:

| Section | Current imported panel |
| --- | --- |
| `shots` | `src/modules/editor-shell/ShotListPanel.tsx` |
| `inspector` | `src/modules/editor-shell/ShotInspectorPanel.tsx` |
| `layers` | `src/modules/canvas-engine/LayerPanel.tsx` |
| `audio` | `src/modules/preview-engine/AudioTrackPanel.tsx` |
| `assets` | `src/modules/asset-manager/AssetPanel.tsx` |
| `health` | `src/modules/editor-shell/ProjectHealthPanel.tsx` |
| `pipeline` | `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx` |

The primary stage also directly imports `StoryboardPreviewPanel` and `TimelinePanel` at `src/app/App.tsx:43-44`; they are current workspace surfaces, not members of the legacy auxiliary-panel list above.

## Line counts

PowerShell `Get-Content` line counts at capture time:

| File | Lines |
| --- | ---: |
| `src/app/App.tsx` | 1,535 |
| `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx` | 18,600 |
| `src/modules/comfy-pipeline/comfyService.ts` | 34,661 |

## Snapshot and persistence schema facts

`StoryboardSnapshot` is exported from `src/modules/storyboard-core/store.ts:296` as a `Pick<StoryboardState, ...>`. Its current fields are:

1. `project`
2. `sequences`
3. `currentSequenceId`
4. `shots`
5. `selectedShotId`
6. `audioTracks`
7. `assets`
8. `canvasTool`
9. `layers`
10. `activeLayerByShotId`
11. `exportSettings`
12. `shotStrokes`
13. `shotHistory`
14. `generationTasks`

`StoryboardSnapshot` itself currently has no `schemaVersion` field. Related persistence envelopes are version 1:

- `src/modules/persistence/projectFile.ts:11`: `CURRENT_SCHEMA_VERSION = 1` for `ProjectFile`.
- `src/modules/persistence/backupSnapshot.ts:9`: `SNAPSHOT_BACKUP_SCHEMA_VERSION = 1` for snapshot backup files.

## Reproduction commands

Run from the repository root:

```powershell
node scripts/check-graybean-workbench-baseline.mjs
npm.cmd run build
(Get-Content 'src/app/App.tsx').Count
(Get-Content 'src/modules/comfy-pipeline/ComfyPipelinePanel.tsx').Count
(Get-Content 'src/modules/comfy-pipeline/comfyService.ts').Count
rg -n "LazyAuxPanelContent|ComfyPipelinePanel|AssetPanel|ShotInspectorPanel|EditorShell|route|Route|panel|Panel" src/app src/main.tsx src/modules/editor-shell
rg -n -A 20 -B 5 "export type StoryboardSnapshot|CURRENT_SCHEMA_VERSION|SNAPSHOT_BACKUP_SCHEMA_VERSION" src/modules/storyboard-core/store.ts src/modules/persistence
```
