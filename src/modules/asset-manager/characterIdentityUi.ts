// @ts-ignore Executable runtime facade is intentionally plain ESM.
import * as runtime from "./characterIdentityUiRuntime.mjs";
// @ts-ignore The evidence runtime is intentionally plain ESM; this facade defines its TS surface.
import * as generationRuntime from "../comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
import type { CharacterBenchmarkEvidence, CharacterGenerationEvidence, CharacterGenerationMode, CharacterLoraProfile } from "../storyboard-core/types";

export type CharacterLoraProviderId = "qwen_image_edit_2511" | "flux2_klein_4b";
export type CharacterIdentityPathFields = Partial<Record<
  "faceMasterPath" | "faceLeftPath" | "faceRightPath" | "hairBackPath" | "bodyFrontPath" | "bodySidePath" | "bodyBackPath",
  string | undefined
>>;

export type CharacterLoraProviderOption = {
  value: CharacterLoraProviderId;
  label: string;
  modelName: string;
};

export const CHARACTER_LORA_PROVIDER_OPTIONS = runtime.CHARACTER_LORA_PROVIDER_OPTIONS as readonly CharacterLoraProviderOption[];
export const clampCharacterLoraStrength = runtime.clampCharacterLoraStrength as (value?: number) => number;
export const countCharacterIdentityCompleteness = runtime.countCharacterIdentityCompleteness as (identity?: CharacterIdentityPathFields) => number;
export const normalizeCharacterTriggerWord = runtime.normalizeCharacterTriggerWord as (name: string) => string;
export const parseCharacterIdentityList = runtime.parseCharacterIdentityList as (value: string) => string[];
export const resolveCharacterLoraProvider = runtime.resolveCharacterLoraProvider as (
  provider?: string
) => CharacterLoraProviderOption;
export type CharacterBenchmarkEvidenceCoreContext = {
  characterAssetId: string;
  identityPackVersion: string;
  provider: CharacterLoraProviderId;
  loraName: string;
  loraVersion: string;
  modelName: string;
  loraStrength: number;
  candidateStatus?: "dataset_ready" | "training";
  workflowProof: {
    workflowDigest: string;
    terminalOutputNode: string;
    authoritativeModelBindings: Array<{ model: string }>;
  };
};
export type CharacterBenchmarkEvidenceLegacyContext = CharacterBenchmarkEvidenceCoreContext & {
  referenceManifestDigest?: never;
  evaluatorId?: never;
  evaluatorVersion?: never;
  evaluatorImplementationHash?: never;
  evaluatorPolicyHash?: never;
};
export type CharacterBenchmarkEvidenceCurrentLoraContext = CharacterBenchmarkEvidenceCoreContext & {
  referenceManifestDigest: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
};
export type CharacterBenchmarkEvidenceContext =
  | CharacterBenchmarkEvidenceLegacyContext
  | CharacterBenchmarkEvidenceCurrentLoraContext;
export type CharacterGenerationEvidenceContext = {
  generationMode: CharacterGenerationMode;
  characterAssetId: string;
  identityPackVersion: string;
  provider: CharacterLoraProviderId;
  modelName: string;
  referenceManifestDigest: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
  loraName?: string;
  loraVersion?: string;
  loraStrength?: number;
  candidateStatus?: "dataset_ready" | "training";
  workflowProof: {
    workflowDigest: string;
    terminalOutputNode: string;
    authoritativeModelBindings: Array<{ model: string }>;
    authoritativeLoraBindings?: Array<unknown>;
  };
};
export type CharacterBenchmarkEvidenceValidation =
  | { valid: true; reason: "ok"; expectedDigest?: string; evidence?: CharacterBenchmarkEvidence; legacy?: true }
  | { valid: false; reason: string; expectedDigest?: string | null };
export const importCharacterBenchmarkEvidence = runtime.importCharacterBenchmarkEvidence as (
  report: unknown,
  context: CharacterBenchmarkEvidenceContext,
  options?: { reportLabel?: string; now?: () => string }
) => CharacterBenchmarkEvidenceValidation & { evidence?: CharacterBenchmarkEvidence };
export const importCharacterGenerationEvidence = generationRuntime.importCharacterGenerationEvidence as (
  report: unknown,
  context: CharacterGenerationEvidenceContext,
  options?: { reportLabel?: string; now?: () => string }
) => CharacterBenchmarkEvidenceValidation & { evidence?: CharacterGenerationEvidence };
export const validateStoredCharacterBenchmarkEvidence = runtime.validateStoredCharacterBenchmarkEvidence as (
  evidence: CharacterBenchmarkEvidence | undefined,
  context: CharacterBenchmarkEvidenceContext
) => CharacterBenchmarkEvidenceValidation;
export const validateStoredCharacterGenerationEvidence = generationRuntime.validateStoredCharacterGenerationEvidence as (
  evidence: CharacterGenerationEvidence | undefined,
  context: CharacterGenerationEvidenceContext
) => CharacterBenchmarkEvidenceValidation;
export const recomputeCharacterWorkflowDigest = runtime.recomputeCharacterWorkflowDigest as (
  workflow: string | Record<string, unknown>
) => string | null;
export const recomputeStoredCharacterBenchmarkEvidenceDigest = runtime.recomputeStoredCharacterBenchmarkEvidenceDigest as (
  evidence: CharacterBenchmarkEvidence
) => string;
export const recomputeCharacterGenerationEvidenceDigest = generationRuntime.recomputeCharacterGenerationEvidenceDigest as (
  report: unknown
) => string;
export const recomputeStoredCharacterGenerationEvidenceDigest = generationRuntime.recomputeStoredCharacterGenerationEvidenceDigest as (
  evidence: CharacterGenerationEvidence
) => string;
export const invalidateCharacterLoraEvidence = runtime.invalidateCharacterLoraEvidence as (
  lora: CharacterLoraProfile
) => CharacterLoraProfile;
