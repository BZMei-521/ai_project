import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  planVideoContinuity,
  planContinuityInvalidation
} from "../src/modules/video-production/continuityPlannerRuntime.mjs";

const shot = (id, order, overrides = {}) => ({
  id,
  order,
  characterAnchorPaths: ["characters/hero-face.png", "characters/hero-body.png"],
  sceneAnchorPath: "scenes/courtyard.png",
  colorAnchorPath: "looks/dusk.png",
  sceneState: "courtyard",
  characterState: "hero:blue-robe",
  timeState: "dusk",
  tailFrameApprovalStatus: "pending",
  ...overrides
});

const boundary = (fromShotId, toShotId, kind, overrides = {}) => ({
  fromShotId,
  toShotId,
  kind,
  approvalStatus: "pending",
  ...overrides
});

const baseShots = [
  shot("shot-01", 1, {
    approvedTailFramePath: "frames/shot-01-approved-tail.png",
    tailFrameApprovalStatus: "approved"
  }),
  shot("shot-02", 2),
  shot("shot-03", 3)
];

const approvedContinuous = boundary("shot-01", "shot-02", "continuous", {
  approvalStatus: "approved"
});
const hardCut = boundary("shot-02", "shot-03", "hard_cut");
const basePlan = planVideoContinuity({
  shots: [baseShots[2], baseShots[0], baseShots[1]],
  boundaries: [hardCut, approvedContinuous],
  assemblyTaskId: "assembly:feature"
});

assert.deepEqual(basePlan.segments.map((segment) => segment.shotIds), [
  ["shot-01", "shot-02", "shot-03"]
], "same-character, same-scene, same-time ordered shots must form one segment");
assert.deepEqual(basePlan.segments[0].characterAnchorPaths, [
  "characters/hero-body.png",
  "characters/hero-face.png"
], "segment anchors must be normalized, deduplicated, and sorted");
assert.equal(basePlan.segments[0].sceneAnchorPath, "scenes/courtyard.png");
assert.equal(basePlan.segments[0].colorAnchorPath, "looks/dusk.png");

const continuousExecution = basePlan.shotExecutions.find((item) => item.shotId === "shot-02");
assert.deepEqual(continuousExecution, {
  shotId: "shot-02",
  taskId: "video-shot:shot-02",
  status: "ready",
  dependencyTaskIds: ["video-shot:shot-01"],
  firstFrameInput: {
    kind: "approved_tail_frame",
    path: "frames/shot-01-approved-tail.png",
    boundaryId: "video-boundary:shot-01:shot-02",
    fromShotId: "shot-01"
  }
}, "continuous must consume only the previous shot's approved tail frame");

const pendingContinuous = planVideoContinuity({
  shots: [shot("left", 1, { approvedTailFramePath: "frames/unapproved.png" }), shot("right", 2)],
  boundaries: [boundary("left", "right", "continuous", { approvalStatus: "approved" })]
});
assert.deepEqual(pendingContinuous.shotExecutions[1], {
  shotId: "right",
  taskId: "video-shot:right",
  status: "awaiting_approval",
  blockReason: "continuous_tail_frame_not_approved",
  dependencyTaskIds: ["video-shot:left"]
}, "continuous must block instead of exposing an unapproved frame");
assert.equal(pendingContinuous.statusSummary.awaitingApproval, 1);
assert.equal(pendingContinuous.statusSummary.ready, 1);

const invalidMatchCut = planVideoContinuity({
  shots: [shot("match-a", 1), shot("match-b", 2)],
  boundaries: [boundary("match-a", "match-b", "match_cut", {
    approvalStatus: "approved",
    sharedFramePath: "frames/match.png",
    sharedFrameSource: "derived_from_shot"
  })]
});
assert.equal(invalidMatchCut.shotExecutions[1].status, "awaiting_approval");
assert.equal(invalidMatchCut.shotExecutions[1].blockReason, "match_cut_shared_frame_not_independently_approved");
assert.equal(invalidMatchCut.shotExecutions[1].firstFrameInput, undefined);

const validMatchCut = planVideoContinuity({
  shots: [shot("match-a", 1), shot("match-b", 2)],
  boundaries: [boundary("match-a", "match-b", "match_cut", {
    approvalStatus: "approved",
    sharedFramePath: "frames/match.png",
    sharedFrameSource: "independent"
  })]
});
assert.deepEqual(validMatchCut.shotExecutions[1].firstFrameInput, {
  kind: "approved_shared_frame",
  path: "frames/match.png",
  boundaryId: "video-boundary:match-a:match-b"
});
assert.deepEqual(validMatchCut.shotExecutions[1].dependencyTaskIds, [],
  "an independently authored match-cut frame must not depend on either shot asset");

assert.deepEqual(basePlan.shotExecutions.find((item) => item.shotId === "shot-03"), {
  shotId: "shot-03",
  taskId: "video-shot:shot-03",
  status: "ready",
  dependencyTaskIds: []
}, "hard cut must allow parallel execution without a frame dependency");

const sceneChangePlan = planVideoContinuity({
  shots: [
    shot("inside", 1),
    shot("outside", 2, {
      sceneAnchorPath: "scenes/street.png",
      sceneState: "street",
      timeState: "night"
    })
  ],
  boundaries: [boundary("inside", "outside", "scene_change")]
});
assert.deepEqual(sceneChangePlan.segments.map((segment) => segment.shotIds), [["inside"], ["outside"]]);
assert.deepEqual(sceneChangePlan.shotExecutions[1].dependencyTaskIds, []);
assert.equal(sceneChangePlan.shotExecutions[1].firstFrameInput, undefined);

const deterministicPlan = planVideoContinuity({
  shots: [baseShots[1], baseShots[2], baseShots[0], { ...baseShots[0] }],
  boundaries: [approvedContinuous, hardCut, { ...approvedContinuous }],
  assemblyTaskId: "assembly:feature"
});
assert.deepEqual(deterministicPlan, basePlan,
  "planner ids, order, and duplicate handling must be deterministic");

const changedBoundaryPlan = planVideoContinuity({
  shots: baseShots,
  boundaries: [
    boundary("shot-01", "shot-02", "match_cut", {
      approvalStatus: "approved",
      sharedFramePath: "frames/new-independent-match.png",
      sharedFrameSource: "independent"
    }),
    hardCut
  ],
  assemblyTaskId: "assembly:feature"
});
assert.deepEqual(planContinuityInvalidation(basePlan, changedBoundaryPlan), {
  staleShotIds: ["shot-01", "shot-02"],
  staleTaskIds: ["assembly:feature", "video-shot:shot-01", "video-shot:shot-02"],
  reasons: ["boundary_changed:video-boundary:shot-01:shot-02"]
}, "changing one shared boundary must stale only its two shots and assembly");

const changedStatusPlan = planVideoContinuity({
  shots: baseShots.map((item) => item.id === "shot-01"
    ? { ...item, characterState: "hero:blue-robe:wounded" }
    : item),
  boundaries: [approvedContinuous, hardCut],
  assemblyTaskId: "assembly:feature"
});
assert.deepEqual(planContinuityInvalidation(basePlan, changedStatusPlan), {
  staleShotIds: ["shot-01", "shot-02"],
  staleTaskIds: ["assembly:feature", "video-shot:shot-01", "video-shot:shot-02"],
  reasons: ["shot_state_changed:shot-01"]
}, "a shot state change must stale that shot, its actual dependent, and assembly");

async function loadRealInferVideoMode() {
  const sourcePath = new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url);
  const source = await readFile(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile("comfyService.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "inferVideoMode"
  );
  assert.ok(declaration, "real comfyService inferVideoMode function must exist");
  const executable = declaration.getText(sourceFile).replace(
    /^function inferVideoMode/,
    "export function inferVideoMode"
  );
  const transpiled = ts.transpileModule(`
    function containsAnyKeyword(text, keywords) {
      const normalized = String(text).toLowerCase();
      return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
    }
    function inferStoryboardVideoModeByMatureCase() { return "auto"; }
    ${executable}
  `, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "isolated real inferVideoMode must transpile");
  return (await import(`data:text/javascript,${encodeURIComponent(transpiled.outputText)}`)).inferVideoMode;
}

const inferVideoMode = await loadRealInferVideoMode();
assert.equal(inferVideoMode({
  id: "legacy-a",
  storyPrompt: "generic transition into the next composition",
  generatedImagePath: "frames/a.png"
}, {
  id: "legacy-b",
  generatedImagePath: "frames/b.png"
}), "single_frame", "generic transition words plus a next storyboard must not infer FLF2V");
assert.equal(inferVideoMode({ videoMode: "first_last_frame" }), "first_last_frame",
  "explicit legacy FLF2V intent must remain compatible");

console.log("PASS video continuity planner");
