import {
  computeSpatialCameraDigest,
  createSpatialControlPack,
  validateSpatialControlPack,
  type SpatialControlPack,
  type SpatialControlPackInput,
  type StageRenderArtifact,
} from "./spatialControlPack";
import type { StageArtifactWriteRequest, StageRenderPassRequest } from "./stageRenderPasses";
import type { SceneStage, StageCamera, StageStateSnapshot } from "./types";

export type ExportShotControlPackInput = {
  stage: Pick<SceneStage, "id" | "revision" | "sourceDigest">;
  shotId: string;
  snapshot?: StageStateSnapshot;
  camera?: StageCamera;
  projectAssetsDir: string;
  width: number;
  height: number;
  expectedHands: SpatialControlPackInput["expectedHands"];
  expectedProps: SpatialControlPackInput["expectedProps"];
  renderControlArtifacts(request: Omit<StageRenderPassRequest, "render">): Promise<StageRenderArtifact[]>;
  writeArtifact(request: StageArtifactWriteRequest): Promise<StageRenderArtifact>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

export function canonicalSpatialControlPackJson(pack: SpatialControlPack): string {
  return JSON.stringify(canonicalize(pack), null, 2);
}

export async function exportShotControlPack(input: ExportShotControlPackInput): Promise<SpatialControlPack> {
  if (!input.projectAssetsDir?.trim()) throw new Error("spatial_control_project_assets_dir_missing");
  if (!input.snapshot) throw new Error("spatial_control_snapshot_missing");
  if (!input.camera) throw new Error("spatial_control_camera_missing");
  if (input.snapshot.shotId !== input.shotId) throw new Error("spatial_control_snapshot_mismatch");
  if (input.snapshot.cameraId !== input.camera.id) throw new Error("spatial_control_camera_mismatch");

  const artifacts = await input.renderControlArtifacts({
    stageId: input.stage.id,
    shotId: input.shotId,
    width: input.width,
    height: input.height,
    writeArtifact: input.writeArtifact,
  });
  const pack = createSpatialControlPack({
    stageId: input.stage.id,
    stageRevision: input.stage.revision,
    stageDigest: input.stage.sourceDigest,
    shotId: input.shotId,
    snapshotId: input.snapshot.id,
    cameraId: input.camera.id,
    cameraDigest: computeSpatialCameraDigest(input.camera),
    artifacts,
    expectedHands: input.expectedHands,
    expectedProps: input.expectedProps,
  });
  const validation = validateSpatialControlPack(pack, pack);
  if (!validation.valid) throw new Error(validation.reason);
  return pack;
}
