import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  planVideoContinuity,
  planContinuityInvalidation
} from "../src/modules/video-production/continuityPlannerRuntime.mjs";
import {
  resolveShotTransitionBoundary
} from "../src/modules/video-production/shotTransitionBoundaryRuntime.mjs";

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

const resolverShots = [
  { id: "same-a", videoBoundaryKind: "scene_change", approvedBoundaryFramePath: "frames/legacy.png" },
  { id: "same-b" }
];
const transitionFor = (sequenceId, type, overrides = {}) => ({
  id: `transition:${sequenceId}`,
  sequenceId,
  fromShotId: "same-a",
  toShotId: "same-b",
  type,
  durationSeconds: 0.6,
  frameDependency: "previous_tail",
  actionContinuity: "keep action",
  characterPosition: "enter right",
  cameraDirection: "track left",
  notes: "warm light",
  ...overrides
});
const seqOneTransition = transitionFor("seq-one", "continuous", {
  durationSeconds: 0.4,
  prompt: "transition prompt",
  negativePrompt: "axis jump",
  frameDependency: "shared_frame",
  sharedFramePath: "frames/seq-one.png"
});
const seqTwoTransition = transitionFor("seq-two", "hard_cut", {
  durationSeconds: 0,
  frameDependency: "none",
  actionContinuity: "seq-two action"
});
const expectedSeqOneBoundary = {
  fromShotId: "same-a",
  toShotId: "same-b",
  kind: "continuous",
  durationSeconds: 0.4,
  prompt: "transition prompt",
  negativePrompt: "axis jump",
  frameDependency: "shared_frame",
  actionContinuity: "keep action",
  characterPosition: "enter right",
  cameraDirection: "track left",
  notes: "warm light",
  sharedFramePath: "frames/seq-one.png",
  sharedFrameSource: "independent",
  approvalStatus: "approved"
};
for (const transitions of [
  [seqOneTransition, seqTwoTransition],
  [seqTwoTransition, seqOneTransition]
]) {
  assert.deepEqual(resolveShotTransitionBoundary({
    sequenceId: "seq-one",
    fromShot: resolverShots[0],
    toShot: resolverShots[1],
    transitions
  }), expectedSeqOneBoundary,
  "resolver must isolate identical shot pairs by sequence regardless of transition order");
}
assert.equal(resolveShotTransitionBoundary({
  sequenceId: "seq-two",
  fromShot: resolverShots[0],
  toShot: resolverShots[1],
  transitions: [seqOneTransition, seqTwoTransition]
}).kind, "hard_cut", "a valid configured edge must never fall back to the legacy shot kind");
assert.deepEqual(resolveShotTransitionBoundary({
  sequenceId: "missing-sequence",
  fromShot: resolverShots[0],
  toShot: resolverShots[1],
  transitions: [seqOneTransition, seqTwoTransition]
}), {
  fromShotId: "same-a",
  toShotId: "same-b",
  kind: "scene_change",
  sharedFramePath: "frames/legacy.png",
  sharedFrameSource: "independent",
  approvalStatus: "approved"
}, "legacy shot boundary fields are allowed only when the exact sequence edge is absent");

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

const guidedPlan = planVideoContinuity({
  shots: [
    shot("guided-a", 1, {
      approvedTailFramePath: "frames/a-tail.png",
      tailFrameApprovalStatus: "approved"
    }),
    shot("guided-b", 2)
  ],
  boundaries: [{
    fromShotId: "guided-a",
    toShotId: "guided-b",
    kind: "continuous",
    approvalStatus: "approved",
    durationSeconds: 0.6,
    prompt: "  keep the door-opening motion  ",
    negativePrompt: "  axis jump  ",
    frameDependency: "previous_tail",
    sharedFramePath: "frames/must-not-leak.png",
    sharedFrameSource: "independent",
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
  prompt: "keep the door-opening motion",
  negativePrompt: "axis jump",
  frameDependency: "previous_tail",
  actionContinuity: "保持推门动作",
  characterPosition: "人物从右侧进入",
  cameraDirection: "继续向左跟拍",
  notes: "保持室内暖光",
  requiresApproval: true,
  approvalStatus: "approved"
}, "continuous guidance must survive normalization without leaking an unrelated shared frame");

const hardCutGuidance = planVideoContinuity({
  shots: [shot("hard-a", 1), shot("hard-b", 2)],
  boundaries: [boundary("hard-a", "hard-b", "hard_cut", {
    durationSeconds: 1.5,
    prompt: "preserve edit rhythm",
    negativePrompt: "freeze",
    frameDependency: "shared_frame",
    sharedFramePath: "frames/hard-cut-must-not-depend.png",
    sharedFrameSource: "independent",
    approvalStatus: "approved"
  })]
});
assert.deepEqual(hardCutGuidance.boundaries[0], {
  id: "video-boundary:hard-a:hard-b",
  fromShotId: "hard-a",
  toShotId: "hard-b",
  kind: "hard_cut",
  durationSeconds: 0,
  prompt: "preserve edit rhythm",
  negativePrompt: "freeze",
  frameDependency: "none",
  requiresApproval: false,
  approvalStatus: "approved"
}, "hard cuts must retain textual guidance while clearing frame dependencies and forcing zero duration");

const explicitSharedFrame = planVideoContinuity({
  shots: [shot("shared-a", 1), shot("shared-b", 2)],
  boundaries: [boundary("shared-a", "shared-b", "match_cut", {
    durationSeconds: 0.4,
    frameDependency: "shared_frame",
    sharedFramePath: "  frames/shared-match.png  ",
    sharedFrameSource: "independent",
    approvalStatus: "approved"
  })]
});
assert.equal(explicitSharedFrame.boundaries[0].frameDependency, "shared_frame");
assert.equal(explicitSharedFrame.boundaries[0].sharedFramePath, "frames/shared-match.png");
assert.equal(explicitSharedFrame.boundaries[0].sharedFrameSource, "independent");
assert.equal(explicitSharedFrame.boundaries[0].durationSeconds, 0.4);
assert.equal(explicitSharedFrame.shotExecutions[1].firstFrameInput?.path, "frames/shared-match.png");

for (const invalidDuration of [Number.NaN, Number.POSITIVE_INFINITY, -0.1]) {
  const invalidDurationPlan = planVideoContinuity({
    shots: [shot("duration-a", 1), shot("duration-b", 2)],
    boundaries: [boundary("duration-a", "duration-b", "scene_change", {
      durationSeconds: invalidDuration
    })]
  });
  assert.equal(Object.hasOwn(invalidDurationPlan.boundaries[0], "durationSeconds"), false,
    `invalid duration must normalize to absence: ${String(invalidDuration)}`);
}

const signatureShots = [shot("signature-a", 1), shot("signature-b", 2)];
const signatureBoundary = {
  fromShotId: "signature-a",
  toShotId: "signature-b",
  kind: "match_cut",
  durationSeconds: 0.4,
  prompt: "match the raised hand",
  negativePrompt: "axis jump",
  frameDependency: "shared_frame",
  sharedFramePath: "frames/signature-shared.png",
  sharedFrameSource: "independent",
  actionContinuity: "keep hand raised",
  characterPosition: "center frame",
  cameraDirection: "track left",
  notes: "warm light",
  approvalStatus: "approved"
};
const signatureBasePlan = planVideoContinuity({ shots: signatureShots, boundaries: [signatureBoundary] });
const guidanceMutations = [
  ["durationSeconds", 0.7],
  ["prompt", "match the lowered hand"],
  ["negativePrompt", "camera shake"],
  ["frameDependency", "none"],
  ["sharedFramePath", "frames/signature-shared-v2.png"],
  ["actionContinuity", "lower the hand"],
  ["characterPosition", "right edge"],
  ["cameraDirection", "track right"],
  ["notes", "cool light"]
];
for (const [field, value] of guidanceMutations) {
  const changedPlan = planVideoContinuity({
    shots: signatureShots,
    boundaries: [{ ...signatureBoundary, [field]: value }]
  });
  assert.deepEqual(planContinuityInvalidation(signatureBasePlan, changedPlan), {
    staleShotIds: ["signature-a", "signature-b"],
    staleTaskIds: ["video-assembly", "video-shot:signature-a", "video-shot:signature-b"],
    reasons: ["boundary_changed:video-boundary:signature-a:signature-b"]
  }, `changing only ${field} must alter the normalized boundary signature`);
}

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

const boundaryConflictShots = [
  shot("boundary-a", 1, {
    approvedTailFramePath: "frames/boundary-a-approved-tail.png",
    tailFrameApprovalStatus: "approved"
  }),
  shot("boundary-b", 2)
];
const boundaryConflictCases = [
  ["pending versus approved", [
    boundary("boundary-a", "boundary-b", "continuous", { approvalStatus: "pending" }),
    boundary("boundary-a", "boundary-b", "continuous", { approvalStatus: "approved" })
  ]],
  ["different kind", [
    boundary("boundary-a", "boundary-b", "continuous", { approvalStatus: "approved" }),
    boundary("boundary-a", "boundary-b", "hard_cut", { approvalStatus: "approved" })
  ]],
  ["different shared frame path", [
    boundary("boundary-a", "boundary-b", "match_cut", {
      approvalStatus: "approved", sharedFramePath: "frames/one.png", sharedFrameSource: "independent"
    }),
    boundary("boundary-a", "boundary-b", "match_cut", {
      approvalStatus: "approved", sharedFramePath: "frames/two.png", sharedFrameSource: "independent"
    })
  ]],
  ["different shared frame source", [
    boundary("boundary-a", "boundary-b", "match_cut", {
      approvalStatus: "approved", sharedFramePath: "frames/shared.png", sharedFrameSource: "independent"
    }),
    boundary("boundary-a", "boundary-b", "match_cut", {
      approvalStatus: "approved", sharedFramePath: "frames/shared.png", sharedFrameSource: "derived_from_shot"
    })
  ]],
  ["same explicit identity on different pairs", [
    { ...boundary("boundary-a", "boundary-b", "hard_cut"), id: "manual-boundary-1" },
    { ...boundary("boundary-b", "boundary-a", "hard_cut"), id: "manual-boundary-1" }
  ]]
];
for (const [label, boundaries] of boundaryConflictCases) {
  let unsafePlan;
  assert.throws(() => {
    unsafePlan = planVideoContinuity({ shots: boundaryConflictShots, boundaries });
  }, /duplicate_boundary_conflict:/,
  `${label} duplicate boundaries must fail before approval planning`);
  assert.equal(unsafePlan, undefined,
    `${label} conflict must not return a plan or mark the dependent shot ready`);
}

const identicalBoundary = boundary("boundary-a", "boundary-b", "continuous", {
  approvalStatus: "approved"
});
const identicalBoundaryPlan = planVideoContinuity({
  shots: [...boundaryConflictShots].reverse(),
  boundaries: [{ ...identicalBoundary }, { ...identicalBoundary }]
});
assert.equal(identicalBoundaryPlan.boundaries.length, 1,
  "identical duplicate boundary definitions must deduplicate idempotently");
assert.equal(identicalBoundaryPlan.shotExecutions[1].status, "ready");

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

async function assertPanelTransitionWiring() {
  const sourcePath = new URL("../src/modules/video-production/VideoProductionPanel.tsx", import.meta.url);
  const source = await readFile(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile("VideoProductionPanel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const descendants = [];
  const visit = (node) => {
    descendants.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const textOf = (node) => node.getText(sourceFile);
  const resolverImport = sourceFile.statements.find((statement) =>
    ts.isImportDeclaration(statement) &&
    statement.moduleSpecifier.text === "./shotTransitionBoundary" &&
    statement.importClause?.namedBindings?.elements?.some((item) => item.name.text === "resolveShotTransitionBoundary")
  );
  assert.ok(resolverImport, "VideoProductionPanel must import the typed pure transition resolver");
  const buildContexts = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "buildContexts"
  );
  assert.ok(buildContexts, "VideoProductionPanel must declare buildContexts");
  assert.deepEqual(buildContexts.parameters.map((parameter) => textOf(parameter.name)), ["sequenceId", "shots", "assets", "transitions"],
    "buildContexts must accept sequence identity and persisted transitions explicitly");

  const selectors = descendants.filter((node) => ts.isCallExpression(node) && textOf(node.expression) === "useStoryboardStore");
  assert.ok(selectors.some((call) => call.arguments.some((argument) => textOf(argument).includes("state.shotTransitions"))),
    "VideoProductionPanel must select shotTransitions from the store");

  const contextCalls = descendants.filter((node) => ts.isCallExpression(node) && textOf(node.expression) === "buildContexts");
  assert.equal(contextCalls.length, 2, "live and generation snapshot paths must be the only buildContexts call sites");
  assert.ok(contextCalls.every((call) => call.arguments.length === 4),
    "every buildContexts call must pass sequence id and transitions; the old three-argument form is forbidden");
  assert.ok(contextCalls.some((call) =>
    textOf(call.arguments[0]) === "currentSequenceId" &&
    textOf(call.arguments[1]) === "scopedShots" &&
    textOf(call.arguments[3]) === "scopedTransitions"
  ), "live contexts must pass their current sequence id and scoped persisted transitions");
  assert.ok(contextCalls.some((call) =>
    textOf(call.arguments[0]) === "state.currentSequenceId" &&
    textOf(call.arguments[1]) === "allShots" &&
    textOf(call.arguments[3]) === "state.shotTransitions"
  ), "generation snapshots must pass their captured current sequence id and persisted transitions");

  const buildSource = textOf(buildContexts);
  const buildDescendants = [];
  const visitBuild = (node) => {
    buildDescendants.push(node);
    ts.forEachChild(node, visitBuild);
  };
  visitBuild(buildContexts);
  const resolverCalls = buildDescendants.filter((node) =>
    ts.isCallExpression(node) && textOf(node.expression) === "resolveShotTransitionBoundary"
  );
  assert.equal(resolverCalls.length, 1, "buildContexts must delegate all edge resolution to the pure resolver");
  const resolverInput = resolverCalls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(resolverInput), "resolver input must be an explicit object");
  const resolverFields = new Map(resolverInput.properties.map((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return [property.name.text, property.name.text];
    if (ts.isPropertyAssignment(property)) return [textOf(property.name), textOf(property.initializer)];
    return ["", ""];
  }));
  assert.deepEqual(Object.fromEntries(resolverFields), {
    sequenceId: "sequenceId",
    fromShot: "shot",
    toShot: "shots[index + 1]",
    transitions: "transitions"
  }, "buildContexts must pass the exact sequence and adjacent pair to the pure resolver");
  assert.ok(!buildSource.includes("transitionByPair"),
    "Panel must not retain the unscoped pair-only transition map");
}

await assertPanelTransitionWiring();

console.log("PASS video continuity planner");
