import type { ReactNode } from "react";

export type StoryboardWorkspaceViewProps = { shotCount?: number; onContinue?: () => void; children?: ReactNode };
export function StoryboardWorkspaceView({ shotCount = 0, onContinue, children }: StoryboardWorkspaceViewProps): JSX.Element {
  return <section data-stage-view="storyboard"><header><p>阶段 4</p><h1>分镜工作区</h1></header><p>{shotCount} 个镜头等待确认，优先检查构图和连续性。</p><button type="button" onClick={onContinue}>进入成片</button>{children}</section>;
}
