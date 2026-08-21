import type { ChangeEvent } from "react";
import type { Shot, ShotTransition, ShotTransitionFrameDependency } from "../../modules/storyboard-core/types";
import type { VideoBoundaryKind } from "../../modules/video-production/types";

export type ScriptTransitionInspectorProps = {
  fps: number;
  selectedShot: Shot | null;
  selectedTransition: ShotTransition | null;
  fromShot: Shot | null;
  toShot: Shot | null;
  onUpdateTransition: (transitionId: string, patch: Partial<ShotTransition>) => void;
  onRequestDeleteShot?: (shotId: string) => void;
};

const TRANSITION_LABELS: Record<VideoBoundaryKind, string> = {
  continuous: "连续动作",
  match_cut: "匹配剪辑",
  hard_cut: "硬切",
  scene_change: "换场"
};

export function ScriptTransitionInspector({ fps, selectedShot, selectedTransition, fromShot, toShot, onUpdateTransition, onRequestDeleteShot }: ScriptTransitionInspectorProps): JSX.Element {
  if (selectedTransition) {
    const update = (patch: Partial<ShotTransition>) => onUpdateTransition(selectedTransition.id, patch);
    const durationCeiling = fromShot && toShot ? Math.min(fromShot.durationFrames, toShot.durationFrames) / Math.max(1, fps) : undefined;
    const onTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
      const type = event.target.value as VideoBoundaryKind;
      if (type === "hard_cut") { update({ type, durationSeconds: 0, frameDependency: "none" }); return; }
      update({ type });
    };
    return (
      <section className="script-transition-inspector" aria-labelledby="script-transition-inspector-title">
        <header><p>镜头连接</p><h2 id="script-transition-inspector-title">{fromShot?.title ?? "前镜头"} → {toShot?.title ?? "后镜头"}</h2></header>
        {selectedTransition.type === "continuous" && !fromShot?.approvedBoundaryFramePath ? <p className="script-boundary-waiting" role="status">等待边界帧</p> : null}
        <label><span>转场类型</span><select aria-label="转场类型" value={selectedTransition.type} onChange={onTypeChange}>{Object.entries(TRANSITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>转场时长（秒）</span><input aria-label="转场时长（秒）" type="number" min={0} max={durationCeiling} step={0.1} value={selectedTransition.durationSeconds} disabled={selectedTransition.type === "hard_cut"} onChange={(event) => update({ durationSeconds: Number(event.target.value) })} /></label>
        <details data-transition-advanced open={false}>
          <summary>高级参数</summary>
          <label><span>首尾帧依赖</span><select aria-label="首尾帧依赖" value={selectedTransition.frameDependency} onChange={(event) => update({ frameDependency: event.target.value as ShotTransitionFrameDependency })}><option value="none">无依赖</option><option value="previous_tail">前镜头尾帧</option><option value="shared_frame">共享匹配帧</option></select></label>
          {selectedTransition.frameDependency === "shared_frame" ? <label><span>共享匹配帧路径</span><input aria-label="共享匹配帧路径" type="text" value={selectedTransition.sharedFramePath ?? ""} onChange={(event) => update({ sharedFramePath: event.target.value })} /></label> : null}
          <TransitionTextField label="动作延续" value={selectedTransition.actionContinuity} onChange={(value) => update({ actionContinuity: value })} />
          <TransitionTextField label="人物位置" value={selectedTransition.characterPosition} onChange={(value) => update({ characterPosition: value })} />
          <TransitionTextField label="运镜方向" value={selectedTransition.cameraDirection} onChange={(value) => update({ cameraDirection: value })} />
          <TransitionTextField label="转场备注" value={selectedTransition.notes} onChange={(value) => update({ notes: value })} />
        </details>
      </section>
    );
  }
  if (selectedShot) {
    return (
      <section className="script-shot-inspector" aria-labelledby="script-shot-inspector-title">
        <header><p>镜头详情</p><h2 id="script-shot-inspector-title">{selectedShot.title}</h2><small>{(selectedShot.durationFrames / Math.max(1, fps)).toFixed(1)} 秒</small></header>
        <dl><dt>画面提示</dt><dd>{selectedShot.storyPrompt || "未填写"}</dd><dt>人物</dt><dd>{selectedShot.sourceCharacterNames?.join("、") || selectedShot.tags.join("、") || "未填写"}</dd><dt>场景</dt><dd>{selectedShot.sourceSceneName || "未填写"}</dd><dt>对白</dt><dd>{selectedShot.dialogue || "未填写"}</dd><dt>备注</dt><dd>{selectedShot.notes || "未填写"}</dd></dl>
        {onRequestDeleteShot ? <button type="button" className="btn-danger" data-danger="true" aria-label="删除镜头" onClick={() => onRequestDeleteShot(selectedShot.id)}>删除镜头</button> : null}
      </section>
    );
  }
  return <section className="script-inspector-empty"><p>选择镜头或转场以查看详情。</p></section>;
}

function TransitionTextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return <label><span>{label}</span><textarea aria-label={label} value={value} rows={3} onChange={(event) => onChange(event.target.value)} /></label>;
}
