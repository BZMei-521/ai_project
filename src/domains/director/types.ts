import type { CameraPlan, DirectorPlanRevision, PoseKeyframe, PreviewReferenceSet, SpatialObject, SpatialScene } from "../spatial-scene/types";

export type { CameraPlan, DirectorPlanRevision, PoseKeyframe, PreviewReferenceSet, SpatialObject, SpatialScene };

export type DirectorPlan = {
  id: string;
  title: string;
  revision: DirectorPlanRevision;
  scenes: SpatialScene[];
  cameras: CameraPlan[];
  objects: SpatialObject[];
  poses: PoseKeyframe[];
  references: PreviewReferenceSet[];
};
