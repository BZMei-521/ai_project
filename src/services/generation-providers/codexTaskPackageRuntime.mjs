export const CODEX_STORYBOARD_PROVIDER_ID = "codex_task_package";
export const CODEX_STORYBOARD_REFERENCE_USAGES = Object.freeze([
  "spatial_authority", "pose_reference", "face_identity", "body_costume",
  "prop_detail", "style_only", "lighting_only", "negative_example",
  "spatial_depth", "spatial_normal", "character_id", "prop_id", "environment_reference"
]);
export const CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS = Object.freeze([
  "color", "depth", "normal", "character_id", "prop_id", "pose"
]);

const REQUEST_KEYS = ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "createdAt", "prompt", "references", "acceptedImagePath", "expectedOutput"];
const SPATIAL_BINDING_KEYS = ["stageId", "stageRevision", "stageDigest", "shotId", "snapshotId", "cameraId", "cameraDigest", "panoramaAssetId", "panoramaSha256", "artifacts"];
const SPATIAL_ARTIFACT_KEYS = ["kind", "referenceId", "sha256"];
const SPATIAL_ARTIFACT_USAGE = Object.freeze({
  color: "spatial_authority", depth: "spatial_depth", normal: "spatial_normal", character_id: "character_id", prop_id: "prop_id", pose: "pose_reference"
});
const SPATIAL_REFERENCE_USAGES = new Set([...Object.values(SPATIAL_ARTIFACT_USAGE), "environment_reference"]);
const OLD_CANDIDATE_INSTRUCTION = /prior storyboard candidate|old storyboard candidate|previous storyboard candidate/i;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys, code) => {
  if (!isPlainObject(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail(code);
};
const safeRelativePath = (value) => typeof value === "string" && value.length > 0 && !/^(?:[a-zA-Z]:|[\\/])/.test(value) && value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : isPlainObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const deepFreeze = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
};
const validIsoTimestamp = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const promptConstraintValue = (prompt, key, fallback) => {
  const value = prompt?.hardConstraints?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

function mandatoryHardConstraints(request) {
  const prompt = request.prompt;
  const subjectCount = Number.isSafeInteger(prompt?.hardConstraints?.subjectCount) && prompt.hardConstraints.subjectCount > 0
    ? prompt.hardConstraints.subjectCount
    : 1;
  const anatomy = promptConstraintValue(prompt, "visibleAnatomy", "both arms, both hands, and all required fingers must remain visible and anatomically separate");
  const framing = promptConstraintValue(prompt, "cameraFramingLock", request.references.find((item) => item.usage === "spatial_authority")?.instruction ?? "preserve the spatial-authority camera and framing exactly");
  const subjectVisibility = promptConstraintValue(prompt, "subjectVisibility", "");
  const spatialAuthorityRole = promptConstraintValue(prompt, "spatialAuthorityRole", "");
  return [
    "MANDATORY HARD CONSTRAINTS:",
    subjectVisibility
      ? `- Subject visibility: ${subjectVisibility}`
      : `- Exact subject count: ${subjectCount}. Do not add, duplicate, merge, or remove subjects.`,
    `- Visible anatomy: ${anatomy}. No fused, missing, duplicated, or malformed limbs/hands.`,
    `- Camera and framing lock: ${framing}`,
    spatialAuthorityRole
      ? `- Spatial authority role: ${spatialAuthorityRole}`
      : "- No pose, composition, camera, framing, projection, or occlusion drift from spatial authority.",
    "- No text, captions, logos, signatures, or watermarks."
  ].join("\n");
}

export function validateCodexStoryboardRequest(value) {
  if (value?.schemaVersion === 1) exactKeys(value, REQUEST_KEYS, "codex_storyboard_request_keys_invalid");
  else if (value?.schemaVersion === 2) exactKeys(value, [...REQUEST_KEYS, "spatialControl"], "codex_storyboard_request_keys_invalid");
  else fail("codex_storyboard_provider_mismatch");
  if (value.provider !== CODEX_STORYBOARD_PROVIDER_ID) fail("codex_storyboard_provider_mismatch");
  for (const field of ["jobId", "projectId", "episodeId", "shotId"]) if (!/^[a-zA-Z0-9_-]{1,96}$/.test(value[field] ?? "")) fail(`codex_storyboard_${field}_invalid`);
  if (!Array.isArray(value.references) || value.references.length === 0 || value.references.length > 16) fail("codex_storyboard_references_invalid");
  const ids = new Set();
  for (const reference of value.references) {
    exactKeys(reference, ["id", "usage", "instruction", "relativePath", "sha256", "width", "height", "mimeType"], "codex_storyboard_reference_keys_invalid");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(reference.id) || ids.has(reference.id)) fail("codex_storyboard_reference_id_invalid");
    ids.add(reference.id);
    if (!CODEX_STORYBOARD_REFERENCE_USAGES.includes(reference.usage)) fail("codex_storyboard_reference_usage_invalid");
    if (!String(reference.instruction ?? "").trim()) fail("codex_storyboard_reference_instruction_invalid");
    if (!safeRelativePath(reference.relativePath)) fail("codex_storyboard_reference_path_invalid");
    if (!digest(reference.sha256) || !Number.isSafeInteger(reference.width) || reference.width <= 0 || !Number.isSafeInteger(reference.height) || reference.height <= 0 || !["image/png", "image/jpeg"].includes(reference.mimeType)) fail("codex_storyboard_reference_invalid");
  }
  if (!value.references.some((item) => item.usage === "spatial_authority") || !value.references.some((item) => item.usage === "face_identity" || item.usage === "body_costume")) fail("codex_storyboard_required_reference_usage_missing");
  if (value.schemaVersion === 2) {
    const referencesById = new Map(value.references.map((reference) => [reference.id, reference]));
    if (value.references.filter((item) => item.usage === "spatial_authority").length !== 1 || value.references.filter((item) => item.usage === "environment_reference").length !== 1) fail("codex_storyboard_required_reference_usage_missing");
    if (value.references.some((item) => SPATIAL_REFERENCE_USAGES.has(item.usage) && OLD_CANDIDATE_INSTRUCTION.test(item.instruction))) fail("codex_storyboard_spatial_instruction_invalid");
    const spatial = value.spatialControl;
    exactKeys(spatial, SPATIAL_BINDING_KEYS, "codex_storyboard_spatial_control_invalid");
    for (const field of ["stageId", "shotId", "snapshotId", "cameraId", "panoramaAssetId"]) if (!/^[a-zA-Z0-9_-]{1,160}$/.test(spatial[field] ?? "")) fail("codex_storyboard_spatial_control_invalid");
    if (!Number.isSafeInteger(spatial.stageRevision) || spatial.stageRevision < 1 || !digest(spatial.stageDigest) || !digest(spatial.cameraDigest) || !digest(spatial.panoramaSha256)) fail("codex_storyboard_spatial_control_invalid");
    if (spatial.shotId !== value.shotId) fail("codex_storyboard_spatial_shot_id_invalid");
    if (!Array.isArray(spatial.artifacts) || spatial.artifacts.length !== CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.length) fail("codex_storyboard_spatial_artifacts_invalid");
    const artifactKinds = new Set();
    for (const artifact of spatial.artifacts) {
      exactKeys(artifact, SPATIAL_ARTIFACT_KEYS, "codex_storyboard_spatial_artifacts_invalid");
      if (!CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.includes(artifact.kind) || artifactKinds.has(artifact.kind)) fail("codex_storyboard_spatial_artifacts_invalid");
      artifactKinds.add(artifact.kind);
      const reference = referencesById.get(artifact.referenceId);
      if (!reference || reference.usage !== SPATIAL_ARTIFACT_USAGE[artifact.kind] || !digest(artifact.sha256)) fail("codex_storyboard_spatial_artifacts_invalid");
      if (artifact.sha256 !== reference.sha256) fail("codex_storyboard_spatial_artifact_hash_invalid");
    }
    if (CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.some((kind) => !artifactKinds.has(kind))) fail("codex_storyboard_spatial_artifacts_invalid");
  }
  if (!isPlainObject(value.prompt) || value.prompt.useCase !== "stylized-concept" || !String(value.prompt.primaryRequest ?? "").trim()) fail("codex_storyboard_prompt_invalid");
  if (value.acceptedImagePath !== null && typeof value.acceptedImagePath !== "string") fail("codex_storyboard_accepted_path_invalid");
  exactKeys(value.expectedOutput, ["candidatePath", "resultPath", "mimeTypes"], "codex_storyboard_expected_output_invalid");
  if (value.expectedOutput.candidatePath !== "outputs/candidate.png" || value.expectedOutput.resultPath !== "outputs/result.json" || JSON.stringify(value.expectedOutput.mimeTypes) !== JSON.stringify(["image/png"])) fail("codex_storyboard_expected_output_invalid");
  return deepFreeze(structuredClone(value));
}

export function canonicalCodexStoryboardRequest(value) {
  return JSON.stringify(canonicalize(validateCodexStoryboardRequest(value)));
}

export function compileCodexStoryboardImageSpec(value) {
  const request = validateCodexStoryboardRequest(value);
  const orderedReferences = request.schemaVersion === 2
    ? [...request.references].sort((left, right) => spatialReferenceRank(left.usage) - spatialReferenceRank(right.usage))
    : request.references;
  const pictureInstructions = orderedReferences.map((item, index) => `Picture ${index + 1} [${item.usage}]: ${item.instruction}`);
  const spatialLineage = request.schemaVersion === 2
    ? [
      "SPATIAL LINEAGE (non-visual provenance; do not render):",
      `- Stage: ${request.spatialControl.stageId} rev ${request.spatialControl.stageRevision} digest ${request.spatialControl.stageDigest}`,
      `- Shot snapshot: ${request.spatialControl.shotId} / ${request.spatialControl.snapshotId}`,
      `- Camera: ${request.spatialControl.cameraId} digest ${request.spatialControl.cameraDigest}`,
      `- Panorama: ${request.spatialControl.panoramaAssetId} sha256 ${request.spatialControl.panoramaSha256}`
    ].join("\n")
    : null;
  return Object.freeze({ taxonomy: "stylized-concept", assetType: "AI comic-drama storyboard frame", referenceUsages: orderedReferences.map((item) => item.usage), referencedRelativePaths: orderedReferences.map((item) => item.relativePath), compiledPrompt: [...pictureInstructions, ...(spatialLineage ? [spatialLineage] : []), mandatoryHardConstraints(request), request.prompt.primaryRequest].join("\n") });
}

function spatialReferenceRank(usage) {
  return ({ spatial_authority: 0, spatial_depth: 1, spatial_normal: 2, character_id: 3, prop_id: 4, pose_reference: 5, environment_reference: 6, face_identity: 7, body_costume: 7, prop_detail: 8, style_only: 9, lighting_only: 9, negative_example: 10 })[usage] ?? 11;
}

export function validateCodexStoryboardResult(result, requestValue) {
  const request = validateCodexStoryboardRequest(requestValue);
  const cropMode = result?.generationMode === "user_authorized_local_deterministic_crop";
  exactKeys(result, ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "requestDigest", "referenceDigests", "generationMode", "finalPrompt", "output", "completedAt", "state", ...(cropMode ? ["derivedTransform"] : [])], "codex_storyboard_result_keys_invalid");
  if (result.schemaVersion !== 1 || result.provider !== CODEX_STORYBOARD_PROVIDER_ID || !["codex_builtin_imagegen", "user_authorized_local_deterministic_crop"].includes(result.generationMode) || result.state !== "completed") fail("codex_storyboard_result_invalid");
  for (const field of ["jobId", "projectId", "episodeId", "shotId"]) if (result[field] !== request[field]) fail("codex_storyboard_result_identity_mismatch");
  if (!digest(result.requestDigest) || JSON.stringify(result.referenceDigests) !== JSON.stringify(request.references.map(({ id, sha256 }) => ({ id, sha256 })))) fail("codex_storyboard_result_lineage_mismatch");
  if (result.finalPrompt !== compileCodexStoryboardImageSpec(request).compiledPrompt) fail("codex_storyboard_result_prompt_mismatch");
  if (!validIsoTimestamp(result.completedAt)) fail("codex_storyboard_result_completed_at_invalid");
  if (result.output?.relativePath !== "outputs/candidate.png" || !digest(result.output?.sha256) || !Number.isSafeInteger(result.output?.width) || result.output.width <= 0 || !Number.isSafeInteger(result.output?.height) || result.output.height <= 0 || result.output?.mimeType !== "image/png") fail("codex_storyboard_result_output_invalid");
  if (cropMode) {
    const transform = result.derivedTransform;
    try {
      exactKeys(transform, ["operation", "authorization", "tool", "source", "cropRectangle", "output", "pixelExactCrop"], "codex_storyboard_result_derived_transform_invalid");
      exactKeys(transform.authorization, ["observedAt", "context"], "codex_storyboard_result_derived_transform_invalid");
      exactKeys(transform.tool, ["name", "generative", "filter"], "codex_storyboard_result_derived_transform_invalid");
      exactKeys(transform.source, ["absolutePath", "sha256", "width", "height"], "codex_storyboard_result_derived_transform_invalid");
      exactKeys(transform.cropRectangle, ["x", "y", "width", "height"], "codex_storyboard_result_derived_transform_invalid");
      exactKeys(transform.output, ["absolutePath", "sha256", "width", "height"], "codex_storyboard_result_derived_transform_invalid");
    } catch { fail("codex_storyboard_result_derived_transform_invalid"); }
    const { source, cropRectangle: crop, output } = transform;
    const integers = [source.width, source.height, crop.x, crop.y, crop.width, crop.height, output.width, output.height];
    if (transform.operation !== result.generationMode || transform.tool?.name !== "ffmpeg" || transform.tool?.generative !== false || transform.pixelExactCrop !== true || !validIsoTimestamp(transform.authorization?.observedAt) || typeof transform.authorization?.context !== "string" || !transform.authorization.context.trim() || !digest(source?.sha256) || !digest(output?.sha256) || typeof source?.absolutePath !== "string" || typeof output?.absolutePath !== "string" || integers.some((v) => !Number.isSafeInteger(v) || v < 0) || source.width <= 0 || source.height <= 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > source.width || crop.y + crop.height > source.height || output.width !== crop.width || output.height !== crop.height || output.width * 9 !== output.height * 16 || output.sha256 !== result.output.sha256 || output.width !== result.output.width || output.height !== result.output.height || transform.tool.filter !== `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`) fail("codex_storyboard_result_derived_transform_invalid");
  }
  return deepFreeze(structuredClone(result));
}
