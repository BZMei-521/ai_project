export type DisposableResource = { dispose(): void };

type TrackableTexture = DisposableResource & { isTexture?: boolean };
type TrackableMaterial = DisposableResource & Record<string, unknown>;
type TrackableMesh = {
  isMesh?: boolean;
  geometry?: DisposableResource;
  material?: TrackableMaterial | TrackableMaterial[];
};
type TrackableObject3D = {
  traverse(callback: (object: TrackableMesh) => void): void;
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

  trackObject3D(object: TrackableObject3D): void {
    object.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry) this.track(child.geometry);
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        this.track(material);
        for (const value of Object.values(material)) {
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
