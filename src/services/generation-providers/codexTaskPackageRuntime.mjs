export const CODEX_STORYBOARD_PROVIDER_ID = "codex_task_package";
export const CODEX_STORYBOARD_REFERENCE_USAGES = Object.freeze([
  "spatial_authority", "pose_reference", "face_identity", "body_costume",
  "prop_detail", "style_only", "lighting_only", "negative_example"
]);

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
  exactKeys(value, ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "createdAt", "prompt", "references", "acceptedImagePath", "expectedOutput"], "codex_storyboard_request_keys_invalid");
  if (value.schemaVersion !== 1 || value.provider !== CODEX_STORYBOARD_PROVIDER_ID) fail("codex_storyboard_provider_mismatch");
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
  const pictureInstructions = request.references.map((item, index) => `Picture ${index + 1} [${item.usage}]: ${item.instruction}`);
  return Object.freeze({ taxonomy: "stylized-concept", assetType: "AI comic-drama storyboard frame", referenceUsages: request.references.map((item) => item.usage), referencedRelativePaths: request.references.map((item) => item.relativePath), compiledPrompt: [...pictureInstructions, mandatoryHardConstraints(request), request.prompt.primaryRequest].join("\n") });
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
