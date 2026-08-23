import { DIRECTOR_NODE_EDGES, DIRECTOR_NODE_IDS, type DirectorNodeId, type DirectorNodeStatus, type DirectorNodeViewState } from "./nodeflowContracts";
import { NodeflowNodeCard } from "./NodeflowNodeCard";
import { NodeflowToolbar } from "./NodeflowToolbar";

const NODE_X: Record<DirectorNodeId, number> = { script: 32, assets: 300, preview: 568, storyboard: 836, production: 1104 };

export type DirectedNodeflowCanvasProps = { statuses: Record<DirectorNodeId, DirectorNodeStatus>; summaries?: Partial<Record<DirectorNodeId, string>>; viewState: DirectorNodeViewState; onSelectNode: (id: DirectorNodeId) => void; onToggleNode: (id: DirectorNodeId) => void; onViewStateChange: (state: DirectorNodeViewState) => void; onRunNode: (id: DirectorNodeId) => void; onLegacy: () => void };

export function DirectedNodeflowCanvas({ statuses, summaries, viewState, onSelectNode, onToggleNode, onViewStateChange, onRunNode, onLegacy }: DirectedNodeflowCanvasProps): JSX.Element {
  return <section className="nodeflow-canvas-shell" data-nodeflow-canvas>
    <NodeflowToolbar viewState={viewState} onViewStateChange={onViewStateChange} onLegacy={onLegacy} />
    <div className="nodeflow-canvas-scroll" tabIndex={0} aria-label="导演主流程画布">
      <div className="nodeflow-canvas-viewport" style={{ transform: `translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.zoom})` }}>
        <svg className="nodeflow-edges" viewBox="0 0 1370 280" aria-hidden="true">
          {DIRECTOR_NODE_EDGES.map((edge) => <path key={`${edge.from}-${edge.to}`} d={`M ${NODE_X[edge.from] + 224} 126 C ${NODE_X[edge.from] + 250} 126, ${NODE_X[edge.to] - 28} 126, ${NODE_X[edge.to]} 126`} />)}
        </svg>
        <div className="nodeflow-context-pill"><span>项目上下文</span><strong>当前项目</strong></div>
        <div className="nodeflow-cards">
          {DIRECTOR_NODE_IDS.map((id) => <NodeflowNodeCard key={id} nodeId={id} status={statuses[id]} summary={summaries?.[id]} selected={viewState.selectedNodeId === id} collapsed={viewState.collapsedNodeIds.includes(id)} onSelect={() => onSelectNode(id)} onToggle={() => onToggleNode(id)} onRun={() => onRunNode(id)} />)}
        </div>
      </div>
    </div>
  </section>;
}
