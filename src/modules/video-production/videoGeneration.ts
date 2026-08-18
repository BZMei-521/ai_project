import {
  generateShotAsset,
  type ComfyExecutionProof,
  type ComfyQueuedPromptAttestation,
  type ComfySettings
} from "../comfy-pipeline/comfyService";
import minimaxH3Flf2vCanonical from "../comfy-pipeline/presets/minimax-h3-flf2v-v1.json";
import minimaxH3I2vCanonical from "../comfy-pipeline/presets/minimax-h3-i2v-v1.json";
import minimaxH3R2vCanonical from "../comfy-pipeline/presets/minimax-h3-r2v-v1.json";
import minimaxH3T2vCanonical from "../comfy-pipeline/presets/minimax-h3-t2v-v1.json";
import type { Asset, Shot } from "../storyboard-core/types";
import type {
  VideoAccelerationMode,
  VideoQualityTier,
  VideoRouteDecision,
  VideoWorkflowProfileId
} from "./types";

export type H3ReferenceKind = "character_face" | "character_body" | "scene" | "key_prop";

export interface H3ReferenceImage {
  kind: H3ReferenceKind;
  path: string;
}

export interface RoutedVideoShotRequest {
  settings: ComfySettings;
  shot: Shot;
  index: number;
  allShots?: Shot[];
  assets?: Asset[];
  routeDecision: VideoRouteDecision;
  profileWorkflowJson: string;
  durationSeconds: number;
  width: number;
  height: number;
  qualityTier: VideoQualityTier;
  accelerationMode: VideoAccelerationMode;
  references?: H3ReferenceImage[];
  firstFramePath?: string;
  lastFramePath?: string;
  prompt?: string;
  seed?: number;
  generatedAt?: string;
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
}

export interface H3VideoGenerationPlan {
  profileId: VideoWorkflowProfileId;
  profileWorkflowJson: string;
  tokenOverrides: Record<string, string>;
  selectedReferences: H3ReferenceImage[];
  plannedWorkflowDigest: string;
  plannedInputDigest: string;
}

type ApiWorkflowNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  [key: string]: unknown;
};

type ApiWorkflow = Record<string, ApiWorkflowNode>;

const REFERENCE_RANK: Record<H3ReferenceKind, number> = {
  character_face: 0,
  character_body: 1,
  scene: 2,
  key_prop: 3
};

const CANONICAL_H3_WORKFLOWS: Record<VideoWorkflowProfileId, ApiWorkflow> = {
  minimax_h3_t2v: minimaxH3T2vCanonical,
  minimax_h3_i2v: minimaxH3I2vCanonical,
  minimax_h3_flf2v: minimaxH3Flf2vCanonical,
  minimax_h3_r2v: minimaxH3R2vCanonical
};

export function getCanonicalH3WorkflowJson(profileId: VideoWorkflowProfileId): string {
  const workflow = CANONICAL_H3_WORKFLOWS[profileId];
  if (!workflow) throw new Error("h3_profile_unknown");
  return JSON.stringify(workflow);
}

export function secondsToH3Length(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("invalid_video_duration");
  if (seconds > 15) throw new Error("h3_shot_too_long");
  const requested = Math.round(seconds * 24);
  const snapped = requested + ((5 - (requested % 17) + 17) % 17);
  return Math.min(362, Math.max(124, snapped));
}

export function selectH3ReferenceImages(references: H3ReferenceImage[]): H3ReferenceImage[] {
  const ranked = references
    .map((reference, index) => ({
      kind: reference.kind,
      path: String(reference.path ?? "").trim(),
      index
    }))
    .filter((reference) => reference.path.length > 0 && reference.kind in REFERENCE_RANK)
    .sort((left, right) => REFERENCE_RANK[left.kind] - REFERENCE_RANK[right.kind] || left.index - right.index);
  const seen = new Set<string>();
  const selected: H3ReferenceImage[] = [];
  for (const reference of ranked) {
    const identity = reference.path.replace(/\\/g, "/").toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push({ kind: reference.kind, path: reference.path });
    if (selected.length === 4) break;
  }
  return selected;
}

export async function prepareH3VideoGeneration(
  request: RoutedVideoShotRequest
): Promise<H3VideoGenerationPlan> {
  const profileId = requireSelectedProfile(request.routeDecision);
  if (request.accelerationMode === "te_speed_preview" && request.qualityTier !== "draft") {
    throw new Error("te_speed_draft_only");
  }
  if (request.accelerationMode !== "standard" && request.accelerationMode !== "te_speed_preview") {
    throw new Error("invalid_video_acceleration_mode");
  }
  if (request.qualityTier !== "draft" && request.qualityTier !== "production") {
    throw new Error("invalid_video_quality_tier");
  }

  const workflow = parseApiWorkflow(request.profileWorkflowJson);
  assertCanonicalWorkflow(workflow, profileId);
  const selectedReferences = profileId === "minimax_h3_r2v"
    ? selectH3ReferenceImages(request.references ?? [])
    : [];
  if (profileId === "minimax_h3_r2v") {
    if (selectedReferences.length === 0) throw new Error("h3_r2v_reference_required");
    pruneUnusedR2VReferences(workflow, selectedReferences.length);
  }
  if (request.accelerationMode === "te_speed_preview") {
    injectTeSpeed(workflow);
  }

  const tokenOverrides = buildH3TokenOverrides(request, profileId, selectedReferences);
  assertAllWorkflowTokensBound(workflow, tokenOverrides);
  const profileWorkflowJson = JSON.stringify(workflow);
  const plannedWorkflowDigest = await sha256Hex(stableJson(workflow));
  const plannedInputDigest = await sha256Hex(stableJson({
    version: 1,
    profileId,
    qualityTier: request.qualityTier,
    accelerationMode: request.accelerationMode,
    workflowDigest: plannedWorkflowDigest,
    shotId: request.shot.id,
    index: request.index,
    tokenOverrides,
    selectedReferences
  }));

  return {
    profileId,
    profileWorkflowJson,
    tokenOverrides,
    selectedReferences,
    plannedWorkflowDigest,
    plannedInputDigest
  };
}

export async function generateRoutedVideoShot(request: RoutedVideoShotRequest): Promise<{
  previewUrl: string;
  localPath: string;
  videoGenerationReceipt: NonNullable<Shot["videoGenerationReceipt"]>;
}> {
  request.signal?.throwIfAborted();
  const plan = await prepareH3VideoGeneration(request);
  request.signal?.throwIfAborted();
  let promptId = "";
  let queuedAttestation: ComfyQueuedPromptAttestation | undefined;
  const result = await generateShotAsset(
    request.settings,
    request.shot,
    request.index,
    "video",
    request.allShots ?? [request.shot],
    request.assets ?? [],
    {
      workflowJsonOverride: plan.profileWorkflowJson,
      tokenOverrides: plan.tokenOverrides,
      onProgress: request.onProgress,
      signal: request.signal,
      onPromptQueued: (queuedPromptId) => {
        promptId = queuedPromptId;
      },
      onQueuedPromptAttested: (attestation) => {
        queuedAttestation = {
          ...attestation,
          effectiveInputs: { ...attestation.effectiveInputs }
        };
      },
      strictComfyExecution: true
    }
  );
  request.signal?.throwIfAborted();
  const executionProof = requireSuccessfulExecutionProof(result.executionProof, queuedAttestation, promptId, result);
  const workflowDigest = await sha256Hex(executionProof.canonicalWorkflowJson);
  const inputDigest = await sha256Hex(stableJson({
    version: 2,
    profileId: plan.profileId,
    qualityTier: request.qualityTier,
    accelerationMode: request.accelerationMode,
    workflowDigest,
    shotId: request.shot.id,
    index: request.index,
    effectiveInputs: executionProof.effectiveInputs
  }));
  request.signal?.throwIfAborted();
  const generatedAt = request.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("invalid_generated_at");
  return {
    previewUrl: result.previewUrl,
    localPath: result.localPath,
    videoGenerationReceipt: {
      profileId: plan.profileId,
      accelerationMode: request.accelerationMode,
      workflowDigest,
      inputDigest,
      promptId: executionProof.promptId,
      normalizedPath: normalizeOutputPath(executionProof.outputIdentity.localPath),
      generatedAt
    }
  };
}

function requireSuccessfulExecutionProof(
  proof: ComfyExecutionProof | undefined,
  accepted: ComfyQueuedPromptAttestation | undefined,
  promptId: string,
  result: { previewUrl: string; localPath: string }
): ComfyExecutionProof {
  if (!proof || proof.status !== "succeeded" || proof.provenance !== "comfy") {
    throw new Error("h3_execution_proof_missing");
  }
  if (!accepted || accepted.provenance !== "comfy") throw new Error("h3_queue_attestation_missing");
  if (!promptId || proof.promptId !== promptId || accepted.promptId !== promptId) {
    throw new Error("h3_prompt_attestation_mismatch");
  }
  if (!proof.canonicalWorkflowJson || proof.canonicalWorkflowJson !== accepted.canonicalWorkflowJson) {
    throw new Error("h3_workflow_attestation_mismatch");
  }
  let parsedWorkflow: unknown;
  try {
    parsedWorkflow = JSON.parse(proof.canonicalWorkflowJson);
  } catch {
    throw new Error("h3_workflow_attestation_invalid");
  }
  if (stableJson(parsedWorkflow) !== proof.canonicalWorkflowJson) {
    throw new Error("h3_workflow_attestation_not_canonical");
  }
  if (stableJson(proof.effectiveInputs) !== stableJson(accepted.effectiveInputs)) {
    throw new Error("h3_input_attestation_mismatch");
  }
  if (
    !proof.outputIdentity?.localPath ||
    !proof.outputIdentity?.previewUrl ||
    normalizeOutputPath(proof.outputIdentity.localPath) !== normalizeOutputPath(result.localPath) ||
    proof.outputIdentity.previewUrl !== result.previewUrl
  ) {
    throw new Error("h3_output_attestation_mismatch");
  }
  return proof;
}

function requireSelectedProfile(decision: VideoRouteDecision): VideoWorkflowProfileId {
  if (decision.status === "blocked") throw new Error(decision.reason || "video_route_blocked");
  return decision.profileId;
}

function buildH3TokenOverrides(
  request: RoutedVideoShotRequest,
  profileId: VideoWorkflowProfileId,
  selectedReferences: H3ReferenceImage[]
): Record<string, string> {
  const width = positiveInteger(request.width, "invalid_video_width");
  const height = positiveInteger(request.height, "invalid_video_height");
  const seed = normalizeSeed(request.seed ?? request.shot.seed ?? 0);
  const prompt = String(
    request.prompt ?? request.shot.videoPrompt ?? request.shot.storyPrompt ?? request.shot.notes ?? request.shot.title
  ).trim();
  if (!prompt) throw new Error("video_prompt_required");
  const tokenOverrides: Record<string, string> = {
    VIDEO_PROMPT: prompt,
    VIDEO_WIDTH: String(width),
    VIDEO_HEIGHT: String(height),
    H3_LENGTH: String(secondsToH3Length(request.durationSeconds)),
    SEED: String(seed)
  };

  if (profileId === "minimax_h3_i2v" || profileId === "minimax_h3_flf2v") {
    tokenOverrides.FIRST_FRAME_PATH = requiredPath(
      request.firstFramePath ??
      request.shot.videoStartFramePath ??
      request.shot.approvedBoundaryFramePath ??
      request.shot.generatedImagePath,
      "h3_first_frame_required"
    );
  }
  if (profileId === "minimax_h3_flf2v") {
    tokenOverrides.LAST_FRAME_PATH = requiredPath(
      request.lastFramePath ?? request.shot.videoEndFramePath,
      "h3_last_frame_required"
    );
  }
  if (profileId === "minimax_h3_r2v") {
    selectedReferences.forEach((reference, index) => {
      tokenOverrides[`REF_IMAGE_${index + 1}_PATH`] = reference.path;
    });
  }
  return tokenOverrides;
}

function positiveInteger(value: number, errorCode: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(errorCode);
  return Math.round(value);
}

function normalizeSeed(value: number): number {
  if (!Number.isFinite(value)) throw new Error("invalid_video_seed");
  return Math.max(0, Math.trunc(value));
}

function requiredPath(value: string | undefined, errorCode: string): string {
  const path = String(value ?? "").trim();
  if (!path) throw new Error(errorCode);
  return path;
}

function parseApiWorkflow(workflowJson: string): ApiWorkflow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowJson);
  } catch {
    throw new Error("invalid_h3_workflow_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_h3_workflow_json");
  }
  return parsed as ApiWorkflow;
}

function assertCanonicalWorkflow(workflow: ApiWorkflow, profileId: VideoWorkflowProfileId): void {
  if (stableJson(workflow) !== stableJson(CANONICAL_H3_WORKFLOWS[profileId])) {
    throw new Error("h3_noncanonical_workflow");
  }
  const conditioningNodes = Object.values(workflow).filter((node) =>
    node.class_type === "MiniMaxH3ImageToVideo" || node.class_type === "MiniMaxH3ReferenceToVideo"
  );
  if (conditioningNodes.length !== 1) throw new Error("h3_profile_workflow_mismatch");
  const conditioning = conditioningNodes[0];
  const inputs = conditioning.inputs ?? {};
  const firstFrame = "first_frame" in inputs;
  const lastFrame = "last_frame" in inputs;
  const referenceSlots = Object.keys(inputs).filter((key) => key.startsWith("ref_images.ref_image_")).length;
  const matches = profileId === "minimax_h3_t2v"
    ? conditioning.class_type === "MiniMaxH3ImageToVideo" && !firstFrame && !lastFrame && referenceSlots === 0
    : profileId === "minimax_h3_i2v"
      ? conditioning.class_type === "MiniMaxH3ImageToVideo" && firstFrame && !lastFrame && referenceSlots === 0
      : profileId === "minimax_h3_flf2v"
        ? conditioning.class_type === "MiniMaxH3ImageToVideo" && firstFrame && lastFrame && referenceSlots === 0
        : profileId === "minimax_h3_r2v"
          ? conditioning.class_type === "MiniMaxH3ReferenceToVideo" && !firstFrame && !lastFrame && referenceSlots === 4
          : false;
  if (!matches) throw new Error("h3_profile_workflow_mismatch");
}

function pruneUnusedR2VReferences(workflow: ApiWorkflow, referenceCount: number): void {
  const unusedTokens = new Set(
    Array.from({ length: 4 - referenceCount }, (_, index) => `{{REF_IMAGE_${referenceCount + index + 1}_PATH}}`)
  );
  const removedNodeIds = new Set<string>();
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type === "LoadImage" && unusedTokens.has(String(node.inputs?.image ?? ""))) {
      delete workflow[nodeId];
      removedNodeIds.add(nodeId);
    }
  }
  for (const node of Object.values(workflow)) {
    if (!node.inputs) continue;
    node.inputs = removeLinksToNodes(node.inputs, removedNodeIds) as Record<string, unknown>;
  }
}

function removeLinksToNodes(value: unknown, removedNodeIds: Set<string>): unknown {
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === "string" && removedNodeIds.has(value[0])) {
      return undefined;
    }
    return value.map((item) => removeLinksToNodes(item, removedNodeIds)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, removeLinksToNodes(item, removedNodeIds)] as const)
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

function injectTeSpeed(workflow: ApiWorkflow): void {
  const unetNodeIds = Object.keys(workflow)
    .filter((nodeId) => workflow[nodeId]?.class_type === "UNETLoader")
    .sort(compareNodeIds);
  if (unetNodeIds.length === 0) throw new Error("h3_unet_loader_missing");
  let nextId = Math.max(0, ...Object.keys(workflow).map((nodeId) => Number.parseInt(nodeId, 10) || 0)) + 1;
  for (const unetNodeId of unetNodeIds) {
    const teNodeId = String(nextId++);
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (nodeId === teNodeId || !node.inputs) continue;
      node.inputs = replaceModelLink(node.inputs, unetNodeId, teNodeId) as Record<string, unknown>;
    }
    workflow[teNodeId] = {
      class_type: "TESpeedMiniMaxH3",
      inputs: { model: [unetNodeId, 0] }
    };
  }
}

function replaceModelLink(value: unknown, sourceNodeId: string, targetNodeId: string): unknown {
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === sourceNodeId && value[1] === 0) return [targetNodeId, 0];
    return value.map((item) => replaceModelLink(item, sourceNodeId, targetNodeId));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceModelLink(item, sourceNodeId, targetNodeId)])
    );
  }
  return value;
}

function compareNodeIds(left: string, right: string): number {
  const numeric = (Number.parseInt(left, 10) || 0) - (Number.parseInt(right, 10) || 0);
  return numeric || left.localeCompare(right);
}

function assertAllWorkflowTokensBound(workflow: ApiWorkflow, tokenOverrides: Record<string, string>): void {
  const tokens = new Set<string>();
  const serialized = JSON.stringify(workflow);
  for (const match of serialized.matchAll(/\{\{([^{}]*)\}\}/g)) tokens.add(match[1]);
  for (const token of tokens) {
    if (!(token in tokenOverrides)) throw new Error(`h3_token_unbound:${token}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOutputPath(value: string): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}
