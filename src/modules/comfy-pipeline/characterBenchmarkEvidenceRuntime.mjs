const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const sha256Value = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const finiteScore = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const finiteLoraStrength = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1.5;
const SHOT_IDS = Object.freeze(["front_close", "three_quarter_medium", "left_profile", "right_profile", "back_view", "full_body_action", "strong_expression", "different_lighting"]);
const REFERENCE_SLOTS = Object.freeze(["face_master", "face_left", "face_right", "hair_back", "body_front", "body_side", "body_back", "expression_neutral"]);
const TRANSFORMS = Object.freeze(["none", "mirror_x", "head_shoulders_crop"]);
const DIMENSIONS = Object.freeze(["face", "hair", "outfit", "body", "quality"]);
const CANDIDATE_LORA_STATUSES = Object.freeze(["dataset_ready", "training"]);
export const CHARACTER_GENERATION_MODES = Object.freeze(["zero_shot_multi_reference", "lora_augmented"]);
export const CHARACTER_BENCHMARK_STRENGTH_TOLERANCE = 1e-9;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// Dependency-free SHA-256 keeps this validation usable by both browser code and Node checks.
function sha256(input) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const maxWord = 2 ** 32; const words = []; const ascii = unescape(encodeURIComponent(input));
  const bitLength = ascii.length * 8; const hash = []; const constants = []; const composite = {};
  for (let candidate = 2, count = 0; count < 64; candidate += 1) {
    if (composite[candidate]) continue;
    for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) composite[multiple] = true;
    hash[count] = (Math.sqrt(candidate) * maxWord) | 0; constants[count] = (candidate ** (1 / 3) * maxWord) | 0; count += 1;
  }
  let padded = `${ascii}\x80`; while ((padded.length % 64) !== 56) padded += "\x00";
  for (let index = 0; index < padded.length; index += 1) words[index >> 2] |= padded.charCodeAt(index) << ((3 - index) % 4) * 8;
  words.push(Math.floor(bitLength / maxWord), bitLength);
  for (let offset = 0; offset < words.length; offset += 16) {
    const initial = hash.slice(0, 8); const schedule = words.slice(offset, offset + 16); let working = initial.slice();
    for (let index = 0; index < 64; index += 1) {
      if (index >= 16) { const x = schedule[index - 15]; const y = schedule[index - 2]; schedule[index] = (schedule[index - 16] + (rightRotate(x, 7) ^ rightRotate(x, 18) ^ (x >>> 3)) + schedule[index - 7] + (rightRotate(y, 17) ^ rightRotate(y, 19) ^ (y >>> 10))) | 0; }
      const e = working[4]; const a = working[0];
      const temp1 = (working[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & working[5]) ^ (~e & working[6])) + constants[index] + schedule[index]) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & working[1]) ^ (a & working[2]) ^ (working[1] & working[2]))) | 0;
      working = [(temp1 + temp2) | 0, working[0], working[1], working[2], (working[3] + temp1) | 0, working[4], working[5], working[6]];
    }
    for (let index = 0; index < 8; index += 1) hash[index] = (initial[index] + working[index]) | 0;
  }
  return hash.slice(0, 8).map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

const basename = (value) => String(value ?? "").trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
const sameStrength = (left, right) => finiteLoraStrength(left) && finiteLoraStrength(right) && Math.abs(left - right) <= CHARACTER_BENCHMARK_STRENGTH_TOLERANCE;
const ordered = (items, expected) => Array.isArray(items) && items.length === expected.length && items.every((item, index) => item === expected[index]);

function normalizeProof(proof) {
  return plain(proof) ? {
    providerId: text(proof.providerId), workflowDigest: text(proof.workflowDigest), terminalOutputNode: text(proof.terminalOutputNode),
    authoritativeModelBindings: Array.isArray(proof.authoritativeModelBindings) ? proof.authoritativeModelBindings.map((item) => ({ id: text(item?.id), classType: text(item?.classType), field: text(item?.field), model: text(item?.model) })) : [],
    authoritativeLoraBindings: Array.isArray(proof.authoritativeLoraBindings) ? proof.authoritativeLoraBindings.map((item) => ({ id: text(item?.id), classType: text(item?.classType), field: text(item?.field), loraName: text(item?.loraName), strengthModel: finiteLoraStrength(item?.strengthModel) ? item.strengthModel : null, strengthClip: item?.strengthClip === null || finiteLoraStrength(item?.strengthClip) ? item.strengthClip : null, clipStrengthPolicy: text(item?.clipStrengthPolicy), modelPathNodeIds: Array.isArray(item?.modelPathNodeIds) ? item.modelPathNodeIds.map(text) : [], modelPathEdges: Array.isArray(item?.modelPathEdges) ? item.modelPathEdges.map((edge) => ({ fromNodeId: text(edge?.fromNodeId), fromOutputIndex: Number.isInteger(edge?.fromOutputIndex) ? edge.fromOutputIndex : null, toNodeId: text(edge?.toNodeId), toInput: text(edge?.toInput) })) : [] })) : []
  } : null;
}

function validReferences(references) {
  if (!Array.isArray(references) || references.length !== 8) return false;
  const pairs = new Set();
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (!plain(reference) || reference.shotId !== SHOT_IDS[index] || !REFERENCE_SLOTS.includes(reference.slot) || !sha256Value(reference.sourceSha256) || !sha256Value(reference.transformedSha256) || !TRANSFORMS.includes(reference.transform)) return false;
    const pair = `${reference.shotId}:${reference.slot}`; if (pairs.has(pair)) return false; pairs.add(pair);
  }
  return true;
}

function validShots(shots, provider, terminalOutputNode, dimensionThreshold) {
  return Array.isArray(shots) && shots.length === 8 && ordered(shots.map((shot) => shot?.id), SHOT_IDS) && shots.every((shot) =>
    plain(shot) && sha256Value(shot.outputSha256) && finiteScore(shot.score) && Number.isInteger(shot.retries) && shot.retries >= 0 && shot.finalStatus === "accepted" && shot.provenance === "model_generation" && shot.actualProvider === provider && shot.terminalOutputNode === terminalOutputNode &&
    plain(shot.dimensionScores) && DIMENSIONS.every((dimension) => finiteScore(shot.dimensionScores[dimension]) && shot.dimensionScores[dimension] >= dimensionThreshold) && Object.keys(shot.dimensionScores).length === DIMENSIONS.length
  );
}

function validateRequiredTerminalLora(subject, proof) {
  const modelPathMatches = (item) => item.modelPathNodeIds.length >= 2 && item.modelPathEdges.length === item.modelPathNodeIds.length - 1 && item.modelPathNodeIds[0] === item.id && item.modelPathEdges.every((edge, index) => edge.fromNodeId === item.modelPathNodeIds[index] && edge.fromOutputIndex === 0 && edge.toNodeId === item.modelPathNodeIds[index + 1] && edge.toInput === "model");
  const loraBindingMatches = (item) => item?.field === "lora_name" && item.loraName === subject?.loraName && modelPathMatches(item) && sameStrength(item.strengthModel, subject?.loraStrength) && (
    item.classType === "LoraLoader" ? item.clipStrengthPolicy === "equal_to_model" && sameStrength(item.strengthClip, subject.loraStrength) && sameStrength(item.strengthClip, item.strengthModel)
      : item.classType === "LoraLoaderModelOnly" && item.clipStrengthPolicy === "not_applicable" && item.strengthClip === null
  );
  return [subject?.loraName, subject?.loraVersion, subject?.candidateStatus].every(Boolean) && finiteLoraStrength(subject?.loraStrength) && CANDIDATE_LORA_STATUSES.includes(subject.candidateStatus) && proof.authoritativeLoraBindings.length > 0 && proof.authoritativeLoraBindings.every(loraBindingMatches);
}

function noActiveTerminalLora(subject, proof) {
  return [subject?.loraName, subject?.loraVersion, subject?.loraStrength, subject?.candidateStatus].every((value) => value === null || value === undefined || value === "") && proof.authoritativeLoraBindings.length === 0;
}

const modeHasValidLora = (mode, subject, proof) => mode === "lora_augmented" ? validateRequiredTerminalLora(subject, proof) : noActiveTerminalLora(subject, proof);

export function buildCharacterGenerationEvidencePayload(report) {
  const subject = plain(report?.subject) ? report.subject : null; const proof = normalizeProof(report?.preflight?.providerProof); const evaluator = plain(report?.evaluatorProof) ? report.evaluatorProof : null;
  return {
    generationMode: text(report?.generationMode), benchmarkVersion: text(report?.benchmarkVersion), promptTemplateVersion: text(report?.promptTemplateVersion), fixtureDigest: text(report?.fixtureDigest), generationParametersDigest: text(report?.generationParametersDigest), character: text(report?.character), provider: text(report?.provider), referenceManifestDigest: text(report?.referenceManifestDigest),
    subject: subject ? { characterAssetId: text(subject.characterAssetId), provider: text(subject.provider), identityPackVersion: text(subject.identityPackVersion), modelName: text(subject.modelName), loraName: text(subject.loraName), loraVersion: text(subject.loraVersion), loraStrength: finiteLoraStrength(subject.loraStrength) ? subject.loraStrength : null, candidateStatus: text(subject.candidateStatus) } : null,
    references: Array.isArray(report?.references) ? report.references.map((reference) => ({ shotId: text(reference?.shotId), slot: text(reference?.slot), sourceSha256: text(reference?.sourceSha256), transformedSha256: text(reference?.transformedSha256), transform: text(reference?.transform) })) : [],
    workflowProof: proof,
    evaluatorProof: evaluator ? { id: text(evaluator.id), version: text(evaluator.version), implementationHash: text(evaluator.implementationHash), policyHash: text(evaluator.policyHash), dimensionThreshold: finiteScore(evaluator.dimensionThreshold) ? evaluator.dimensionThreshold : null } : null,
    fallbackUsed: report?.preflight?.fallbackUsed === false ? false : true,
    aggregate: plain(report?.aggregate) ? { status: text(report.aggregate.status), accepted: report.aggregate.accepted, score: finiteScore(report.aggregate.score) ? report.aggregate.score : null } : null,
    shots: Array.isArray(report?.shots) ? report.shots.map((shot) => ({ id: text(shot?.id), outputSha256: text(shot?.outputSha256), score: finiteScore(shot?.score) ? shot.score : null, dimensionScores: plain(shot?.dimensionScores) ? Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, finiteScore(shot.dimensionScores[dimension]) ? shot.dimensionScores[dimension] : null])) : {}, retries: Number.isInteger(shot?.retries) ? shot.retries : null, finalStatus: text(shot?.finalStatus), provenance: text(shot?.provenance), actualProvider: text(shot?.actualProvider), terminalOutputNode: text(shot?.terminalOutputNode) })) : []
  };
}

export function isCharacterGenerationEvidenceEligible(report) {
  const payload = buildCharacterGenerationEvidencePayload(report); const { subject, workflowProof: proof, evaluatorProof: evaluator } = payload;
  const core = CHARACTER_GENERATION_MODES.includes(payload.generationMode) && [payload.benchmarkVersion, payload.promptTemplateVersion, payload.fixtureDigest, payload.generationParametersDigest, payload.character, payload.provider, payload.referenceManifestDigest].every(Boolean) && sha256Value(payload.fixtureDigest) && sha256Value(payload.generationParametersDigest) && sha256Value(payload.referenceManifestDigest);
  const subjectValid = subject && [subject.characterAssetId, subject.provider, subject.identityPackVersion, subject.modelName].every(Boolean) && subject.characterAssetId === payload.character && subject.provider === payload.provider;
  const proofValid = proof && proof.providerId === payload.provider && sha256Value(proof.workflowDigest) && Boolean(proof.terminalOutputNode) && proof.authoritativeModelBindings.length > 0 && proof.authoritativeModelBindings.every((item) => Object.values(item).every(Boolean)) && proof.authoritativeModelBindings.some((item) => basename(item.model) === basename(subject?.modelName));
  const evaluatorValid = evaluator && [evaluator.id, evaluator.version, evaluator.implementationHash, evaluator.policyHash].every(Boolean) && sha256Value(evaluator.implementationHash) && sha256Value(evaluator.policyHash) && finiteScore(evaluator.dimensionThreshold);
  return Boolean(core && subjectValid && proofValid && evaluatorValid && payload.fallbackUsed === false && validReferences(payload.references) && modeHasValidLora(payload.generationMode, subject, proof) && payload.aggregate?.status === "accepted" && payload.aggregate?.accepted === 8 && finiteScore(payload.aggregate?.score) && validShots(payload.shots, payload.provider, proof.terminalOutputNode, evaluator.dimensionThreshold));
}

export function recomputeCharacterGenerationEvidenceDigest(report) { return sha256(stable(buildCharacterGenerationEvidencePayload(report))); }

// Old reports are kept readable for the already-shipped LoRA importer; new reports must carry a mode.
function legacyReportPayload(report) {
  const proof = normalizeProof(report?.preflight?.providerProof); const subject = plain(report?.subject) ? report.subject : null;
  return { benchmarkVersion: report?.benchmarkVersion ?? null, fixtureDigest: text(report?.fixtureDigest), subject: subject ? { characterAssetId: text(subject.characterAssetId), provider: text(subject.provider), identityPackVersion: text(subject.identityPackVersion), loraName: text(subject.loraName), loraVersion: text(subject.loraVersion), modelName: text(subject.modelName), loraStrength: finiteLoraStrength(subject.loraStrength) ? subject.loraStrength : null, candidateStatus: text(subject.candidateStatus) } : null, workflowProof: proof, evaluatorProof: plain(report?.evaluatorProof) ? { modulePathHash: text(report.evaluatorProof.modulePathHash), version: text(report.evaluatorProof.version) } : null, shots: Array.isArray(report?.shots) ? report.shots.map((shot) => ({ id: text(shot?.id), finalStatus: text(shot?.finalStatus), score: finiteScore(shot?.score) ? shot.score : null, dimensionScores: plain(shot?.dimensionScores) ? Object.fromEntries(Object.entries(shot.dimensionScores).filter(([, score]) => finiteScore(score))) : {}, actualProvider: text(shot?.actualProvider), provenance: text(shot?.provenance), terminalOutputNode: text(shot?.terminalOutputNode) })) : [] };
}
function legacyReportEligible(report) {
  const payload = legacyReportPayload(report); const { subject, workflowProof: proof, evaluatorProof: evaluator } = payload;
  return Boolean(subject && [subject.characterAssetId, subject.provider, subject.identityPackVersion, subject.loraName, subject.loraVersion, subject.modelName].every(Boolean) && finiteLoraStrength(subject.loraStrength) && CANDIDATE_LORA_STATUSES.includes(subject.candidateStatus) && subject.provider === report?.provider && subject.characterAssetId === report?.character && proof && proof.providerId === subject.provider && sha256Value(proof.workflowDigest) && proof.terminalOutputNode && proof.authoritativeModelBindings.length && proof.authoritativeModelBindings.every((item) => Object.values(item).every(Boolean)) && proof.authoritativeModelBindings.some((item) => basename(item.model) === basename(subject.modelName)) && validateRequiredTerminalLora(subject, proof) && evaluator && sha256Value(evaluator.modulePathHash) && evaluator.version && report?.aggregate?.status === "accepted" && report?.aggregate?.accepted === 8 && payload.shots.length === 8 && payload.shots.every((shot) => shot.finalStatus === "accepted" && finiteScore(shot.score) && shot.actualProvider === subject.provider && shot.provenance === "model_generation" && shot.terminalOutputNode === proof.terminalOutputNode && Object.keys(shot.dimensionScores).length > 0));
}
function legacyReportDigest(report) { return recomputeCharacterGenerationEvidenceDigest(report); }

export function validateCharacterGenerationReport(report) {
  if (!text(report?.generationMode)) { const eligible = legacyReportEligible(report); const expectedDigest = eligible ? legacyReportDigest(report) : null; return { valid: eligible && report?.evidenceDigest === expectedDigest, eligible, expectedDigest, legacy: true }; }
  const eligible = isCharacterGenerationEvidenceEligible(report); const expectedDigest = eligible ? recomputeCharacterGenerationEvidenceDigest(report) : null;
  return { valid: eligible && report?.evidenceDigest === expectedDigest, eligible, expectedDigest };
}

export function recomputeCharacterWorkflowDigest(workflowValue) { let workflow = workflowValue; if (typeof workflowValue === "string") { try { workflow = JSON.parse(workflowValue); } catch { return null; } } return plain(workflow) ? sha256(stable(workflow)) : null; }

function legacyStoredPayload(evidence) {
  return { reportLabel: text(evidence?.reportLabel), benchmarkVersion: text(evidence?.benchmarkVersion), fixtureDigest: text(evidence?.fixtureDigest), characterAssetId: text(evidence?.characterAssetId), provider: text(evidence?.provider), identityPackVersion: text(evidence?.identityPackVersion), loraName: text(evidence?.loraName), loraVersion: text(evidence?.loraVersion), modelName: text(evidence?.modelName), loraStrength: finiteLoraStrength(evidence?.loraStrength) ? evidence.loraStrength : null, candidateStatus: text(evidence?.candidateStatus), workflowDigest: text(evidence?.workflowDigest), terminalOutputNode: text(evidence?.terminalOutputNode), terminalModel: text(evidence?.terminalModel), terminalLoraName: text(evidence?.terminalLoraName), terminalLoraStrengthModel: finiteLoraStrength(evidence?.terminalLoraStrengthModel) ? evidence.terminalLoraStrengthModel : null, terminalLoraStrengthClip: evidence?.terminalLoraStrengthClip === null || finiteLoraStrength(evidence?.terminalLoraStrengthClip) ? evidence.terminalLoraStrengthClip : null, terminalLoraClassType: text(evidence?.terminalLoraClassType), terminalLoraClipPolicy: text(evidence?.terminalLoraClipPolicy), evaluatorHash: text(evidence?.evaluatorHash), evaluatorVersion: text(evidence?.evaluatorVersion), acceptedShots: evidence?.acceptedShots === 8 ? 8 : null, verifiedAt: text(evidence?.verifiedAt), importedAt: text(evidence?.importedAt) };
}
export function buildStoredCharacterGenerationEvidencePayload(evidence) {
  if (!text(evidence?.generationMode)) return legacyStoredPayload(evidence);
  return { reportLabel: text(evidence?.reportLabel), generationMode: text(evidence?.generationMode), benchmarkVersion: text(evidence?.benchmarkVersion), promptTemplateVersion: text(evidence?.promptTemplateVersion), fixtureDigest: text(evidence?.fixtureDigest), generationParametersDigest: text(evidence?.generationParametersDigest), characterAssetId: text(evidence?.characterAssetId), provider: text(evidence?.provider), identityPackVersion: text(evidence?.identityPackVersion), referenceManifestDigest: text(evidence?.referenceManifestDigest), references: Array.isArray(evidence?.references) ? evidence.references.map((reference) => ({ shotId: text(reference?.shotId), slot: text(reference?.slot), sourceSha256: text(reference?.sourceSha256), transformedSha256: text(reference?.transformedSha256), transform: text(reference?.transform) })) : [], modelName: text(evidence?.modelName), workflowDigest: text(evidence?.workflowDigest), terminalOutputNode: text(evidence?.terminalOutputNode), terminalModel: text(evidence?.terminalModel), evaluatorId: text(evidence?.evaluatorId), evaluatorVersion: text(evidence?.evaluatorVersion), evaluatorImplementationHash: text(evidence?.evaluatorImplementationHash), evaluatorPolicyHash: text(evidence?.evaluatorPolicyHash), dimensionThreshold: finiteScore(evidence?.dimensionThreshold) ? evidence.dimensionThreshold : null, shots: Array.isArray(evidence?.shots) ? evidence.shots.map((shot) => ({ id: text(shot?.id), outputSha256: text(shot?.outputSha256), score: finiteScore(shot?.score) ? shot.score : null, dimensionScores: plain(shot?.dimensionScores) ? Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, finiteScore(shot.dimensionScores[dimension]) ? shot.dimensionScores[dimension] : null])) : {}, retries: Number.isInteger(shot?.retries) ? shot.retries : null, finalStatus: text(shot?.finalStatus), provenance: text(shot?.provenance), actualProvider: text(shot?.actualProvider), terminalOutputNode: text(shot?.terminalOutputNode) })) : [], aggregateScore: finiteScore(evidence?.aggregateScore) ? evidence.aggregateScore : null, acceptedShots: evidence?.acceptedShots === 8 ? 8 : null, verifiedAt: text(evidence?.verifiedAt), importedAt: text(evidence?.importedAt), loraName: text(evidence?.loraName), loraVersion: text(evidence?.loraVersion), loraStrength: finiteLoraStrength(evidence?.loraStrength) ? evidence.loraStrength : null, candidateStatus: text(evidence?.candidateStatus), terminalLoraName: text(evidence?.terminalLoraName), terminalLoraStrengthModel: finiteLoraStrength(evidence?.terminalLoraStrengthModel) ? evidence.terminalLoraStrengthModel : null, terminalLoraStrengthClip: evidence?.terminalLoraStrengthClip === null || finiteLoraStrength(evidence?.terminalLoraStrengthClip) ? evidence.terminalLoraStrengthClip : null, terminalLoraClassType: text(evidence?.terminalLoraClassType), terminalLoraClipPolicy: text(evidence?.terminalLoraClipPolicy) };
}
export function recomputeStoredCharacterGenerationEvidenceDigest(evidence) { return sha256(stable(buildStoredCharacterGenerationEvidencePayload(evidence))); }

function contextReason(payload, context, mode) {
  const checks = [["generation_mode_mismatch", mode, text(context?.generationMode)], ["character_mismatch", payload.characterAssetId, text(context?.characterAssetId)], ["provider_mismatch", payload.provider, text(context?.provider)], ["identity_version_mismatch", payload.identityPackVersion, text(context?.identityPackVersion)], ["model_mismatch", basename(payload.modelName), basename(context?.modelName)]];
  for (const [reason, actual, expected] of checks) if (!actual || !expected || actual !== expected) return reason;
  if (payload.referenceManifestDigest !== text(context?.referenceManifestDigest)) return "reference_manifest_mismatch";
  for (const [reason, actual, expected] of [["evaluator_id_mismatch", payload.evaluatorId, text(context?.evaluatorId)], ["evaluator_version_mismatch", payload.evaluatorVersion, text(context?.evaluatorVersion)], ["evaluator_implementation_mismatch", payload.evaluatorImplementationHash, text(context?.evaluatorImplementationHash)], ["evaluator_policy_mismatch", payload.evaluatorPolicyHash, text(context?.evaluatorPolicyHash)]]) if (!actual || !expected || actual !== expected) return reason;
  if (mode === "lora_augmented") { for (const [reason, actual, expected] of [["lora_name_mismatch", payload.loraName, text(context?.loraName)], ["lora_version_mismatch", payload.loraVersion, text(context?.loraVersion)]]) if (!actual || !expected || actual !== expected) return reason; if (!sameStrength(payload.loraStrength, context?.loraStrength)) return "strength_mismatch"; if (text(context?.candidateStatus) && payload.candidateStatus !== text(context.candidateStatus)) return "candidate_status_mismatch"; }
  const proof = context?.workflowProof; if (!plain(proof) || payload.workflowDigest !== text(proof.workflowDigest)) return "workflow_digest_mismatch"; if (payload.terminalOutputNode !== text(proof.terminalOutputNode)) return "workflow_terminal_mismatch"; const models = Array.isArray(proof.authoritativeModelBindings) ? proof.authoritativeModelBindings.map((item) => basename(item?.model)) : []; if (!models.includes(basename(payload.terminalModel)) || basename(payload.terminalModel) !== basename(payload.modelName)) return "workflow_model_mismatch";
  return null;
}

function newStoredShapeReason(payload) {
  const required = [payload.reportLabel, payload.generationMode, payload.benchmarkVersion, payload.promptTemplateVersion, payload.fixtureDigest, payload.generationParametersDigest, payload.characterAssetId, payload.provider, payload.identityPackVersion, payload.referenceManifestDigest, payload.modelName, payload.workflowDigest, payload.terminalOutputNode, payload.terminalModel, payload.evaluatorId, payload.evaluatorVersion, payload.evaluatorImplementationHash, payload.evaluatorPolicyHash, payload.verifiedAt, payload.importedAt];
  if (required.some((value) => !value) || !CHARACTER_GENERATION_MODES.includes(payload.generationMode) || !sha256Value(payload.fixtureDigest) || !sha256Value(payload.generationParametersDigest) || !sha256Value(payload.referenceManifestDigest) || !sha256Value(payload.workflowDigest) || !sha256Value(payload.evaluatorImplementationHash) || !sha256Value(payload.evaluatorPolicyHash) || payload.acceptedShots !== 8 || !finiteScore(payload.aggregateScore)) return "evidence_shape_invalid";
  if (!validReferences(payload.references)) return "reference_shape_invalid";
  if (!finiteScore(payload.dimensionThreshold)) return "evidence_shape_invalid";
  if (!validShots(payload.shots, payload.provider, payload.terminalOutputNode, 0)) return "shot_shape_invalid";
  if (!validShots(payload.shots, payload.provider, payload.terminalOutputNode, payload.dimensionThreshold)) return "dimension_threshold_not_met";
  if (payload.generationMode === "lora_augmented" && (![payload.loraName, payload.loraVersion, payload.candidateStatus, payload.terminalLoraName, payload.terminalLoraClassType, payload.terminalLoraClipPolicy].every(Boolean) || !finiteLoraStrength(payload.loraStrength) || !sameStrength(payload.terminalLoraStrengthModel, payload.loraStrength) || payload.terminalLoraName !== payload.loraName || !CANDIDATE_LORA_STATUSES.includes(payload.candidateStatus) || (payload.terminalLoraClassType === "LoraLoader" ? payload.terminalLoraClipPolicy !== "equal_to_model" || !sameStrength(payload.terminalLoraStrengthClip, payload.loraStrength) : payload.terminalLoraClassType !== "LoraLoaderModelOnly" || payload.terminalLoraClipPolicy !== "not_applicable" || payload.terminalLoraStrengthClip !== null))) return "evidence_shape_invalid";
  if (payload.generationMode === "zero_shot_multi_reference" && [payload.loraName, payload.loraVersion, payload.loraStrength, payload.candidateStatus, payload.terminalLoraName, payload.terminalLoraStrengthModel, payload.terminalLoraStrengthClip, payload.terminalLoraClassType, payload.terminalLoraClipPolicy].some((value) => value !== null && value !== undefined && value !== "")) return "evidence_shape_invalid";
  return null;
}

export function validateLegacyStoredCharacterBenchmarkEvidence(evidence, context) {
  if (!plain(evidence)) return { valid: false, reason: "evidence_missing", expectedDigest: null };
  const payload = legacyStoredPayload(evidence); const required = [payload.reportLabel, payload.benchmarkVersion, payload.fixtureDigest, payload.characterAssetId, payload.provider, payload.identityPackVersion, payload.loraName, payload.loraVersion, payload.modelName, payload.candidateStatus, payload.workflowDigest, payload.terminalOutputNode, payload.terminalModel, payload.terminalLoraName, payload.terminalLoraClassType, payload.terminalLoraClipPolicy, payload.evaluatorHash, payload.evaluatorVersion, payload.verifiedAt, payload.importedAt];
  const terminalValid = payload.terminalLoraName === payload.loraName && sameStrength(payload.terminalLoraStrengthModel, payload.loraStrength) && (payload.terminalLoraClassType === "LoraLoader" ? payload.terminalLoraClipPolicy === "equal_to_model" && sameStrength(payload.terminalLoraStrengthClip, payload.loraStrength) : payload.terminalLoraClassType === "LoraLoaderModelOnly" && payload.terminalLoraClipPolicy === "not_applicable" && payload.terminalLoraStrengthClip === null);
  if (required.some((value) => !value) || !CANDIDATE_LORA_STATUSES.includes(payload.candidateStatus) || payload.acceptedShots !== 8 || !sha256Value(payload.fixtureDigest) || !sha256Value(payload.workflowDigest) || !sha256Value(payload.evaluatorHash) || !terminalValid) return { valid: false, reason: "evidence_shape_invalid", expectedDigest: null };
  const expectedDigest = sha256(stable(payload)); if (text(evidence.evidenceDigest) !== expectedDigest) return { valid: false, reason: "evidence_digest_mismatch", expectedDigest };
  const legacyContext = { ...context, generationMode: "lora_augmented", evaluatorId: payload.evaluatorHash, evaluatorVersion: payload.evaluatorVersion, evaluatorImplementationHash: payload.evaluatorHash, evaluatorPolicyHash: payload.evaluatorHash, referenceManifestDigest: "legacy" };
  const mismatch = contextReason({ ...payload, referenceManifestDigest: "legacy", evaluatorId: payload.evaluatorHash, evaluatorImplementationHash: payload.evaluatorHash, evaluatorPolicyHash: payload.evaluatorHash }, legacyContext, "lora_augmented");
  return mismatch ? { valid: false, reason: mismatch, expectedDigest } : { valid: true, reason: "ok", expectedDigest, legacy: true };
}

export function validateStoredCharacterGenerationEvidence(evidence, context) {
  if (!plain(evidence)) return { valid: false, reason: "evidence_missing", expectedDigest: null };
  if (!text(evidence.generationMode)) {
    const loraRequested = context?.generationMode === "lora_augmented" || (!text(context?.generationMode) && Boolean(text(context?.loraName)));
    if (!loraRequested) return { valid: false, reason: "legacy_evidence_not_zero_shot", expectedDigest: null };
    return validateLegacyStoredCharacterBenchmarkEvidence(evidence, context);
  }
  const payload = buildStoredCharacterGenerationEvidencePayload(evidence); const expectedDigest = recomputeStoredCharacterGenerationEvidenceDigest(evidence);
  if (text(evidence.evidenceDigest) !== expectedDigest) return { valid: false, reason: "evidence_digest_mismatch", expectedDigest };
  const mismatch = contextReason(payload, context, payload.generationMode); if (mismatch) return { valid: false, reason: mismatch, expectedDigest };
  const shapeReason = newStoredShapeReason(payload); return shapeReason ? { valid: false, reason: shapeReason, expectedDigest } : { valid: true, reason: "ok", expectedDigest };
}

function safeReportLabel(value) { const raw = text(value); if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return "character-generation-evidence.json"; return raw.split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "character-generation-evidence.json"; }

function legacyImport(report, context, options) {
  const validation = validateCharacterGenerationReport(report); if (!validation.eligible) return { valid: false, reason: "report_not_evidence_eligible" }; if (!validation.valid) return { valid: false, reason: "report_digest_mismatch" };
  const payload = legacyReportPayload(report); const proof = payload.workflowProof; const subject = payload.subject; if (subject.candidateStatus !== text(context?.candidateStatus)) return { valid: false, reason: "candidate_status_mismatch" }; const model = proof.authoritativeModelBindings.find((item) => basename(item.model) === basename(subject.modelName)); const lora = proof.authoritativeLoraBindings.find((item) => item.loraName === subject.loraName); const now = typeof options.now === "function" ? options.now() : new Date().toISOString();
  const evidence = { reportLabel: safeReportLabel(options.reportLabel), benchmarkVersion: String(report.benchmarkVersion), fixtureDigest: report.fixtureDigest, characterAssetId: subject.characterAssetId, provider: subject.provider, identityPackVersion: subject.identityPackVersion, loraName: subject.loraName, loraVersion: subject.loraVersion, modelName: subject.modelName, loraStrength: subject.loraStrength, candidateStatus: subject.candidateStatus, workflowDigest: proof.workflowDigest, terminalOutputNode: proof.terminalOutputNode, terminalModel: model?.model ?? "", terminalLoraName: lora?.loraName ?? "", terminalLoraStrengthModel: lora?.strengthModel ?? null, terminalLoraStrengthClip: lora?.strengthClip ?? null, terminalLoraClassType: lora?.classType ?? "", terminalLoraClipPolicy: lora?.clipStrengthPolicy ?? "", evaluatorHash: payload.evaluatorProof.modulePathHash, evaluatorVersion: payload.evaluatorProof.version, acceptedShots: 8, verifiedAt: now, importedAt: now, evidenceDigest: "" };
  evidence.evidenceDigest = sha256(stable(legacyStoredPayload(evidence))); const stored = validateLegacyStoredCharacterBenchmarkEvidence(evidence, context); return stored.valid ? { valid: true, reason: "ok", evidence } : stored;
}

export function importCharacterGenerationEvidence(report, context, options = {}) {
  if (!text(report?.generationMode)) return legacyImport(report, context, options);
  const validation = validateCharacterGenerationReport(report); if (!validation.eligible) return { valid: false, reason: "report_not_evidence_eligible" }; if (!validation.valid) return { valid: false, reason: "report_digest_mismatch" };
  const payload = buildCharacterGenerationEvidencePayload(report); const proof = payload.workflowProof; const subject = payload.subject; if (payload.generationMode !== text(context?.generationMode)) return { valid: false, reason: "generation_mode_mismatch" }; const now = typeof options.now === "function" ? options.now() : new Date().toISOString(); const model = proof.authoritativeModelBindings.find((item) => basename(item.model) === basename(subject.modelName)); const lora = proof.authoritativeLoraBindings[0] ?? null;
  const evidence = { reportLabel: safeReportLabel(options.reportLabel), evidenceDigest: "", generationMode: payload.generationMode, benchmarkVersion: payload.benchmarkVersion, promptTemplateVersion: payload.promptTemplateVersion, fixtureDigest: payload.fixtureDigest, generationParametersDigest: payload.generationParametersDigest, characterAssetId: subject.characterAssetId, provider: subject.provider, identityPackVersion: subject.identityPackVersion, referenceManifestDigest: payload.referenceManifestDigest, references: payload.references, modelName: subject.modelName, workflowDigest: proof.workflowDigest, terminalOutputNode: proof.terminalOutputNode, terminalModel: model?.model ?? "", evaluatorId: payload.evaluatorProof.id, evaluatorVersion: payload.evaluatorProof.version, evaluatorImplementationHash: payload.evaluatorProof.implementationHash, evaluatorPolicyHash: payload.evaluatorProof.policyHash, dimensionThreshold: payload.evaluatorProof.dimensionThreshold, shots: payload.shots, aggregateScore: payload.aggregate.score, acceptedShots: 8, verifiedAt: now, importedAt: now, ...(payload.generationMode === "lora_augmented" ? { loraName: subject.loraName, loraVersion: subject.loraVersion, loraStrength: subject.loraStrength, candidateStatus: subject.candidateStatus, terminalLoraName: lora?.loraName ?? "", terminalLoraStrengthModel: lora?.strengthModel ?? null, terminalLoraStrengthClip: lora?.strengthClip ?? null, terminalLoraClassType: lora?.classType ?? "", terminalLoraClipPolicy: lora?.clipStrengthPolicy ?? "" } : {}) };
  evidence.evidenceDigest = recomputeStoredCharacterGenerationEvidenceDigest(evidence); const stored = validateStoredCharacterGenerationEvidence(evidence, context); return stored.valid ? { valid: true, reason: "ok", evidence } : stored;
}

// Migration aliases keep all existing imports source-compatible.
export const validateCharacterBenchmarkEvidence = validateCharacterGenerationReport;
export const importCharacterBenchmarkEvidence = importCharacterGenerationEvidence;
export const recomputeCharacterBenchmarkEvidenceDigest = recomputeCharacterGenerationEvidenceDigest;
export const buildStoredCharacterBenchmarkEvidencePayload = buildStoredCharacterGenerationEvidencePayload;
export const recomputeStoredCharacterBenchmarkEvidenceDigest = recomputeStoredCharacterGenerationEvidenceDigest;
export const validateStoredCharacterBenchmarkEvidence = validateStoredCharacterGenerationEvidence;
