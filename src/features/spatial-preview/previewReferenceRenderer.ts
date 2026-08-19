import type {
  CameraPlan,
  PreviewReferenceChannel,
  PreviewReferenceSet as DomainPreviewReferenceSet,
  SpatialScene
} from "../../domains/spatial-scene/types";

export type PreviewReferenceKind = "color" | "depth" | "normal" | "mask" | "pose" | "json";

export type PreviewReferenceChannelDescriptor = PreviewReferenceChannel & {
  name: PreviewReferenceKind;
  metadata: Record<string, unknown>;
};

export type PreviewReferenceSet = Omit<DomainPreviewReferenceSet, "channels"> & {
  channels: PreviewReferenceChannelDescriptor[];
};

const channels: PreviewReferenceKind[] = ["color", "depth", "normal", "mask", "pose", "json"];

const finite = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

/** Build stable placeholder descriptors until the media renderer is connected. */
export function createPreviewReferenceSet(scene: SpatialScene, camera: CameraPlan): PreviewReferenceSet {
  const cameraMetadata = {
    yaw: finite(camera.yaw, 0),
    pitch: finite(camera.pitch, 0),
    fov: finite(camera.fov, 60),
    position: camera.position ? { ...camera.position } : null,
    target: camera.target ? { ...camera.target } : null
  };
  const objectIds = scene.objects.map((object) => object.id);

  return {
    sceneId: scene.id,
    revision: scene.revision,
    channels: channels.map((kind) => ({
      kind,
      name: kind,
      path: `preview://${scene.id}/revision-${scene.revision}/${kind}`,
      mimeType: kind === "json" ? "application/json" : "image/png",
      metadata: {
        sceneId: scene.id,
        revision: scene.revision,
        channel: kind,
        camera: cameraMetadata,
        objectIds,
        objectCount: objectIds.length
      }
    }))
  };
}
