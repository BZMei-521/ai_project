import { importCharacterGenerationEvidence } from "./characterBenchmarkEvidenceRuntime.mjs";

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const sha256Value = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

const REFERENCE_FIELDS = Object.freeze({
  face_master: "faceMasterPath",
  face_left: "faceLeftPath",
  face_right: "faceRightPath",
  hair_back: "hairBackPath",
  body_front: "bodyFrontPath",
  body_side: "bodySidePath",
  body_back: "bodyBackPath",
  expression_neutral: "neutralExpressionPath"
});

const REFERENCE_ROUTES = Object.freeze([
  Object.freeze({ shotId: "front_close", slots: Object.freeze(["face_master", "body_front"]), transforms: Object.freeze({ face_master: "head_shoulders_crop", body_front: "none" }) }),
  Object.freeze({ shotId: "three_quarter_medium", slots: Object.freeze(["face_master", "body_side"]), transforms: Object.freeze({ face_master: "head_shoulders_crop", body_side: "none" }) }),
  Object.freeze({ shotId: "left_profile", slots: Object.freeze(["face_left", "body_side"]), transforms: Object.freeze({ face_left: "head_shoulders_crop", body_side: "none" }) }),
  Object.freeze({ shotId: "right_profile", slots: Object.freeze(["face_right", "body_side"]), transforms: Object.freeze({ face_right: "head_shoulders_crop", body_side: "none" }) }),
  Object.freeze({ shotId: "back_view", slots: Object.freeze(["hair_back", "body_back"]), transforms: Object.freeze({ hair_back: "none", body_back: "none" }) }),
  Object.freeze({ shotId: "full_body_action", slots: Object.freeze(["body_front", "body_side"]), transforms: Object.freeze({ body_front: "none", body_side: "none" }) }),
  Object.freeze({ shotId: "strong_expression", slots: Object.freeze(["face_master", "expression_neutral"]), transforms: Object.freeze({ face_master: "head_shoulders_crop", expression_neutral: "none" }) }),
  Object.freeze({ shotId: "different_lighting", slots: Object.freeze(["face_master", "body_front"]), transforms: Object.freeze({ face_master: "head_shoulders_crop", body_front: "none" }) })
]);

export const TRUSTED_CHARACTER_EVIDENCE_METADATA = Object.freeze({
  benchmarkVersion: "1",
  promptTemplateVersion: "klein-character-v2",
  fixtureDigest: "48fe813b546ec15cdaac58d8e9e550c3c2ffad53009d7fa8bad9c0274841b72d",
  evaluatorId: "siglip2-character-consistency",
  evaluatorVersion: "1.0.0",
  evaluatorImplementationHash: "b5458e0d26ae515be0d7d1688b2635f68e18145b9075d37d41e4355d389527b2",
  evaluatorPolicyHash: "828f4a18f06b4d325adc72d48463e67965db2d474c065bfdbe83994b6ad4cfae",
  dimensionThreshold: 0.72
});

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

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

export function computeTrustedCharacterReferenceManifestDigest(identity, referenceSourceHashes) {
  if (!plain(identity) || !plain(referenceSourceHashes)) return { ok: false, reason: "reference_manifest_incomplete" };
  const sources = [];
  for (const [slot, field] of Object.entries(REFERENCE_FIELDS)) {
    if (!text(identity[field])) continue;
    const sourceSha256 = referenceSourceHashes[slot];
    if (!sha256Value(sourceSha256)) return { ok: false, reason: "reference_hash_missing" };
    sources.push({ slot, sourceSha256: sourceSha256.toLowerCase(), logicalLabel: field.replace(/Path$/, "") });
  }
  sources.sort((left, right) => left.slot.localeCompare(right.slot));
  const bySlot = new Map(sources.map((item) => [item.slot, item]));
  if (!bySlot.has("face_master") || !bySlot.has("body_front") || sources.length < 3) return { ok: false, reason: "reference_manifest_incomplete" };
  const routes = [];
  for (const route of REFERENCE_ROUTES) {
    for (const requestedSlot of [...route.slots].sort((left, right) => left.localeCompare(right))) {
      let source = bySlot.get(requestedSlot);
      let transform = route.transforms[requestedSlot];
      if (!source && requestedSlot === "face_right") { source = bySlot.get("face_left"); transform = "mirror_x"; }
      else if (!source && requestedSlot === "face_left") { source = bySlot.get("face_right"); transform = "mirror_x"; }
      if (!source) return { ok: false, reason: "reference_manifest_incomplete" };
      routes.push({ shotId: route.shotId, requestedSlot, slot: source.slot, sourceSha256: source.sourceSha256, transform });
    }
  }
  return { ok: true, digest: sha256(stable({ sources, routes })) };
}

export function buildTrustedCharacterGenerationEvidenceContext(input = {}) {
  const asset = input.asset;
  const identity = asset?.characterIdentityPack;
  const mode = text(input.mode);
  if (!plain(asset) || !text(asset.id) || !plain(identity) || !text(identity.version)) return { ok: false, reason: "identity_context_incomplete" };
  if (!['zero_shot_multi_reference', 'lora_augmented'].includes(mode)) return { ok: false, reason: "generation_mode_mismatch" };
  const reference = computeTrustedCharacterReferenceManifestDigest(identity, input.referenceSourceHashes);
  if (!reference.ok) return reference;
  const proof = input.workflowProof;
  if (!plain(proof) || !sha256Value(proof.workflowDigest) || !text(proof.terminalOutputNode) || !Array.isArray(proof.authoritativeModelBindings) || !proof.authoritativeModelBindings.length) return { ok: false, reason: "workflow_invalid" };
  const provider = text(input.providerId); const modelName = text(input.modelName);
  if (!provider || !modelName) return { ok: false, reason: "provider_context_incomplete" };
  const context = {
    generationMode: mode,
    characterAssetId: asset.id.trim(),
    identityPackVersion: identity.version.trim(),
    provider,
    modelName,
    fixtureDigest: TRUSTED_CHARACTER_EVIDENCE_METADATA.fixtureDigest,
    referenceManifestDigest: reference.digest,
    evaluatorId: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorId,
    evaluatorVersion: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorVersion,
    evaluatorImplementationHash: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorImplementationHash,
    evaluatorPolicyHash: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorPolicyHash,
    workflowProof: {
      workflowDigest: proof.workflowDigest,
      terminalOutputNode: proof.terminalOutputNode,
      authoritativeModelBindings: proof.authoritativeModelBindings.map((item) => ({ model: item?.model })).filter((item) => text(item.model)),
      authoritativeLoraBindings: Array.isArray(proof.authoritativeLoraBindings) ? proof.authoritativeLoraBindings : []
    }
  };
  if (mode === "lora_augmented") {
    const lora = asset.characterLora;
    const candidateStatus = ["dataset_ready", "training"].includes(lora?.status)
      ? lora.status
      : ["dataset_ready", "training"].includes(asset.currentLoraContext?.candidateStatus)
        ? asset.currentLoraContext.candidateStatus
        : null;
    if (!plain(lora) || !text(lora.loraName) || !text(lora.version) || !Number.isFinite(lora.strength) || lora.strength <= 0 || !candidateStatus) return { ok: false, reason: "legacy_lora_context_invalid" };
    Object.assign(context, { loraName: lora.loraName.trim(), loraVersion: lora.version.trim(), loraStrength: lora.strength, candidateStatus });
  }
  return { ok: true, context };
}

export function applyCharacterGenerationEvidenceImport(input = {}) {
  const mode = text(input.mode);
  if (!plain(input.report) || text(input.report.generationMode) !== mode) return { valid: false, reason: "generation_mode_mismatch", patch: null };
  const imported = importCharacterGenerationEvidence(input.report, input.context, { reportLabel: input.reportLabel, now: input.now });
  if (!imported.valid || !imported.evidence) return { ...imported, patch: null };
  if (mode === "zero_shot_multi_reference") {
    return { valid: true, reason: "ok", evidence: imported.evidence, patch: { characterZeroShotEvidence: imported.evidence, currentZeroContext: input.context } };
  }
  const lora = input.asset?.characterLora;
  if (!plain(lora)) return { valid: false, reason: "legacy_lora_context_invalid", patch: null };
  return { valid: true, reason: "ok", evidence: imported.evidence, patch: { characterLora: { ...lora, status: "ready", benchmarkEvidence: imported.evidence }, currentLoraContext: input.context } };
}
