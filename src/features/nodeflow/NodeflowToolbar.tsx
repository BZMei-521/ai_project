import type { DirectorNodeViewState } from "./nodeflowContracts";

export type NodeflowToolbarProps = { viewState: DirectorNodeViewState; onViewStateChange: (next: DirectorNodeViewState) => void; onLegacy: () => void };

export function NodeflowToolbar({ viewState, onViewStateChange, onLegacy }: NodeflowToolbarProps): JSX.Element {
  const updateZoom = (zoom: number) => onViewStateChange({ ...viewState, zoom: Math.min(1.35, Math.max(0.72, zoom)) });
  return <div className="nodeflow-toolbar" role="toolbar" aria-label="导演工作流工具栏">
    <div className="nodeflow-toolbar-brand"><span className="nodeflow-brand-mark">G</span><strong>导演工作流</strong><small>DIRECTOR / 01</small></div>
    <div className="nodeflow-toolbar-actions">
      <button type="button" title="缩小画布" onClick={() => updateZoom(viewState.zoom - 0.1)}>-</button>
      <span className="nodeflow-zoom-label">{Math.round(viewState.zoom * 100)}%</span>
      <button type="button" title="放大画布" onClick={() => updateZoom(viewState.zoom + 0.1)}>+</button>
      <button type="button" title="重置视图" onClick={() => onViewStateChange({ ...viewState, panX: 0, panY: 0, zoom: 1 })}>适应</button>
      <button type="button" className="nodeflow-legacy-button" onClick={onLegacy}>传统视图</button>
    </div>
  </div>;
}
