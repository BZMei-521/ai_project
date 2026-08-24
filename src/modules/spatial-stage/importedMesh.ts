import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { StageMeshResource } from "./types";

export type MeshValidation = { ok: true } | { ok: false; reason: string };

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SUPPORTED_MESH_PATTERN = /\.(?:glb|gltf)$/i;
const MAX_TRIANGLE_COUNT = 250_000;

function isPositiveBounds(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0);
}

export function validateStageMeshResource(resource: StageMeshResource): MeshValidation {
  if (!resource || typeof resource.filePath !== "string" || !resource.filePath.trim()) {
    return { ok: false, reason: "stage_mesh_path_invalid" };
  }
  if (!SUPPORTED_MESH_PATTERN.test(resource.filePath.trim())) {
    return { ok: false, reason: "stage_mesh_format_unsupported" };
  }
  if (typeof resource.sha256 !== "string" || !SHA256_PATTERN.test(resource.sha256)) {
    return { ok: false, reason: "stage_mesh_hash_invalid" };
  }
  if (!Number.isInteger(resource.triangleCount) || resource.triangleCount < 0) {
    return { ok: false, reason: "stage_mesh_triangle_count_invalid" };
  }
  if (resource.triangleCount > MAX_TRIANGLE_COUNT) {
    return { ok: false, reason: "stage_mesh_triangle_budget_exceeded" };
  }
  if (!Number.isInteger(resource.materialCount) || resource.materialCount < 0) {
    return { ok: false, reason: "stage_mesh_material_count_invalid" };
  }
  if (!isPositiveBounds(resource.bounds)) {
    return { ok: false, reason: "stage_mesh_bounds_invalid" };
  }
  return { ok: true };
}

type StageMeshLoader = Pick<GLTFLoader, "loadAsync">;

function cloneTexture(
  texture: THREE.Texture,
  textureClones: Map<THREE.Texture, THREE.Texture>
): THREE.Texture {
  const existing = textureClones.get(texture);
  if (existing) return existing;
  const clone = texture.clone();
  clone.needsUpdate = true;
  textureClones.set(texture, clone);
  return clone;
}

function cloneMaterial(
  material: THREE.Material,
  materialClones: Map<THREE.Material, THREE.Material>,
  textureClones: Map<THREE.Texture, THREE.Texture>
): THREE.Material {
  const existing = materialClones.get(material);
  if (existing) return existing;
  const clone = material.clone();
  materialClones.set(material, clone);
  const fields = clone as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof THREE.Texture) fields[key] = cloneTexture(value, textureClones);
  }
  return clone;
}

function cloneOwnedScene(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  const sourceMeshes: THREE.Mesh[] = [];
  const clonedMeshes: THREE.Mesh[] = [];
  source.traverse((object) => {
    if (object instanceof THREE.Mesh) sourceMeshes.push(object);
  });
  clone.traverse((object) => {
    if (object instanceof THREE.Mesh) clonedMeshes.push(object);
  });

  const geometryClones = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materialClones = new Map<THREE.Material, THREE.Material>();
  const textureClones = new Map<THREE.Texture, THREE.Texture>();
  clonedMeshes.forEach((mesh, index) => {
    const sourceMesh = sourceMeshes[index];
    if (!sourceMesh) return;
    let geometry = geometryClones.get(sourceMesh.geometry);
    if (!geometry) {
      geometry = sourceMesh.geometry.clone();
      geometryClones.set(sourceMesh.geometry, geometry);
    }
    mesh.geometry = geometry;
    mesh.material = Array.isArray(sourceMesh.material)
      ? sourceMesh.material.map((material) => cloneMaterial(material, materialClones, textureClones))
      : cloneMaterial(sourceMesh.material, materialClones, textureClones);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return clone;
}

export async function loadStageMesh(
  resource: StageMeshResource,
  loader: StageMeshLoader = new GLTFLoader()
): Promise<THREE.Group> {
  const validation = validateStageMeshResource(resource);
  if ("reason" in validation) throw new Error(validation.reason);

  let loaded: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
  try {
    loaded = await loader.loadAsync(resource.filePath);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new Error(`stage_mesh_load_failed${detail}`);
  }

  let meshCount = 0;
  loaded.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshCount += 1;
  });
  if (meshCount === 0) throw new Error("stage_mesh_contains_no_mesh");
  return cloneOwnedScene(loaded.scene);
}
