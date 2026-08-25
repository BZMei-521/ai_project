import type { LayerArtifactKind, LayerRenderArtifact } from "./layeredSpatialControlPack";
import { sha256Bytes } from "./layeredSpatialControlPackRuntime.mjs";

export type LayeredPassSpec = { layerId: string; kind: LayerArtifactKind; entityIds: string[] };
export type LayeredArtifactWriteRequest = LayeredPassSpec & { stageId: string; shotId: string; pngBytes: Uint8Array; width: number; height: number };
export type LayeredStageRenderPassRequest = {
  stageId: string; shotId: string; width: number; height: number; passes: LayeredPassSpec[];
  render(spec: LayeredPassSpec): Promise<Uint8Array>;
  writeArtifact(request: LayeredArtifactWriteRequest): Promise<LayerRenderArtifact>;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const HEX64 = /^[a-f0-9]{64}$/;
const KINDS = new Set<LayerArtifactKind>(["color", "depth", "normal", "mask", "material_id"]);

function validateRequest(request: LayeredStageRenderPassRequest): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.stageId)) throw new Error("layered_render_stage_id_invalid");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.shotId)) throw new Error("layered_render_shot_id_invalid");
  if (!Number.isInteger(request.width) || request.width <= 0 || request.width > 8192) throw new Error("layered_render_width_invalid");
  if (!Number.isInteger(request.height) || request.height <= 0 || request.height > 8192) throw new Error("layered_render_height_invalid");
  if (!Array.isArray(request.passes) || request.passes.length > 128) throw new Error("layered_render_pass_count_invalid");
  const identities = new Set<string>();
  for (const spec of request.passes) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(spec.layerId) || !KINDS.has(spec.kind) || !Array.isArray(spec.entityIds) || spec.entityIds.length === 0 || spec.entityIds.some((entityId) => !entityId.trim())) throw new Error("layered_render_pass_invalid");
    const identity = `${spec.layerId}:${spec.kind}`;
    if (identities.has(identity)) throw new Error(`layered_render_pass_duplicate:${identity}`);
    identities.add(identity);
  }
}

function validatePng(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error("layered_render_png_invalid");
  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIdat = false;
  let idatClosed = false;
  let sawIend = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error("layered_render_png_invalid");
    const length = readUint32(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (dataEnd > bytes.length - 4) throw new Error("layered_render_png_invalid");
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const isCritical = bytes[offset + 4] >= 65 && bytes[offset + 4] <= 90;
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) throw new Error("layered_render_png_invalid");
      sawIhdr = true;
    } else if (type === "IHDR") {
      throw new Error("layered_render_png_invalid");
    }
    if (crc32(bytes, offset + 4, dataEnd) !== readUint32(bytes, crcOffset)) throw new Error("layered_render_png_invalid");
    offset = crcOffset + 4;
    if (type === "IEND") {
      if (length !== 0 || !sawIdat || offset !== bytes.length) throw new Error("layered_render_png_invalid");
      sawIend = true;
      break;
    }
    if (type === "IHDR") continue;
    if (type === "IDAT") {
      if (idatClosed) throw new Error("layered_render_png_invalid");
      sawIdat = true;
      continue;
    }
    if (sawIdat) idatClosed = true;
    if (type === "PLTE") {
      if (sawIdat) throw new Error("layered_render_png_invalid");
      continue;
    }
    if (isCritical) throw new Error("layered_render_png_invalid");
  }
  if (!sawIhdr || !sawIdat || !sawIend) throw new Error("layered_render_png_invalid");
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateReceipt(receipt: LayerRenderArtifact, request: LayeredArtifactWriteRequest): void {
  if (receipt.layerId !== request.layerId) throw new Error("layered_render_receipt_layer_mismatch");
  if (receipt.kind !== request.kind) throw new Error("layered_render_receipt_kind_mismatch");
  if (receipt.width !== request.width || receipt.height !== request.height) throw new Error("layered_render_receipt_dimensions_mismatch");
  if (!receipt.filePath || !HEX64.test(receipt.sha256)) throw new Error("layered_render_receipt_invalid");
  if (receipt.sha256 !== sha256Bytes(request.pngBytes)) throw new Error("layered_render_receipt_hash_mismatch");
}

export async function renderLayeredStagePasses(request: LayeredStageRenderPassRequest): Promise<LayerRenderArtifact[]> {
  validateRequest(request);
  const artifacts: LayerRenderArtifact[] = [];
  for (const spec of request.passes) {
    const pngBytes = Uint8Array.from(await request.render(spec));
    validatePng(pngBytes);
    if (readUint32(pngBytes, 16) !== request.width || readUint32(pngBytes, 20) !== request.height) throw new Error("layered_render_png_invalid");
    const writeRequest: LayeredArtifactWriteRequest = { ...spec, stageId: request.stageId, shotId: request.shotId, pngBytes, width: request.width, height: request.height };
    const receipt = await request.writeArtifact(writeRequest);
    validateReceipt(receipt, writeRequest);
    artifacts.push(receipt);
  }
  return artifacts;
}
