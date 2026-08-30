import {
  CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS,
  type CodexStoryboardSpatialArtifactKind,
  type CodexStoryboardSpatialBinding
} from "./codexTaskPackage";
import type { CodexStoryboardReferenceSelection } from "../../modules/platform/desktopBridge";
import type { SpatialControlPack } from "../../modules/spatial-stage/spatialControlPack";

export type SpatialCodexReferenceInput = {
  shotId: string;
  controlPack: SpatialControlPack;
  panorama: { assetId: string; masterPath: string; masterSha256: string; width: number; height: number };
  environmentPerspectivePath: string;
  identities: Array<{ id: string; sourcePath: string; instruction: string }>;
  props: Array<{ id: string; sourcePath: string; instruction: string }>;
  forbiddenCandidatePaths: string[];
  isCurrentPack: boolean;
};

const CONTROL_REFERENCE_IDS: Record<CodexStoryboardSpatialArtifactKind, string> = {
  color: "color",
  depth: "depth",
  normal: "normal",
  character_id: "character-id",
  prop_id: "prop-id",
  pose: "pose"
};

const CONTROL_USAGES: Record<CodexStoryboardSpatialArtifactKind, CodexStoryboardReferenceSelection["usage"]> = {
  color: "spatial_authority",
  depth: "spatial_depth",
  normal: "spatial_normal",
  character_id: "character_id",
  prop_id: "prop_id",
  pose: "pose_reference"
};

const CONTROL_INSTRUCTIONS: Record<CodexStoryboardSpatialArtifactKind, string> = {
  color: "Camera and projection come only from this color control pass; do not derive camera or projection from any other reference.",
  depth: "Geometry comes from depth, normal, IDs, and pose controls; this depth pass is geometry authority only.",
  normal: "Geometry comes from depth, normal, IDs, and pose controls; this normal pass is geometry authority only.",
  character_id: "Geometry comes from depth, normal, IDs, and pose controls; this character-ID pass locks character regions only.",
  prop_id: "Geometry comes from depth, normal, IDs, and pose controls; this prop-ID pass locks prop regions only.",
  pose: "Geometry comes from depth, normal, IDs, and pose controls; this pose pass locks projected humanoid pose only."
};

const HEX64 = /^[a-f0-9]{64}$/;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function pathKey(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const prefix = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : /^[a-zA-Z]:\//.test(normalized) ? normalized.slice(0, 3) : "";
  const segments: string[] = [];
  for (const part of normalized.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const canonical = `${prefix}${segments.join("/")}`.replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(canonical) || canonical.startsWith("//") ? canonical.toLowerCase() : canonical;
}

function requireSafePath(value: string, error: string): string {
  const path = String(value ?? "").trim();
  if (!isAbsolutePath(path)) throw new Error(error);
  return path;
}

function requireUniquePaths(paths: string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = pathKey(path);
    if (seen.has(key)) throw new Error("spatial_codex_duplicate_source");
    seen.add(key);
  }
}

function requireIdentifier(value: string, error: string): string {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(error);
  return id;
}

export function buildSpatialCodexReferenceSelections(
  input: SpatialCodexReferenceInput
): {
  references: CodexStoryboardReferenceSelection[];
  spatialControl: CodexStoryboardSpatialBinding;
} {
  if (!input.isCurrentPack) throw new Error("spatial_codex_stale_pack");
  const shotId = requireIdentifier(input.shotId, "spatial_codex_shot_invalid");
  const pack = input.controlPack;
  if (!pack || pack.shotId !== shotId) throw new Error("spatial_codex_wrong_shot");
  if (!input.panorama || input.panorama.width !== input.panorama.height * 2) {
    throw new Error("spatial_codex_non_panorama_master");
  }
  if (!Number.isSafeInteger(input.panorama.width) || !Number.isSafeInteger(input.panorama.height) || input.panorama.height <= 0 || !HEX64.test(input.panorama.masterSha256)) {
    throw new Error("spatial_codex_panorama_invalid");
  }

  const artifacts = new Map<CodexStoryboardSpatialArtifactKind, SpatialControlPack["artifacts"][number]>();
  for (const artifact of pack.artifacts ?? []) {
    if (!CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.includes(artifact.kind)) continue;
    if (artifacts.has(artifact.kind)) throw new Error("spatial_codex_duplicate_artifact");
    if (!HEX64.test(artifact.sha256) || artifact.width <= 0 || artifact.height <= 0) throw new Error("spatial_codex_artifact_invalid");
    artifacts.set(artifact.kind, artifact);
  }
  for (const kind of CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS) {
    if (!artifacts.has(kind)) throw new Error("spatial_codex_missing_artifact");
  }

  const masterPath = requireSafePath(input.panorama.masterPath, "spatial_codex_panorama_path_invalid");
  const environmentPath = requireSafePath(input.environmentPerspectivePath, "spatial_codex_environment_path_invalid");
  const forbiddenCandidatePaths = input.forbiddenCandidatePaths.map((path) =>
    requireSafePath(path, "spatial_codex_forbidden_candidate_path_invalid")
  );
  if (forbiddenCandidatePaths.some((path) => pathKey(path) === pathKey(environmentPath))) {
    throw new Error("spatial_codex_old_candidate");
  }
  const identities = input.identities.map((identity) => ({
    id: requireIdentifier(identity.id, "spatial_codex_identity_id_invalid"),
    sourcePath: requireSafePath(identity.sourcePath, "spatial_codex_identity_path_invalid"),
    instruction: String(identity.instruction ?? "").trim()
  }));
  const props = input.props.map((prop) => ({
    id: requireIdentifier(prop.id, "spatial_codex_prop_id_invalid"),
    sourcePath: requireSafePath(prop.sourcePath, "spatial_codex_prop_path_invalid"),
    instruction: String(prop.instruction ?? "").trim()
  }));
  if (identities.some((identity) => !identity.instruction) || props.some((prop) => !prop.instruction)) {
    throw new Error("spatial_codex_reference_instruction_invalid");
  }
  const orderedArtifacts = CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.map((kind) => artifacts.get(kind)!);
  requireUniquePaths([masterPath, environmentPath, ...orderedArtifacts.map((artifact) => requireSafePath(artifact.filePath, "spatial_codex_artifact_path_invalid")), ...identities.map((identity) => identity.sourcePath), ...props.map((prop) => prop.sourcePath)]);

  const references: CodexStoryboardReferenceSelection[] = [
    ...CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.map((kind, index) => ({
      id: CONTROL_REFERENCE_IDS[kind],
      usage: CONTROL_USAGES[kind],
      instruction: CONTROL_INSTRUCTIONS[kind],
      sourcePath: orderedArtifacts[index].filePath
    })),
    {
      id: "environment",
      usage: "environment_reference",
      instruction: "Appearance comes from this panorama-derived perspective; it does not control camera, projection, geometry, or pose.",
      sourcePath: environmentPath
    },
    ...identities.map((identity) => ({ ...identity, usage: "face_identity" as const })),
    ...props.map((prop) => ({ ...prop, usage: "prop_detail" as const }))
  ];
  const ids = new Set<string>();
  for (const reference of references) {
    if (ids.has(reference.id)) throw new Error("spatial_codex_duplicate_reference_id");
    ids.add(reference.id);
  }

  return {
    references,
    spatialControl: {
      stageId: pack.stageId,
      stageRevision: pack.stageRevision,
      stageDigest: pack.stageDigest,
      shotId,
      snapshotId: pack.snapshotId,
      cameraId: pack.cameraId,
      cameraDigest: pack.cameraDigest,
      panoramaAssetId: input.panorama.assetId,
      panoramaSha256: input.panorama.masterSha256,
      artifacts: CODEX_STORYBOARD_SPATIAL_ARTIFACT_KINDS.map((kind, index) => ({
        kind,
        referenceId: CONTROL_REFERENCE_IDS[kind],
        sha256: orderedArtifacts[index].sha256
      }))
    }
  };
}
