import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const result = await build({ entryPoints: [path.join(root, "src/modules/comfy-pipeline/comfyService.ts")], bundle: true, format: "esm", platform: "browser", target: "es2020", write: false });
const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const { storyboardGenerationStore: useStoryboardStore } = service;
const initial = useStoryboardStore.getState();
const shot = initial.shots[0];
const settings = { imageWorkflowJson: "{}", baseUrl: "http://mock", outputDir: "", comfyInputDir: "", comfyRootDir: "" };
const request = (id = shot.id, runStage, extra = {}) => ({ settings, shot: { ...shot, id }, allShots: [{ ...shot, id }], runStage, ...extra });
const accepted = (localPath) => ({ status: "accepted", previewUrl: localPath, localPath });
const needsReview = (bestPreviewPath, reasons = ["quality"]) => ({ status: "needs_review", bestPreviewPath, reasons });

try {
  const rejected = await service.queueStoryboardShot(request(shot.id, async () => ({ localPath: "x.png" }), { preflight: async () => { throw new Error("missing checkpoint"); } }));
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.errorCode, "preflight_failed");

  const success = await service.queueStoryboardShot(request(shot.id, async (stage) => accepted(`${stage}.png`)));
  assert.equal(success.status, "completed");
  assert.equal(useStoryboardStore.getState().shots.find((item) => item.id === shot.id)?.generatedImagePath, "stageB.png");

  const second = initial.shots[1];
  const batch = await service.queueStoryboardBatch([
    request(shot.id, async () => accepted("first.png")),
    request(second.id, async () => { throw Object.assign(new Error("queue failed"), { errorCode: "queue_failed" }); })
  ], { preflight: async () => undefined });
  assert.equal(batch[0].status, "completed");
  assert.equal(batch[1].status, "failed");
  assert.equal(batch[1].errorCode, "queue_failed");

  const retried = await service.retryStoryboardTask(batch[1].id, settings, { runStage: async () => accepted("retry.png") });
  assert.equal(retried.status, "completed");
  assert.equal(useStoryboardStore.getState().shots.find((item) => item.id === second.id)?.generatedImagePath, "retry.png");

  const acceptedPathBeforeReview = useStoryboardStore.getState().shots.find((item) => item.id === shot.id)?.generatedImagePath;
  const review = await service.queueStoryboardShot(request(shot.id, async () => needsReview("review-only.png", ["face", "quality"])));
  assert.equal(review.status, "needs_review");
  assert.equal(review.bestPreviewPath, "review-only.png");
  assert.deepEqual(review.reviewReasons, ["face", "quality"]);
  assert.equal(
    useStoryboardStore.getState().shots.find((item) => item.id === shot.id)?.generatedImagePath,
    acceptedPathBeforeReview,
    "needs_review must not replace the accepted shot image path"
  );

  const conflictAsset = {
    id: "conflict-human",
    projectId: "project-style-contract",
    type: "character",
    name: "Shen Yan",
    filePath: "",
    characterIdentityPack: { species: "human", speciesTraits: [] }
  };
  const conflictShot = {
    ...shot,
    id: "shot-species-conflict",
    title: "Species conflict",
    storyPrompt: "neutral blocking",
    notes: "",
    dialogue: "",
    characterRefs: [conflictAsset.id],
    tags: ["species:wolffolk"]
  };
  await assert.rejects(
    () => service.generateShotAsset(
      {
        ...settings,
        imageWorkflowJson: JSON.stringify({
          "1": { class_type: "CLIPTextEncode", inputs: { text: "{{PROMPT}}" } }
        }),
        tokenMapping: service.DEFAULT_TOKEN_MAPPING
      },
      conflictShot,
      0,
      "image",
      [conflictShot],
      [conflictAsset]
    ),
    /species_metadata_conflict/,
    "identity/Shot.tags species conflicts must reject before queueing /prompt"
  );
} finally {
  useStoryboardStore.setState(initial, true);
}

console.log("PASS storyboard generation flow: preflight, staged success, partial batch failure, and isolated retry");
