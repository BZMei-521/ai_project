import React from "react";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

void React;

const result = await build({
  entryPoints: ["src/modules/storyboard-core/store.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["react"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
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
  useStoryboardStore.getState().selectShot("b");
  assert.equal(useStoryboardStore.getState().selectedShotId, "b");
  assert.equal(useStoryboardStore.getState().selectedShotIds.includes("b"), true);
  useStoryboardStore.getState().selectShot(null);
  assert.equal(useStoryboardStore.getState().selectedShotId, "");
  assert.deepEqual(useStoryboardStore.getState().selectedShotIds, []);
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
  useStoryboardStore.getState().selectShotTransition(useStoryboardStore.getState().shotTransitions[0].id);
  const snapshot = createStoryboardSnapshot(useStoryboardStore.getState());
  assert.deepEqual(snapshot.shotTransitions, useStoryboardStore.getState().shotTransitions);
  assert.equal(snapshot.selectedShotTransitionId, useStoryboardStore.getState().selectedShotTransitionId);
  assert.equal("shotSequenceHistory" in snapshot, false);
  useStoryboardStore.setState({ shotTransitions: [] });
  useStoryboardStore.getState().hydrateFromSnapshot(snapshot);
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, snapshot.shotTransitions);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, snapshot.selectedShotTransitionId);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory, { past: [], future: [] });

  useStoryboardStore.getState().hydrateFromSnapshot({ shots: snapshot.shots });
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [["a", "b"]]);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);

  const replace = () => useStoryboardStore.getState().replaceShotScriptForCurrentSequence({
    shots: [
      { id: "a", title: "A", prompt: "A", durationFrames: 48 },
      { id: "b", title: "B", prompt: "B", durationFrames: 48 },
      { id: "c", title: "C", prompt: "C", durationFrames: 48 }
    ],
    transitions: []
  });
  replace();
  const identity = useStoryboardStore.getState().shotTransitions[0];
  useStoryboardStore.getState().updateShotTransition(identity.id, {
    id: "forbidden",
    fromShotId: "forbidden",
    toShotId: "forbidden",
    type: "continuous",
    durationSeconds: 8
  });
  const updated = useStoryboardStore.getState().shotTransitions[0];
  assert.equal(updated.id, identity.id);
  assert.equal(updated.fromShotId, identity.fromShotId);
  assert.equal(updated.toShotId, identity.toShotId);
  assert.equal(updated.durationSeconds, 2);
  assert.equal(updated.frameDependency, "previous_tail");

  useStoryboardStore.getState().moveShot("c", "up");
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory.past.map(({ orderedShotIds }) => orderedShotIds), [["a", "b", "c"]]);
  replace();
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory, { past: [], future: [] });

  useStoryboardStore.setState({ selectedShotIds: ["b", "c"] });
  useStoryboardStore.getState().moveSelectedShots("up");
  assert.deepEqual(useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === sequenceId).sort((left, right) => left.order - right.order).map(({ id }) => id), ["b", "c", "a"]);
  assert.equal(useStoryboardStore.getState().shotSequenceHistory.past.length, 1);
  useStoryboardStore.getState().deleteSelectedShots();
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);
  useStoryboardStore.getState().undoShotSequenceEdit();
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);

  const transition = (id, sequence, from, to) => ({
    id,
    sequenceId: sequence,
    fromShotId: from,
    toShotId: to,
    type: "continuous",
    durationSeconds: 0.4,
    frameDependency: "previous_tail",
    actionContinuity: "",
    characterPosition: "",
    cameraDirection: "",
    notes: id
  });
  useStoryboardStore.setState({
    sequences: [
      { id: "seq-delete", projectId: "p", name: "Delete", order: 1 },
      { id: "seq-keep", projectId: "p", name: "Keep", order: 2 }
    ],
    currentSequenceId: "seq-delete",
    shots: [
      { id: "delete-a", sequenceId: "seq-delete", order: 1, durationFrames: 48 },
      { id: "delete-b", sequenceId: "seq-delete", order: 2, durationFrames: 48 },
      { id: "keep-a", sequenceId: "seq-keep", order: 1, durationFrames: 48 },
      { id: "keep-b", sequenceId: "seq-keep", order: 2, durationFrames: 48 }
    ],
    shotTransitions: [
      transition("delete-transition", "seq-delete", "delete-a", "delete-b"),
      transition("keep-transition", "seq-keep", "keep-a", "keep-b")
    ],
    selectedShotTransitionId: "delete-transition",
    shotSequenceHistory: {
      past: [
        { sequenceId: "seq-delete", orderedShotIds: ["delete-a", "delete-b"], transitions: [] },
        { sequenceId: "seq-keep", orderedShotIds: ["keep-a", "keep-b"], transitions: [] }
      ],
      future: [
        { sequenceId: "seq-keep", orderedShotIds: ["keep-b", "keep-a"], transitions: [] },
        { sequenceId: "seq-delete", orderedShotIds: ["delete-b", "delete-a"], transitions: [] }
      ]
    },
    selectedShotIds: []
  });
  useStoryboardStore.getState().deleteSequence("seq-delete");
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ id }) => id), ["keep-transition"]);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory.past.map(({ sequenceId: id }) => id), ["seq-keep"]);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory.future.map(({ sequenceId: id }) => id), ["seq-keep"]);

  const hydratedProject = { ...useStoryboardStore.getState().project, fps: 10 };
  const hydratedSequences = [
    { id: "seq-hydrate-a", projectId: "p", name: "Hydrate A", order: 1 },
    { id: "seq-hydrate-b", projectId: "p", name: "Hydrate B", order: 2 }
  ];
  const hydratedShots = [
    { id: "hydrate-a2", sequenceId: "seq-hydrate-a", order: 2, durationFrames: 5 },
    { id: "hydrate-b2", sequenceId: "seq-hydrate-b", order: 2, durationFrames: 10 },
    { id: "hydrate-a1", sequenceId: "seq-hydrate-a", order: 1, durationFrames: 5 },
    { id: "hydrate-a3", sequenceId: "seq-hydrate-a", order: 3, durationFrames: 20 },
    { id: "hydrate-b1", sequenceId: "seq-hydrate-b", order: 1, durationFrames: 10 }
  ];
  useStoryboardStore.setState({ project: { ...hydratedProject, fps: 100 } });
  useStoryboardStore.getState().hydrateFromSnapshot({
    project: hydratedProject,
    sequences: hydratedSequences,
    currentSequenceId: "seq-hydrate-a",
    shots: hydratedShots
  });
  assert.deepEqual(
    useStoryboardStore.getState().shotTransitions.map(({ sequenceId: id, fromShotId, toShotId, type, durationSeconds, frameDependency }) =>
      [id, fromShotId, toShotId, type, durationSeconds, frameDependency]),
    [
      ["seq-hydrate-a", "hydrate-a1", "hydrate-a2", "continuous", 0.5, "previous_tail"],
      ["seq-hydrate-a", "hydrate-a2", "hydrate-a3", "continuous", 0.5, "previous_tail"],
      ["seq-hydrate-b", "hydrate-b1", "hydrate-b2", "continuous", 0.6, "previous_tail"]
    ]
  );

  const supplied = transition("supplied", "seq-hydrate-a", "hydrate-a1", "hydrate-a2");
  useStoryboardStore.getState().hydrateFromSnapshot({
    project: hydratedProject,
    sequences: hydratedSequences,
    currentSequenceId: "seq-hydrate-a",
    shots: hydratedShots,
    shotTransitions: [supplied],
    selectedShotTransitionId: supplied.id
  });
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [
    ["hydrate-a1", "hydrate-a2"],
    ["hydrate-a2", "hydrate-a3"],
    ["hydrate-b1", "hydrate-b2"]
  ]);
  assert.equal(useStoryboardStore.getState().shotTransitions[0].notes, supplied.notes);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, supplied.id);

  useStoryboardStore.setState({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [
      { id: "seq-identity-a", projectId: "p", name: "Identity A", order: 1 },
      { id: "seq-identity-b", projectId: "p", name: "Identity B", order: 2 }
    ],
    currentSequenceId: "seq-identity-a",
    shots: [
      { id: "same-a", sequenceId: "seq-identity-a", order: 1, durationFrames: 120 },
      { id: "same-b", sequenceId: "seq-identity-a", order: 2, durationFrames: 120 },
      { id: "same-a", sequenceId: "seq-identity-b", order: 1, durationFrames: 12 },
      { id: "same-b", sequenceId: "seq-identity-b", order: 2, durationFrames: 12 }
    ],
    shotTransitions: [
      transition("ambiguous", "seq-identity-a", "same-a", "same-b"),
      transition("ambiguous", "seq-identity-b", "same-a", "same-b")
    ],
    selectedShotTransitionId: null
  });
  useStoryboardStore.getState().selectShotTransition("ambiguous");
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  useStoryboardStore.getState().updateShotTransition("ambiguous", { notes: "must-not-update" });
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ notes }) => notes), ["ambiguous", "ambiguous"]);

  useStoryboardStore.setState({
    shotTransitions: [
      transition("identity-a", "seq-identity-a", "same-a", "same-b"),
      transition("identity-b", "seq-identity-b", "same-a", "same-b")
    ],
    selectedShotTransitionId: "identity-a"
  });
  useStoryboardStore.getState().updateShotTransition("identity-b", { durationSeconds: 8 });
  assert.equal(useStoryboardStore.getState().shotTransitions.find(({ id }) => id === "identity-b").durationSeconds, 0.5);
  useStoryboardStore.getState().selectSequence("seq-identity-b");
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);

  useStoryboardStore.setState({
    sequences: [{ id: "seq-topology", projectId: "p", name: "Topology", order: 1 }],
    currentSequenceId: "seq-topology",
    shots: [
      { id: "topology-a", sequenceId: "seq-topology", order: 1, durationFrames: 48 },
      { id: "topology-b", sequenceId: "seq-topology", order: 2, durationFrames: 48 }
    ],
    shotTransitions: [transition("topology-edge", "seq-topology", "topology-a", "topology-b")],
    selectedShotTransitionId: null,
    layers: [],
    shotStrokes: {},
    shotHistory: {},
    activeLayerByShotId: {},
    selectedShotIds: []
  });
  useStoryboardStore.getState().addShot();
  const addedShots = useStoryboardStore.getState().shots
    .filter(({ sequenceId: id }) => id === "seq-topology")
    .sort((left, right) => left.order - right.order);
  const addedTransitions = useStoryboardStore.getState().shotTransitions.filter(({ sequenceId: id }) => id === "seq-topology");
  assert.equal(addedTransitions.length, addedShots.length - 1);
  assert.deepEqual(addedTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), [
    ["topology-a", "topology-b"],
    ["topology-b", addedShots[2].id]
  ]);

  useStoryboardStore.getState().duplicateSequence("seq-topology");
  const duplicateSequenceId = useStoryboardStore.getState().currentSequenceId;
  const duplicateShots = useStoryboardStore.getState().shots
    .filter(({ sequenceId: id }) => id === duplicateSequenceId)
    .sort((left, right) => left.order - right.order);
  const duplicateTransitions = useStoryboardStore.getState().shotTransitions.filter(({ sequenceId: id }) => id === duplicateSequenceId);
  assert.equal(duplicateTransitions.length, duplicateShots.length - 1);
  assert.deepEqual(duplicateTransitions.map(({ fromShotId, toShotId }) => [fromShotId, toShotId]), duplicateShots.slice(0, -1).map((shot, index) => [shot.id, duplicateShots[index + 1].id]));
  assert.equal(duplicateTransitions.every(({ notes }) => notes === ""), true);
  assert.equal(duplicateTransitions.every(({ id }) => !addedTransitions.some((source) => source.id === id)), true);

  useStoryboardStore.setState({
    sequences: [{ id: "seq-duration", projectId: "p", name: "Duration", order: 1 }],
    currentSequenceId: "seq-duration",
    shots: [
      { id: "duration-a", sequenceId: "seq-duration", order: 1, durationFrames: 48 },
      { id: "duration-b", sequenceId: "seq-duration", order: 2, durationFrames: 48 }
    ],
    shotTransitions: [{ ...transition("duration-edge", "seq-duration", "duration-a", "duration-b"), durationSeconds: 2 }],
    selectedShotIds: ["duration-b"]
  });
  useStoryboardStore.getState().batchSetDurationForSelectedShots(6);
  assert.equal(useStoryboardStore.getState().shotTransitions[0].durationSeconds, 0.25);

  useStoryboardStore.setState({
    sequences: [{ id: "seq-negative", projectId: "p", name: "Negative", order: 1 }],
    currentSequenceId: "seq-negative",
    shots: [],
    shotTransitions: [],
    layers: [],
    shotStrokes: {},
    shotHistory: {},
    activeLayerByShotId: {},
    selectedShotIds: []
  });
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence({
    shots: [{ id: "negative-a", title: "Negative", prompt: "Prompt", negativePrompt: "模糊" }],
    transitions: []
  });
  const negativeSnapshot = createStoryboardSnapshot(useStoryboardStore.getState());
  assert.equal(negativeSnapshot.shots[0].negativePrompt, "模糊");
  useStoryboardStore.setState({ shots: [] });
  useStoryboardStore.getState().hydrateFromSnapshot(negativeSnapshot);
  assert.equal(useStoryboardStore.getState().shots[0].negativePrompt, "模糊");

  useStoryboardStore.getState().resetForNewProject("Fresh");
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory, { past: [], future: [] });
  console.log("PASS shot transition store");
} finally {
  await rm(directory, { recursive: true, force: true });
}
