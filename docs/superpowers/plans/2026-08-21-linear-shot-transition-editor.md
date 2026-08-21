# Linear Shot Transition Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a JSON-driven linear shot editor in the 剧本 stage where users can reorder shot nodes, edit typed transition edges with advanced continuity parameters, persist them, and feed the same data into video continuity planning.

**Architecture:** Add `ShotTransition` as shared storyboard domain data, keep import and adjacency reconciliation in pure runtimes, and make the Zustand store the single source of truth for ordered shots plus transitions. The script-stage React components render a horizontal node chain and use the existing Director Desk inspector; video production consumes the stored transitions through the existing continuity planner rather than a parallel UI-only model.

**Tech Stack:** React 18, TypeScript 5.6, Zustand 4, existing `.mjs` pure runtimes, `react-test-renderer`, esbuild-based contract checks, Vite CSS, existing Director Desk shell.

**Design Spec:** `docs/superpowers/specs/2026-08-21-linear-shot-transition-editor-design.md`

## Global Constraints

- First release supports JSON import only.
- First release supports one strictly linear shot sequence: no branches, loops, one-to-many edges, or free node graph.
- Supported transition types are exactly `continuous`, `match_cut`, `hard_cut`, and `scene_change`.
- Supported frame dependencies are exactly `none`, `previous_tail`, and `shared_frame`.
- Transition duration is seconds, finite, and `>= 0`; `hard_cut` is always `0`; other defaults are `0.6` seconds and may not exceed the shorter adjacent shot.
- Missing `transitions` creates default `continuous` / `previous_tail` / `0.6` edges between adjacent shots.
- Import failures never mutate the current project.
- Stored transitions must be consumed by preview/video planning; UI-only edge state is forbidden.
- Reuse existing React, Zustand, snapshot, `VideoBoundaryKind`, continuity planner, and Director Desk infrastructure; add no UI framework or graph dependency.
- Preserve unrelated dirty and staged worktree changes; every commit stages only the files named by its task.

---

## Planned File Structure

```text
src/features/script-director/
  shotTransitionRuntime.mjs       # Pure adjacency, defaulting, reorder, delete logic
  shotTransitionModel.ts          # Typed facade over the pure runtime
  shotScriptImportRuntime.mjs     # JSON parse, legacy normalization, validation
  shotScriptImport.ts             # Typed import facade
  ShotNode.tsx                    # One accessible/draggable shot node
  TransitionEdge.tsx              # One selectable labeled transition edge
  ScriptDirectorView.tsx          # Import toolbar and horizontal shot chain
  ScriptTransitionInspector.tsx   # Shot details / transition parameter form
src/modules/storyboard-core/
  types.ts                        # Shared ShotTransition domain types
  store.ts                        # State, actions, snapshot and reconciliation wiring
src/modules/video-production/
  continuityPlanner.ts            # Typed boundary metadata
  continuityPlannerRuntime.mjs    # Preserve advanced transition metadata in plans
  VideoProductionPanel.tsx        # Build contexts from stored transitions
src/styles/
  script-transition-editor.css    # Desktop, compact and mobile editor layout
scripts/
  check-shot-transition-model.mjs
  check-shot-script-import.mjs
  check-shot-transition-store.mjs
  check-script-transition-components.mjs
  check-script-transition-integration.mjs
package.json                      # Aggregate test command
src/main.tsx                      # Feature stylesheet import
src/app/App.tsx                   # Script workspace, inspector and primary save action
```

---

### Task 1: Linear transition domain and adjacency reconciliation

**Files:**
- Modify: `src/modules/storyboard-core/types.ts`
- Create: `src/features/script-director/shotTransitionRuntime.mjs`
- Create: `src/features/script-director/shotTransitionModel.ts`
- Create: `scripts/check-shot-transition-model.mjs`

**Interfaces:**
- Consumes: existing `VideoBoundaryKind` from `src/modules/video-production/types.ts`.
- Produces: `ShotTransition`, `ShotTransitionFrameDependency`, `createDefaultShotTransition()`, `reconcileLinearTransitions()`, `moveShotInLinearSequence()`, and `removeShotFromLinearSequence()` for all later tasks.

- [ ] **Step 1: Write the failing pure-runtime contract**

Create `scripts/check-shot-transition-model.mjs` with explicit assertions for defaults, preservation, reordering, deletion, and duration clamping:

```js
import assert from "node:assert/strict";
import {
  createDefaultShotTransition,
  reconcileLinearTransitions,
  moveShotInLinearSequence,
  removeShotFromLinearSequence
} from "../src/features/script-director/shotTransitionRuntime.mjs";

const first = createDefaultShotTransition("seq-1", "shot-1", "shot-2", {
  maxDurationSeconds: 0.4
});
assert.deepEqual(first, {
  id: "shot-transition:shot-1:shot-2",
  sequenceId: "seq-1",
  fromShotId: "shot-1",
  toShotId: "shot-2",
  type: "continuous",
  durationSeconds: 0.4,
  frameDependency: "previous_tail",
  actionContinuity: "",
  characterPosition: "",
  cameraDirection: "",
  notes: ""
});

const edited = { ...first, durationSeconds: 0.25, actionContinuity: "保持推门动作" };
assert.deepEqual(
  reconcileLinearTransitions({
    sequenceId: "seq-1",
    orderedShots: [
      { id: "shot-1", durationSeconds: 4 },
      { id: "shot-2", durationSeconds: 3 },
      { id: "shot-3", durationSeconds: 2 }
    ],
    existingTransitions: [edited]
  }).map(({ fromShotId, toShotId, type, durationSeconds, actionContinuity }) => ({
    fromShotId, toShotId, type, durationSeconds, actionContinuity
  })),
  [
    { fromShotId: "shot-1", toShotId: "shot-2", type: "continuous", durationSeconds: 0.25, actionContinuity: "保持推门动作" },
    { fromShotId: "shot-2", toShotId: "shot-3", type: "continuous", durationSeconds: 0.6, actionContinuity: "" }
  ]
);

const moved = moveShotInLinearSequence({
  sequenceId: "seq-1",
  orderedShots: [
    { id: "shot-1", durationSeconds: 4 },
    { id: "shot-2", durationSeconds: 3 },
    { id: "shot-3", durationSeconds: 2 }
  ],
  transitions: [edited],
  shotId: "shot-3",
  targetIndex: 1
});
assert.deepEqual(moved.orderedShots.map(({ id }) => id), ["shot-1", "shot-3", "shot-2"]);
assert.deepEqual(moved.transitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [
  ["shot-1", "shot-3"], ["shot-3", "shot-2"]
]);
assert.equal(moved.transitions.some(({ actionContinuity }) => actionContinuity === "保持推门动作"), false);

const removed = removeShotFromLinearSequence({
  sequenceId: "seq-1",
  orderedShots: moved.orderedShots,
  transitions: moved.transitions,
  shotId: "shot-3"
});
assert.deepEqual(removed.orderedShots.map(({ id }) => id), ["shot-1", "shot-2"]);
assert.deepEqual(removed.transitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [["shot-1", "shot-2"]]);
console.log("PASS shot transition model");
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `node scripts/check-shot-transition-model.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `shotTransitionRuntime.mjs`.

- [ ] **Step 3: Add shared types and the minimal pure implementation**

Add to `src/modules/storyboard-core/types.ts`:

```ts
export type ShotTransitionFrameDependency = "none" | "previous_tail" | "shared_frame";

export type ShotTransition = {
  id: string;
  sequenceId: string;
  fromShotId: string;
  toShotId: string;
  type: VideoBoundaryKind;
  durationSeconds: number;
  frameDependency: ShotTransitionFrameDependency;
  sharedFramePath?: string;
  actionContinuity: string;
  characterPosition: string;
  cameraDirection: string;
  notes: string;
};
```

Implement `shotTransitionRuntime.mjs` with pair identity and adjacency as the only source of edge preservation:

```js
const DEFAULT_DURATION_SECONDS = 0.6;

const pairKey = (fromShotId, toShotId) => `${fromShotId}\u0000${toShotId}`;
const transitionId = (fromShotId, toShotId) =>
  `shot-transition:${encodeURIComponent(fromShotId)}:${encodeURIComponent(toShotId)}`;

export function createDefaultShotTransition(sequenceId, fromShotId, toShotId, options = {}) {
  const ceiling = Number.isFinite(options.maxDurationSeconds)
    ? Math.max(0, options.maxDurationSeconds)
    : DEFAULT_DURATION_SECONDS;
  return {
    id: transitionId(fromShotId, toShotId),
    sequenceId,
    fromShotId,
    toShotId,
    type: "continuous",
    durationSeconds: Math.min(DEFAULT_DURATION_SECONDS, ceiling),
    frameDependency: "previous_tail",
    actionContinuity: "",
    characterPosition: "",
    cameraDirection: "",
    notes: ""
  };
}

export function reconcileLinearTransitions({ sequenceId, orderedShots, existingTransitions }) {
  const existingByPair = new Map(
    existingTransitions
      .filter((item) => item.sequenceId === sequenceId)
      .map((item) => [pairKey(item.fromShotId, item.toShotId), item])
  );
  return orderedShots.slice(0, -1).map((fromShot, index) => {
    const toShot = orderedShots[index + 1];
    const ceiling = Math.min(fromShot.durationSeconds, toShot.durationSeconds);
    const existing = existingByPair.get(pairKey(fromShot.id, toShot.id));
    if (!existing) return createDefaultShotTransition(sequenceId, fromShot.id, toShot.id, { maxDurationSeconds: ceiling });
    const durationSeconds = existing.type === "hard_cut"
      ? 0
      : Math.min(Math.max(0, existing.durationSeconds), ceiling);
    return { ...existing, durationSeconds };
  });
}

export function moveShotInLinearSequence(input) {
  const sourceIndex = input.orderedShots.findIndex(({ id }) => id === input.shotId);
  if (sourceIndex < 0) return { orderedShots: input.orderedShots, transitions: input.transitions };
  const targetIndex = Math.max(0, Math.min(input.targetIndex, input.orderedShots.length - 1));
  const orderedShots = [...input.orderedShots];
  const [moving] = orderedShots.splice(sourceIndex, 1);
  orderedShots.splice(targetIndex, 0, moving);
  return {
    orderedShots,
    transitions: reconcileLinearTransitions({
      sequenceId: input.sequenceId,
      orderedShots,
      existingTransitions: input.transitions
    })
  };
}

export function removeShotFromLinearSequence(input) {
  const orderedShots = input.orderedShots.filter(({ id }) => id !== input.shotId);
  return {
    orderedShots,
    transitions: reconcileLinearTransitions({
      sequenceId: input.sequenceId,
      orderedShots,
      existingTransitions: input.transitions
    })
  };
}
```

Add `shotTransitionModel.ts` as a typed facade with exact signatures:

```ts
import type { ShotTransition } from "../../modules/storyboard-core/types";

export type LinearShotRef = { id: string; durationSeconds: number };
export type LinearTransitionState = { orderedShots: LinearShotRef[]; transitions: ShotTransition[] };

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import * as runtime from "./shotTransitionRuntime.mjs";

export const createDefaultShotTransition = runtime.createDefaultShotTransition as (
  sequenceId: string,
  fromShotId: string,
  toShotId: string,
  options?: { maxDurationSeconds?: number }
) => ShotTransition;
export const reconcileLinearTransitions = runtime.reconcileLinearTransitions as (input: {
  sequenceId: string;
  orderedShots: LinearShotRef[];
  existingTransitions: ShotTransition[];
}) => ShotTransition[];
export const moveShotInLinearSequence = runtime.moveShotInLinearSequence as (input: {
  sequenceId: string;
  orderedShots: LinearShotRef[];
  transitions: ShotTransition[];
  shotId: string;
  targetIndex: number;
}) => LinearTransitionState;
export const removeShotFromLinearSequence = runtime.removeShotFromLinearSequence as (input: {
  sequenceId: string;
  orderedShots: LinearShotRef[];
  transitions: ShotTransition[];
  shotId: string;
}) => LinearTransitionState;
```

- [ ] **Step 4: Run model checks and TypeScript**

Run: `node scripts/check-shot-transition-model.mjs`

Expected: `PASS shot transition model`

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 5: Commit the domain unit**

```bash
git add src/modules/storyboard-core/types.ts src/features/script-director/shotTransitionRuntime.mjs src/features/script-director/shotTransitionModel.ts scripts/check-shot-transition-model.mjs
git commit -m "feat: add linear shot transition model"
```

---

### Task 2: JSON import normalization and validation

**Files:**
- Create: `src/features/script-director/shotScriptImportRuntime.mjs`
- Create: `src/features/script-director/shotScriptImport.ts`
- Create: `scripts/check-shot-script-import.mjs`

**Interfaces:**
- Consumes: `createDefaultShotTransition()` and `reconcileLinearTransitions()` from Task 1.
- Produces: `parseShotScriptText(text, { fps, sequenceId }) => ShotScriptImportResult`; successful results contain normalized `ImportedShotScriptItem[]` and `ShotTransition[]` without mutating the store.

- [ ] **Step 1: Write a failing import contract**

Create `scripts/check-shot-script-import.mjs`:

```js
import assert from "node:assert/strict";
import { parseShotScriptText } from "../src/features/script-director/shotScriptImportRuntime.mjs";

const valid = parseShotScriptText(JSON.stringify({
  project: { title: "推门测试", version: 1 },
  shots: [
    { id: "a", title: "人物推门", duration: 4, prompt: "推门" },
    { id: "b", title: "进入房间", duration_sec: 3.5, video_prompt: "向左跟拍", character_names: ["角色A"] }
  ]
}), { fps: 24, sequenceId: "seq-1" });
assert.equal(valid.ok, true);
assert.equal(valid.value.shots[1].durationFrames, 84);
assert.equal(valid.value.shots[1].videoPrompt, "向左跟拍");
assert.deepEqual(valid.value.shots[1].sourceCharacterNames, ["角色A"]);
assert.deepEqual(valid.value.transitions.map(({ fromShotId, toShotId, type }) => ({ fromShotId, toShotId, type })), [
  { fromShotId: "a", toShotId: "b", type: "continuous" }
]);

const legacy = parseShotScriptText(JSON.stringify({
  shots: [{ title: "旧镜头", frames: 48, negative_prompt: "模糊", scene_name: "房间" }]
}), { fps: 24, sequenceId: "seq-legacy" });
assert.equal(legacy.ok, true);
assert.equal(legacy.value.shots[0].id, "shot_import_001");
assert.equal(legacy.value.shots[0].durationFrames, 48);
assert.equal(legacy.value.shots[0].prompt, "旧镜头");
assert.equal(legacy.value.shots[0].sourceSceneName, "房间");

for (const [payload, code] of [
  ["not json", "invalid_json"],
  [JSON.stringify({}), "shots_missing"],
  [JSON.stringify({ shots: [{ id: "x", title: "1" }, { id: "x", title: "2" }] }), "duplicate_shot_id"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "missing", type: "continuous" }] }), "transition_shot_missing"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }, { id: "c", title: "3" }], transitions: [{ from: "a", to: "c", type: "continuous" }] }), "transition_not_adjacent"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "b", type: "continuous" }, { from: "a", to: "b", type: "hard_cut" }] }), "duplicate_transition"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "b", type: "continuous", frameDependency: "future_frame" }] }), "frame_dependency_invalid"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "b", type: "continuous", duration: -1 }] }), "transition_duration_invalid"]
]) {
  const result = parseShotScriptText(payload, { fps: 24, sequenceId: "seq-1" });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, code);
}
console.log("PASS shot script import");
```

- [ ] **Step 2: Run import checks and verify RED**

Run: `node scripts/check-shot-script-import.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `shotScriptImportRuntime.mjs`.

- [ ] **Step 3: Implement parse, legacy normalization, and fail-closed validation**

Implement these exported shapes in `shotScriptImportRuntime.mjs`:

```js
import { reconcileLinearTransitions } from "./shotTransitionRuntime.mjs";

const TRANSITION_TYPES = new Set(["continuous", "match_cut", "hard_cut", "scene_change"]);
const FRAME_DEPENDENCIES = new Set(["none", "previous_tail", "shared_frame"]);
const text = (value) => typeof value === "string" ? value.trim() : "";
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : undefined;

export function parseShotScriptText(source, context) {
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { return { ok: false, issues: [{ code: "invalid_json", path: "$", message: "文件不是合法 JSON" }] }; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.shots)) {
    return { ok: false, issues: [{ code: "shots_missing", path: "$.shots", message: "缺少 shots 数组" }] };
  }
  const fps = Math.max(1, Math.round(context.fps));
  const shots = parsed.shots.map((item, index) => {
    const id = text(item.id) || `shot_import_${String(index + 1).padStart(3, "0")}`;
    const title = text(item.title) || `镜头 ${index + 1}`;
    const durationSeconds = number(item.duration ?? item.duration_sec ?? item.durationSec);
    const frames = number(item.frames ?? item.durationFrames);
    return {
      id,
      title,
      prompt: text(item.prompt) || text(item.notes) || title,
      negativePrompt: text(item.negative_prompt ?? item.negativePrompt),
      videoPrompt: text(item.video_prompt ?? item.videoPrompt),
      durationFrames: Math.max(1, Math.round(frames ?? (durationSeconds ?? 2) * fps)),
      dialogue: text(item.dialogue),
      notes: text(item.notes),
      tags: Array.isArray(item.tags) ? item.tags.map(text).filter(Boolean) : [],
      sourceCharacterNames: Array.isArray(item.character_names ?? item.characterNames)
        ? (item.character_names ?? item.characterNames).map(text).filter(Boolean)
        : [],
      sourceSceneName: text(item.scene_name ?? item.sceneName),
      sourceScenePrompt: text(item.scene_prompt ?? item.scenePrompt),
      generatedImagePath: text(item.thumbnail ?? item.generatedImagePath),
      generatedVideoPath: text(item.generatedVideoPath)
    };
  });
  const ids = new Set();
  for (let index = 0; index < shots.length; index += 1) {
    if (ids.has(shots[index].id)) return { ok: false, issues: [{ code: "duplicate_shot_id", path: `$.shots[${index}].id`, message: `镜头 ID 重复：${shots[index].id}` }] };
    ids.add(shots[index].id);
  }
  const position = new Map(shots.map((shot, index) => [shot.id, index]));
  const transitions = [];
  const transitionPairs = new Set();
  for (let index = 0; index < (Array.isArray(parsed.transitions) ? parsed.transitions.length : 0); index += 1) {
    const item = parsed.transitions[index];
    const fromShotId = text(item.from ?? item.fromShotId);
    const toShotId = text(item.to ?? item.toShotId);
    if (!ids.has(fromShotId) || !ids.has(toShotId)) return { ok: false, issues: [{ code: "transition_shot_missing", path: `$.transitions[${index}]`, message: `${fromShotId} → ${toShotId} 引用了不存在的镜头` }] };
    if (position.get(toShotId) !== position.get(fromShotId) + 1) return { ok: false, issues: [{ code: "transition_not_adjacent", path: `$.transitions[${index}]`, message: `${fromShotId} → ${toShotId} 不是相邻镜头` }] };
    const transitionPair = `${fromShotId}\u0000${toShotId}`;
    if (transitionPairs.has(transitionPair)) return { ok: false, issues: [{ code: "duplicate_transition", path: `$.transitions[${index}]`, message: `${fromShotId} → ${toShotId} 存在重复转场` }] };
    transitionPairs.add(transitionPair);
    const type = text(item.type);
    if (!TRANSITION_TYPES.has(type)) return { ok: false, issues: [{ code: "transition_type_invalid", path: `$.transitions[${index}].type`, message: `不支持的转场类型：${type}` }] };
    const requestedFrameDependency = text(item.frameDependency);
    if (requestedFrameDependency && !FRAME_DEPENDENCIES.has(requestedFrameDependency)) return { ok: false, issues: [{ code: "frame_dependency_invalid", path: `$.transitions[${index}].frameDependency`, message: `不支持的首尾帧依赖：${requestedFrameDependency}` }] };
    const frameDependency = FRAME_DEPENDENCIES.has(requestedFrameDependency)
      ? requestedFrameDependency
      : type === "continuous" ? "previous_tail" : "none";
    const ceiling = Math.min(shots[position.get(fromShotId)].durationFrames, shots[position.get(toShotId)].durationFrames) / fps;
    const rawDuration = item.duration ?? item.durationSeconds;
    const parsedDuration = number(rawDuration);
    if (rawDuration !== undefined && (parsedDuration === undefined || parsedDuration < 0)) return { ok: false, issues: [{ code: "transition_duration_invalid", path: `$.transitions[${index}].duration`, message: "转场时长必须是大于或等于零的有限秒数" }] };
    const requestedDuration = parsedDuration ?? (type === "hard_cut" ? 0 : 0.6);
    transitions.push({
      id: text(item.id) || `shot-transition:${encodeURIComponent(fromShotId)}:${encodeURIComponent(toShotId)}`,
      sequenceId: context.sequenceId,
      fromShotId,
      toShotId,
      type,
      durationSeconds: type === "hard_cut" ? 0 : Math.min(Math.max(0, requestedDuration), ceiling),
      frameDependency,
      sharedFramePath: text(item.sharedFramePath) || undefined,
      actionContinuity: text(item.actionContinuity),
      characterPosition: text(item.characterPosition),
      cameraDirection: text(item.cameraDirection),
      notes: text(item.notes)
    });
  }
  const orderedShots = shots.map((shot) => ({ id: shot.id, durationSeconds: shot.durationFrames / fps }));
  return {
    ok: true,
    value: {
      projectTitle: text(parsed.project?.title),
      shots,
      transitions: reconcileLinearTransitions({
        sequenceId: context.sequenceId,
        orderedShots,
        existingTransitions: transitions
      })
    }
  };
}
```

Add this typed facade in `shotScriptImport.ts`:

```ts
import type { ImportedShotScriptItem } from "../../modules/storyboard-core/store";
import type { ShotTransition } from "../../modules/storyboard-core/types";
// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { parseShotScriptText as runtimeParseShotScriptText } from "./shotScriptImportRuntime.mjs";

export type ShotScriptImportIssue = { code: string; path: string; message: string };
export type NormalizedShotScript = {
  projectTitle: string;
  shots: ImportedShotScriptItem[];
  transitions: ShotTransition[];
};
export type ShotScriptImportResult =
  | { ok: true; value: NormalizedShotScript }
  | { ok: false; issues: ShotScriptImportIssue[] };

export const parseShotScriptText = runtimeParseShotScriptText as (
  source: string,
  context: { fps: number; sequenceId: string }
) => ShotScriptImportResult;
```

- [ ] **Step 4: Run focused validation**

Run: `node scripts/check-shot-script-import.mjs`

Expected: `PASS shot script import`

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit the import unit**

```bash
git add src/features/script-director/shotScriptImportRuntime.mjs src/features/script-director/shotScriptImport.ts scripts/check-shot-script-import.mjs
git commit -m "feat: validate shot script JSON imports"
```

---

### Task 3: Store actions and snapshot persistence

**Files:**
- Modify: `src/modules/storyboard-core/store.ts`
- Create: `scripts/check-shot-transition-store.mjs`

**Interfaces:**
- Consumes: `ShotTransition`, `reconcileLinearTransitions()`, `moveShotInLinearSequence()`, and `removeShotFromLinearSequence()`.
- Produces store fields `shotTransitions`, `selectedShotTransitionId` and actions `replaceShotScriptForCurrentSequence()`, `selectShotTransition()`, `updateShotTransition()`; existing move/delete actions become transition-aware.

- [ ] **Step 1: Write the failing store behavior check**

Create an esbuild-based `scripts/check-shot-transition-store.mjs` that bundles and imports `store.ts`, resets it with `setState`, then asserts replacement, selection, update, move, delete and snapshot hydration:

```js
import React from "react";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const result = await build({
  entryPoints: ["src/modules/storyboard-core/store.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["react"],
  write: false
});
const directory = await mkdtemp(join(process.cwd(), ".shot-transition-store-"));
const file = join(directory, "runtime.mjs");
await writeFile(file, result.outputFiles[0].text, "utf8");
try {
  const { useStoryboardStore, createStoryboardSnapshot } = await import(pathToFileURL(file).href);
  const sequenceId = "seq-test";
  useStoryboardStore.setState({
    sequences: [{ id: sequenceId, projectId: "p", name: "Test", order: 1 }],
    currentSequenceId: sequenceId,
    shots: [], shotTransitions: [], selectedShotId: "", selectedShotTransitionId: null,
    layers: [], shotStrokes: {}, shotHistory: {}, activeLayerByShotId: {}, selectedShotIds: []
  });
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence({
    shots: [
      { id: "a", title: "A", prompt: "A", durationFrames: 48 },
      { id: "b", title: "B", prompt: "B", durationFrames: 48 },
      { id: "c", title: "C", prompt: "C", durationFrames: 48 }
    ],
    transitions: []
  });
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [["a", "b"], ["b", "c"]]);
  const firstId = useStoryboardStore.getState().shotTransitions[0].id;
  useStoryboardStore.getState().selectShotTransition(firstId);
  useStoryboardStore.getState().updateShotTransition(firstId, { type: "hard_cut", durationSeconds: 8 });
  assert.equal(useStoryboardStore.getState().shotTransitions[0].durationSeconds, 0);
  useStoryboardStore.getState().moveShotToIndex("c", 1);
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [["a", "c"], ["c", "b"]]);
  useStoryboardStore.getState().undoShotSequenceEdit();
  assert.deepEqual(useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === sequenceId).sort((a, b) => a.order - b.order).map(({ id }) => id), ["a", "b", "c"]);
  useStoryboardStore.getState().redoShotSequenceEdit();
  assert.deepEqual(useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === sequenceId).sort((a, b) => a.order - b.order).map(({ id }) => id), ["a", "c", "b"]);
  useStoryboardStore.getState().deleteShot("c");
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [["a", "b"]]);
  const snapshot = createStoryboardSnapshot(useStoryboardStore.getState());
  assert.deepEqual(snapshot.shotTransitions, useStoryboardStore.getState().shotTransitions);
  useStoryboardStore.setState({ shotTransitions: [] });
  useStoryboardStore.getState().hydrateFromSnapshot(snapshot);
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, snapshot.shotTransitions);
  console.log("PASS shot transition store");
} finally {
  await rm(directory, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-shot-transition-store.mjs`

Expected: FAIL because `replaceShotScriptForCurrentSequence` and `shotTransitions` do not exist.

- [ ] **Step 3: Add store state, transition-aware actions, and snapshot fields**

In `store.ts`, import `ShotTransition` and the Task 1 helpers. Add:

```ts
shotTransitions: ShotTransition[];
selectedShotTransitionId: string | null;
shotSequenceHistory: {
  past: Array<{ sequenceId: string; orderedShotIds: string[]; transitions: ShotTransition[] }>;
  future: Array<{ sequenceId: string; orderedShotIds: string[]; transitions: ShotTransition[] }>;
};
replaceShotScriptForCurrentSequence: (input: {
  shots: ImportedShotScriptItem[];
  transitions: ShotTransition[];
}) => void;
selectShotTransition: (transitionId: string | null) => void;
updateShotTransition: (
  transitionId: string,
  patch: Partial<Pick<ShotTransition,
    "type" | "durationSeconds" | "frameDependency" | "sharedFramePath" |
    "actionContinuity" | "characterPosition" | "cameraDirection" | "notes"
  >>
) => void;
undoShotSequenceEdit: () => void;
redoShotSequenceEdit: () => void;
```

Initialize `shotTransitions` and `selectedShotTransitionId`, include both in `StoryboardSnapshot`, `createStoryboardSnapshot()`, `hydrateFromSnapshot()`, and clear both in `resetForNewProject()`.

`shotSequenceHistory` is transient and is not included in `StoryboardSnapshot`. Initialize it to `{ past: [], future: [] }` and clear it after project load, project reset, backup import, or full script replacement. Before every successful `moveShot`, `moveShotToIndex`, or `moveSelectedShots`, push exactly one entry containing the pre-move order and sequence transitions, then clear `future`. `undoShotSequenceEdit` restores the last entry and moves the current state to `future`; `redoShotSequenceEdit` performs the inverse. Restoring an entry rewrites only that sequence's `order` fields and transitions.

Use one local helper to convert scoped shots to the Task 1 runtime input:

```ts
const linearRefs = (shots: Shot[], fps: number) => shots
  .slice()
  .sort((left, right) => left.order - right.order)
  .map((shot) => ({ id: shot.id, durationSeconds: shot.durationFrames / Math.max(1, fps) }));
```

After `replaceShotsForCurrentSequence` builds `nextShots`, reconcile transitions for that sequence. Implement `replaceShotScriptForCurrentSequence` by reusing the same internal shot replacement builder and passing the imported transitions, so there is one layer/media cleanup path rather than duplicated replacement logic.

For `moveShot`, `moveShotToIndex`, `moveSelectedShots`, `deleteShot`, and `deleteSelectedShots`, calculate the final ordered scoped shots first, then call:

```ts
const nextTransitions = reconcileLinearTransitions({
  sequenceId,
  orderedShots: linearRefs(normalizedScoped, state.project.fps),
  existingTransitions: state.shotTransitions
});
return {
  shots: mergedShots,
  shotTransitions: [
    ...state.shotTransitions.filter((item) => item.sequenceId !== sequenceId),
    ...nextTransitions
  ],
  selectedShotTransitionId: nextTransitions.some((item) => item.id === state.selectedShotTransitionId)
    ? state.selectedShotTransitionId
    : null
};
```

In `updateShotTransition`, reject changes to endpoints or identity. Clamp duration against the adjacent shots and force `hard_cut` to `0`; force `continuous` with no explicit dependency to `previous_tail`.

- [ ] **Step 4: Verify store behavior and existing state compilation**

Run: `node scripts/check-shot-transition-store.mjs`

Expected: `PASS shot transition store`

Run: `node scripts/check-shot-transition-model.mjs && node scripts/check-shot-script-import.mjs`

Expected: both PASS.

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit the persistent state unit**

```bash
git add src/modules/storyboard-core/store.ts scripts/check-shot-transition-store.mjs
git commit -m "feat: persist linear shot transitions"
```

---

### Task 4: Horizontal node editor and transition inspector

**Files:**
- Create: `src/features/script-director/ShotNode.tsx`
- Create: `src/features/script-director/TransitionEdge.tsx`
- Replace: `src/features/script-director/ScriptDirectorView.tsx`
- Create: `src/features/script-director/ScriptTransitionInspector.tsx`
- Create: `src/styles/script-transition-editor.css`
- Modify: `src/main.tsx`
- Create: `scripts/check-script-transition-components.mjs`

**Interfaces:**
- Consumes: store actions and import parser from Tasks 2–3.
- Produces: a usable script-stage editor and an inspector component exported for App integration.

- [ ] **Step 1: Write failing component contracts**

Bundle the four TSX files in `scripts/check-script-transition-components.mjs` using the same esbuild/temp-module pattern as `check-director-desk-components.mjs`. Assert:

```js
const shotA = {
  id: "a", sequenceId: "seq-1", order: 1, title: "A", durationFrames: 96,
  dialogue: "", notes: "", tags: [], generatedImagePath: "frames/a.png"
};
const shotB = {
  id: "b", sequenceId: "seq-1", order: 2, title: "B", durationFrames: 84,
  dialogue: "", notes: "", tags: []
};
const transitionAB = {
  id: "shot-transition:a:b", sequenceId: "seq-1", fromShotId: "a", toShotId: "b",
  type: "continuous", durationSeconds: 0.6, frameDependency: "previous_tail",
  actionContinuity: "", characterPosition: "", cameraDirection: "", notes: ""
};
const selectedShots = [];
const selectedTransitions = [];
const moves = [];
const imports = [];
const updates = [];
const view = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
  shots: [shotA, shotB],
  transitions: [transitionAB],
  fps: 24,
  sequenceId: "seq-1",
  selectedShotId: "a",
  selectedTransitionId: null,
  onSelectShot: selectedShots.push.bind(selectedShots),
  onSelectTransition: selectedTransitions.push.bind(selectedTransitions),
  onMoveShot: (...args) => moves.push(args),
  onImportScript: (value) => imports.push(value)
}));
assert.equal(view.root.findAllByProps({ "data-shot-node": true }).length, 2);
assert.equal(view.root.findAllByProps({ "data-transition-edge": true }).length, 1);
assert.match(view.root.findByProps({ "data-transition-edge": true }).children.join(""), /连续动作.*0\.6s/);
assert.equal(view.root.findByProps({ type: "file" }).props.accept, "application/json,.json");
assert.equal(view.root.findByProps({ "aria-label": "镜头 A 向后移动" }).props.disabled, false);

const inspector = TestRenderer.create(React.createElement(runtime.ScriptTransitionInspector, {
  fps: 24,
  selectedShot: null,
  selectedTransition: transitionAB,
  fromShot: shotA,
  toShot: shotB,
  onUpdateTransition: (id, patch) => updates.push([id, patch])
}));
assert.equal(inspector.root.findByProps({ "aria-label": "转场类型" }).props.value, "continuous");
assert.equal(inspector.root.findByProps({ "aria-label": "转场时长（秒）" }).props.value, 0.6);
assert.equal(inspector.root.findByProps({ "data-transition-advanced": true }).props.open, false);
inspector.root.findByProps({ "aria-label": "转场类型" }).props.onChange({ target: { value: "hard_cut" } });
assert.deepEqual(updates.at(-1), [transitionAB.id, { type: "hard_cut", durationSeconds: 0, frameDependency: "none" }]);
```

Also assert semantic order is node A, edge A→B, node B; every node has keyboard move buttons; the edge is a real button; import errors render in `role="alert"`; zero shots renders an explicit JSON import empty state.
Assert the toolbar has enabled/disabled “撤销镜头排序” and “重做镜头排序” buttons from props. In the shot-detail inspector, assert the delete button calls `onRequestDeleteShot(shot.id)` and that no delete control is rendered while a transition is selected.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-script-transition-components.mjs`

Expected: FAIL because the new component exports and DOM contracts do not exist.

- [ ] **Step 3: Implement focused components and file import**

`ShotNode.tsx` must render a real article with a selection button and keyboard move controls:

```tsx
import type { DragEvent } from "react";
import type { Shot } from "../../modules/storyboard-core/types";
import { toDesktopMediaSource } from "../../modules/platform/desktopBridge";

export type ShotNodeProps = {
  shot: Shot;
  index: number;
  fps: number;
  selected: boolean;
  canMoveBack: boolean;
  canMoveForward: boolean;
  onSelect: () => void;
  onMove: (offset: -1 | 1) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export function ShotNode({ shot, index, fps, selected, canMoveBack, canMoveForward, onSelect, onMove, onDragStart, onDrop }: ShotNodeProps) {
  return <article data-shot-node data-selected={selected || undefined} draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <button type="button" className="script-shot-select" aria-pressed={selected} onClick={onSelect}>
      <span className="script-shot-thumb">{shot.generatedImagePath ? <img src={toDesktopMediaSource(shot.generatedImagePath)} alt="" /> : <span>暂无画面</span>}</span>
      <strong>{String(index + 1).padStart(2, "0")} · {shot.title}</strong>
      <small>{(shot.durationFrames / Math.max(1, fps)).toFixed(1)} 秒 · {shot.generatedVideoPath ? "已生成" : shot.generatedImagePath ? "分镜就绪" : "待生成"}</small>
    </button>
    <span className="script-shot-order-actions">
      <button type="button" aria-label={`镜头 ${shot.title} 向前移动`} disabled={!canMoveBack} onClick={() => onMove(-1)}>←</button>
      <button type="button" aria-label={`镜头 ${shot.title} 向后移动`} disabled={!canMoveForward} onClick={() => onMove(1)}>→</button>
    </span>
  </article>;
}
```

`TransitionEdge.tsx` maps type labels and renders one selectable button:

```tsx
import type { ShotTransition } from "../../modules/storyboard-core/types";

export type TransitionEdgeProps = {
  transition: ShotTransition;
  selected: boolean;
  onSelect: () => void;
};

const LABELS = { continuous: "连续动作", match_cut: "匹配剪辑", hard_cut: "硬切", scene_change: "换场" } as const;
export function TransitionEdge({ transition, selected, onSelect }: TransitionEdgeProps) {
  return <div data-transition-edge data-type={transition.type}>
    <button type="button" aria-pressed={selected} onClick={onSelect}>
      {LABELS[transition.type]} · {transition.durationSeconds.toFixed(1)}s
    </button>
  </div>;
}
```

`ScriptDirectorView.tsx` receives data/actions as props, keeps only `draggedShotId` and import error presentation locally, and processes a selected file with:

```tsx
const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  const result = parseShotScriptText(await file.text(), { fps, sequenceId });
  if (!result.ok) { setIssues(result.issues); return; }
  setIssues([]);
  onImportScript(result.value);
};
```

Render shots and edges in alternating DOM order. On node drop, call `onMoveShot(draggedShotId, targetIndex)`. The empty state contains “导入 JSON 镜头剧本” and the same hidden file input trigger.

Add toolbar buttons wired to `onUndo` and `onRedo`, disabled from `canUndo` and `canRedo`. They are secondary controls and use the accessible labels “撤销镜头排序” and “重做镜头排序”.

`ScriptTransitionInspector.tsx` renders shot detail when a shot is selected and the transition form when an edge is selected. Use native `select`, `input type="number"`, `textarea`, and `<details data-transition-advanced>`; every change calls `onUpdateTransition` with an explicit patch. Disable `duration` for hard cuts, only show `sharedFramePath` when dependency is `shared_frame`, and display “等待边界帧” for a continuous transition whose previous shot has no `approvedBoundaryFramePath`. In shot-detail mode, show a danger-styled “删除镜头” button that calls `onRequestDeleteShot(selectedShot.id)`; do not call the store directly from the inspector.

Add `script-transition-editor.css` scoped below `.director-desk [data-stage-view="script"]`; define horizontal overflow only inside the chain, readable fixed node width, two-pixel directed edges, selected states, 44px compact/coarse targets, and mobile bottom-sheet-friendly form spacing. Import it after `director-desk.css` in `src/main.tsx`.

- [ ] **Step 4: Run component, responsive, and type checks**

Run: `node scripts/check-script-transition-components.mjs`

Expected: `PASS script transition components`

Run: `node scripts/check-director-desk-responsive.mjs`

Expected: existing Director Desk contract remains PASS.

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit the editor UI unit**

```bash
git add src/features/script-director/ShotNode.tsx src/features/script-director/TransitionEdge.tsx src/features/script-director/ScriptDirectorView.tsx src/features/script-director/ScriptTransitionInspector.tsx src/styles/script-transition-editor.css src/main.tsx scripts/check-script-transition-components.mjs
git commit -m "feat: add horizontal shot transition editor"
```

---

### Task 5: Director Desk App integration and save state

**Files:**
- Modify: `src/app/App.tsx`
- Create: `scripts/check-script-transition-integration.mjs`
- Modify: `scripts/check-director-desk-app-integration.mjs`

**Interfaces:**
- Consumes: UI components and store actions from Tasks 3–4.
- Produces: the real 剧本 route, the global inspector content, import/update/reorder callbacks, and one honest script-stage primary action.

- [ ] **Step 1: Add a failing App wiring contract**

Create `scripts/check-script-transition-integration.mjs` as a focused source-structure contract. Extract the `focusedStageView`, `inspectorByStage`, and `stagePrimaryAction` blocks from `App.tsx`, then assert:

```js
assert.match(app, /const \[scriptTransitionDirty, setScriptTransitionDirty\] = useState\(false\)/);
assert.match(app, /const shotTransitions = useStoryboardStore\(\(state\) => state\.shotTransitions\)/);
assert.match(app, /const selectedShotTransitionId = useStoryboardStore\(\(state\) => state\.selectedShotTransitionId\)/);
assert.match(stageViews, /case "script":[\s\S]*<ScriptDirectorView/);
for (const prop of ["shots={scriptShots}", "transitions={scriptTransitions}", "onImportScript={onImportShotScript}", "onMoveShot={onMoveScriptShot}"]) {
  assert.ok(stageViews.includes(prop), `script view missing ${prop}`);
}
assert.match(inspector, /script:\s*<ScriptTransitionInspector/);
assert.match(primaryActions, /scriptTransitionDirty[\s\S]*保存转场[\s\S]*saveScriptTransitions/);
assert.match(app, /confirmDialog\([\s\S]*删除镜头[\s\S]*相邻转场/);
assert.match(stageViews, /onUndo=\{onUndoScriptSequence\}/);
assert.match(stageViews, /onRedo=\{onRedoScriptSequence\}/);
assert.doesNotMatch(stageViews, /继续到资产/);
```

Extend `check-director-desk-app-integration.mjs` so it allows the new script props while retaining its “no obsolete direct stage CTA” and shell assertions.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-script-transition-integration.mjs`

Expected: FAIL on missing `scriptTransitionDirty` or `shotTransitions` wiring.

- [ ] **Step 3: Wire the editor, inspector, and honest save action**

In `App.tsx`, select the current sequence shots and transitions in stable order:

```tsx
const shotTransitions = useStoryboardStore((state) => state.shotTransitions);
const selectedShotTransitionId = useStoryboardStore((state) => state.selectedShotTransitionId);
const selectShotTransition = useStoryboardStore((state) => state.selectShotTransition);
const updateShotTransition = useStoryboardStore((state) => state.updateShotTransition);
const replaceShotScriptForCurrentSequence = useStoryboardStore((state) => state.replaceShotScriptForCurrentSequence);
const moveShotToIndex = useStoryboardStore((state) => state.moveShotToIndex);
const deleteShot = useStoryboardStore((state) => state.deleteShot);
const undoShotSequenceEdit = useStoryboardStore((state) => state.undoShotSequenceEdit);
const redoShotSequenceEdit = useStoryboardStore((state) => state.redoShotSequenceEdit);
const shotSequenceHistory = useStoryboardStore((state) => state.shotSequenceHistory);
const [scriptTransitionDirty, setScriptTransitionDirty] = useState(false);
const scriptShots = shots.filter((shot) => shot.sequenceId === currentSequenceId).slice().sort((a, b) => a.order - b.order);
const scriptTransitions = shotTransitions.filter((item) => item.sequenceId === currentSequenceId);
const selectedScriptTransition = scriptTransitions.find((item) => item.id === selectedShotTransitionId) ?? null;
```

Make `onSaveDesktop` return `Promise<boolean>`: return `false` for blocked, cancelled, skipped and failed paths; return `true` only after the active workspace save completes and `setSaveState("已保存")` runs.

Add explicit mutation wrappers:

```tsx
const onImportShotScript = (value: NormalizedShotScript) => {
  replaceShotScriptForCurrentSequence({ shots: value.shots, transitions: value.transitions });
  setScriptTransitionDirty(true);
};
const onMoveScriptShot = (shotId: string, targetIndex: number) => {
  moveShotToIndex(shotId, targetIndex);
  setScriptTransitionDirty(true);
};
const onUpdateScriptTransition = (id: string, patch: Parameters<typeof updateShotTransition>[1]) => {
  updateShotTransition(id, patch);
  setScriptTransitionDirty(true);
};
const onDeleteScriptShot = async (shotId: string) => {
  const shot = scriptShots.find((item) => item.id === shotId);
  if (!shot) return;
  const shotIndex = scriptShots.findIndex((item) => item.id === shotId);
  const affected = scriptTransitions.filter((item) => item.fromShotId === shotId || item.toShotId === shotId);
  const reconnectNotice = shotIndex > 0 && shotIndex < scriptShots.length - 1
    ? "，并为新的相邻镜头创建默认连续动作转场"
    : "";
  const confirmed = await confirmDialog({
    title: "删除镜头",
    message: `删除“${shot.title}”将移除 ${affected.length} 条相邻转场${reconnectNotice}。`,
    confirmText: "删除",
    danger: true
  });
  if (!confirmed) return;
  deleteShot(shotId);
  setScriptTransitionDirty(true);
};
const onUndoScriptSequence = () => {
  undoShotSequenceEdit();
  setScriptTransitionDirty(true);
};
const onRedoScriptSequence = () => {
  redoShotSequenceEdit();
  setScriptTransitionDirty(true);
};
const saveScriptTransitions = async () => {
  if (await onSaveDesktop()) setScriptTransitionDirty(false);
};
```

Render `ScriptDirectorView` with the focused props and change `inspectorByStage.script` to:

```tsx
case "script": return <ScriptDirectorView
  shots={scriptShots}
  transitions={scriptTransitions}
  fps={project.fps}
  sequenceId={currentSequenceId}
  selectedShotId={selectedShotId}
  selectedTransitionId={selectedShotTransitionId}
  onSelectShot={(shotId) => { selectShot(shotId); selectShotTransition(null); }}
  onSelectTransition={selectShotTransition}
  onMoveShot={onMoveScriptShot}
  onImportScript={onImportShotScript}
  onUndo={onUndoScriptSequence}
  onRedo={onRedoScriptSequence}
  canUndo={shotSequenceHistory.past.length > 0}
  canRedo={shotSequenceHistory.future.length > 0}
/>;
```

Change `inspectorByStage.script` to:

```tsx
<ScriptTransitionInspector
  fps={project.fps}
  selectedShot={selectedShot ?? null}
  selectedTransition={selectedScriptTransition}
  fromShot={scriptShots.find((shot) => shot.id === selectedScriptTransition?.fromShotId) ?? null}
  toShot={scriptShots.find((shot) => shot.id === selectedScriptTransition?.toShotId) ?? null}
  onUpdateTransition={onUpdateScriptTransition}
  onRequestDeleteShot={(shotId) => void onDeleteScriptShot(shotId)}
/>
```

The script primary action is the only high-emphasis script action:

```tsx
script: scriptTransitionDirty
  ? { label: "保存转场", onInvoke: () => void saveScriptTransitions() }
  : { label: "继续到资产", onInvoke: () => onWorkbenchStageChange("assets") },
```

On successful project load, new project reset, backup import, or snapshot recovery, reset `scriptTransitionDirty` to `false`.

- [ ] **Step 4: Run integration regressions**

Run: `node scripts/check-script-transition-integration.mjs`

Expected: `PASS script transition integration`

Run: `npm run test:director-desk`

Expected: six existing Director Desk checks PASS.

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit App integration**

```bash
git add src/app/App.tsx scripts/check-script-transition-integration.mjs scripts/check-director-desk-app-integration.mjs
git commit -m "feat: connect script transition editor"
```

---

### Task 6: Feed transition parameters into video continuity planning

**Files:**
- Modify: `src/modules/video-production/continuityPlanner.ts`
- Modify: `src/modules/video-production/continuityPlannerRuntime.mjs`
- Modify: `src/modules/video-production/VideoProductionPanel.tsx`
- Modify: `scripts/check-video-continuity-planner.mjs`

**Interfaces:**
- Consumes: persisted `ShotTransition[]` from Task 3.
- Produces: `VideoBoundaryPlan` values carrying duration and continuity guidance; `VideoProductionPanel` contexts use stored transitions as the authoritative boundary configuration.

- [ ] **Step 1: Extend the planner test first**

Add this case to `scripts/check-video-continuity-planner.mjs`:

```js
const guidedPlan = planVideoContinuity({
  shots: [
    shot("guided-a", 1, { approvedTailFramePath: "frames/a-tail.png", tailFrameApprovalStatus: "approved" }),
    shot("guided-b", 2)
  ],
  boundaries: [{
    fromShotId: "guided-a",
    toShotId: "guided-b",
    kind: "continuous",
    approvalStatus: "approved",
    durationSeconds: 0.6,
    frameDependency: "previous_tail",
    actionContinuity: "保持推门动作",
    characterPosition: "人物从右侧进入",
    cameraDirection: "继续向左跟拍",
    notes: "保持室内暖光"
  }]
});
assert.deepEqual(guidedPlan.boundaries[0], {
  id: "video-boundary:guided-a:guided-b",
  fromShotId: "guided-a",
  toShotId: "guided-b",
  kind: "continuous",
  durationSeconds: 0.6,
  frameDependency: "previous_tail",
  actionContinuity: "保持推门动作",
  characterPosition: "人物从右侧进入",
  cameraDirection: "继续向左跟拍",
  notes: "保持室内暖光",
  requiresApproval: true,
  approvalStatus: "approved"
});
```

Add source assertions that `VideoProductionPanel` selects `shotTransitions`, passes them to both `buildContexts` calls, and maps `type` to planner `kind`.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-video-continuity-planner.mjs`

Expected: FAIL because the advanced metadata is absent from `guidedPlan.boundaries[0]`.

- [ ] **Step 3: Preserve metadata and use transitions in production contexts**

Extend both `VideoBoundaryInput` and `VideoBoundaryPlan` in `continuityPlanner.ts`:

```ts
durationSeconds?: number;
frameDependency?: "none" | "previous_tail" | "shared_frame";
actionContinuity?: string;
characterPosition?: string;
cameraDirection?: string;
notes?: string;
```

In `normalizeBoundaryInputs()` normalize these properties, and in the `boundaries.push()` object preserve them exactly when present. Include them in the normalized signature so changing any advanced parameter invalidates the affected shots and assembly.

In `VideoProductionPanel.tsx`, select transitions:

```tsx
const shotTransitions = useStoryboardStore((state) => state.shotTransitions);
const scopedTransitions = useMemo(
  () => shotTransitions.filter((item) => item.sequenceId === currentSequenceId),
  [currentSequenceId, shotTransitions]
);
const contexts = useMemo(
  () => buildContexts(scopedShots, assets, scopedTransitions),
  [assets, scopedShots, scopedTransitions]
);
```

Change `buildContexts` to `function buildContexts(shots: Shot[], assets: Asset[], transitions: ShotTransition[])`. Index transitions by `fromShotId\u0000toShotId`; for each adjacent pair, prefer its stored transition and fall back to the legacy `shot.videoBoundaryKind` fields only when no stored edge exists:

```ts
const configured = transitionByPair.get(`${shot.id}\u0000${next.id}`);
const kind = configured?.type ?? shot.videoBoundaryKind ?? "hard_cut";
return {
  fromShotId: shot.id,
  toShotId: next.id,
  kind,
  durationSeconds: configured?.durationSeconds,
  frameDependency: configured?.frameDependency,
  actionContinuity: configured?.actionContinuity,
  characterPosition: configured?.characterPosition,
  cameraDirection: configured?.cameraDirection,
  notes: configured?.notes,
  sharedFramePath: configured?.frameDependency === "shared_frame"
    ? configured.sharedFramePath
    : shot.approvedBoundaryFramePath,
  sharedFrameSource: configured?.frameDependency === "shared_frame" ? "independent" as const : undefined,
  approvalStatus: configured?.frameDependency === "shared_frame"
    ? configured.sharedFramePath ? "approved" as const : "pending" as const
    : shot.approvedBoundaryFramePath ? "approved" as const : "pending" as const
};
```

Update the generator snapshot callback to pass `state.shotTransitions` into `buildContexts()` as well, preventing live UI contexts and generation-time contexts from diverging.

- [ ] **Step 4: Verify planner and production compilation**

Run: `node scripts/check-video-continuity-planner.mjs`

Expected: `PASS video continuity planner`

Run: `node scripts/check-video-production-schema.mjs`

Expected: `PASS video production schema`

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit downstream consumption**

```bash
git add src/modules/video-production/continuityPlanner.ts src/modules/video-production/continuityPlannerRuntime.mjs src/modules/video-production/VideoProductionPanel.tsx scripts/check-video-continuity-planner.mjs
git commit -m "feat: consume shot transition guidance"
```

---

### Task 7: Aggregate verification and real browser acceptance

**Files:**
- Modify: `package.json`
- Modify: `scripts/check-script-transition-components.mjs`
- Modify: `scripts/check-script-transition-integration.mjs`
- Create: `docs/superpowers/verification/2026-08-21-linear-shot-transition-editor.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one repeatable aggregate command and recorded desktop/compact/mobile evidence.

- [ ] **Step 1: Add the aggregate script**

Add to `package.json`:

```json
"test:script-transitions": "node scripts/check-shot-transition-model.mjs && node scripts/check-shot-script-import.mjs && node scripts/check-shot-transition-store.mjs && node scripts/check-script-transition-components.mjs && node scripts/check-script-transition-integration.mjs && node scripts/check-video-continuity-planner.mjs"
```

Run: `npm run test:script-transitions`

Expected: all six script-transition checks PASS. A failure must be fixed in the task that owns the failing contract; do not weaken the assertion or add branching, additional import formats, AI generation, or a graph library.

- [ ] **Step 2: Run the full automated gate**

Run: `npm run test:script-transitions`

Expected: all six script-transition checks PASS.

Run: `npm run test:director-desk`

Expected: all six Director Desk checks PASS.

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: exit 0.

Run: `git diff --check`

Expected: exit 0; line-ending warnings are informational, whitespace errors are not.

- [ ] **Step 3: Verify the approved interaction in a real browser**

Start: `npm run dev`

At 1440×900, 1024×768, and 390×844 verify with ordinary clicks/keyboard, never forced clicks:

1. Open 剧本 and import a JSON fixture containing three shots and no transitions.
2. Confirm three nodes and two default “连续动作 · 0.6s” edges.
3. Select the first edge, change it to matching cut, expand advanced parameters, enter frame/action/position/camera notes, and save.
4. Drag shot 3 between shots 1 and 2; verify both new edges are defaults and the obsolete edited 1→2 edge is no longer active.
5. Use keyboard “向前移动 / 向后移动” as the drag alternative.
6. Import invalid JSON and confirm the current three-shot project remains unchanged while the error is announced.
7. Close and reopen the inspector at every viewport; confirm no control is clipped, nodes remain horizontally reachable, mobile uses the existing bottom inspector, and the page itself has no unintended horizontal overflow.
8. Save, reload the project, and confirm shot order plus transition parameters persist.
9. Open 成片 and confirm the continuity status reflects the saved boundary type and any missing required frame.

Capture screenshots:

```text
output/playwright/script-transitions-1440x900.png
output/playwright/script-transitions-1024x768.png
output/playwright/script-transitions-390x844.png
```

- [ ] **Step 4: Record verification and build status**

Write `docs/superpowers/verification/2026-08-21-linear-shot-transition-editor.md` with commands, exit codes, viewport metrics, interaction results, screenshot paths, and any remaining blocker.

Run: `npm run build`

Expected: PASS. If the already-known unrelated `src/modules/video-production/runningHubResult.mjs` browser-external `spawnSync` blocker still exists, record that exact failure as pre-existing, keep the transition suite and `tsc --noEmit` GREEN, and do not modify RunningHub files in this feature.

- [ ] **Step 5: Commit aggregate wiring and verification evidence**

```bash
git add package.json scripts/check-script-transition-components.mjs scripts/check-script-transition-integration.mjs docs/superpowers/verification/2026-08-21-linear-shot-transition-editor.md
git commit -m "test: verify linear shot transition editor"
```

---

## Self-Review Checklist

- Spec coverage: Tasks 1–3 cover domain data, default edges, JSON-only compatibility, validation, reordering, deletion and persistence; Tasks 4–5 cover the approved horizontal UI, inspector, responsive behavior and save state; Task 6 proves downstream consumption; Task 7 covers accessibility, three viewports and reload verification.
- Non-goals: no AI splitter, non-JSON importer, branching graph, new UI framework, or ComfyUI rewrite appears in any task.
- Type consistency: all internal edges use `fromShotId` / `toShotId`; import alone accepts external `from` / `to`. Duration is always `durationSeconds`; JSON `duration` and `duration_sec` normalize at the boundary.
- State consistency: `shotTransitions` is included in snapshots and used by both live production context and generation-time snapshot context.
- Failure safety: parsing completes before the store replacement action; invalid JSON and invalid references cannot partially mutate the project.
- Worktree safety: every commit command names only task-owned files; no reset, clean, prune, or unrelated build-blocker change is authorized.
