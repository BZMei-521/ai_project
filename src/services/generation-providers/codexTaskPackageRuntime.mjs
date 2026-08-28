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
  return Object.freeze({ taxonomy: "stylized-concept", assetType: "AI comic-drama storyboard frame", referenceUsages: request.references.map((item) => item.usage), referencedRelativePaths: request.references.map((item) => item.relativePath), compiledPrompt: [...pictureInstructions, request.prompt.primaryRequest].join("\n") });
}

export function validateCodexStoryboardResult(result, requestValue) {
  const request = validateCodexStoryboardRequest(requestValue);
  exactKeys(result, ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "requestDigest", "referenceDigests", "generationMode", "finalPrompt", "output", "completedAt", "state"], "codex_storyboard_result_keys_invalid");
  if (result.schemaVersion !== 1 || result.provider !== CODEX_STORYBOARD_PROVIDER_ID || result.generationMode !== "codex_builtin_imagegen" || result.state !== "completed") fail("codex_storyboard_result_invalid");
  for (const field of ["jobId", "projectId", "episodeId", "shotId"]) if (result[field] !== request[field]) fail("codex_storyboard_result_identity_mismatch");
  if (!digest(result.requestDigest) || JSON.stringify(result.referenceDigests) !== JSON.stringify(request.references.map(({ id, sha256 }) => ({ id, sha256 })))) fail("codex_storyboard_result_lineage_mismatch");
  if (result.output?.relativePath !== "outputs/candidate.png" || !digest(result.output?.sha256) || !Number.isSafeInteger(result.output?.width) || result.output.width <= 0 || !Number.isSafeInteger(result.output?.height) || result.output.height <= 0 || result.output?.mimeType !== "image/png") fail("codex_storyboard_result_output_invalid");
  return deepFreeze(structuredClone(result));
}
