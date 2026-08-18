export function inventoryFromComfyObjectInfo(objectInfo = {}) {
  const source = objectInfo && typeof objectInfo === "object" && !Array.isArray(objectInfo) ? objectInfo : {};
  return {
    nodes: Object.keys(source).sort(),
    models: {
      diffusion_models: options(source.UNETLoader, "unet_name"),
      text_encoders: options(source.CLIPLoader, "clip_name"),
      vae: options(source.VAELoader, "vae_name")
    }
  };
}

function options(node, inputName) {
  const values = [];
  collect(node?.input?.required?.[inputName], values);
  return [...new Set(values)].sort();
}

function collect(value, values) {
  if (typeof value === "string" && value.trim()) values.push(value.trim());
  else if (Array.isArray(value)) value.forEach((item) => collect(item, values));
}
