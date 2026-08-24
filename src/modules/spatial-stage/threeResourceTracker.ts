import type { Material, Object3D } from "three";

export type DisposableResource = { dispose(): void };

type TrackableTexture = DisposableResource & { isTexture?: boolean };
type TrackableMesh = Object3D & {
  isMesh?: boolean;
  geometry?: DisposableResource;
  material?: Material | Material[];
};

export class ThreeResourceTracker {
  private readonly resources = new Set<DisposableResource>();

  track<T extends DisposableResource>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  untrack(resource: DisposableResource): void {
    this.resources.delete(resource);
  }

  trackObject3D(object: Object3D): void {
    object.traverse((child) => {
      const mesh = child as TrackableMesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry) this.track(mesh.geometry);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        this.track(material);
        for (const value of Object.values(material as unknown as Record<string, unknown>)) {
          const texture = value as TrackableTexture | null;
          if (texture?.isTexture && typeof texture.dispose === "function") this.track(texture);
        }
      }
    });
  }

  dispose(): void {
    const resources = [...this.resources];
    this.resources.clear();
    for (const resource of resources) resource.dispose();
  }
}
