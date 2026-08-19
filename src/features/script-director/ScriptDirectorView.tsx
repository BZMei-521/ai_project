export type ScriptDirectorViewProps = { title?: string; onContinue?: () => void };
export function ScriptDirectorView({ title = "剧本导演", onContinue }: ScriptDirectorViewProps): JSX.Element {
  return <section data-stage-view="script"><header><p>阶段 1</p><h1>{title}</h1></header><p>把故事意图整理成可执行的镜头计划。</p><button type="button" onClick={onContinue}>继续到资产</button></section>;
}
