// @ts-ignore Browser-safe evidence context runtime is intentionally plain ESM.
import * as runtime from "./characterEvidenceContextRuntime.mjs";
import { readTrustedCharacterReference } from "../platform/desktopBridge";
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
    const result = await readTrustedCharacterReference(path);
    if (!Number.isInteger(result.byteLength) || result.byteLength <= 0 || result.byteLength > MAX_REFERENCE_BYTES) throw new Error("reference_too_large");
    const binary = atob(result.base64Data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length !== result.byteLength) throw new Error("reference_read_failed");
    if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES || !bytesMatchImageFormat(bytes)) throw new Error("reference_image_invalid");
    return bytes;
  }
): Promise<Record<string, string>> {
  return loadCharacterReferencePathHashes(
    Object.fromEntries(Object.entries(IDENTITY_REFERENCE_PATHS).flatMap(([slot, field]) => {
      const path = identity[field]?.trim();
      return path ? [[slot, path]] : [];
    })),
    loadBytes
  );
}

export async function loadCharacterReferencePathHashes(
  referencePaths: Record<string, string>,
  loadBytes: (path: string) => Promise<Uint8Array> = async (path) => {
    const result = await readTrustedCharacterReference(path);
    if (!Number.isInteger(result.byteLength) || result.byteLength <= 0 || result.byteLength > MAX_REFERENCE_BYTES) throw new Error("reference_too_large");
    const binary = atob(result.base64Data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length !== result.byteLength) throw new Error("reference_read_failed");
    if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES || !bytesMatchImageFormat(bytes)) throw new Error("reference_image_invalid");
    return bytes;
  }
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const [slot, value] of Object.entries(referencePaths)) {
    const path = value?.trim();
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

export type ImmutableCharacterReferenceSnapshot = {
  stagedIdentity: CharacterIdentityPack;
  sourceHashes: Record<string, string>;
  pathBySource: Record<string, string>;
  slotPaths: Record<string, string>;
  supplementalPaths: Record<string, string>;
  supplementalHashes: Record<string, string>;
};

export const stageImmutableCharacterReferenceSnapshot = runtime.stageImmutableCharacterReferenceSnapshot as (input: {
  identity: CharacterIdentityPack;
  stageReference: (input: { slot: string; field: string; sourcePath: string }) => Promise<string>;
  hashIdentity: (identity: CharacterIdentityPack) => Promise<Record<string, string>>;
  supplementalReferences?: Record<string, string>;
  hashReferencePaths?: (paths: Record<string, string>) => Promise<Record<string, string>>;
}) => Promise<ImmutableCharacterReferenceSnapshot>;

export const verifyImmutableCharacterReferenceSnapshot = runtime.verifyImmutableCharacterReferenceSnapshot as (
  snapshot: ImmutableCharacterReferenceSnapshot,
  hashIdentity: (identity: CharacterIdentityPack) => Promise<Record<string, string>>,
  hashReferencePaths?: (paths: Record<string, string>) => Promise<Record<string, string>>
) => Promise<{ valid: true; reason: "ok" } | { valid: false; reason: string }>;

export const verifyCompiledCharacterReferenceBindings = runtime.verifyCompiledCharacterReferenceBindings as (
  compiledWorkflow: Record<string, unknown>,
  expectedInputNames: string[]
) => { valid: true; reason: "ok" } | { valid: false; reason: string };

export const applyCharacterGenerationEvidenceImport = runtime.applyCharacterGenerationEvidenceImport as (input: {
  asset: Asset;
  mode: CharacterGenerationMode;
  report: unknown;
  context: CharacterGenerationEvidenceContext;
  reportLabel?: string;
  now?: () => string;
  trustedReceiptVerification?: { valid: boolean; receiptId?: string; claimsDigest?: string };
}) =>
  | { valid: true; reason: "ok"; evidence: CharacterGenerationEvidence; patch: Partial<Asset> }
  | { valid: false; reason: string; patch: null };
