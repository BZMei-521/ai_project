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

  const videoEvidence = (shotId, sequenceId) => ({
    schemaVersion: 1,
    shotId,
    sequenceId,
    status: "ready",
    sourceVideoPath: `C:/videos/${shotId}.mp4`,
    routeDecision: { status: "selected", profileId: "minimax_h3_i2v", reason: "storyboard_anchor" },
    profilePreflight: {
      profileId: "minimax_h3_i2v",
      available: true,
      missingNodes: [],
      missingModels: [],
      warnings: []
    },
    nested: { marker: "must-deep-clone" }
  });
  const runningHubSafeId = /^[A-Za-z0-9_-]{1,80}$/;
  const windowsReservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  const assertSafeComponent = (value, label) => {
    assert.match(value, runningHubSafeId, `${label} must satisfy the RunningHub ID contract`);
    assert.equal(windowsReservedName.test(value), false, `${label} must not be a Windows reserved device name`);
  };
  const assertSafeBitmapPath = (value, label) => {
    const match = /^shots\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,80})\.png$/.exec(value);
    assert.ok(match, `${label} must be a canonical storyboard bitmap path`);
    assertSafeComponent(match[1], `${label} shot component`);
    assertSafeComponent(match[2], `${label} layer component`);
    assert.equal(value.split("/").some((component) => component === "." || component === ".."), false);
  };
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
  assert.notEqual(useStoryboardStore.getState().selectedShotTransitionId, supplied.id);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, useStoryboardStore.getState().shotTransitions[0].id);

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

  useStoryboardStore.setState({
    sequences: [
      { id: "seq-import-a", projectId: "p", name: "Import A", order: 1 },
      { id: "seq-import-b", projectId: "p", name: "Import B", order: 2 }
    ],
    currentSequenceId: "seq-import-a",
    shots: [],
    shotTransitions: [],
    selectedShotTransitionId: null,
    layers: [],
    shotStrokes: {},
    shotHistory: {},
    activeLayerByShotId: {},
    selectedShotIds: []
  });
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence({
    shots: [
      { id: "import-a1", title: "A1", prompt: "A1", durationFrames: 48 },
      { id: "import-a2", title: "A2", prompt: "A2", durationFrames: 48 }
    ],
    transitions: [transition("shared-explicit-id", "seq-import-a", "import-a1", "import-a2")]
  });
  useStoryboardStore.getState().selectSequence("seq-import-b");
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence({
    shots: [
      { id: "import-b1", title: "B1", prompt: "B1", durationFrames: 48 },
      { id: "import-b2", title: "B2", prompt: "B2", durationFrames: 48 }
    ],
    transitions: [transition("shared-explicit-id", "seq-import-b", "import-b1", "import-b2")]
  });
  const importedA = useStoryboardStore.getState().shotTransitions.find(({ sequenceId: id }) => id === "seq-import-a");
  const importedB = useStoryboardStore.getState().shotTransitions.find(({ sequenceId: id }) => id === "seq-import-b");
  assert.notEqual(importedA.id, importedB.id);
  assert.match(importedA.id, /^shot-transition-external:/);
  assert.match(importedB.id, /^shot-transition-external:/);
  useStoryboardStore.getState().selectShotTransition(importedA.id);
  useStoryboardStore.getState().updateShotTransition(importedA.id, { notes: "updated-a" });
  useStoryboardStore.getState().selectShotTransition(importedB.id);
  useStoryboardStore.getState().updateShotTransition(importedB.id, { notes: "updated-b" });
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ notes }) => notes), ["updated-a", "updated-b"]);

  const legacyCollisionId = "shot-transition:legacy-a:legacy-b";
  useStoryboardStore.getState().hydrateFromSnapshot({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [
      { id: "seq-legacy-a", projectId: "p", name: "Legacy A", order: 1 },
      { id: "seq-legacy-b", projectId: "p", name: "Legacy B", order: 2 }
    ],
    currentSequenceId: "seq-legacy-a",
    shots: [
      { id: "legacy-a", sequenceId: "seq-legacy-a", order: 1, durationFrames: 48 },
      { id: "legacy-b", sequenceId: "seq-legacy-a", order: 2, durationFrames: 48 },
      { id: "legacy-a", sequenceId: "seq-legacy-b", order: 1, durationFrames: 48 },
      { id: "legacy-b", sequenceId: "seq-legacy-b", order: 2, durationFrames: 48 }
    ],
    shotTransitions: [
      transition(legacyCollisionId, "seq-legacy-a", "legacy-a", "legacy-b"),
      transition(legacyCollisionId, "seq-legacy-b", "legacy-a", "legacy-b")
    ],
    selectedShotTransitionId: legacyCollisionId
  });
  const legacyTransitions = useStoryboardStore.getState().shotTransitions;
  assert.equal(new Set(legacyTransitions.map(({ id }) => id)).size, legacyTransitions.length);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  useStoryboardStore.getState().updateShotTransition(legacyCollisionId, { notes: "must-remain-noop" });
  assert.equal(useStoryboardStore.getState().shotTransitions.every(({ notes }) => notes !== "must-remain-noop"), true);

  useStoryboardStore.getState().hydrateFromSnapshot({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [{ id: "seq-legacy-unique", projectId: "p", name: "Legacy Unique", order: 1 }],
    currentSequenceId: "seq-legacy-unique",
    shots: [
      { id: "unique-a", sequenceId: "seq-legacy-unique", order: 1, durationFrames: 48 },
      { id: "unique-b", sequenceId: "seq-legacy-unique", order: 2, durationFrames: 48 }
    ],
    shotTransitions: [transition("legacy-unique-id", "seq-legacy-unique", "unique-a", "unique-b")],
    selectedShotTransitionId: "legacy-unique-id"
  });
  assert.notEqual(useStoryboardStore.getState().selectedShotTransitionId, "legacy-unique-id");
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, useStoryboardStore.getState().shotTransitions[0].id);
  const canonicalId = useStoryboardStore.getState().shotTransitions[0].id;
  const canonicalSnapshot = createStoryboardSnapshot(useStoryboardStore.getState());
  useStoryboardStore.getState().hydrateFromSnapshot(canonicalSnapshot);
  assert.equal(useStoryboardStore.getState().shotTransitions[0].id, canonicalId);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, canonicalId);
  useStoryboardStore.getState().hydrateFromSnapshot(createStoryboardSnapshot(useStoryboardStore.getState()));
  assert.equal(useStoryboardStore.getState().shotTransitions[0].id, canonicalId);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, canonicalId);
  const canonicalTransition = useStoryboardStore.getState().shotTransitions[0];
  const canonicalImport = {
    shots: [
      { id: "unique-a", title: "Unique A", prompt: "Unique A", durationFrames: 48 },
      { id: "unique-b", title: "Unique B", prompt: "Unique B", durationFrames: 48 }
    ],
    transitions: [canonicalTransition]
  };
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(canonicalImport);
  assert.equal(useStoryboardStore.getState().shotTransitions[0].id, canonicalId);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, canonicalId);
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(canonicalImport);
  assert.equal(useStoryboardStore.getState().shotTransitions[0].id, canonicalId);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, canonicalId);

  useStoryboardStore.setState({
    sequences: [{ id: "seq-id-gap", projectId: "p", name: "ID Gap", order: 1 }],
    currentSequenceId: "seq-id-gap",
    shots: [
      { id: "shot_001", sequenceId: "seq-id-gap", order: 1, durationFrames: 48 },
      { id: "shot_002", sequenceId: "seq-id-gap", order: 2, durationFrames: 48 },
      { id: "shot_003", sequenceId: "seq-id-gap", order: 3, durationFrames: 48 }
    ],
    shotTransitions: [
      transition("gap-edge-1", "seq-id-gap", "shot_001", "shot_002"),
      transition("gap-edge-2", "seq-id-gap", "shot_002", "shot_003")
    ],
    selectedShotTransitionId: null,
    layers: [],
    shotStrokes: {},
    shotHistory: {},
    activeLayerByShotId: {},
    selectedShotIds: []
  });
  useStoryboardStore.getState().deleteShot("shot_002");
  useStoryboardStore.getState().addShot();
  const gapShots = useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-id-gap");
  const addedGapShotId = useStoryboardStore.getState().selectedShotId;
  assert.equal(new Set(gapShots.map(({ id }) => id)).size, gapShots.length);
  assert.notEqual(addedGapShotId, "shot_003");
  const gapTransitions = useStoryboardStore.getState().shotTransitions.filter(({ sequenceId: id }) => id === "seq-id-gap");
  assert.equal(gapTransitions.length, gapShots.length - 1);
  assert.equal(gapTransitions.some(({ fromShotId, toShotId }) => fromShotId === toShotId), false);
  useStoryboardStore.getState().deleteShot(addedGapShotId);
  assert.deepEqual(useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-id-gap").map(({ id }) => id).sort(), ["shot_001", "shot_003"]);

  useStoryboardStore.setState({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [{ id: "seq-single-duration", projectId: "p", name: "Single Duration", order: 1 }],
    currentSequenceId: "seq-single-duration",
    shots: [
      { id: "single-a", sequenceId: "seq-single-duration", order: 1, durationFrames: 48 },
      { id: "single-b", sequenceId: "seq-single-duration", order: 2, durationFrames: 48 }
    ],
    shotTransitions: [{ ...transition("single-edge", "seq-single-duration", "single-a", "single-b"), durationSeconds: 2 }]
  });
  useStoryboardStore.getState().setShotDuration("single-b", 6);
  assert.equal(useStoryboardStore.getState().shotTransitions[0].durationSeconds, 0.25);

  useStoryboardStore.setState({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [
      { id: "seq-fps-a", projectId: "p", name: "FPS A", order: 1 },
      { id: "seq-fps-b", projectId: "p", name: "FPS B", order: 2 }
    ],
    shots: [
      { id: "fps-a1", sequenceId: "seq-fps-a", order: 1, durationFrames: 12 },
      { id: "fps-a2", sequenceId: "seq-fps-a", order: 2, durationFrames: 12 },
      { id: "fps-b1", sequenceId: "seq-fps-b", order: 1, durationFrames: 12 },
      { id: "fps-b2", sequenceId: "seq-fps-b", order: 2, durationFrames: 12 }
    ],
    shotTransitions: [
      { ...transition("fps-edge-a", "seq-fps-a", "fps-a1", "fps-a2"), durationSeconds: 0.5 },
      { ...transition("fps-edge-b", "seq-fps-b", "fps-b1", "fps-b2"), durationSeconds: 0.5 }
    ]
  });
  useStoryboardStore.getState().updateProjectSettings({ fps: 48 });
  assert.deepEqual(useStoryboardStore.getState().shotTransitions.map(({ durationSeconds }) => durationSeconds), [0.25, 0.25]);

  useStoryboardStore.setState({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [
      { id: "seq-shot-id-a", projectId: "p", name: "Shot ID A", order: 1 },
      { id: "seq-shot-id-b", projectId: "p", name: "Shot ID B", order: 2 }
    ],
    currentSequenceId: "seq-shot-id-a",
    shots: [],
    shotTransitions: [],
    selectedShotId: "",
    selectedShotIds: [],
    layers: [],
    shotStrokes: {},
    shotHistory: {},
    activeLayerByShotId: {}
  });
  const duplicateExternalShotImport = {
    shots: [
      {
        id: "external-a", title: "External A", prompt: "External A", durationFrames: 48,
        videoProductionEvidence: videoEvidence("external-a", "seq-shot-id-a")
      },
      { id: "external-b", title: "External B", prompt: "External B", durationFrames: 48 }
    ],
    transitions: [transition("external-edge", "ignored", "external-a", "external-b")]
  };
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(duplicateExternalShotImport);
  const sequenceAShotIds = useStoryboardStore.getState().shots
    .filter(({ sequenceId: id }) => id === "seq-shot-id-a")
    .sort((left, right) => left.order - right.order)
    .map(({ id }) => id);
  useStoryboardStore.getState().selectSequence("seq-shot-id-b");
  const duplicateExternalShotImportB = {
    ...duplicateExternalShotImport,
    shots: duplicateExternalShotImport.shots.map((shot) => shot.id === "external-a"
      ? { ...shot, videoProductionEvidence: videoEvidence("external-a", "seq-shot-id-b") }
      : shot)
  };
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(duplicateExternalShotImportB);
  const sequenceBShotIds = useStoryboardStore.getState().shots
    .filter(({ sequenceId: id }) => id === "seq-shot-id-b")
    .sort((left, right) => left.order - right.order)
    .map(({ id }) => id);
  assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id)).size, 4);
  assert.equal(sequenceBShotIds.every((id) => !sequenceAShotIds.includes(id)), true);
  assert.deepEqual(
    useStoryboardStore.getState().shotTransitions
      .filter(({ sequenceId: id }) => id === "seq-shot-id-b")
      .map(({ fromShotId, toShotId }) => [fromShotId, toShotId]),
    [[sequenceBShotIds[0], sequenceBShotIds[1]]]
  );
  const importedAEvidence = useStoryboardStore.getState().shots.find(({ id }) => id === sequenceAShotIds[0]).videoProductionEvidence;
  const importedBEvidence = useStoryboardStore.getState().shots.find(({ id }) => id === sequenceBShotIds[0]).videoProductionEvidence;
  assert.equal(importedAEvidence.sequenceId, "seq-shot-id-a");
  assert.equal(importedBEvidence.shotId, sequenceBShotIds[0]);
  assert.equal(importedBEvidence.sequenceId, "seq-shot-id-b");
  assert.notEqual(importedBEvidence, duplicateExternalShotImportB.shots[0].videoProductionEvidence);
  assert.notEqual(importedBEvidence.nested, duplicateExternalShotImportB.shots[0].videoProductionEvidence.nested);
  assert.notEqual(importedBEvidence, importedAEvidence);
  const firstBImportIds = [...sequenceBShotIds];
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(duplicateExternalShotImportB);
  assert.deepEqual(
    useStoryboardStore.getState().shots
      .filter(({ sequenceId: id }) => id === "seq-shot-id-b")
      .sort((left, right) => left.order - right.order)
      .map(({ id }) => id),
    firstBImportIds
  );
  useStoryboardStore.getState().updateShotFields(sequenceBShotIds[0], { notes: "B only" });
  assert.equal(useStoryboardStore.getState().shots.find(({ id }) => id === sequenceBShotIds[0]).notes, "B only");
  assert.equal(useStoryboardStore.getState().shots.find(({ id }) => id === sequenceAShotIds[0]).notes, "");
  useStoryboardStore.getState().selectShot(sequenceBShotIds[0]);
  useStoryboardStore.getState().toggleShotSelection(sequenceBShotIds[1]);
  assert.equal(useStoryboardStore.getState().selectedShotIds.includes(sequenceAShotIds[0]), false);
  assert.deepEqual(new Set(useStoryboardStore.getState().selectedShotIds), new Set(sequenceBShotIds));
  useStoryboardStore.getState().setShotDuration(sequenceBShotIds[0], 12);
  assert.equal(useStoryboardStore.getState().shots.find(({ id }) => id === sequenceAShotIds[0]).durationFrames, 48);
  useStoryboardStore.getState().deleteShot(sequenceBShotIds[0]);
  assert.deepEqual(
    useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-shot-id-a").map(({ id }) => id),
    sequenceAShotIds
  );
  assert.equal(useStoryboardStore.getState().layers.some(({ shotId }) => shotId === sequenceAShotIds[0]), true);
  assert.deepEqual(useStoryboardStore.getState().shotStrokes[sequenceAShotIds[0]], []);
  assert.deepEqual(useStoryboardStore.getState().shotHistory[sequenceAShotIds[0]], { past: [], future: [] });

  useStoryboardStore.getState().replaceShotScriptForCurrentSequence({
    shots: [
      { id: "validation-good", title: "Good", prompt: "Good", durationFrames: 48, videoProductionEvidence: videoEvidence("validation-good", "seq-shot-id-b") },
      { id: "validation-foreign", title: "Foreign", prompt: "Foreign", durationFrames: 48, videoProductionEvidence: videoEvidence("another-shot", "seq-shot-id-b") },
      {
        id: "validation-malformed", title: "Malformed", prompt: "Malformed", durationFrames: 48,
        videoProductionEvidence: { schemaVersion: 1, shotId: "validation-malformed", sequenceId: "seq-shot-id-b", status: "ready", sourceVideoPath: "C:/malformed.mp4" }
      }
    ],
    transitions: []
  });
  const validationShots = useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-shot-id-b");
  assert.ok(validationShots.find(({ id }) => id === "validation-good").videoProductionEvidence);
  assert.equal(validationShots.find(({ id }) => id === "validation-foreign").videoProductionEvidence, undefined);
  assert.equal(validationShots.find(({ id }) => id === "validation-malformed").videoProductionEvidence, undefined);

  const adversarialExternalIds = [
    "a", "A", "b", "NUL", "path/segment", "path\\segment", "..", "colon:id", "percent%id",
    "界".repeat(120), "CON", "x".repeat(81)
  ];
  useStoryboardStore.setState({
    sequences: [
      { id: "seq-codec-a", projectId: "p", name: "Codec A", order: 1 },
      { id: "seq-codec-b", projectId: "p", name: "Codec B", order: 2 }
    ],
    currentSequenceId: "seq-codec-a",
    shots: [], shotTransitions: [], selectedShotId: "", selectedShotIds: [],
    layers: [], shotStrokes: {}, shotHistory: {}, activeLayerByShotId: {}
  });
  const codecImport = {
    shots: adversarialExternalIds.map((id, index) => ({ id, title: `Codec ${index}`, prompt: `Codec ${index}`, durationFrames: 48 })),
    transitions: []
  };
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(codecImport);
  const codecAIds = useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-codec-a").sort((a, b) => a.order - b.order).map(({ id }) => id);
  useStoryboardStore.getState().selectSequence("seq-codec-b");
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(codecImport);
  const codecBIds = useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-codec-b").sort((a, b) => a.order - b.order).map(({ id }) => id);
  assert.equal(codecAIds[0], "a");
  assert.notEqual(codecAIds[1], "A");
  assert.equal(codecAIds[2], "b");
  for (const [index, id] of [...codecAIds, ...codecBIds].entries()) assertSafeComponent(id, `codec shot ${index}`);
  assert.equal(codecAIds.every((id) => !codecBIds.includes(id)), true);
  assert.equal(new Set([...codecAIds, ...codecBIds].map((id) => id.toLowerCase())).size, codecAIds.length + codecBIds.length);
  assert.equal(Math.max(...[...codecAIds, ...codecBIds].map((id) => id.length)) <= 80, true);
  for (const [index, layer] of useStoryboardStore.getState().layers.entries()) {
    assertSafeComponent(layer.id, `codec layer ${index}`);
    assertSafeBitmapPath(layer.bitmapPath, `codec bitmap ${index}`);
  }
  assert.equal(new Set(useStoryboardStore.getState().layers.map(({ id }) => id.toLowerCase())).size, useStoryboardStore.getState().layers.length);
  assert.equal(useStoryboardStore.getState().shotTransitions.some(({ fromShotId, toShotId }) => fromShotId === toShotId), false);
  useStoryboardStore.getState().updateShotFields(codecBIds[0], { notes: "casefold B only" });
  assert.equal(useStoryboardStore.getState().shots.find(({ id }) => id === codecAIds[0]).notes, "");
  useStoryboardStore.getState().deleteShot(codecBIds[1]);
  assert.equal(useStoryboardStore.getState().shots.some(({ id }) => id === codecAIds[1]), true);
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(codecImport);
  assert.deepEqual(useStoryboardStore.getState().shots.filter(({ sequenceId: id }) => id === "seq-codec-b").sort((a, b) => a.order - b.order).map(({ id }) => id), codecBIds);
  const stableCodecSnapshot = createStoryboardSnapshot(useStoryboardStore.getState());
  useStoryboardStore.getState().resetForNewProject("Codec sentinel");
  useStoryboardStore.getState().hydrateFromSnapshot(stableCodecSnapshot);
  assert.deepEqual(useStoryboardStore.getState().shots.map(({ id }) => id), stableCodecSnapshot.shots.map(({ id }) => id));
  useStoryboardStore.getState().hydrateFromSnapshot(createStoryboardSnapshot(useStoryboardStore.getState()));
  assert.deepEqual(useStoryboardStore.getState().shots.map(({ id }) => id), stableCodecSnapshot.shots.map(({ id }) => id));

  const saltedExternalId = "salted/unsafe/id";
  useStoryboardStore.setState({
    sequences: [{ id: "seq-codec-salt", projectId: "p", name: "Salt Probe", order: 1 }],
    currentSequenceId: "seq-codec-salt",
    shots: [], shotTransitions: [], selectedShotId: "", selectedShotIds: [],
    layers: [], shotStrokes: {}, shotHistory: {}, activeLayerByShotId: {}
  });
  const saltedImport = { shots: [{ id: saltedExternalId, title: "Salted", prompt: "Salted", durationFrames: 48 }], transitions: [] };
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(saltedImport);
  const saltZeroId = useStoryboardStore.getState().selectedShotId;
  const uppercaseSaltZeroId = saltZeroId.toUpperCase();
  useStoryboardStore.setState({
    sequences: [
      { id: "seq-codec-blocker", projectId: "p", name: "Salt Blocker", order: 1 },
      { id: "seq-codec-salt", projectId: "p", name: "Salt Target", order: 2 }
    ],
    currentSequenceId: "seq-codec-salt",
    shots: [{ id: uppercaseSaltZeroId, sequenceId: "seq-codec-blocker", order: 1, durationFrames: 48 }],
    shotTransitions: [], selectedShotId: "", selectedShotIds: [],
    layers: [], shotStrokes: {}, shotHistory: {}, activeLayerByShotId: {}
  });
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(saltedImport);
  const saltOneId = useStoryboardStore.getState().selectedShotId;
  assertSafeComponent(saltOneId, "salt-one shot");
  assert.notEqual(saltOneId.toLowerCase(), saltZeroId.toLowerCase());
  assert.equal(useStoryboardStore.getState().shots.some(({ sequenceId, id }) => sequenceId === "seq-codec-blocker" && id === uppercaseSaltZeroId), true);
  useStoryboardStore.getState().replaceShotScriptForCurrentSequence(saltedImport);
  assert.equal(useStoryboardStore.getState().selectedShotId, saltOneId);
  const saltedSnapshot = createStoryboardSnapshot(useStoryboardStore.getState());
  useStoryboardStore.getState().resetForNewProject("Salt sentinel");
  useStoryboardStore.getState().hydrateFromSnapshot(saltedSnapshot);
  assert.equal(useStoryboardStore.getState().shots.find(({ sequenceId }) => sequenceId === "seq-codec-salt").id, saltOneId);
  useStoryboardStore.getState().hydrateFromSnapshot(createStoryboardSnapshot(useStoryboardStore.getState()));
  assert.equal(useStoryboardStore.getState().shots.find(({ sequenceId }) => sequenceId === "seq-codec-salt").id, saltOneId);

  const oldExternalId = "shot-external:%5B%22external%22%2C%22old-seq%22%2C%22old%2Fshot%22%5D";
  useStoryboardStore.getState().hydrateFromSnapshot({
    sequences: [{ id: "seq-codec-legacy", projectId: "p", name: "Codec Legacy", order: 1 }],
    currentSequenceId: "seq-codec-legacy",
    shots: [
      { id: oldExternalId, sequenceId: "seq-codec-legacy", order: 1, durationFrames: 48 },
      { id: "unsafe/id", sequenceId: "seq-codec-legacy", order: 2, durationFrames: 48, videoProductionEvidence: videoEvidence("unsafe/id", "seq-codec-legacy") },
      { id: "CON", sequenceId: "seq-codec-legacy", order: 3, durationFrames: 48 }
    ],
    shotTransitions: [transition("legacy-codec-edge", "seq-codec-legacy", oldExternalId, "unsafe/id")],
    selectedShotId: "unsafe/id",
    selectedShotIds: ["unsafe/id"],
    layers: [
      { id: "layer:old", shotId: oldExternalId, name: "Old", visible: true, locked: false, zIndex: 1, bitmapPath: `shots/${oldExternalId}/layer:old.png` },
      { id: "layer/unsafe", shotId: "unsafe/id", name: "Unsafe", visible: true, locked: false, zIndex: 1, bitmapPath: "shots/unsafe/id/layer.png" }
    ],
    activeLayerByShotId: { "unsafe/id": "layer/unsafe" },
    shotStrokes: { "unsafe/id": [{ id: "stroke", points: [{ x: 0, y: 0 }], color: "#000", size: 1, layerId: "layer/unsafe" }] },
    shotHistory: { "unsafe/id": { past: [], future: [] } },
    generationTasks: [{ id: "codec-task", batchId: "batch", shotId: "unsafe/id", workflowId: "wf", stage: "image", status: "queued", promptHash: "hash", startedAt: "now" }]
  });
  const migratedCodecState = useStoryboardStore.getState();
  const migratedCodecIds = migratedCodecState.shots.slice().sort((a, b) => a.order - b.order).map(({ id }) => id);
  for (const [index, id] of migratedCodecIds.entries()) assertSafeComponent(id, `migrated codec shot ${index}`);
  assert.equal(migratedCodecIds.includes(oldExternalId), false);
  assert.equal(migratedCodecState.selectedShotId, migratedCodecIds[1]);
  assert.deepEqual(migratedCodecState.selectedShotIds, [migratedCodecIds[1]]);
  assert.equal(migratedCodecState.generationTasks[0].shotId, migratedCodecIds[1]);
  assert.equal(migratedCodecState.shots.find(({ id }) => id === migratedCodecIds[1]).videoProductionEvidence.shotId, migratedCodecIds[1]);
  for (const [index, layer] of migratedCodecState.layers.entries()) {
    assertSafeComponent(layer.id, `migrated codec layer ${index}`);
    assertSafeBitmapPath(layer.bitmapPath, `migrated codec bitmap ${index}`);
  }
  assert.equal(migratedCodecState.shotTransitions.some(({ fromShotId, toShotId }) => fromShotId === toShotId), false);
  const migratedCodecSnapshot = createStoryboardSnapshot(migratedCodecState);
  useStoryboardStore.getState().hydrateFromSnapshot(migratedCodecSnapshot);
  assert.deepEqual(useStoryboardStore.getState().shots.map(({ id }) => id), migratedCodecIds);
  useStoryboardStore.getState().hydrateFromSnapshot(createStoryboardSnapshot(useStoryboardStore.getState()));
  assert.deepEqual(useStoryboardStore.getState().shots.map(({ id }) => id), migratedCodecIds);

  const legacyStroke = { id: "legacy-stroke", points: [{ x: 1, y: 2 }], color: "#000", size: 2, layerId: "legacy-layer" };
  const validHydrateEvidence = videoEvidence("legacy/duplicate", "seq-legacy-shot-b");
  const foreignShotHydrateEvidence = videoEvidence("another-shot", "seq-legacy-shot-b");
  const foreignSequenceHydrateEvidence = videoEvidence("foreign-sequence-key", "another-sequence");
  useStoryboardStore.getState().hydrateFromSnapshot({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: [
      { id: "seq-legacy-shot-a", projectId: "p", name: "Legacy Shot A", order: 1 },
      { id: "seq-legacy-shot-b", projectId: "p", name: "Legacy Shot B", order: 2 }
    ],
    currentSequenceId: "seq-legacy-shot-b",
    shots: [
      { id: "legacy/duplicate", sequenceId: "seq-legacy-shot-a", order: 1, durationFrames: 48 },
      { id: "legacy-tail-a", sequenceId: "seq-legacy-shot-a", order: 2, durationFrames: 48 },
      { id: "foreign-shot-key", sequenceId: "seq-legacy-shot-a", order: 3, durationFrames: 48 },
      { id: "foreign-sequence-key", sequenceId: "seq-legacy-shot-a", order: 4, durationFrames: 48 },
      { id: "malformed-key", sequenceId: "seq-legacy-shot-a", order: 5, durationFrames: 48 },
      {
        id: "legacy/duplicate", sequenceId: "seq-legacy-shot-b", order: 1, durationFrames: 48,
        videoProductionEvidence: validHydrateEvidence
      },
      { id: "legacy-tail-b", sequenceId: "seq-legacy-shot-b", order: 2, durationFrames: 48 },
      { id: "foreign-shot-key", sequenceId: "seq-legacy-shot-b", order: 3, durationFrames: 48, videoProductionEvidence: foreignShotHydrateEvidence },
      { id: "foreign-sequence-key", sequenceId: "seq-legacy-shot-b", order: 4, durationFrames: 48, videoProductionEvidence: foreignSequenceHydrateEvidence },
      {
        id: "malformed-key", sequenceId: "seq-legacy-shot-b", order: 5, durationFrames: 48,
        videoProductionEvidence: { schemaVersion: 1, shotId: "malformed-key", sequenceId: "seq-legacy-shot-b", status: "ready" }
      }
    ],
    shotTransitions: [
      transition("legacy-shot-edge-a", "seq-legacy-shot-a", "legacy/duplicate", "legacy-tail-a"),
      transition("legacy-shot-edge-b", "seq-legacy-shot-b", "legacy/duplicate", "legacy-tail-b")
    ],
    selectedShotId: "legacy/duplicate",
    selectedShotIds: ["legacy/duplicate"],
    layers: [{ id: "legacy-layer", shotId: "legacy/duplicate", name: "Legacy", visible: true, locked: false, zIndex: 1, bitmapPath: "legacy.png" }],
    activeLayerByShotId: { "legacy/duplicate": "legacy-layer" },
    shotStrokes: { "legacy/duplicate": [legacyStroke] },
    shotHistory: { "legacy/duplicate": { past: [[legacyStroke]], future: [] } },
    generationTasks: [{ id: "legacy-task", batchId: "batch", shotId: "legacy/duplicate", workflowId: "wf", stage: "image", status: "queued", promptHash: "hash", startedAt: "now" }]
  });
  const migratedLegacyState = useStoryboardStore.getState();
  const migratedLegacyIds = migratedLegacyState.shots.map(({ id }) => id);
  assert.equal(new Set(migratedLegacyIds).size, migratedLegacyIds.length);
  const legacyAId = migratedLegacyState.shots.find(({ sequenceId: id, order }) => id === "seq-legacy-shot-a" && order === 1).id;
  const legacyBId = migratedLegacyState.shots.find(({ sequenceId: id, order }) => id === "seq-legacy-shot-b" && order === 1).id;
  assert.notEqual(legacyAId, legacyBId);
  assert.equal(migratedLegacyState.selectedShotId, legacyBId);
  assert.deepEqual(migratedLegacyState.selectedShotIds, [legacyBId]);
  assert.equal(migratedLegacyState.shots.find(({ id }) => id === legacyBId).videoProductionEvidence.shotId, legacyBId);
  assert.equal(migratedLegacyState.shots.find(({ sequenceId: id, order }) => id === "seq-legacy-shot-b" && order === 1).videoProductionEvidence.sequenceId, "seq-legacy-shot-b");
  assert.notEqual(migratedLegacyState.shots.find(({ id }) => id === legacyBId).videoProductionEvidence, validHydrateEvidence);
  assert.notEqual(migratedLegacyState.shots.find(({ id }) => id === legacyBId).videoProductionEvidence.nested, validHydrateEvidence.nested);
  assert.equal(migratedLegacyState.shots.find(({ sequenceId: id, order }) => id === "seq-legacy-shot-b" && order === 3).videoProductionEvidence, undefined);
  assert.equal(migratedLegacyState.shots.find(({ sequenceId: id, order }) => id === "seq-legacy-shot-b" && order === 4).videoProductionEvidence, undefined);
  assert.equal(migratedLegacyState.shots.find(({ sequenceId: id, order }) => id === "seq-legacy-shot-b" && order === 5).videoProductionEvidence, undefined);
  for (const [sequence, expectedFrom] of [["seq-legacy-shot-a", legacyAId], ["seq-legacy-shot-b", legacyBId]]) {
    const edge = migratedLegacyState.shotTransitions.find(({ sequenceId }) => sequenceId === sequence);
    assert.equal(edge.fromShotId, expectedFrom);
    assert.equal(edge.toShotId, migratedLegacyState.shots.find(({ sequenceId, order }) => sequenceId === sequence && order === 2).id);
    assert.notEqual(edge.fromShotId, edge.toShotId);
  }
  const legacyALayer = migratedLegacyState.layers.find(({ shotId }) => shotId === legacyAId);
  const legacyBLayer = migratedLegacyState.layers.find(({ shotId }) => shotId === legacyBId);
  assert.ok(legacyALayer);
  assert.ok(legacyBLayer);
  assert.notEqual(legacyALayer.id, legacyBLayer.id);
  assert.equal(migratedLegacyState.activeLayerByShotId[legacyAId], legacyALayer.id);
  assert.equal(migratedLegacyState.activeLayerByShotId[legacyBId], legacyBLayer.id);
  assert.notEqual(migratedLegacyState.shotStrokes[legacyAId], migratedLegacyState.shotStrokes[legacyBId]);
  assert.notEqual(migratedLegacyState.shotHistory[legacyAId], migratedLegacyState.shotHistory[legacyBId]);
  assert.notEqual(migratedLegacyState.shotStrokes[legacyAId][0], migratedLegacyState.shotStrokes[legacyBId][0]);
  assert.notEqual(migratedLegacyState.shotStrokes[legacyAId][0].points, migratedLegacyState.shotStrokes[legacyBId][0].points);
  assert.notEqual(migratedLegacyState.shotHistory[legacyAId].past[0][0], migratedLegacyState.shotHistory[legacyBId].past[0][0]);
  assert.equal(migratedLegacyState.shotStrokes[legacyBId][0].layerId, legacyBLayer.id);
  assert.equal(migratedLegacyState.shotStrokes[legacyAId][0].layerId, legacyALayer.id);
  assert.equal(migratedLegacyState.generationTasks[0].shotId, legacyBId);
  const stableLegacySnapshot = createStoryboardSnapshot(migratedLegacyState);
  const firstHydratedEvidence = migratedLegacyState.shots.find(({ id }) => id === legacyBId).videoProductionEvidence;
  assert.deepEqual(stableLegacySnapshot.selectedShotIds, [legacyBId]);
  useStoryboardStore.getState().resetForNewProject("Selection fallback sentinel");
  useStoryboardStore.getState().hydrateFromSnapshot(stableLegacySnapshot);
  assert.deepEqual(useStoryboardStore.getState().shots.map(({ id }) => id), migratedLegacyIds);
  assert.equal(useStoryboardStore.getState().selectedShotId, legacyBId);
  assert.deepEqual(useStoryboardStore.getState().selectedShotIds, [legacyBId]);
  assert.deepEqual(useStoryboardStore.getState().shots.find(({ id }) => id === legacyBId).videoProductionEvidence, firstHydratedEvidence);
  assert.notEqual(useStoryboardStore.getState().shots.find(({ id }) => id === legacyBId).videoProductionEvidence, firstHydratedEvidence);
  useStoryboardStore.getState().hydrateFromSnapshot(createStoryboardSnapshot(useStoryboardStore.getState()));
  assert.equal(useStoryboardStore.getState().selectedShotId, legacyBId);
  assert.deepEqual(useStoryboardStore.getState().selectedShotIds, [legacyBId]);
  assert.deepEqual(useStoryboardStore.getState().shots.find(({ id }) => id === legacyBId).videoProductionEvidence, firstHydratedEvidence);
  assert.notEqual(useStoryboardStore.getState().shots.find(({ id }) => id === legacyBId).videoProductionEvidence, firstHydratedEvidence);
  useStoryboardStore.getState().shotStrokes[legacyBId][0].points[0].x = 99;
  useStoryboardStore.getState().shotHistory[legacyBId].past[0][0].points[0].y = 88;
  assert.deepEqual(useStoryboardStore.getState().shotStrokes[legacyAId][0].points[0], { x: 1, y: 2 });
  assert.deepEqual(useStoryboardStore.getState().shotHistory[legacyAId].past[0][0].points[0], { x: 1, y: 2 });
  const legacyABitmapPath = useStoryboardStore.getState().layers.find(({ shotId }) => shotId === legacyAId).bitmapPath;
  assert.equal(useStoryboardStore.getState().layers.find(({ shotId }) => shotId === legacyBId).bitmapPath, legacyABitmapPath);
  useStoryboardStore.getState().deleteShot(legacyBId);
  assert.equal(useStoryboardStore.getState().shots.some(({ id }) => id === legacyAId), true);
  assert.equal(useStoryboardStore.getState().layers.some(({ shotId, bitmapPath }) => shotId === legacyAId && bitmapPath === legacyABitmapPath), true);
  assert.ok(useStoryboardStore.getState().shotStrokes[legacyAId]);
  assert.ok(useStoryboardStore.getState().shotHistory[legacyAId]);

  useStoryboardStore.setState({
    sequences: [
      { id: "seq-global-id-a", projectId: "p", name: "Global A", order: 1 },
      { id: "seq-global-id-b", projectId: "p", name: "Global B", order: 2 }
    ],
    currentSequenceId: "seq-global-id-b",
    shots: [
      { id: "SHOT_001", sequenceId: "seq-global-id-a", order: 1, durationFrames: 24 },
      { id: "shot_001_1", sequenceId: "seq-global-id-a", order: 2, durationFrames: 24 }
    ],
    shotTransitions: [], layers: [], shotStrokes: {}, shotHistory: {}, activeLayerByShotId: {}
  });
  useStoryboardStore.getState().addShot();
  assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id)).size, 3);
  assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id.toLowerCase())).size, 3);
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  try {
    Date.now = () => 1234;
    Math.random = () => 0.007;
    useStoryboardStore.setState({
      sequences: [
        { id: "seq-generator-source", projectId: "p", name: "Source", order: 1 },
        { id: "seq_1234_7", projectId: "p", name: "Collision", order: 2 }
      ],
      currentSequenceId: "seq-generator-source",
      shots: [
        {
          id: "source-shot", sequenceId: "seq-generator-source", order: 1, durationFrames: 24, title: "Source",
          videoProductionEvidence: { ...videoEvidence("source-shot", "seq-generator-source"), nested: { source: true } },
          videoGenerationReceipt: { promptId: "source-prompt" }, videoGenerationContractDigest: "source-contract",
          videoProviderArtifact: { provider: "source" }, runningHubCloud: { status: "completed", taskId: "source-task" },
          approvedBoundaryFramePath: "source-boundary.png", generatedImagePath: "source.png", generatedVideoPath: "source.mp4",
          videoQualityStatus: "approved"
        },
        { id: "SHOT_1234_7", sequenceId: "seq_1234_7", order: 1, durationFrames: 24 },
        { id: "SHOT_1234_0_7", sequenceId: "seq_1234_7", order: 2, durationFrames: 24 }
      ],
      shotTransitions: [], layers: [], shotStrokes: {}, shotHistory: {}, activeLayerByShotId: {}
    });
    useStoryboardStore.getState().duplicateShot("source-shot");
    const duplicatedShot = useStoryboardStore.getState().shots.find(({ id }) => id === useStoryboardStore.getState().selectedShotId);
    for (const field of ["videoProductionEvidence", "videoGenerationReceipt", "videoGenerationContractDigest", "videoProviderArtifact", "runningHubCloud", "approvedBoundaryFramePath", "generatedImagePath", "generatedVideoPath"]) {
      assert.equal(duplicatedShot[field], undefined, `duplicateShot retained ${field}`);
    }
    assert.equal(duplicatedShot.videoQualityStatus, "pending");
    assert.equal(useStoryboardStore.getState().shots.find(({ id }) => id === "source-shot").videoProductionEvidence.shotId, "source-shot");
    assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id)).size, useStoryboardStore.getState().shots.length);
    assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id.toLowerCase())).size, useStoryboardStore.getState().shots.length);
    useStoryboardStore.getState().duplicateSequence("seq-generator-source");
    const duplicatedSequenceShots = useStoryboardStore.getState().shots.filter(({ sequenceId }) => sequenceId === useStoryboardStore.getState().currentSequenceId);
    assert.equal(duplicatedSequenceShots.every((shot) => shot.videoProductionEvidence === undefined && shot.videoGenerationReceipt === undefined && shot.generatedVideoPath === undefined), true);
    assert.equal(new Set(useStoryboardStore.getState().sequences.map(({ id }) => id)).size, useStoryboardStore.getState().sequences.length);
    assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id)).size, useStoryboardStore.getState().shots.length);
    assert.equal(new Set(useStoryboardStore.getState().shots.map(({ id }) => id.toLowerCase())).size, useStoryboardStore.getState().shots.length);
    const duplicateSnapshot = createStoryboardSnapshot(useStoryboardStore.getState());
    const expectedDuplicateSelection = [...duplicateSnapshot.selectedShotIds];
    useStoryboardStore.getState().resetForNewProject("Duplicate restore sentinel");
    useStoryboardStore.getState().hydrateFromSnapshot(duplicateSnapshot);
    assert.deepEqual(useStoryboardStore.getState().selectedShotIds, expectedDuplicateSelection);
    assert.equal(useStoryboardStore.getState().shots.filter(({ sequenceId }) => sequenceId === duplicateSnapshot.currentSequenceId).every((shot) => shot.videoProductionEvidence === undefined && shot.generatedVideoPath === undefined), true);
    assert.equal(useStoryboardStore.getState().shots.find(({ id }) => id === "source-shot").videoProductionEvidence.nested.source, true);
    useStoryboardStore.getState().hydrateFromSnapshot(createStoryboardSnapshot(useStoryboardStore.getState()));
    assert.deepEqual(useStoryboardStore.getState().selectedShotIds, expectedDuplicateSelection);
  } finally {
    Date.now = originalDateNow;
    Math.random = originalRandom;
  }

  let sequenceReads = 0;
  const perfSequences = Array.from({ length: 12 }, (_, index) => ({
    id: `seq-perf-${index}`,
    projectId: "p",
    name: `Perf ${index}`,
    order: index + 1
  }));
  const perfShots = perfSequences.flatMap((sequence) => [0, 1].map((offset) => {
    const shot = { id: `${sequence.id}-shot-${offset}`, order: offset + 1, durationFrames: 24 };
    Object.defineProperty(shot, "sequenceId", {
      enumerable: true,
      get() {
        sequenceReads += 1;
        return sequence.id;
      }
    });
    return shot;
  }));
  const perfTransitions = perfSequences.map((sequence) => {
    const item = transition(
      `${sequence.id}-edge`,
      sequence.id,
      `${sequence.id}-shot-0`,
      `${sequence.id}-shot-1`
    );
    Object.defineProperty(item, "sequenceId", {
      enumerable: true,
      get() {
        sequenceReads += 1;
        return sequence.id;
      }
    });
    return item;
  });
  useStoryboardStore.setState({
    project: { ...useStoryboardStore.getState().project, fps: 24 },
    sequences: perfSequences,
    shots: perfShots,
    shotTransitions: perfTransitions
  });
  sequenceReads = 0;
  useStoryboardStore.getState().updateProjectSettings({ fps: 48 });
  assert.equal(sequenceReads < 100, true, `FPS reconciliation performed ${sequenceReads} sequence reads`);

  useStoryboardStore.getState().resetForNewProject("Fresh");
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory, { past: [], future: [] });
  console.log("PASS shot transition store");
} finally {
  await rm(directory, { recursive: true, force: true });
}
