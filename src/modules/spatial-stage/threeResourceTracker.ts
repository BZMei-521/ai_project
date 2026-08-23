export type DisposableResource = { dispose(): void };

export class ThreeResourceTracker {
  private readonly resources = new Set<DisposableResource>();

  track<T extends DisposableResource>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  untrack(resource: DisposableResource): void {
    this.resources.delete(resource);
  }

  dispose(): void {
    const resources = [...this.resources];
    this.resources.clear();
    for (const resource of resources) resource.dispose();
  }
}
