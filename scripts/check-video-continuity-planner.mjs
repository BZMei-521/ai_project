import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  planVideoContinuity,
  planContinuityInvalidation
} from "../src/modules/video-production/continuityPlannerRuntime.mjs";
import {
  createShotTransitionBoundaryResolver,
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
  approvalStatus: "pending"
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
  frameDependency: "none",
  approvalStatus: "pending"
}, "legacy shot boundary fields are allowed only when the exact sequence edge is absent");

const legacyApprovedTailPath = "frames/legacy-approved-tail.png";
const legacyContinuousBoundary = resolveShotTransitionBoundary({
  sequenceId: "legacy-sequence",
  fromShot: {
    id: "legacy-continuous-a",
    videoBoundaryKind: "continuous",
    approvedBoundaryFramePath: legacyApprovedTailPath
  },
  toShot: { id: "legacy-continuous-b" },
  transitions: []
});
assert.deepEqual(legacyContinuousBoundary, {
  fromShotId: "legacy-continuous-a",
  toShotId: "legacy-continuous-b",
  kind: "continuous",
  frameDependency: "previous_tail",
  sharedFramePath: legacyApprovedTailPath,
  sharedFrameSource: "previous_tail",
  approvalStatus: "approved"
}, "legacy continuous fallback must preserve explicit approved-tail provenance");
const legacyContinuousPlan = planVideoContinuity({
  shots: [
    shot("legacy-continuous-a", 1, {
      approvedTailFramePath: legacyApprovedTailPath,
      tailFrameApprovalStatus: "approved"
    }),
    shot("legacy-continuous-b", 2)
  ],
  boundaries: [legacyContinuousBoundary]
});
assert.equal(legacyContinuousPlan.shotExecutions[1].status, "ready");
assert.deepEqual(legacyContinuousPlan.shotExecutions[1].firstFrameInput, {
  kind: "approved_tail_frame",
  path: legacyApprovedTailPath,
  boundaryId: "video-boundary:legacy-continuous-a:legacy-continuous-b",
  fromShotId: "legacy-continuous-a"
}, "legacy approved continuous tails must remain consumable end to end");
assert.equal(Object.hasOwn(legacyContinuousPlan.boundaries[0], "sharedFramePath"), false,
  "the planner must normalize an approved tail away from shared-frame fields");

const legacyMissingTailBoundary = resolveShotTransitionBoundary({
  sequenceId: "legacy-sequence",
  fromShot: { id: "legacy-missing-a", videoBoundaryKind: "continuous" },
  toShot: { id: "legacy-missing-b" },
  transitions: []
});
assert.deepEqual(legacyMissingTailBoundary, {
  fromShotId: "legacy-missing-a",
  toShotId: "legacy-missing-b",
  kind: "continuous",
  frameDependency: "previous_tail",
  approvalStatus: "pending"
});
const legacyMissingTailPlan = planVideoContinuity({
  shots: [shot("legacy-missing-a", 1), shot("legacy-missing-b", 2)],
  boundaries: [legacyMissingTailBoundary]
});
assert.equal(legacyMissingTailPlan.shotExecutions[1].status, "awaiting_approval");
assert.equal(legacyMissingTailPlan.shotExecutions[1].firstFrameInput, undefined);

const legacyMatchBoundary = resolveShotTransitionBoundary({
  sequenceId: "legacy-sequence",
  fromShot: {
    id: "legacy-match-a",
    videoBoundaryKind: "match_cut",
    approvedBoundaryFramePath: "frames/legacy-match-text-path.png"
  },
  toShot: { id: "legacy-match-b" },
  transitions: []
});
assert.deepEqual(legacyMatchBoundary, {
  fromShotId: "legacy-match-a",
  toShotId: "legacy-match-b",
  kind: "match_cut",
  frameDependency: "shared_frame",
  sharedFramePath: "frames/legacy-match-text-path.png",
  sharedFrameSource: "independent",
  approvalStatus: "pending"
});
const legacyMatchPlan = planVideoContinuity({
  shots: [shot("legacy-match-a", 1), shot("legacy-match-b", 2)],
  boundaries: [legacyMatchBoundary]
});
assert.equal(legacyMatchPlan.shotExecutions[1].status, "awaiting_approval");
assert.equal(legacyMatchPlan.shotExecutions[1].firstFrameInput, undefined);

for (const kind of ["hard_cut", "scene_change"]) {
  assert.deepEqual(resolveShotTransitionBoundary({
    sequenceId: "legacy-sequence",
    fromShot: {
      id: `legacy-${kind}-a`,
      videoBoundaryKind: kind,
      approvedBoundaryFramePath: `frames/stale-${kind}.png`
    },
    toShot: { id: `legacy-${kind}-b` },
    transitions: []
  }), {
    fromShotId: `legacy-${kind}-a`,
    toShotId: `legacy-${kind}-b`,
    kind,
    frameDependency: "none",
    approvalStatus: "pending"
  }, `${kind} fallback must clear irrelevant frame path and provenance`);
}

const arbitrarySharedBoundary = resolveShotTransitionBoundary({
  sequenceId: "seq-one",
  fromShot: resolverShots[0],
  toShot: resolverShots[1],
  transitions: [seqOneTransition]
});
const arbitrarySharedPlan = planVideoContinuity({
  shots: [shot("same-a", 1), shot("same-b", 2)],
  boundaries: [arbitrarySharedBoundary]
});
assert.equal(arbitrarySharedBoundary.approvalStatus, "pending",
  "an arbitrary shared-frame text path must not manufacture approval");
assert.equal(arbitrarySharedPlan.boundaries[0].approvalStatus, "pending");
assert.equal(arbitrarySharedPlan.shotExecutions[1].status, "awaiting_approval");
assert.equal(arbitrarySharedPlan.shotExecutions[1].firstFrameInput, undefined,
  "an untrusted shared-frame path must never become a consumable first frame");

const cleanedHardCutBoundary = resolveShotTransitionBoundary({
  sequenceId: "seq-hard",
  fromShot: { id: "hard-from", approvedBoundaryFramePath: "frames/stale-hard.png" },
  toShot: { id: "hard-to" },
  transitions: [{
    ...transitionFor("seq-hard", "hard_cut"),
    fromShotId: "hard-from",
    toShotId: "hard-to",
    durationSeconds: 0,
    frameDependency: "shared_frame",
    sharedFramePath: "frames/untrusted-hard.png"
  }]
});
assert.equal(cleanedHardCutBoundary.frameDependency, "none");
assert.equal(Object.hasOwn(cleanedHardCutBoundary, "sharedFramePath"), false);
assert.equal(Object.hasOwn(cleanedHardCutBoundary, "sharedFrameSource"), false);
assert.equal(cleanedHardCutBoundary.approvalStatus, "pending");

const cleanedPreviousTailBoundary = resolveShotTransitionBoundary({
  sequenceId: "seq-tail",
  fromShot: { id: "tail-from" },
  toShot: { id: "tail-to" },
  transitions: [{
    ...transitionFor("seq-tail", "continuous"),
    fromShotId: "tail-from",
    toShotId: "tail-to",
    frameDependency: "previous_tail",
    sharedFramePath: "frames/untrusted-tail.png"
  }]
});
assert.equal(cleanedPreviousTailBoundary.frameDependency, "previous_tail");
assert.equal(Object.hasOwn(cleanedPreviousTailBoundary, "sharedFramePath"), false);
assert.equal(Object.hasOwn(cleanedPreviousTailBoundary, "sharedFrameSource"), false);
assert.equal(cleanedPreviousTailBoundary.approvalStatus, "pending");

const collidingTransitionA = {
  ...transitionFor("sequence\u0000left", "continuous"),
  id: "collision-a",
  fromShotId: "from",
  toShotId: "to",
  actionContinuity: "collision-a-guidance"
};
const collidingTransitionB = {
  ...transitionFor("sequence", "match_cut"),
  id: "collision-b",
  fromShotId: "left\u0000from",
  toShotId: "to",
  frameDependency: "shared_frame",
  sharedFramePath: "frames/collision-b.png",
  actionContinuity: "collision-b-guidance"
};
for (const transitions of [
  [collidingTransitionA, collidingTransitionB],
  [collidingTransitionB, collidingTransitionA]
]) {
  assert.equal(resolveShotTransitionBoundary({
    sequenceId: "sequence\u0000left",
    fromShot: { id: "from" },
    toShot: { id: "to" },
    transitions
  }).actionContinuity, "collision-a-guidance",
  "tuple A must not collide with tuple B when ids contain the old delimiter");
  assert.equal(resolveShotTransitionBoundary({
    sequenceId: "sequence",
    fromShot: { id: "left\u0000from" },
    toShot: { id: "to" },
    transitions
  }).actionContinuity, "collision-b-guidance",
  "tuple B must not collide with tuple A when ids contain the old delimiter");
}

let sequenceReads = 0;
const countedTransitions = ["count-a", "count-b", "other-sequence"].map((sequenceId, index) => {
  const item = transitionFor(sequenceId === "other-sequence" ? sequenceId : "count-sequence", "continuous", {
    fromShotId: `count-${index}`,
    toShotId: `count-${index + 1}`
  });
  Object.defineProperty(item, "sequenceId", {
    enumerable: true,
    get() { sequenceReads += 1; return sequenceId === "other-sequence" ? sequenceId : "count-sequence"; }
  });
  return item;
});
const resolveCountedBoundary = createShotTransitionBoundaryResolver({
  sequenceId: "count-sequence",
  transitions: countedTransitions
});
assert.equal(sequenceReads, countedTransitions.length,
  "building a sequence resolver must scan each transition exactly once");
for (let index = 0; index < 2; index += 1) {
  resolveCountedBoundary({ id: `count-${index}` }, { id: `count-${index + 1}` });
}
assert.equal(sequenceReads, countedTransitions.length,
  "resolving every adjacent edge must reuse the prebuilt index without rescanning transitions");

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

const plannerCollisionShots = [
  shot("planner-a\u0000b", 1),
  shot("planner-c", 2),
  shot("planner-a", 3),
  shot("b\u0000planner-c", 4)
];
const plannerCollisionBoundaries = [
  boundary("planner-a\u0000b", "planner-c", "continuous"),
  boundary("planner-a", "b\u0000planner-c", "match_cut", {
    frameDependency: "none"
  })
];
for (const boundaries of [plannerCollisionBoundaries, [...plannerCollisionBoundaries].reverse()]) {
  const collisionSafePlan = planVideoContinuity({ shots: plannerCollisionShots, boundaries });
  assert.equal(collisionSafePlan.boundaries.find((item) => item.fromShotId === "planner-a\u0000b")?.kind, "continuous");
  assert.equal(collisionSafePlan.boundaries.find((item) => item.fromShotId === "planner-a")?.kind, "match_cut");
}

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
    statement.importClause?.namedBindings?.elements?.some((item) => item.name.text === "createShotTransitionBoundaryResolver")
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
  const resolverFactoryCalls = buildDescendants.filter((node) =>
    ts.isCallExpression(node) && textOf(node.expression) === "createShotTransitionBoundaryResolver"
  );
  assert.equal(resolverFactoryCalls.length, 1,
    "buildContexts must build exactly one sequence-scoped resolver per context pass");
  const resolverFactoryInput = resolverFactoryCalls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(resolverFactoryInput), "resolver factory input must be explicit");
  const resolverFactoryFields = new Map(resolverFactoryInput.properties.map((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return [property.name.text, property.name.text];
    if (ts.isPropertyAssignment(property)) return [textOf(property.name), textOf(property.initializer)];
    return ["", ""];
  }));
  assert.deepEqual(Object.fromEntries(resolverFactoryFields), {
    sequenceId: "sequenceId",
    transitions: "transitions"
  }, "buildContexts must scope the single resolver index by sequence and transitions");
  const resolverDeclaration = buildContexts.body.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "resolveBoundary");
  assert.equal(resolverDeclaration?.initializer, resolverFactoryCalls[0],
    "the resolver factory result must initialize the resolveBoundary function used by the edge map");
  const boundariesDeclaration = buildContexts.body.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "boundaries");
  assert.ok(boundariesDeclaration?.initializer && ts.isCallExpression(boundariesDeclaration.initializer),
    "buildContexts must initialize boundaries from an executable mapping");
  const boundaryMapCallback = boundariesDeclaration.initializer.arguments[0];
  assert.ok(ts.isArrowFunction(boundaryMapCallback) && ts.isCallExpression(boundaryMapCallback.body),
    "boundaries must be the direct result of mapping adjacent shots through a call");
  assert.equal(textOf(boundaryMapCallback.body.expression), "resolveBoundary",
    "the boundaries initializer must directly return the indexed resolver result, preventing a dead resolver call");
  assert.deepEqual(boundaryMapCallback.body.arguments.map(textOf), ["shot", "shots[index + 1]"],
    "each edge lookup must use only its adjacent shot pair after the one-time transition scan");

  const plannerCalls = buildDescendants.filter((node) =>
    ts.isCallExpression(node) && textOf(node.expression) === "planVideoContinuity"
  );
  assert.equal(plannerCalls.length, 1, "buildContexts must create exactly one continuity plan");
  const plannerInput = plannerCalls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(plannerInput), "continuity planner input must be explicit");
  assert.ok(plannerInput.properties.some((property) =>
    ts.isShorthandPropertyAssignment(property) && property.name.text === "boundaries"
  ), "the resolver-backed boundaries variable must flow into planVideoContinuity");
  assert.ok(!buildSource.includes("transitionByPair"),
    "Panel must not retain the unscoped pair-only transition map");
}

await assertPanelTransitionWiring();

console.log("PASS video continuity planner");
