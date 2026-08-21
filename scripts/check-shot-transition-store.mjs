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
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);
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

  useStoryboardStore.getState().resetForNewProject("Fresh");
  assert.deepEqual(useStoryboardStore.getState().shotTransitions, []);
  assert.equal(useStoryboardStore.getState().selectedShotTransitionId, null);
  assert.deepEqual(useStoryboardStore.getState().shotSequenceHistory, { past: [], future: [] });
  console.log("PASS shot transition store");
} finally {
  await rm(directory, { recursive: true, force: true });
}
