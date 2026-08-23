import { NODEFLOW_LABELS } from "./NodeflowNodeCard";
import type { DirectorNodeId, DirectorNodeStatus } from "./nodeflowContracts";

export type NodeflowInspectorProps = { nodeId: DirectorNodeId; status: DirectorNodeStatus; projectName: string; summary: string; onRun: () => void };

export function NodeflowInspector({ nodeId, status, projectName, summary, onRun }: NodeflowInspectorProps): JSX.Element {
  const meta = NODEFLOW_LABELS[nodeId];
  return <aside className="nodeflow-inspector-panel" data-nodeflow-inspector>
    <span className="nodeflow-inspector-label">当前节点 / {String(nodeId).toUpperCase()}</span>
    <h2>{meta.title}</h2>
    <p className="nodeflow-inspector-subtitle">{meta.subtitle}</p>
    <div className={`nodeflow-inspector-state nodeflow-state-${status}`}><span />{status === "completed" ? "已完成" : status === "running" ? "处理中" : status === "failed" ? "需处理" : "等待输入"}</div>
    <dl><div><dt>项目</dt><dd>{projectName || "未命名项目"}</dd></div><div><dt>节点状态</dt><dd>{summary}</dd></div></dl>
    <button type="button" className="nodeflow-primary-action" onClick={onRun}>{meta.action}</button>
  </aside>;
}
