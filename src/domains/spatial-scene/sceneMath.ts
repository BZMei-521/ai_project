import type { Bounds3, CameraPlan, SpatialObject, SpatialVector3 } from "./types";

const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type CameraPlanInput = Partial<CameraPlan> & Record<string, unknown>;

export function normalizeCameraPlan(input: CameraPlanInput = {}): CameraPlan {
  const yaw = finite(Number(input.yaw ?? 0), "camera yaw");
  const pitch = finite(Number(input.pitch ?? 0), "camera pitch");
  const fov = finite(Number(input.fov ?? 60), "camera fov");
  const normalizedYaw = ((yaw % 360) + 360) % 360;
  return {
    ...(typeof input.id === "string" ? { id: input.id } : {}),
    yaw: normalizedYaw,
    pitch: clamp(pitch, -89, 89),
    fov: clamp(fov, 20, 120),
    ...(input.position ? { position: input.position as SpatialVector3 } : {}),
    ...(input.target ? { target: input.target as SpatialVector3 } : {}),
    ...(typeof input.near === "number" ? { near: input.near } : {}),
    ...(typeof input.far === "number" ? { far: input.far } : {})
  };
}

export function computeSceneBounds(objects: readonly Pick<SpatialObject, "position" | "scale">[]): Bounds3 {
  if (objects.length === 0) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const object of objects) {
    const axes = ["x", "y", "z"] as const;
    for (const axis of axes) {
      const position = finite(object.position[axis], `object position.${axis}`);
      const scale = Math.abs(finite(object.scale[axis], `object scale.${axis}`));
      // Spatial objects use a canonical unit half-extent; larger scales expand it.
      const extent = Math.max(1, scale / 2);
      const lower = axis === "y" ? position : position - extent;
      min[axis] = Math.min(min[axis], lower);
      max[axis] = Math.max(max[axis], position + extent);
    }
  }
  return { min, max };
}
