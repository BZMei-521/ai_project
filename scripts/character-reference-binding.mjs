import crypto from "node:crypto";

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : plain(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
export const CANONICAL_REFERENCE_SLOTS = Object.freeze(["front", "side", "back"]);

const SEMANTIC_SOURCE_MAP = Object.freeze({
  face_master: Object.freeze({ canonicalSlot: "front", logicalLabel: "faceMaster" }),
  face_left: Object.freeze({ canonicalSlot: "side", logicalLabel: "faceLeft" }),
  face_right: Object.freeze({ canonicalSlot: "side", logicalLabel: "faceRight" }),
  hair_back: Object.freeze({ canonicalSlot: "back", logicalLabel: "hairBack" }),
  body_front: Object.freeze({ canonicalSlot: "front", logicalLabel: "bodyFront" }),
  body_side: Object.freeze({ canonicalSlot: "side", logicalLabel: "bodySide" }),
  body_back: Object.freeze({ canonicalSlot: "back", logicalLabel: "bodyBack" }),
  expression_neutral: Object.freeze({ canonicalSlot: "front", logicalLabel: "neutralExpression" })
});

export function canonicalizeReferenceSources(manifest) {
  if (!Array.isArray(manifest)) throw new Error("receipt_reference_invalid");
  const sourceBySlot = new Map(manifest.map((item) => [item?.slot, item]));
  const selected = [
    ["front", sourceBySlot.get("front") ?? sourceBySlot.get("body_front")],
    ["side", sourceBySlot.get("side") ?? sourceBySlot.get("body_side")],
    ["back", sourceBySlot.get("back") ?? sourceBySlot.get("body_back")]
  ].map(([slot, item]) => {
    if (!plain(item) || !/^[a-f0-9]{64}$/.test(item.sourceSha256 ?? "") || typeof item.sourcePath !== "string" || !item.sourcePath.trim()) throw new Error("receipt_reference_invalid");
    return Object.freeze({ slot, sourcePath: item.sourcePath, sourceSha256: item.sourceSha256, logicalLabel: slot });
  });
  return Object.freeze(selected);
}

export function expandCanonicalReferenceSources(canonicalSources) {
  const exact = canonicalizeReferenceSources(canonicalSources);
  const bySlot = new Map(exact.map((item) => [item.slot, item]));
  return Object.freeze(Object.entries(SEMANTIC_SOURCE_MAP).map(([slot, binding]) => {
    const source = bySlot.get(binding.canonicalSlot);
    return Object.freeze({ slot, sourcePath: source.sourcePath, sourceSha256: source.sourceSha256, logicalLabel: binding.logicalLabel });
  }).sort((left, right) => left.slot.localeCompare(right.slot)));
}

export function computeReferenceBindingDigest(referenceManifestDigest, references) {
  if (!/^[a-f0-9]{64}$/.test(referenceManifestDigest ?? "") || !Array.isArray(references)) return null;
  const normalized = references.map((item) => ({
    shotId: item?.shotId ?? null,
    slot: item?.slot ?? null,
    sourceSha256: item?.sourceSha256 ?? null,
    transformedSha256: item?.transformedSha256 ?? null,
    transform: item?.transform ?? null
  }));
  return sha(stable({ referenceManifestDigest, references: normalized }));
}
