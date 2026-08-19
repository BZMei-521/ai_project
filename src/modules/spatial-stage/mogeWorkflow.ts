export type MogeWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export type MogeWorkflowOptions = {
  image: string;
  model?: string;
  resolutionLevel?: number;
  splitResolution?: number;
  mergeResolution?: number;
  batchSize?: number;
  decimation?: number;
  discontinuityThreshold?: number;
  filenamePrefix?: string;
};

const basename = (value: string) => value.replace(/\\/g, "/").split("/").pop() ?? "";
const boundedInt = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value as number) : fallback));
const boundedFloat = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value as number : fallback));

export function buildMogePanoramaWorkflow(options: MogeWorkflowOptions): MogeWorkflow {
  const image = basename(options.image);
  if (!image) throw new Error("MoGe requires a panorama image filename");
  return {
    "1": { class_type: "LoadImage", inputs: { image } },
    "2": { class_type: "LoadMoGeModel", inputs: { model_name: options.model ?? "moge_2_vitl_normal_fp16.safetensors" } },
    "3": { class_type: "MoGePanoramaInference", inputs: {
      moge_model: ["2", 0], image: ["1", 0], resolution_level: boundedInt(options.resolutionLevel, 9, 1, 10),
      split_resolution: boundedInt(options.splitResolution, 512, 128, 1024),
      merge_resolution: boundedInt(options.mergeResolution, 1920, 256, 4096),
      batch_size: boundedInt(options.batchSize, 1, 1, 4)
    } },
    "4": { class_type: "MoGePointMapToMesh", inputs: {
      moge_geometry: ["3", 0], batch_index: 0,
      decimation: boundedInt(options.decimation, 2, 1, 16),
      discontinuity_threshold: boundedFloat(options.discontinuityThreshold, 0.04, 0.001, 0.25), texture: true
    } },
    "5": { class_type: "MoGeRender", inputs: { moge_geometry: ["3", 0], output: "depth" } },
    "6": { class_type: "MoGeRender", inputs: { moge_geometry: ["3", 0], output: "normal_opengl" } },
    "7": { class_type: "MoGeRender", inputs: { moge_geometry: ["3", 0], output: "mask" } },
    "8": { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: `${options.filenamePrefix ?? "spatial-stage/moge"}/depth` } },
    "9": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: `${options.filenamePrefix ?? "spatial-stage/moge"}/normal` } },
    "10": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: `${options.filenamePrefix ?? "spatial-stage/moge"}/mask` } }
  };
}

export type MogeAudit = { valid: boolean; errors: string[] };
export function auditMogeWorkflow(workflow: MogeWorkflow): MogeAudit {
  const errors: string[] = [];
  const node = (id: string, type: string) => workflow[id]?.class_type === type;
  for (const [id, type] of [["1", "LoadImage"], ["2", "LoadMoGeModel"], ["3", "MoGePanoramaInference"], ["4", "MoGePointMapToMesh"]] as const) {
    if (!node(id, type)) errors.push(`missing ${type} node ${id}`);
  }
  const link = (id: string, key: string, target: string) => JSON.stringify(workflow[id]?.inputs?.[key]) === JSON.stringify([target, 0]);
  if (!link("3", "moge_model", "2")) errors.push("panorama inference is not bound to model");
  if (!link("3", "image", "1")) errors.push("panorama inference is not bound to image");
  if (!link("4", "moge_geometry", "3")) errors.push("mesh conversion is not bound to geometry");
  for (const id of ["5", "6", "7"]) if (!link(id, "moge_geometry", "3")) errors.push(`render ${id} is not bound to geometry`);
  for (const id of ["8", "9", "10"]) if (!workflow[id] || workflow[id].class_type !== "SaveImage") errors.push(`missing SaveImage node ${id}`);
  return { valid: errors.length === 0, errors };
}
