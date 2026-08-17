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

assert.deepEqual(planVideoContinuity(), {
  segments: [],
  boundaries: [],
  shotExecutions: [],
  assemblyTaskId: "video-assembly",
  shotStateSignatures: [],
  statusSummary: { total: 0, ready: 0, awaitingApproval: 0 }
}, "empty planner input must be stable and side-effect free");

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

const encodedLeftIdPlan = planVideoContinuity({
  shots: [shot("a:b", 1), shot("c", 2)],
  boundaries: [boundary("a:b", "c", "hard_cut")]
});
const encodedRightIdPlan = planVideoContinuity({
  shots: [shot("a", 1), shot("b:c", 2)],
  boundaries: [boundary("a", "b:c", "hard_cut")]
});
assert.notEqual(encodedLeftIdPlan.boundaries[0].id, encodedRightIdPlan.boundaries[0].id,
  "encoded boundary ids must not collide when shot ids contain delimiters");
assert.notEqual(encodedLeftIdPlan.segments[0].id, encodedRightIdPlan.segments[0].id,
  "encoded segment ids must not collide when shot ids contain delimiters");

const orderedAcyclicPlan = planVideoContinuity({
  shots: [
    shot("cycle-c", 30),
    shot("cycle-a", 10, {
      approvedTailFramePath: "frames/cycle-a-tail.png",
      tailFrameApprovalStatus: "approved"
    }),
    shot("cycle-b", 20, {
      approvedTailFramePath: "frames/cycle-b-tail.png",
      tailFrameApprovalStatus: "approved"
    })
  ],
  boundaries: [
    boundary("cycle-b", "cycle-a", "continuous", { approvalStatus: "approved" }),
    boundary("cycle-a", "cycle-b", "continuous", { approvalStatus: "approved" }),
    boundary("cycle-b", "cycle-c", "continuous", { approvalStatus: "approved" })
  ]
});
assert.deepEqual(orderedAcyclicPlan.shotExecutions.map((item) => [item.shotId, item.dependencyTaskIds]), [
  ["cycle-a", []],
  ["cycle-b", ["video-shot:cycle-a"]],
  ["cycle-c", ["video-shot:cycle-b"]]
], "out-of-order and reverse boundary input must still produce a forward-only acyclic dependency order");

const deterministicPlan = planVideoContinuity({
  shots: [baseShots[1], baseShots[2], baseShots[0], { ...baseShots[0] }],
  boundaries: [approvedContinuous, hardCut, { ...approvedContinuous }],
  assemblyTaskId: "assembly:feature"
});
assert.deepEqual(deterministicPlan, basePlan,
  "planner ids, order, and duplicate handling must be deterministic");

assert.throws(() => planVideoContinuity({
  shots: [
    shot("dup", 1, {
      approvedTailFramePath: "frames/unapproved.png",
      tailFrameApprovalStatus: "pending"
    }),
    shot("dup", 1, {
      approvedTailFramePath: "frames/approved.png",
      tailFrameApprovalStatus: "approved"
    }),
    shot("after-dup", 2)
  ],
  boundaries: [boundary("dup", "after-dup", "continuous", { approvalStatus: "approved" })]
}), /duplicate_shot_id_conflict:dup/,
"conflicting duplicate shot definitions must fail before approval can be bypassed");

const validArraySummaryPlan = planVideoContinuity({
  shots: [shot("json-array", 1, {
    sceneState: ["rain", { wind: 2, flags: [true, null] }]
  })]
});
assert.equal(validArraySummaryPlan.statusSummary.ready, 1,
  "JSON-compatible nested array summaries must remain supported");

const cyclicSummary = { weather: "rain" };
cyclicSummary.self = cyclicSummary;
for (const [label, unsupported] of [
  ["nested undefined", { weather: undefined }],
  ["array undefined", ["rain", undefined]],
  ["function", () => "rain"],
  ["symbol", Symbol("rain")],
  ["bigint", 24n],
  ["non-finite number", Number.NaN],
  ["cycle", cyclicSummary]
]) {
  assert.throws(() => planVideoContinuity({
    shots: [shot(`unsupported-${label}`, 1, { sceneState: unsupported })]
  }), /unsupported_continuity_state:sceneState/,
  `${label} continuity summaries must fail with an explicit planner validation error`);
}

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

const chainShots = [
  shot("a", 1, {
    approvedTailFramePath: "frames/a-tail.png",
    tailFrameApprovalStatus: "approved"
  }),
  shot("b", 2, {
    approvedTailFramePath: "frames/b-tail.png",
    tailFrameApprovalStatus: "approved"
  }),
  shot("c", 3)
];
const chainBoundaries = [
  boundary("a", "b", "continuous", { approvalStatus: "approved" }),
  boundary("b", "c", "continuous", { approvalStatus: "approved" })
];
const chainBefore = planVideoContinuity({
  shots: chainShots,
  boundaries: chainBoundaries,
  assemblyTaskId: "assembly:chain"
});
const chainAfterCompoundChange = planVideoContinuity({
  shots: chainShots.map((item) => item.id === "a" ? { ...item, characterState: "hero:injured" } : item),
  boundaries: [
    boundary("a", "b", "match_cut", {
      approvalStatus: "approved",
      sharedFramePath: "frames/a-b-match.png",
      sharedFrameSource: "independent"
    }),
    chainBoundaries[1]
  ],
  assemblyTaskId: "assembly:chain"
});
assert.deepEqual(planContinuityInvalidation(chainBefore, chainAfterCompoundChange), {
  staleShotIds: ["a", "b", "c"],
  staleTaskIds: ["assembly:chain", "video-shot:a", "video-shot:b", "video-shot:c"],
  reasons: [
    "boundary_changed:video-boundary:a:b",
    "shot_state_changed:a"
  ]
}, "compound boundary and state changes must traverse each dependent exactly once with stable ordering");

async function loadRealVideoModeRuntime() {
  const sourcePath = new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url);
  const source = await readFile(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile("comfyService.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functionSource = (name) => {
    const declaration = sourceFile.statements.find((statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
    );
    assert.ok(declaration, `real comfyService ${name} function must exist`);
    return declaration.getText(sourceFile);
  };
  const variableSource = (name) => {
    const declaration = sourceFile.statements.find((statement) =>
      ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
        (item) => ts.isIdentifier(item.name) && item.name.text === name
      )
    );
    assert.ok(declaration, `real comfyService ${name} declaration must exist`);
    return declaration.getText(sourceFile);
  };
  const executableInfer = functionSource("inferVideoMode").replace(
    /^function inferVideoMode/,
    "export function inferVideoMode"
  );
  const executableFrameSources = functionSource("resolveVideoFrameSources").replace(
    /^function resolveVideoFrameSources/,
    "export function resolveVideoFrameSources"
  );
  const transpiled = ts.transpileModule(`
    ${variableSource("FIRST_LAST_ENDPOINT_PATTERNS")}
    ${variableSource("FIRST_LAST_ACTION_KEYWORDS")}
    ${variableSource("SINGLE_FRAME_DIALOGUE_KEYWORDS")}
    ${variableSource("SINGLE_FRAME_AMBIENCE_KEYWORDS")}
    ${functionSource("containsAnyKeyword")}
    ${functionSource("inferStoryboardVideoModeByMatureCase")}
    ${executableInfer}
    ${executableFrameSources}
  `, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "isolated real video-mode dependency chain must transpile");
  return await import(`data:text/javascript,${encodeURIComponent(transpiled.outputText)}`);
}

const { inferVideoMode, inferStoryboardVideoModeByMatureCase, resolveVideoFrameSources } = await loadRealVideoModeRuntime();
for (const genericTransition of ["transition", "转场", "衔接", "过渡"]) {
  assert.equal(inferStoryboardVideoModeByMatureCase(genericTransition), "single_frame",
    `real mature-case helper must not treat generic ${genericTransition} as endpoint intent`);
  assert.equal(inferVideoMode({
    id: "legacy-a",
    storyPrompt: `${genericTransition} into the next composition`,
    generatedImagePath: "frames/a.png"
  }, {
    id: "legacy-b",
    generatedImagePath: "frames/b.png"
  }), "single_frame", `generic ${genericTransition} plus a next storyboard must not infer FLF2V`);
}
assert.equal(inferVideoMode({ videoMode: "first_last_frame" }), "first_last_frame",
  "explicit legacy FLF2V intent must remain compatible");
assert.equal(inferVideoMode({
  videoStartFramePath: "frames/start.png",
  videoEndFramePath: "frames/end.png"
}), "first_last_frame", "explicit start and end paths must remain compatible");
for (const explicitEndpoint of ["首尾帧控制", "起始帧到结束帧", "first last frame"]) {
  assert.equal(inferVideoMode({ storyPrompt: explicitEndpoint }), "first_last_frame",
    `explicit endpoint wording must remain compatible: ${explicitEndpoint}`);
}
assert.deepEqual(resolveVideoFrameSources({
  generatedImagePath: "frames/current.png"
}, {
  generatedImagePath: "frames/next.png"
}, "single_frame"), {
  firstFramePath: "frames/current.png",
  lastFramePath: ""
}, "single-frame inference must not consume the next storyboard as a latent end frame");

console.log("PASS video continuity planner");
