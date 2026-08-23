import { importCharacterGenerationEvidence } from "./characterBenchmarkEvidenceRuntime.mjs";
import {
  computeCharacterIdentityMetadataDigest,
  validateAndCanonicalizeCharacterIdentityMetadata
} from "./characterIdentityMetadataRuntime.mjs";
import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "./characterStyleContractRuntime.mjs";

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

function normalizedHashMap(value) {
  if (!plain(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([slot, hash]) => !text(slot) || !sha256Value(hash))) return null;
  return Object.fromEntries(entries.map(([slot, hash]) => [slot, hash.toLowerCase()]));
}

export async function stageImmutableCharacterReferenceSnapshot(input = {}) {
  if (!plain(input.identity) || typeof input.stageReference !== "function" || typeof input.hashIdentity !== "function") {
    throw new Error("staged_reference_context_invalid");
  }
  const stagedIdentity = { ...input.identity };
  const pathBySource = {};
  const slotPaths = {};
  const usedTargets = new Set();
  for (const [slot, field] of Object.entries(REFERENCE_FIELDS)) {
    const sourcePath = text(input.identity[field]);
    if (!sourcePath) continue;
    const stagedPath = text(await input.stageReference({ slot, field, sourcePath }));
    if (!stagedPath || usedTargets.has(stagedPath)) throw new Error("staged_reference_path_invalid");
    usedTargets.add(stagedPath);
    stagedIdentity[field] = stagedPath;
    slotPaths[slot] = stagedPath;
    if (!pathBySource[sourcePath]) pathBySource[sourcePath] = stagedPath;
  }
  if (!Object.keys(slotPaths).length) throw new Error("staged_reference_context_invalid");
  const supplementalPaths = {};
  const supplementalSources = plain(input.supplementalReferences) ? input.supplementalReferences : {};
  for (const [slot, value] of Object.entries(supplementalSources)) {
    const sourcePath = text(value);
    if (!text(slot) || !sourcePath) continue;
    const stagedPath = text(await input.stageReference({ slot, field: null, sourcePath, supplemental: true }));
    if (!stagedPath || usedTargets.has(stagedPath)) throw new Error("staged_reference_path_invalid");
    usedTargets.add(stagedPath);
    supplementalPaths[slot] = stagedPath;
    if (!pathBySource[sourcePath]) pathBySource[sourcePath] = stagedPath;
  }
  const sourceHashes = normalizedHashMap(await input.hashIdentity(stagedIdentity));
  if (!sourceHashes || Object.keys(sourceHashes).length !== Object.keys(slotPaths).length || Object.keys(slotPaths).some((slot) => !sourceHashes[slot])) {
    throw new Error("staged_reference_hash_invalid");
  }
  let supplementalHashes = {};
  if (Object.keys(supplementalPaths).length) {
    if (typeof input.hashReferencePaths !== "function") throw new Error("staged_reference_context_invalid");
    supplementalHashes = normalizedHashMap(await input.hashReferencePaths(supplementalPaths));
    if (!supplementalHashes || Object.keys(supplementalPaths).some((slot) => !supplementalHashes[slot])) throw new Error("staged_reference_hash_invalid");
  }
  return { stagedIdentity, sourceHashes, pathBySource, slotPaths, supplementalPaths, supplementalHashes };
}

export async function verifyImmutableCharacterReferenceSnapshot(snapshot, hashIdentity, hashReferencePaths) {
  if (!plain(snapshot) || !plain(snapshot.stagedIdentity) || !plain(snapshot.sourceHashes) || typeof hashIdentity !== "function") {
    return { valid: false, reason: "staged_reference_context_invalid" };
  }
  try {
    const expected = normalizedHashMap(snapshot.sourceHashes);
    const actual = normalizedHashMap(await hashIdentity(snapshot.stagedIdentity));
    const expectedSlots = expected ? Object.keys(expected).sort() : [];
    const actualSlots = actual ? Object.keys(actual).sort() : [];
    if (!expected || !actual || expectedSlots.length !== actualSlots.length || expectedSlots.some((slot, index) => slot !== actualSlots[index] || expected[slot] !== actual[slot])) {
      return { valid: false, reason: "staged_reference_hash_mismatch" };
    }
    const supplementalPaths = plain(snapshot.supplementalPaths) ? snapshot.supplementalPaths : {};
    if (Object.keys(supplementalPaths).length) {
      if (typeof hashReferencePaths !== "function") return { valid: false, reason: "staged_reference_context_invalid" };
      const expectedSupplemental = normalizedHashMap(snapshot.supplementalHashes);
      const actualSupplemental = normalizedHashMap(await hashReferencePaths(supplementalPaths));
      const expectedSupplementalSlots = expectedSupplemental ? Object.keys(expectedSupplemental).sort() : [];
      const actualSupplementalSlots = actualSupplemental ? Object.keys(actualSupplemental).sort() : [];
      if (!expectedSupplemental || !actualSupplemental || expectedSupplementalSlots.length !== actualSupplementalSlots.length || expectedSupplementalSlots.some((slot, index) => slot !== actualSupplementalSlots[index] || expectedSupplemental[slot] !== actualSupplemental[slot])) {
        return { valid: false, reason: "staged_reference_hash_mismatch" };
      }
    }
    return { valid: true, reason: "ok" };
  } catch {
    return { valid: false, reason: "staged_reference_read_failed" };
  }
}

const normalizedReferenceFilename = (value) => typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";

const isCharacterReferenceSinkType = (value) =>
  /^(?:ReferenceLatent|TextEncodeQwenImageEdit)|IPAdapter|InstantID|PuLID|PhotoMaker|FaceID/i.test(String(value ?? ""));

const isTerminalImageType = (value) =>
  /^(?:SaveImage|PreviewImage|VHS_VideoCombine|SaveAnimatedWEBP)$/i.test(String(value ?? ""));

const collectApiInputSources = (value, knownNodeIds, found = new Set()) => {
  if (Array.isArray(value)) {
    if (value.length === 2 && knownNodeIds.has(String(value[0]))) found.add(String(value[0]));
    else for (const item of value) collectApiInputSources(item, knownNodeIds, found);
  } else if (plain(value)) {
    for (const item of Object.values(value)) collectApiInputSources(item, knownNodeIds, found);
  }
  return found;
};

const activeCharacterReferenceFilenames = (compiledWorkflow) => {
  const apiEntries = Object.entries(compiledWorkflow).filter(([, node]) => plain(node) && typeof node.class_type === "string");
  let nodes;
  let edges;
  if (apiEntries.length) {
    nodes = new Map(apiEntries.map(([id, node]) => [String(id), {
      type: String(node.class_type),
      filename: node.class_type === "LoadImage" && plain(node.inputs)
        ? normalizedReferenceFilename(node.inputs.image)
        : ""
    }]));
    const knownNodeIds = new Set(nodes.keys());
    edges = new Map([...knownNodeIds].map((id) => [id, new Set()]));
    for (const [targetId, node] of apiEntries) {
      if (!plain(node.inputs)) continue;
      for (const sourceId of collectApiInputSources(node.inputs, knownNodeIds)) edges.get(sourceId)?.add(String(targetId));
    }
  } else {
    const graphNodes = Array.isArray(compiledWorkflow.nodes) ? compiledWorkflow.nodes : [];
    nodes = new Map(graphNodes.flatMap((node) => {
      if (!plain(node) || (typeof node.id !== "number" && typeof node.id !== "string")) return [];
      const type = String(node.type ?? "");
      return [[String(node.id), {
        type,
        filename: type === "LoadImage" && Array.isArray(node.widgets_values)
          ? normalizedReferenceFilename(node.widgets_values[0])
          : ""
      }]];
    }));
    edges = new Map([...nodes.keys()].map((id) => [id, new Set()]));
    const links = Array.isArray(compiledWorkflow.links) ? compiledWorkflow.links : [];
    for (const link of links) {
      if (!Array.isArray(link) || link.length < 4) continue;
      const sourceId = String(link[1]);
      const targetId = String(link[3]);
      if (nodes.has(sourceId) && nodes.has(targetId)) edges.get(sourceId)?.add(targetId);
    }
  }
  if (!nodes.size) return null;
  const terminals = new Set([...nodes].filter(([, node]) => isTerminalImageType(node.type)).map(([id]) => id));
  if (!terminals.size) return null;
  const reachMemo = new Map();
  const reachable = (startId) => {
    if (reachMemo.has(startId)) return reachMemo.get(startId);
    const seen = new Set();
    const pending = [startId];
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of edges.get(current) ?? []) pending.push(next);
    }
    reachMemo.set(startId, seen);
    return seen;
  };
  const activeSinks = new Set([...nodes]
    .filter(([id, node]) => isCharacterReferenceSinkType(node.type) && [...reachable(id)].some((candidate) => terminals.has(candidate)))
    .map(([id]) => id));
  if (!activeSinks.size) return null;
  const filenames = [];
  for (const [id, node] of nodes) {
    if (node.type !== "LoadImage" || !node.filename) continue;
    if ([...reachable(id)].some((candidate) => activeSinks.has(candidate))) filenames.push(node.filename);
  }
  return filenames;
};

export function verifyCompiledCharacterReferenceBindings(compiledWorkflow, expectedInputNames) {
  if (!plain(compiledWorkflow) || !Array.isArray(expectedInputNames) || !expectedInputNames.length) {
    return { valid: false, reason: "compiled_reference_binding_invalid" };
  }
  const expected = expectedInputNames.map(normalizedReferenceFilename);
  if (expected.some((value) => !value) || new Set(expected).size !== expected.length) {
    return { valid: false, reason: "compiled_reference_binding_invalid" };
  }
  const active = activeCharacterReferenceFilenames(compiledWorkflow);
  if (!active) return { valid: false, reason: "compiled_reference_binding_mismatch" };
  const activeSet = new Set(active);
  const expectedSet = new Set(expected);
  if (activeSet.size !== expectedSet.size || [...expectedSet].some((filename) => !activeSet.has(filename))) {
    return { valid: false, reason: "compiled_reference_binding_mismatch" };
  }
  return { valid: true, reason: "ok" };
}

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
  evaluatorImplementationHash: "e5e320bd503b84ec4f97c3e1c129e629e9078f04313f327f7f30f15f1d55ec19",
  evaluatorPolicyHash: "5f08eb8e61ec83f18e9a846ae7e201b28f8bf0833a377352a30ff68f8a650db0",
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
  const contract = CINEMATIC_3D_DONGHUA_CONTRACT;
  const canonicalDigest = computeCharacterStyleContractDigest(contract);
  if (identity.styleContractId !== contract.id || identity.styleContractVersion !== contract.version || identity.styleContractDigest !== canonicalDigest) {
    return { ok: false, reason: "style_contract_mismatch" };
  }
  const canonicalIdentity = validateAndCanonicalizeCharacterIdentityMetadata(identity);
  if (!canonicalIdentity.ok) return { ok: false, reason: "identity_context_incomplete" };
  const reference = computeTrustedCharacterReferenceManifestDigest(identity, input.referenceSourceHashes);
  if (!reference.ok) return reference;
  const identityMetadataDigest = computeCharacterIdentityMetadataDigest(identity);
  if (!sha256Value(identityMetadataDigest)) return { ok: false, reason: "identity_context_incomplete" };
  const proof = input.workflowProof;
  if (!plain(proof) || !sha256Value(proof.workflowDigest) || !text(proof.terminalOutputNode) || !Array.isArray(proof.authoritativeModelBindings) || !proof.authoritativeModelBindings.length) return { ok: false, reason: "workflow_invalid" };
  const provider = text(input.providerId); const modelName = text(input.modelName);
  if (!provider || !modelName) return { ok: false, reason: "provider_context_incomplete" };
  const context = {
    generationMode: mode,
    benchmarkVersion: TRUSTED_CHARACTER_EVIDENCE_METADATA.benchmarkVersion,
    promptTemplateVersion: TRUSTED_CHARACTER_EVIDENCE_METADATA.promptTemplateVersion,
    characterAssetId: asset.id.trim(),
    identityPackVersion: identity.version.trim(),
    identityMetadataDigest,
    ...canonicalIdentity.value,
    provider,
    modelName,
    fixtureDigest: TRUSTED_CHARACTER_EVIDENCE_METADATA.fixtureDigest,
    referenceManifestDigest: reference.digest,
    evaluatorId: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorId,
    evaluatorVersion: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorVersion,
    evaluatorImplementationHash: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorImplementationHash,
    evaluatorPolicyHash: TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorPolicyHash,
    dimensionThreshold: TRUSTED_CHARACTER_EVIDENCE_METADATA.dimensionThreshold,
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
  const imported = importCharacterGenerationEvidence(input.report, input.context, { reportLabel: input.reportLabel, now: input.now, trustedReceiptVerification: input.trustedReceiptVerification });
  if (!imported.valid || !imported.evidence) return { ...imported, patch: null };
  if (mode === "zero_shot_multi_reference") {
    return { valid: true, reason: "ok", evidence: imported.evidence, patch: { characterZeroShotEvidence: imported.evidence, currentZeroContext: input.context } };
  }
  const lora = input.asset?.characterLora;
  if (!plain(lora)) return { valid: false, reason: "legacy_lora_context_invalid", patch: null };
  return { valid: true, reason: "ok", evidence: imported.evidence, patch: { characterLora: { ...lora, status: "ready", benchmarkEvidence: imported.evidence }, currentLoraContext: input.context } };
}
