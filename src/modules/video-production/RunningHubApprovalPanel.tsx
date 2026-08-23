import { useState } from "react";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import type { CloudRecommendationReason } from "./cloudShotRouting";
import type { RunningHubApprovalSnapshot } from "./runningHubApproval";

const reasonLabels: Record<CloudRecommendationReason, string> = {
  character_contact: "角色接触或交互",
  ordered_fast_actions: "连续动作节拍",
  combined_subject_camera_motion: "角色与镜头同时运动",
  crowd_spatial_action: "群体空间调度",
  local_quality_exhausted: "本地质量重试已用尽"
};

export interface RunningHubApprovalPanelProps {
  approval: RunningHubApprovalSnapshot;
  recommendationReasons: CloudRecommendationReason[];
  confirmed?: boolean;
  onPrepare: () => Promise<void>;
  onContinueLocal: () => void;
  onCancel: () => void;
}

export function RunningHubApprovalPanel({ approval, recommendationReasons, confirmed = false, onPrepare, onContinueLocal, onCancel }: RunningHubApprovalPanelProps) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepared, setPrepared] = useState(confirmed);
  const [error, setError] = useState("");

  const confirm = async () => {
    if (prepared || isPreparing) return;
    setIsPreparing(true);
    setError("");
    try {
      await onPrepare();
      setPrepared(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPreparing(false);
    }
  };

  return <section className="runninghub-approval-panel" aria-label="RunningHub 审批">
    <header className="runninghub-approval-panel__header">
      <div><h4>RunningHub 复杂镜头审批</h4><p>MiniMax H3 多参考工作流 #{approval.workflowId}</p></div>
      <span className="runninghub-approval-panel__state">{prepared ? "已创建交接包" : "等待确认"}</span>
    </header>
    <div className="runninghub-approval-panel__reasons">
      <small>推荐原因</small>
      <span>{recommendationReasons.length ? recommendationReasons.map((reason) => reasonLabels[reason]).join("、") : "复杂镜头人工确认"}</span>
    </div>
    <div className="runninghub-approval-panel__references" aria-label="两个角色参考图">
      {approval.references.map((reference, index) => <figure key={reference}>
        <img alt={`参考图 ${index + 1}`} loading="lazy" src={toDesktopMediaSource(reference)} />
        <figcaption>参考图 {index + 1} · {fileName(reference)}</figcaption>
      </figure>)}
    </div>
    <dl className="runninghub-approval-panel__settings">
      <div><dt>画面</dt><dd>{approval.width} x {approval.height} · 16:9 · 0.9MP</dd></div>
      <div><dt>时长</dt><dd>{approval.durationSeconds} 秒</dd></div>
      <div><dt>工作流</dt><dd>#{approval.workflowId}</dd></div>
    </dl>
    <div className="runninghub-approval-panel__prompt"><small>完整提示词</small><p>{approval.prompt}</p></div>
    <div className="runninghub-approval-panel__warnings">
      <p>可能产生费用：最终运行与计费仅会在 RunningHub 页面内由你手动完成。</p>
      <p>预览可能带有 RunningHub 烧录水印，导入前必须经过后续水印检查。</p>
    </div>
    {error && <p className="runninghub-approval-panel__error" role="alert">交接失败：{error}</p>}
    <div className="runninghub-approval-panel__actions">
      <button className="btn-primary" data-runninghub-action="confirm" disabled={prepared || isPreparing} onClick={() => void confirm()} type="button">{isPreparing ? "正在创建交接包" : "确认并打开 RunningHub"}</button>
      <button className="btn-ghost" data-runninghub-action="continue-local" disabled={isPreparing} onClick={onContinueLocal} type="button">继续本地</button>
      <button className="btn-danger" data-runninghub-action="cancel" disabled={isPreparing} onClick={onCancel} type="button">取消</button>
    </div>
  </section>;
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}
