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

  useStoryboardStore.getState().resetForNewProject("Fresh");
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory, { past: [], future: [] });
  console.log("PASS shot transition store");
} finally {
  await rm(directory, { recursive: true, force: true });
}
