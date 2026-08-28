import { lazy, Suspense, type ReactNode } from "react";

const loadComfyPipelinePanel = () => import("../../modules/comfy-pipeline/ComfyPipelinePanel").then((module) => ({ default: module.ComfyPipelinePanel }));
const LazyComfyPipelinePanel = lazy(loadComfyPipelinePanel);

export function preloadAdvancedPipeline() {
  return loadComfyPipelinePanel();
}

export function AdvancedPipelinePanel({ hidden = false, projectPath }: { hidden?: boolean; projectPath: string }): JSX.Element {
  return <div hidden={hidden}><Suspense fallback={<div className="aux-panel-loading" role="status">Loading pipeline...</div>}><LazyComfyPipelinePanel projectPath={projectPath} /></Suspense></div>;
}

export type AdvancedToolsViewProps = { children?: ReactNode; projectPath: string };
export function AdvancedToolsView({ children, projectPath }: AdvancedToolsViewProps): JSX.Element {
  return <section data-stage-view="advanced-tools"><header><p>高级工具</p><h1>生成流水线</h1></header>{children ?? <AdvancedPipelinePanel projectPath={projectPath} />}</section>;
}
