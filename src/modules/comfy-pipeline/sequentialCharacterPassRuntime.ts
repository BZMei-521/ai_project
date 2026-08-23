import type { CharacterGenerationProviderId } from "./characterProviderRegistry";
import type { CharacterBenchmarkEvidence, CharacterGenerationEvidence, CharacterLoraProfile } from "../storyboard-core/types";

export type SequentialArtifactRetention = "disposable" | "persisted" | "publication" | "review";
export type SequentialArtifactLedger = {
  runId: string;
  entries: Array<{ path: string; retention: SequentialArtifactRetention; runOwned: boolean }>;
};
export type SequentialTransactionContext = {
  assertActive: () => void;
  recordPromptId: (promptId: string) => void;
};
export type SequentialProviderWorkflowProof = {
  ok: true;
  reason: "ok";
  providerId: CharacterGenerationProviderId;
  workflowDigest: string;
  terminalOutputNode: string;
  ancestorNodeIds: string[];
  authoritativeModelBindings: Array<{ id: string; classType: string; field: string; model: string }>;
};
export type SequentialProviderWorkflowFailure = {
  ok: false;
  reason: string;
  providerId: CharacterGenerationProviderId;
  terminalOutputNode?: string;
};

// @ts-expect-error The JavaScript runtime is intentionally dependency-free for stock-Node focused tests.
import * as runtime from "./sequentialCharacterPassRuntime.mjs";

export const createSequentialRunId = runtime.createSequentialRunId as (options?: {
  now?: () => number;
  randomToken?: () => string;
}) => string;
export const buildSequentialArtifactPath = runtime.buildSequentialArtifactPath as (options: {
  inputDir: string;
  shotId: string;
  runId: string;
  characterId: string;
  roleIndex: number;
  kind: string;
  suffix?: string | number;
  extension?: string;
}) => string;
export const createSequentialArtifactLedger = runtime.createSequentialArtifactLedger as (
  runId: string
) => SequentialArtifactLedger;
export const registerSequentialArtifact = runtime.registerSequentialArtifact as (
  ledger: SequentialArtifactLedger,
  artifact: { path: string; retention: SequentialArtifactRetention; runOwned?: boolean }
) => SequentialArtifactLedger;
export const executeSequentialArtifactWrite = runtime.executeSequentialArtifactWrite as <TResult>(
  ledger: SequentialArtifactLedger,
  artifact: { path: string; retention: SequentialArtifactRetention; runOwned?: boolean },
  writer: (targetPath: string) => TResult | Promise<TResult>
) => Promise<TResult>;
export const planSequentialArtifactCleanup = runtime.planSequentialArtifactCleanup as (
  ledger: SequentialArtifactLedger,
  outcome: "success" | "failure"
) => string[];
export const planSequentialArtifactRetainedPaths = runtime.planSequentialArtifactRetainedPaths as (
  ledger: SequentialArtifactLedger
) => string[];
export const acquireSequentialControllerOwner = runtime.acquireSequentialControllerOwner as <TController>(
  ownerRef: { current: TController | null },
  createController?: () => TController
) => { acquired: boolean; controller: TController };
export const releaseSequentialControllerOwner = runtime.releaseSequentialControllerOwner as <TController>(
  ownerRef: { current: TController | null },
  controller: TController
) => boolean;
export const proveTerminalProviderWorkflow = runtime.proveTerminalProviderWorkflow as (
  providerId: CharacterGenerationProviderId,
  workflow: string | Record<string, unknown>,
  outputNode?: string
) => SequentialProviderWorkflowProof | SequentialProviderWorkflowFailure;
export const validateSequentialProviderWorkflow = runtime.validateSequentialProviderWorkflow as (
  providerId: CharacterGenerationProviderId,
  workflowJson: string,
  outputNode?: string
) => SequentialProviderWorkflowProof | SequentialProviderWorkflowFailure;
export const lockSequentialCharacterTokens = runtime.lockSequentialCharacterTokens as (input: {
  tokens: Record<string, string>;
  providerId: CharacterGenerationProviderId;
  protectedIdentityTokens: Record<string, string>;
  appliedLora?: AppliedCharacterLora | null;
}) => Record<string, string>;
export const proveCompiledCharacterLoraBinding = runtime.proveCompiledCharacterLoraBinding as (input: {
  providerId: CharacterGenerationProviderId;
  workflowTemplate: string | Record<string, unknown>;
  compiledWorkflow: string | Record<string, unknown>;
  outputNode?: string;
  appliedLora?: AppliedCharacterLora | null;
}) =>
  | { ok: true; reason: "ok"; providerProof: SequentialProviderWorkflowProof; appliedLora: AppliedCharacterLora | null }
  | { ok: false; reason: string; providerProof: SequentialProviderWorkflowProof | SequentialProviderWorkflowFailure; appliedLora: null };
export const validateSequentialCharacterCount = runtime.validateSequentialCharacterCount as (
  count: number
) => { ok: true; count: number } | { ok: false; count: number; reason: string };
export type AppliedCharacterLora = { loraName: string; strength: number; version?: string };
export type CharacterGenerationTrack = {
  mode: "zero_shot_multi_reference" | "lora_augmented";
  providerId: CharacterGenerationProviderId;
  modelName: string;
  appliedLora: AppliedCharacterLora | null;
};
export type CharacterGenerationEvidenceContext = {
  generationMode?: "zero_shot_multi_reference" | "lora_augmented";
  characterAssetId: string;
  identityPackVersion: string;
  provider: CharacterGenerationProviderId;
  modelName: string;
  fixtureDigest: string;
  referenceManifestDigest: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
  loraName?: string;
  loraVersion?: string;
  loraStrength?: number;
  candidateStatus?: "dataset_ready" | "training";
  workflowProof: { workflowDigest: string; terminalOutputNode: string; authoritativeModelBindings: Array<{ model: string }> };
};
export const resolveCharacterGenerationTrack = runtime.resolveCharacterGenerationTrack as (input: {
  characterAssetId?: string;
  identityPackVersion?: string;
  providerId?: CharacterGenerationProviderId;
  modelName?: string;
  characterLora?: CharacterLoraProfile;
  lora?: CharacterLoraProfile;
  characterZeroShotEvidence?: CharacterGenerationEvidence;
  currentEvidenceContext?: CharacterGenerationEvidenceContext;
  currentZeroContext?: CharacterGenerationEvidenceContext;
  currentLoraContext?: CharacterGenerationEvidenceContext;
  workflowProof?: CharacterGenerationEvidenceContext["workflowProof"];
  compiledWorkflow?: string | Record<string, unknown>;
  trustedZeroReceiptVerification?: { valid: boolean; receiptId?: string; claimsDigest?: string };
  trustedLoraReceiptVerification?: { valid: boolean; receiptId?: string; claimsDigest?: string };
}) => CharacterGenerationTrack | null;
export const verifyFreshCharacterEvidenceReceipts = runtime.verifyFreshCharacterEvidenceReceipts as (
  input: {
    characterZeroShotEvidence?: CharacterGenerationEvidence;
    characterLora?: CharacterLoraProfile;
  },
  verifyReceipt: (evidence: CharacterGenerationEvidence | CharacterBenchmarkEvidence) => Promise<{
    valid: boolean;
    reason?: string;
    receiptId?: string;
    claimsDigest?: string;
  }>
) => Promise<{
  trustedZeroReceiptVerification: { valid: boolean; reason?: string; receiptId?: string; claimsDigest?: string };
  trustedLoraReceiptVerification: { valid: boolean; reason?: string; receiptId?: string; claimsDigest?: string };
}>;
export const resolveAppliedCharacterLora = runtime.resolveAppliedCharacterLora as (input: {
  characterAssetId: string;
  identityPackVersion: string;
  lora?: { provider?: string; modelName?: string; loraName?: string; strength?: number; version?: string; status?: string; benchmarkEvidence?: CharacterBenchmarkEvidence };
  providerId: CharacterGenerationProviderId;
  workflowProof: {
    workflowDigest: string;
    terminalOutputNode: string;
    authoritativeModelBindings: Array<{ model: string }>;
  };
}) => AppliedCharacterLora | null;
export const normalizeSequentialProviderWorkflowMap = runtime.normalizeSequentialProviderWorkflowMap as (input?: {
  selectedProviderId?: CharacterGenerationProviderId | string;
  singularWorkflowJson?: string;
  workflowJsonByProvider?: Record<string, unknown>;
}) => Record<CharacterGenerationProviderId, string>;
export const resolveSequentialProviderWorkflow = runtime.resolveSequentialProviderWorkflow as (input: {
  providerId: CharacterGenerationProviderId;
  selectedProviderId?: CharacterGenerationProviderId;
  selectedWorkflowJson?: string;
  workflowJsonByProvider?: Partial<Record<CharacterGenerationProviderId, string>>;
}) =>
  | { ok: true; reason: "ok"; providerId: CharacterGenerationProviderId; workflowJson: string; proof: SequentialProviderWorkflowProof }
  | { ok: false; reason: string; providerId: CharacterGenerationProviderId };
export const planExpandedCharacterRetryCrop = runtime.planExpandedCharacterRetryCrop as (input: {
  bbox: { x: number; y: number; width: number; height: number };
  canvasWidth: number;
  canvasHeight: number;
  normalPaddingRatio?: number;
  expandedPaddingRatio?: number;
}) => {
  normal: { x: number; y: number; width: number; height: number };
  expanded: { x: number; y: number; width: number; height: number };
  normalPaddingRatio: number;
  expandedPaddingRatio: number;
};
export const executeSequentialTransaction = runtime.executeSequentialTransaction as <TGenerated, TPublished>(options: {
  signal?: AbortSignal;
  generate: (context: SequentialTransactionContext) => Promise<TGenerated>;
  publish: (generated: TGenerated) => Promise<TPublished>;
  commit: (published: TPublished) => void | Promise<void>;
  interrupt: (promptIds: string[]) => Promise<void>;
  cleanup: (outcome: "success" | "failure") => Promise<void>;
}) => Promise<TPublished>;
