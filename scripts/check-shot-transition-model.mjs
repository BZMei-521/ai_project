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
const { id: firstId, ...firstFields } = first;
assert.equal(firstId.startsWith("shot-transition:"), true);
assert.deepEqual(firstFields, {
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

assert.notEqual(
  createDefaultShotTransition("seq-1", "same-from", "same-to").id,
  createDefaultShotTransition("seq-2", "same-from", "same-to").id
);
assert.notEqual(
  createDefaultShotTransition("seq:a", "from", "to").id,
  createDefaultShotTransition("seq", "a:from", "to").id
);

const nulPairOne = {
  ...createDefaultShotTransition("seq-nul", "a\u0000b", "c"),
  notes: "pair-one"
};
const nulPairTwo = {
  ...createDefaultShotTransition("seq-nul", "a", "b\u0000c"),
  notes: "pair-two"
};
for (const existingTransitions of [[nulPairOne, nulPairTwo], [nulPairTwo, nulPairOne]]) {
  assert.equal(reconcileLinearTransitions({
    sequenceId: "seq-nul",
    orderedShots: [
      { id: "a\u0000b", durationSeconds: 1 },
      { id: "c", durationSeconds: 1 }
    ],
    existingTransitions
  })[0].notes, "pair-one");
  assert.equal(reconcileLinearTransitions({
    sequenceId: "seq-nul",
    orderedShots: [
      { id: "a", durationSeconds: 1 },
      { id: "b\u0000c", durationSeconds: 1 }
    ],
    existingTransitions
  })[0].notes, "pair-two");
}

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

const [normalizedNonFiniteDuration] = reconcileLinearTransitions({
  sequenceId: "seq-1",
  orderedShots: [
    { id: "shot-1", durationSeconds: 4 },
    { id: "shot-2", durationSeconds: 0.25 }
  ],
  existingTransitions: [{ ...first, durationSeconds: Number.NaN }]
});
assert.equal(normalizedNonFiniteDuration.durationSeconds, 0.25);

const [hardCut] = reconcileLinearTransitions({
  sequenceId: "seq-1",
  orderedShots: [
    { id: "shot-1", durationSeconds: 4 },
    { id: "shot-2", durationSeconds: 3 }
  ],
  existingTransitions: [{ ...first, type: "hard_cut", durationSeconds: 0.25 }]
});
assert.equal(hardCut.durationSeconds, 0);

const [clampedOverlongDuration] = reconcileLinearTransitions({
  sequenceId: "seq-1",
  orderedShots: [
    { id: "shot-1", durationSeconds: 4 },
    { id: "shot-2", durationSeconds: 3 }
  ],
  existingTransitions: [{ ...first, durationSeconds: 8 }]
});
assert.equal(clampedOverlongDuration.durationSeconds, 3);

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
