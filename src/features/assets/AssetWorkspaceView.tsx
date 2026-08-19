export type AssetWorkspaceViewProps = { assetCount?: number; onContinue?: () => void };
export function AssetWorkspaceView({ assetCount = 0, onContinue }: AssetWorkspaceViewProps): JSX.Element {
  return <section data-stage-view="assets"><header><p>阶段 2</p><h1>资产工作区</h1></header><p>{assetCount} 个资产已就绪，检查角色、场景与参考图。</p><button type="button" onClick={onContinue}>进入预演</button></section>;
}
