export type ProjectWorkspaceViewProps = { projectName?: string; onCreateProject?: () => void };
export function ProjectWorkspaceView({ projectName = "未命名项目", onCreateProject }: ProjectWorkspaceViewProps): JSX.Element {
  return <section data-stage-view="project"><header><p>阶段 0</p><h1>项目工作区</h1></header><p>{projectName} · 从项目设置和素材入口开始。</p><button type="button" onClick={onCreateProject}>新建项目</button></section>;
}
