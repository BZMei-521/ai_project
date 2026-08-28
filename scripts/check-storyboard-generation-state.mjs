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

  const acceptedBeforeExport = completedState.shots.find(
    (shot) => shot.id === firstShot.id
  )?.generatedImagePath;
  const exportedTask = {
    ...task,
    id: "generation_task_exported",
    stage: "exported",
    status: "queued",
    outputPath: "C:/project/codex-storyboard-jobs/job-1",
    externalProvider: "codex_task_package",
    externalJobId: "job-1",
    externalRequestDigest: "a".repeat(64)
  };
  useStoryboardStore.getState().upsertGenerationTask(exportedTask);
  assert.equal(
    useStoryboardStore.getState().shots.find((item) => item.id === firstShot.id)
      ?.generatedImagePath,
    acceptedBeforeExport,
    "exporting a task package must not publish an image"
  );
  useStoryboardStore
    .getState()
    .markGenerationTaskNeedsReview(
      exportedTask.id,
      "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png",
      ["codex_candidate"]
    );
  assert.equal(
    useStoryboardStore.getState().shots.find((item) => item.id === firstShot.id)
      ?.generatedImagePath,
    acceptedBeforeExport,
    "importing a Codex candidate must remain review-only"
  );
  useStoryboardStore
    .getState()
    .completeGenerationTask(
      exportedTask.id,
      "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png"
    );
  assert.equal(
    useStoryboardStore.getState().shots.find((item) => item.id === firstShot.id)
      ?.generatedImagePath,
    acceptedBeforeExport,
    "needs_review remains terminal until a dedicated acceptance action"
  );
  useStoryboardStore.getState().acceptGenerationTaskCandidate(exportedTask.id);
  const acceptedExportState = useStoryboardStore.getState();
  const acceptedExportTask = acceptedExportState.generationTasks.find(
    (item) => item.id === exportedTask.id
  );
  assert.equal(
    acceptedExportState.shots.find((item) => item.id === firstShot.id)?.generatedImagePath,
    "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png"
  );
  assert.equal(acceptedExportTask?.stage, "completed");
  assert.equal(acceptedExportTask?.status, "completed");
  assert.equal(
    acceptedExportTask?.outputPath,
    "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png"
  );
  assert.ok(acceptedExportTask?.finishedAt);
  useStoryboardStore.getState().completeGenerationTask(exportedTask.id, "C:/attacker/late-complete.png");
  assert.equal(useStoryboardStore.getState().generationTasks.find((item) => item.id === exportedTask.id)?.outputPath, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png", "accepted task is terminal against ordinary late completion");
  assert.equal(useStoryboardStore.getState().shots.find((item) => item.id === firstShot.id)?.generatedImagePath, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png");

  const rejectedTask = { ...exportedTask, id: "generation_task_rejected", externalJobId: "job-rejected" };
  useStoryboardStore.getState().upsertGenerationTask(rejectedTask);
  useStoryboardStore.getState().markGenerationTaskNeedsReview(rejectedTask.id, "C:/project/codex-storyboard-jobs/job-rejected/outputs/candidate.png", ["codex_candidate"]);
  useStoryboardStore.getState().rejectGenerationTaskCandidate(rejectedTask.id);
  const rejectedState = useStoryboardStore.getState();
  const rejectedRecord = rejectedState.generationTasks.find((item) => item.id === rejectedTask.id);
  assert.equal(rejectedRecord?.stage, "rejected");
  assert.equal(rejectedRecord?.status, "rejected");
  assert.equal(rejectedRecord?.bestPreviewPath, "C:/project/codex-storyboard-jobs/job-rejected/outputs/candidate.png");
  assert.equal(rejectedState.shots.find((item) => item.id === firstShot.id)?.generatedImagePath, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png", "rejection preserves accepted output");
  useStoryboardStore.getState().completeGenerationTask(rejectedTask.id, "C:/attacker/late.png");
  assert.equal(useStoryboardStore.getState().generationTasks.find((item) => item.id === rejectedTask.id)?.status, "rejected", "rejected task is terminal against late completion");
  assert.equal(useStoryboardStore.getState().shots.find((item) => item.id === firstShot.id)?.generatedImagePath, "C:/project/codex-storyboard-jobs/job-1/outputs/candidate.png");
  useStoryboardStore.getState().markGenerationTaskCancelled(rejectedTask.id);
  assert.equal(useStoryboardStore.getState().generationTasks.find((item) => item.id === rejectedTask.id)?.status, "rejected", "rejected task is terminal against late cancellation");
  useStoryboardStore.getState().markGenerationTaskCancelled(exportedTask.id);
  assert.equal(useStoryboardStore.getState().generationTasks.find((item) => item.id === exportedTask.id)?.status, "completed", "accepted task is terminal against late cancellation");

  const lateTransitionExpectation = (candidateTask) => ({
    stage: "exported",
    status: "queued",
    outputPath: candidateTask.outputPath,
    shotId: candidateTask.shotId,
    externalProvider: "codex_task_package",
    externalJobId: candidateTask.externalJobId
  });
  const lateCandidatePath = "C:/project/codex-storyboard-jobs/late/outputs/candidate.png";

  const cancelledDuringImport = {
    ...exportedTask,
    id: "generation_task_import_cancelled",
    externalJobId: "job-import-cancelled"
  };
  useStoryboardStore.getState().upsertGenerationTask(cancelledDuringImport);
  const cancelledExpectation = lateTransitionExpectation(cancelledDuringImport);
  useStoryboardStore.getState().markGenerationTaskCancelled(cancelledDuringImport.id, {
    bestPreviewPath: "C:/project/codex-storyboard-jobs/late/evidence-before-import.png",
    reviewReasons: ["user_cancelled_during_import"]
  });
  const cancelledDecision = structuredClone(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === cancelledDuringImport.id)
  );
  useStoryboardStore.getState().markGenerationTaskNeedsReview(
    cancelledDuringImport.id,
    lateCandidatePath,
    ["codex_candidate"],
    cancelledExpectation
  );
  assert.deepEqual(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === cancelledDuringImport.id),
    cancelledDecision,
    "a late import receipt must not resurrect a cancelled task"
  );

  const acceptedDuringImport = {
    ...exportedTask,
    id: "generation_task_import_accepted",
    externalJobId: "job-import-accepted"
  };
  useStoryboardStore.getState().upsertGenerationTask(acceptedDuringImport);
  const acceptedExpectation = lateTransitionExpectation(acceptedDuringImport);
  useStoryboardStore.getState().markGenerationTaskNeedsReview(
    acceptedDuringImport.id,
    "C:/project/codex-storyboard-jobs/accepted/outputs/candidate.png",
    ["codex_candidate"],
    acceptedExpectation
  );
  useStoryboardStore.getState().acceptGenerationTaskCandidate(acceptedDuringImport.id);
  const acceptedDecision = structuredClone(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === acceptedDuringImport.id)
  );
  useStoryboardStore.getState().markGenerationTaskNeedsReview(
    acceptedDuringImport.id,
    lateCandidatePath,
    ["late_receipt"],
    acceptedExpectation
  );
  assert.deepEqual(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === acceptedDuringImport.id),
    acceptedDecision,
    "a late import receipt must not overwrite an accepted decision"
  );

  const duplicateImportTask = {
    ...exportedTask,
    id: "generation_task_import_duplicate",
    externalJobId: "job-import-duplicate"
  };
  useStoryboardStore.getState().upsertGenerationTask(duplicateImportTask);
  const duplicateExpectation = lateTransitionExpectation(duplicateImportTask);
  useStoryboardStore.getState().markGenerationTaskNeedsReview(
    duplicateImportTask.id,
    "C:/project/codex-storyboard-jobs/duplicate/outputs/first.png",
    ["codex_candidate"],
    duplicateExpectation
  );
  const firstReviewDecision = structuredClone(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === duplicateImportTask.id)
  );
  useStoryboardStore.getState().markGenerationTaskNeedsReview(
    duplicateImportTask.id,
    "C:/project/codex-storyboard-jobs/duplicate/outputs/second.png",
    ["duplicate_receipt"],
    duplicateExpectation
  );
  assert.deepEqual(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === duplicateImportTask.id),
    firstReviewDecision,
    "a repeated import receipt must not overwrite the first review transition"
  );

  const mismatchedImportTask = {
    ...exportedTask,
    id: "generation_task_import_mismatch",
    externalJobId: "job-import-mismatch"
  };
  useStoryboardStore.getState().upsertGenerationTask(mismatchedImportTask);
  const beforeMismatchedReceipt = structuredClone(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === mismatchedImportTask.id)
  );
  useStoryboardStore.getState().markGenerationTaskNeedsReview(
    mismatchedImportTask.id,
    lateCandidatePath,
    ["codex_candidate"],
    {
      ...lateTransitionExpectation(mismatchedImportTask),
      outputPath: "C:/project/codex-storyboard-jobs/other-package",
      externalJobId: "other-job"
    }
  );
  assert.deepEqual(
    useStoryboardStore.getState().generationTasks.find((item) => item.id === mismatchedImportTask.id),
    beforeMismatchedReceipt,
    "identity or package-path mismatch must fail closed"
  );

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

  const inconsistentReviewTasks = [
    {
      ...task,
      id: "generation_task_review_status_only",
      stage: "queued",
      status: "needs_review",
      bestPreviewPath: "outputs/status-only-review.png"
    },
    {
      ...task,
      id: "generation_task_review_stage_only",
      stage: "needs_review",
      status: "queued",
      bestPreviewPath: "outputs/stage-only-review.png"
    }
  ];
  for (const inconsistentTask of inconsistentReviewTasks) {
    useStoryboardStore.getState().hydrateFromSnapshot({ generationTasks: [inconsistentTask] });
    const beforeInconsistentCompletion = useStoryboardStore.getState();
    const acceptedPath = beforeInconsistentCompletion.shots.find(
      (shot) => shot.id === firstShot.id
    )?.generatedImagePath;
    const persistedTask = structuredClone(beforeInconsistentCompletion.generationTasks[0]);

    useStoryboardStore
      .getState()
      .completeGenerationTask(inconsistentTask.id, "outputs/must-not-publish.png");
    const afterInconsistentCompletion = useStoryboardStore.getState();
    assert.equal(
      afterInconsistentCompletion.shots.find((shot) => shot.id === firstShot.id)
        ?.generatedImagePath,
      acceptedPath,
      `completion must fail closed when review is represented by ${inconsistentTask.stage}/${inconsistentTask.status}`
    );
    assert.deepEqual(
      afterInconsistentCompletion.generationTasks[0],
      persistedTask,
      `completion must not mutate an inconsistent review task represented by ${inconsistentTask.stage}/${inconsistentTask.status}`
    );
  }

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
  assert.throws(
    () => useStoryboardStore.getState().acceptGenerationTaskCandidate("missing-task"),
    /unknown generation task/i
  );
} finally {
  useStoryboardStore.setState(initialState, true);
}

console.log("PASS storyboard generation state: export, review acceptance, success, failure, retry, restore, and unknown-shot rejection");
