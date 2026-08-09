// @ts-ignore Browser-safe evidence context runtime is intentionally plain ESM.
import * as runtime from "./characterEvidenceContextRuntime.mjs";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import type {
  Asset,
  CharacterGenerationEvidence,
  CharacterGenerationEvidenceContext,
  CharacterGenerationMode,
  CharacterIdentityPack
} from "../storyboard-core/types";
import type { CharacterGenerationProviderId } from "./characterProviderRegistry";
import type { SequentialProviderWorkflowProof } from "./sequentialCharacterPassRuntime";

export type TrustedCharacterEvidenceMetadata = {
  benchmarkVersion: string;
  promptTemplateVersion: string;
  fixtureDigest: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
  dimensionThreshold: number;
};

export const TRUSTED_CHARACTER_EVIDENCE_METADATA = runtime.TRUSTED_CHARACTER_EVIDENCE_METADATA as TrustedCharacterEvidenceMetadata;

const IDENTITY_REFERENCE_PATHS = {
  face_master: "faceMasterPath",
  face_left: "faceLeftPath",
  face_right: "faceRightPath",
  hair_back: "hairBackPath",
  body_front: "bodyFrontPath",
  body_side: "bodySidePath",
  body_back: "bodyBackPath",
  expression_neutral: "neutralExpressionPath"
} as const;

const MAX_REFERENCE_BYTES = 40 * 1024 * 1024;

function bytesMatchImageFormat(bytes: Uint8Array): boolean {
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return png || jpeg || webp;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("reference_hash_unavailable");
  const ownedBytes = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function loadCharacterIdentityReferenceSourceHashes(
  identity: CharacterIdentityPack,
  loadBytes: (path: string) => Promise<Uint8Array> = async (path) => {
    const source = toDesktopMediaSource(path);
    if (!source) throw new Error("reference_path_missing");
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) throw new Error("reference_read_failed");
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > MAX_REFERENCE_BYTES) throw new Error("reference_too_large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES || !bytesMatchImageFormat(bytes)) throw new Error("reference_image_invalid");
    return bytes;
  }
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const [slot, field] of Object.entries(IDENTITY_REFERENCE_PATHS)) {
    const path = identity[field]?.trim();
    if (!path) continue;
    hashes[slot] = await sha256Hex(await loadBytes(path));
  }
  return hashes;
}

export type TrustedContextInput = {
  asset: Asset;
  mode: CharacterGenerationMode;
  providerId: CharacterGenerationProviderId;
  modelName: string;
  workflowProof: SequentialProviderWorkflowProof;
  referenceSourceHashes: Record<string, string>;
};

export const buildTrustedCharacterGenerationEvidenceContext = runtime.buildTrustedCharacterGenerationEvidenceContext as (
  input: TrustedContextInput
) => { ok: true; context: CharacterGenerationEvidenceContext } | { ok: false; reason: string };

export const applyCharacterGenerationEvidenceImport = runtime.applyCharacterGenerationEvidenceImport as (input: {
  asset: Asset;
  mode: CharacterGenerationMode;
  report: unknown;
  context: CharacterGenerationEvidenceContext;
  reportLabel?: string;
  now?: () => string;
}) =>
  | { valid: true; reason: "ok"; evidence: CharacterGenerationEvidence; patch: Partial<Asset> }
  | { valid: false; reason: string; patch: null };
