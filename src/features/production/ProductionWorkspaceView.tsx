export type ProductionWorkspaceViewProps = { taskLabel?: string; onExport?: () => void };
export function ProductionWorkspaceView({ taskLabel = "等待生成", onExport }: ProductionWorkspaceViewProps): JSX.Element {
  return <section data-stage-view="production"><header><p>阶段 5</p><h1>成片工作区</h1></header><p>当前状态：{taskLabel}</p><button type="button" onClick={onExport}>导出成片</button></section>;
}
