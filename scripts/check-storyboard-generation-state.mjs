import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const entryPoint = path.join(repoRoot, "src", "modules", "storyboard-core", "store.ts");
const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "The bundled storyboard store should be available for state checks.");

const { useStoryboardStore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);
const initialState = useStoryboardStore.getState();
const [firstShot, secondShot] = initialState.shots;
assert.ok(firstShot && secondShot, "Mock data must provide two shots for isolated transition checks.");

const task = {
  id: "generation_task_1",
  batchId: "generation_batch_1",
  shotId: firstShot.id,
  workflowId: "storyboard-qwen-stageA",
  stage: "preflight",
  status: "queued",
  promptHash: "prompt-hash-1",
  startedAt: "2026-08-07T00:00:00.000Z"
};

try {
  useStoryboardStore.getState().upsertGenerationTask(task);
  useStoryboardStore.getState().upsertGenerationTask({ ...task, stage: "stageA", status: "running" });
  assert.deepEqual(useStoryboardStore.getState().generationTasks, [
    { ...task, stage: "stageA", status: "running", errorCode: undefined, errorMessage: undefined }
  ]);

  useStoryboardStore.getState().completeGenerationTask(task.id, "outputs/shot-1.png");
  const completedState = useStoryboardStore.getState();
  assert.equal(completedState.shots.find((shot) => shot.id === firstShot.id)?.generatedImagePath, "outputs/shot-1.png");
  assert.equal(completedState.shots.find((shot) => shot.id === secondShot.id)?.generatedImagePath, secondShot.generatedImagePath);
  assert.equal(completedState.generationTasks[0]?.stage, "completed");
  assert.equal(completedState.generationTasks[0]?.status, "completed");
  assert.equal(completedState.generationTasks[0]?.outputPath, "outputs/shot-1.png");
  assert.ok(completedState.generationTasks[0]?.finishedAt);

  const reviewTask = { ...task, id: "generation_task_review", stage: "stageB", status: "running" };
  useStoryboardStore.getState().upsertGenerationTask(reviewTask);
  const acceptedPathBeforeReview = useStoryboardStore.getState().shots.find((shot) => shot.id === firstShot.id)?.generatedImagePath;
  useStoryboardStore.getState().markGenerationTaskNeedsReview(reviewTask.id, "outputs/review.png", ["face", "quality"]);
  const reviewState = useStoryboardStore.getState();
  const review = reviewState.generationTasks.find((item) => item.id === reviewTask.id);
  assert.equal(review?.stage, "needs_review");
  assert.equal(review?.status, "needs_review");
  assert.equal(review?.bestPreviewPath, "outputs/review.png");
  assert.deepEqual(review?.reviewReasons, ["face", "quality"]);
  assert.equal(
    reviewState.shots.find((shot) => shot.id === firstShot.id)?.generatedImagePath,
    acceptedPathBeforeReview,
    "review transition must not publish to the normal shot path"
  );

  useStoryboardStore
    .getState()
    .completeGenerationTask(reviewTask.id, "outputs/should-not-publish.png");
  const postReviewCompletionState = useStoryboardStore.getState();
  const terminalReview = postReviewCompletionState.generationTasks.find(
    (item) => item.id === reviewTask.id
  );
  assert.equal(terminalReview?.stage, "needs_review");
  assert.equal(terminalReview?.status, "needs_review");
  assert.equal(terminalReview?.bestPreviewPath, "outputs/review.png");
  assert.deepEqual(terminalReview?.reviewReasons, ["face", "quality"]);
  assert.equal(
    postReviewCompletionState.shots.find((shot) => shot.id === firstShot.id)
      ?.generatedImagePath,
    acceptedPathBeforeReview,
    "completion must not publish a terminal review task"
  );

  const failedTask = { ...task, id: "generation_task_2", shotId: secondShot.id, stage: "fallback", status: "running" };
  useStoryboardStore.getState().upsertGenerationTask(failedTask);
  useStoryboardStore.getState().markGenerationTaskFailed(failedTask.id, {
    errorCode: "output_missing",
    errorMessage: "ComfyUI did not return an image."
  });
  useStoryboardStore.getState().markGenerationTaskFailed(failedTask.id, {});
  const failed = useStoryboardStore.getState().generationTasks.find((item) => item.id === failedTask.id);
  assert.equal(failed?.stage, "failed");
  assert.equal(failed?.errorCode, "output_missing");
  assert.equal(failed?.errorMessage, "ComfyUI did not return an image.");

  useStoryboardStore.getState().upsertGenerationTask({ ...failedTask, stage: "fallback", status: "running" });
  const retried = useStoryboardStore.getState().generationTasks.find((item) => item.id === failedTask.id);
  assert.equal(retried?.stage, "fallback");
  assert.equal(retried?.errorCode, "output_missing");

  useStoryboardStore.getState().hydrateFromSnapshot({ generationTasks: [retried] });
  assert.deepEqual(useStoryboardStore.getState().generationTasks, [retried]);

  assert.throws(
    () => useStoryboardStore.getState().upsertGenerationTask({ ...task, id: "unknown-shot-task", shotId: "missing-shot" }),
    /unknown shot/i
  );
  useStoryboardStore.setState({ generationTasks: [{ ...task, id: "orphaned-task", shotId: "missing-shot" }] });
  assert.throws(
    () => useStoryboardStore.getState().completeGenerationTask("orphaned-task", "outputs/missing.png"),
    /unknown shot/i
  );
} finally {
  useStoryboardStore.setState(initialState, true);
}

console.log("PASS storyboard generation state: success, failure, retry, restore, and unknown-shot rejection");
