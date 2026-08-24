import * as THREE from "three";
import { STAGE_RENDER_KINDS, type StageRenderArtifact, type StageRenderKind } from "./spatialControlPack";

export type StageArtifactWriteRequest = {
  stageId: string;
  shotId: string;
  kind: StageRenderKind;
  pngBytes: Uint8Array;
  width: number;
  height: number;
};

export type StageRenderPassRequest = {
  stageId: string;
  shotId: string;
  width: number;
  height: number;
  render(kind: StageRenderKind): Promise<Uint8Array>;
  writeArtifact(request: StageArtifactWriteRequest): Promise<StageRenderArtifact>;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const HEX64 = /^[a-f0-9]{64}$/;

function validateRequest(request: StageRenderPassRequest): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.stageId)) throw new Error("spatial_render_stage_id_invalid");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.shotId)) throw new Error("spatial_render_shot_id_invalid");
  if (!Number.isInteger(request.width) || request.width <= 0 || request.width > 8192) throw new Error("spatial_render_width_invalid");
  if (!Number.isInteger(request.height) || request.height <= 0 || request.height > 8192) throw new Error("spatial_render_height_invalid");
}

function validatePng(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error("spatial_render_png_invalid");
  }
}

function validateReceipt(receipt: StageRenderArtifact, request: StageArtifactWriteRequest): void {
  if (receipt.kind !== request.kind) throw new Error("spatial_render_receipt_kind_mismatch");
  if (receipt.width !== request.width || receipt.height !== request.height) throw new Error("spatial_render_receipt_dimensions_mismatch");
  if (!receipt.filePath || !HEX64.test(receipt.sha256)) throw new Error("spatial_render_receipt_invalid");
}

export async function renderStagePasses(request: StageRenderPassRequest): Promise<StageRenderArtifact[]> {
  validateRequest(request);
  const artifacts: StageRenderArtifact[] = [];
  for (const kind of STAGE_RENDER_KINDS) {
    const pngBytes = Uint8Array.from(await request.render(kind));
    validatePng(pngBytes);
    const writeRequest: StageArtifactWriteRequest = {
      stageId: request.stageId,
      shotId: request.shotId,
      kind,
      pngBytes,
      width: request.width,
      height: request.height
    };
    const receipt = await request.writeArtifact(writeRequest);
    validateReceipt(receipt, writeRequest);
    artifacts.push(receipt);
  }
  return artifacts;
}

function stableEntityColor(entityId: string): number {
  let hash = 0x811c9dc5;
  for (const character of entityId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  const color = (hash >>> 0) & 0xffffff;
  return color === 0 ? 0x010101 : color;
}

export function createStageOverrideMaterial(
  kind: StageRenderKind,
  entity: { id: string; tags: string[] }
): THREE.Material | null {
  if (kind === "color") return null;
  if (kind === "depth") return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  if (kind === "normal") return new THREE.MeshNormalMaterial();
  const isCharacter = entity.tags.includes("character") || entity.tags.includes("lead");
  const isProp = entity.tags.includes("prop");
  const visibleForPass = kind === "character_id" ? isCharacter : kind === "prop_id" ? isProp : isCharacter;
  return new THREE.MeshBasicMaterial({
    color: visibleForPass ? stableEntityColor(entity.id) : 0x000000,
    transparent: !visibleForPass,
    opacity: visibleForPass ? 1 : 0,
    depthWrite: visibleForPass
  });
}
