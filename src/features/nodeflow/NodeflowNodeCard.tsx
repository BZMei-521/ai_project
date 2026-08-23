import type { DirectorNodeId, DirectorNodeStatus } from "./nodeflowContracts";

export const NODEFLOW_LABELS: Record<DirectorNodeId, { title: string; subtitle: string; action: string }> = {
  script: { title: "剧本", subtitle: "意图与镜头计划", action: "整理剧本" },
  assets: { title: "角色资产", subtitle: "角色、场景与道具", action: "管理资产" },
  preview: { title: "空间预演", subtitle: "场景、机位与动作", action: "打开预演" },
  storyboard: { title: "分镜", subtitle: "画面与镜头节奏", action: "编辑分镜" },
  production: { title: "成片", subtitle: "视频、音频与导出", action: "准备导出" }
};

const STATUS_LABELS: Record<DirectorNodeStatus, string> = {
  idle: "待开始", waiting: "待输入", running: "处理中", completed: "已完成", failed: "需处理"
};

export type NodeflowNodeCardProps = {
  nodeId: DirectorNodeId;
  status: DirectorNodeStatus;
  selected: boolean;
  collapsed: boolean;
  summary?: string;
  onSelect: () => void;
  onToggle: () => void;
  onRun: () => void;
};

export function NodeflowNodeCard({ nodeId, status, selected, collapsed, summary, onSelect, onToggle, onRun }: NodeflowNodeCardProps): JSX.Element {
  const meta = NODEFLOW_LABELS[nodeId];
  return (
    <article className={`nodeflow-card nodeflow-card-${status} ${selected ? "is-selected" : ""}`} data-node-id={nodeId}>
      <button className="nodeflow-card-main" type="button" onClick={onSelect} aria-pressed={selected}>
        <span className="nodeflow-card-kicker">{String(nodeId).toUpperCase()}</span>
        <strong>{meta.title}</strong>
        <span className="nodeflow-card-subtitle">{meta.subtitle}</span>
        <span className={`nodeflow-status nodeflow-status-${status}`}><i aria-hidden="true" />{STATUS_LABELS[status]}</span>
      </button>
      <span className="nodeflow-port nodeflow-port-in" aria-hidden="true" />
      <span className="nodeflow-port nodeflow-port-out" aria-hidden="true" />
      {!collapsed && <div className="nodeflow-card-body"><span>{summary ?? "等待工作区数据"}</span><button type="button" className="nodeflow-card-action" onClick={onRun}>{meta.action}</button></div>}
      <button className="nodeflow-card-collapse" type="button" onClick={onToggle} aria-label={collapsed ? "展开节点" : "折叠节点"}>{collapsed ? "+" : "-"}</button>
    </article>
  );
}
