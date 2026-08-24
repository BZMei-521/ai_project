import { SpatialPreviewCanvas } from "./SpatialPreviewCanvas";
import { SpatialStageWorkbench } from "../../modules/spatial-stage/SpatialStageWorkbench";
import type { SpatialObject, SpatialScene } from "../../domains/spatial-scene/types";

export type PreviewWorkspaceViewProps = { scene: SpatialScene; selection?: string | null; onSceneChange: (scene: SpatialScene) => void; onSelectionChange: (id: string | null) => void };
export function PreviewWorkspaceView({ scene, selection = null, onSceneChange, onSelectionChange }: PreviewWorkspaceViewProps): JSX.Element {
  return (
    <section data-stage-view="preview">
      <header><p>阶段 3</p><h1>空间预演</h1></header>
      <SpatialStageWorkbench />
      <details className="spatial-preview-compatibility">
        <summary>兼容预览</summary>
        <SpatialPreviewCanvas scene={scene} selection={selection} onSceneChange={onSceneChange} onSelectionChange={onSelectionChange} />
      </details>
    </section>
  );
}

export type { SpatialObject, SpatialScene };
