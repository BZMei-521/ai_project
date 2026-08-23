# Spatial Stage State And Rigs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add universal rig bindings, attachment points, pose editing data, and deterministic cross-shot state snapshots to the stage foundation while remaining compatible with the existing `SpatialObject`, `PoseKeyframe`, and `CameraPlan` domain.

**Architecture:** Keep `SceneStage` as the persistence authority introduced in Phase A. Add pure state-transition helpers that normalize humanoid, quadruped, rigid-chain, and custom rigs; create attachment/contact records; and derive the next beat from a previous snapshot. Provide explicit adapters to the existing spatial-scene types so current preview controls and legacy snapshots remain usable.

**Tech Stack:** TypeScript 5.6, existing `domains/spatial-scene` types, Zustand stage actions, Node/esbuild contract tests.

## Global Constraints

- No physical simulation or automatic IK in this phase.
- A pose source is always recorded as `manual`, `previous_snapshot`, `auto_pose`, or `imported`.
- Snapshot inheritance copies the previous state before applying an explicit patch; it never re-initializes from prompt text.
- Attachment and contact records are declarative and deterministic; unresolved targets are reported, not silently moved.
- Preserve existing `SpatialObject`, `PoseKeyframe`, and `CameraPlan` fields and legacy snapshot behavior.
- Preserve all unrelated dirty/untracked files; do not reset, checkout, clean, or use `git add -A`.

---

### Task 1: Rig, Attachment, and Pose Normalization

**Files:**
- Create: `src/modules/spatial-stage/rigState.ts`
- Create: `scripts/check-spatial-stage-rigs.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SceneStage`, `StageEntity`, `PoseSnapshot` from Phase A and existing `SpatialObject`, `PoseKeyframe`.
- Produces: `normalizeRigBinding`, `normalizeAttachmentPoints`, `normalizePoseSnapshot`, `toSpatialObject`, `toPoseKeyframe`.

- [ ] **Step 1: Write failing adapter and normalization tests**

Assert humanoid/quadruped defaults, finite confidence clamping, duplicate attachment removal, legacy object conversion, and pose conversion:

```js
const humanoid = normalizeRigBinding({ kind: "humanoid", joints: { hip: "pelvis" } });
assert.equal(humanoid.kind, "humanoid");
assert.equal(humanoid.joints.hip, "pelvis");
assert.equal(normalizeRigBinding({ kind: "invalid" }).kind, "custom");
const points = normalizeAttachmentPoints([
  { id: "hand_r", label: "Right hand", localTransform: validTransform },
  { id: "hand_r", label: "Duplicate", localTransform: validTransform }
]);
assert.equal(points.length, 1);
const pose = normalizePoseSnapshot({ ...validPose, confidence: 4 });
assert.equal(pose.confidence, 1);
const legacy = toSpatialObject(entity, "scene-1");
assert.equal(legacy.objectKind, "character");
assert.deepEqual(toPoseKeyframe(pose, "hero", 12).position, { x: 0, y: 1, z: 0 });
```

- [ ] **Step 2: Run RED**

Run: `npm run test:spatial-stage-rigs`  
Expected: FAIL because `rigState.ts` is missing.

- [ ] **Step 3: Implement minimal pure functions**

Use exact exports:

```ts
normalizeRigBinding(value: unknown): RigBinding;
normalizeAttachmentPoints(value: unknown): AttachmentPoint[];
normalizePoseSnapshot(value: unknown): PoseSnapshot | null;
toSpatialObject(entity: StageEntity, sceneId: string): SpatialObject;
toPoseKeyframe(pose: PoseSnapshot, objectId: string, time: number): PoseKeyframe;
```

Adapters use metre vectors and Euler XYZ for the legacy `SpatialObject` rotation. Do not discard rig or attachment metadata; put it under `metadata` as JSON-safe values.

- [ ] **Step 4: Run GREEN and commit exact files**

Run: `npm run test:spatial-stage-rigs`  
Expected: PASS.

```powershell
git add -- package.json scripts/check-spatial-stage-rigs.mjs src/modules/spatial-stage/rigState.ts
git commit -m "feat: normalize spatial stage rigs"
```

### Task 2: Snapshot Inheritance and Declarative Contacts

**Files:**
- Create: `src/modules/spatial-stage/stageState.ts`
- Create: `scripts/check-spatial-stage-state.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: normalized stage entities, constraints, cameras, poses.
- Produces: `createStageSnapshot`, `inheritStageSnapshot`, `validateStageSnapshot`.

- [ ] **Step 1: Write failing state-transition tests**

Cover previous-state inheritance, explicit transform/pose patching, unresolved attachment reports, and deterministic IDs:

```js
const first = createStageSnapshot(stage, "beat-1", undefined, now);
const second = inheritStageSnapshot(stage, first, "beat-2", {
  entityPatches: { hero: { transform: movedTransform } },
  posePatches: { hero: manualPose }
}, now);
assert.equal(second.previousSnapshotId, first.id);
assert.deepEqual(second.entityStates.find((item) => item.entityId === "hero").transform, movedTransform);
assert.deepEqual(validateStageSnapshot(stage, second).unresolved, []);
const invalid = inheritStageSnapshot(stage, first, "beat-3", {
  contacts: [{ attachmentId: "missing", targetEntityId: "hero" }]
}, now);
assert.equal(validateStageSnapshot(stage, invalid).unresolved.length, 1);
```

- [ ] **Step 2: Run RED**

Run: `npm run test:spatial-stage-state`  
Expected: FAIL because `stageState.ts` is missing.

- [ ] **Step 3: Implement deterministic transitions**

`createStageSnapshot` captures every visible/hidden entity, optional pose, camera ID, and enabled constraint IDs. `inheritStageSnapshot` clones all prior entity states and applies only patches. `validateStageSnapshot` returns:

```ts
{ valid: boolean; unresolved: string[]; disabledConstraints: string[] }
```

No unresolved attachment or contact may be marked valid. Do not mutate input stage or previous snapshot.

- [ ] **Step 4: Run GREEN and commit exact files**

Run: `npm run test:spatial-stage-state`  
Expected: PASS.

```powershell
git add -- package.json scripts/check-spatial-stage-state.mjs src/modules/spatial-stage/stageState.ts
git commit -m "feat: inherit spatial stage snapshots"
```

### Task 3: Store and Inspector Integration

**Files:**
- Modify: `src/modules/spatial-stage/SpatialStageWorkbench.tsx`
- Modify: `src/modules/spatial-stage/SpatialStageViewport.tsx`
- Modify: `src/modules/storyboard-core/store.ts`
- Modify: `scripts/check-spatial-stage-viewport.mjs`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: rig adapters and state transitions from Tasks 1-2.
- Produces: selected entity transform editor, rig type selector, attachment list, “继承上一节拍” snapshot action, and unresolved-state banner.

- [ ] **Step 1: Extend UI contract tests**

Assert UI source contains rig selector, attachment labels, snapshot inheritance action, and unresolved warning state. Keep stage creation and manual proxies working.

- [ ] **Step 2: Run RED**

Run: `npm run test:spatial-stage-viewport`  
Expected: FAIL on the new UI assertions.

- [ ] **Step 3: Implement minimal inspector controls**

Add controls for selected entity label, rig kind (`humanoid`, `quadruped`, `rigid_chain`, `custom`), position XYZ, visibility, and attachment rows. Add a button that creates an inherited snapshot for the current beat and displays validation results. Do not add drag-based bone editing yet; viewport selection remains proxy-level.

- [ ] **Step 4: Run focused tests and build**

Run: `npm run test:spatial-stage-rigs`, `npm run test:spatial-stage-state`, `npm run test:spatial-stage-viewport`, `npm run build`  
Expected: all PASS.

- [ ] **Step 5: Commit exact files**

```powershell
git add -- scripts/check-spatial-stage-viewport.mjs src/modules/spatial-stage/SpatialStageWorkbench.tsx src/modules/spatial-stage/SpatialStageViewport.tsx src/modules/storyboard-core/store.ts src/styles/global.css
git commit -m "feat: expose spatial stage state inspector"
```

### Task 4: Acceptance and Compatibility

**Files:**
- Create: `scripts/check-spatial-stage-state-compatibility.mjs`
- Create: `docs/superpowers/verification/2026-08-19-spatial-stage-rigs.md`

- [ ] **Step 1: Test legacy adapter compatibility**

Verify existing `SpatialScene` snapshots can be converted to stage entities and pose keyframes without changing their serialized fields. Verify stage snapshots remain additive to existing `createStoryboardSnapshot` output.

- [ ] **Step 2: Run final suite**

```powershell
npm run test:spatial-stage-schema
npm run test:spatial-stage-capabilities
npm run test:spatial-stage-viewport
npm run test:spatial-stage-rigs
npm run test:spatial-stage-state
npm run test:video-production-schema
npm run build
```

- [ ] **Step 3: Record seven-scene minimum evidence**

Use the existing scene domain to record one humanoid, quadruped, prop attachment, vehicle proxy, indoor contact, outdoor path, and abstract relative-scale snapshot. Mark automatic IK/physics as out of scope and record unresolved constraints explicitly.

