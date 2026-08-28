import { useMemo, useState } from "react";
import { DirectedNodeflowCanvas } from "./DirectedNodeflowCanvas";
import { NodeflowInspector } from "./NodeflowInspector";
import { loadNodeflowViewState, persistNodeflowViewState } from "./nodeflowViewState";
import { getDirectorNodeStatus, type DirectorNodeId, type DirectorNodeStatus, type DirectorNodeViewState } from "./nodeflowContracts";

export type DirectedNodeflowWorkspaceProps = { projectName: string; assets: Array<{ id: string; filePath?: string }>; spatialScenes: Array<{ id: string; previewReferences?: { channels?: Array<{ path?: string | null }> } }>; shots: Array<{ id: string; generatedImagePath?: string; generatedVideoPath?: string; videoQualityStatus?: "pending" | "checking" | "needs_review" | "approved" | "rejected" }>; generationTasks: Array<{ status?: "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_review" | "rejected"; outputPath?: string; generatedImagePath?: string; generatedVideoPath?: string }>; onLegacy: () => void; onRunNode?: (id: DirectorNodeId) => void };

export function DirectedNodeflowWorkspace({ projectName, assets, spatialScenes, shots, generationTasks, onLegacy, onRunNode }: DirectedNodeflowWorkspaceProps): JSX.Element {
  const [viewState, setViewState] = useState<DirectorNodeViewState>(() => loadNodeflowViewState());
  const statuses = useMemo(() => Object.fromEntries((["script", "assets", "preview", "storyboard", "production"] as const).map((nodeId) => [nodeId, getDirectorNodeStatus({ nodeId, assets, spatialScenes, shots, generationTasks })])) as Record<DirectorNodeId, DirectorNodeStatus>, [assets, spatialScenes, shots, generationTasks]);
  const summaries = useMemo(() => ({ script: generationTasks.length ? `${generationTasks.length} 个生成任务` : "从故事意图开始", assets: `${assets.length} 个资产`, preview: `${spatialScenes.length} 个空间场景`, storyboard: `${shots.length} 个镜头`, production: `${shots.filter((shot) => shot.generatedVideoPath).length} 个视频输出` }), [assets, spatialScenes, shots, generationTasks]);
  const updateViewState = (next: DirectorNodeViewState) => { setViewState(next); persistNodeflowViewState(next); };
  const selected = viewState.selectedNodeId;
  return <div className="directed-nodeflow-workspace" data-nodeflow-workspace>
    <DirectedNodeflowCanvas statuses={statuses} summaries={summaries} viewState={viewState} onSelectNode={(id) => updateViewState({ ...viewState, selectedNodeId: id })} onToggleNode={(id) => updateViewState({ ...viewState, collapsedNodeIds: viewState.collapsedNodeIds.includes(id) ? viewState.collapsedNodeIds.filter((item) => item !== id) : [...viewState.collapsedNodeIds, id] })} onViewStateChange={updateViewState} onRunNode={(id) => onRunNode?.(id)} onLegacy={onLegacy} />
    <NodeflowInspector nodeId={selected} status={statuses[selected]} projectName={projectName} summary={summaries[selected]} onRun={() => onRunNode?.(selected)} />
  </div>;
}
