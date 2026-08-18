import { useMemo, useState } from "react";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import { useStoryboardStore } from "../storyboard-core/store";
import type { Asset, Shot } from "../storyboard-core/types";
import type { VideoInspection, VideoReviewFrames } from "../platform/desktopBridge";
import type { VideoWorkflowProfileId } from "./types";
import {
  applyVideoQualityDecision,
  createVideoQualityReport,
  planVideoRebuildRequest,
  type VideoProductionRow,
  type VideoQualityReport,
  type VideoRebuildRequest
} from "./videoQuality";

const PROFILE_IDS: VideoWorkflowProfileId[] = [
  "minimax_h3_t2v",
  "minimax_h3_i2v",
  "minimax_h3_flf2v",
  "minimax_h3_r2v"
];

const REJECTION_REASONS = [
  ["character_identity", "人物身份不一致"],
  ["scene_anchor", "场景锚点漂移"],
  ["costume_prop", "服装或道具不一致"],
  ["motion_boundary", "连续边界不流畅"],
  ["color_continuity", "色彩连续性异常"],
  ["other", "其他人工问题"]
] as const;

export interface VideoProductionPanelViewProps {
  rows: VideoProductionRow[];
  onManualProfileChange: (shotId: string, profileId: VideoWorkflowProfileId | "auto") => void;
  onApprove: (shotId: string) => void;
  onRejectAndRebuild: (shotId: string, reason: string) => void;
}

export function VideoProductionPanelView({
  rows,
  onManualProfileChange,
  onApprove,
  onRejectAndRebuild
}: VideoProductionPanelViewProps) {
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

  return (
    <section className="video-production-panel" aria-label="视频质量门与人工首中尾帧审核">
      <header className="video-production-panel__header">
        <div>
          <h3>视频生产质量门</h3>
          <p>结构检查通过后仍需人工批准；驳回只重建当前镜头，连续边界异常最多重建相邻镜头对。</p>
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="video-production-panel__empty">当前序列没有可审核镜头。</p>
      ) : (
        <div className="video-production-panel__list">
          {rows.map((row) => {
            const rejectReason = rejectionReasons[row.shotId] ?? "";
            const structurallyBlocked = row.report.status === "rejected" || row.report.structuralIssues.length > 0;
            return (
              <article className="video-quality-card" data-quality-status={row.report.status} key={row.shotId}>
                <div className="video-quality-card__title">
                  <strong>{row.order}. {row.title}</strong>
                  <span className={`video-quality-status is-${row.report.status}`}>{qualityStatusLabel(row.report.status)}</span>
                </div>

                <div className="video-quality-grid">
                  <div><small>自动选择 Profile</small><b>{row.selectedProfileId ?? "尚未选定"}</b></div>
                  <div><small>选择理由</small><b>{row.routeReason || "尚无路由理由"}</b></div>
                  <label>
                    <small>手动覆盖</small>
                    <select
                      aria-label={`${row.title} 手动覆盖 Profile`}
                      onChange={(event) => onManualProfileChange(row.shotId, event.target.value as VideoWorkflowProfileId | "auto")}
                      value={row.manualProfileId}
                    >
                      <option value="auto">自动</option>
                      {PROFILE_IDS.map((profileId) => <option key={profileId} value={profileId}>{profileId}</option>)}
                    </select>
                  </label>
                  <div>
                    <small>模型 / 节点预检</small>
                    <b>{row.preflight ? (row.preflight.available ? "可用" : "阻断") : "未运行"}</b>
                    {row.preflight && !row.preflight.available && (
                      <ul>
                        {row.preflight.missingNodes.map((item) => <li key={`node:${item}`}>节点：{item}</li>)}
                        {row.preflight.missingModels.map((item) => {
                          const label = typeof item === "string" ? item : item.name;
                          return <li key={`model:${label}`}>模型：{label}</li>;
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                <ReviewImageStrip label="首 / 中 / 尾帧" paths={[
                  ["首帧", row.reviewFrames.first],
                  ["中帧", row.reviewFrames.middle],
                  ["尾帧", row.reviewFrames.last]
                ]} />
                <ReviewImageStrip label="人物脸 / 身体参考" paths={row.characterReferences.map((path, index) => [`人物 ${index + 1}`, path])} />
                <ReviewImageStrip label="场景参考" paths={row.sceneReferences.map((path, index) => [`场景 ${index + 1}`, path])} />
                <ReviewImageStrip label="连续边界帧" paths={row.boundaryFrame ? [["边界帧", row.boundaryFrame]] : []} />

                <div className="video-quality-issues">
                  <small>结构异常</small>
                  {row.report.structuralIssues.length > 0 ? (
                    <ul>{row.report.structuralIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                  ) : <span>未发现结构异常</span>}
                </div>

                <div className="video-quality-actions">
                  <button
                    className="btn-primary"
                    disabled={structurallyBlocked}
                    onClick={() => onApprove(row.shotId)}
                    type="button"
                  >批准</button>
                  <label>
                    <span>驳回原因</span>
                    <select
                      aria-label={`${row.title} 驳回原因`}
                      onChange={(event) => setRejectionReasons((previous) => ({ ...previous, [row.shotId]: event.target.value }))}
                      value={rejectReason}
                    >
                      <option value="">请选择</option>
                      {REJECTION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <button
                    className="btn-danger"
                    disabled={!rejectReason}
                    onClick={() => onRejectAndRebuild(row.shotId, rejectReason)}
                    type="button"
                  >驳回并局部重建</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function VideoProductionPanel() {
  const shots = useStoryboardStore((state) => state.shots);
  const assets = useStoryboardStore((state) => state.assets);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const updateShotFields = useStoryboardStore((state) => state.updateShotFields);
  const scopedShots = useMemo(
    () => shots.filter((shot) => shot.sequenceId === currentSequenceId).slice().sort((left, right) => left.order - right.order || compareText(left.id, right.id)),
    [currentSequenceId, shots]
  );
  const rows = useMemo(() => buildProductionRows(scopedShots, assets), [assets, scopedShots]);

  const emitReview = (name: string, detail: unknown) => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
  };

  return (
    <VideoProductionPanelView
      rows={rows}
      onApprove={(shotId) => {
        const row = rows.find((item) => item.shotId === shotId);
        if (!row) return;
        const report = applyVideoQualityDecision(row.report, { decision: "approve" });
        updateShotFields(shotId, { videoQualityStatus: report.status });
        emitReview("storyboard:video-quality-decision", report);
      }}
      onManualProfileChange={(shotId, profileId) => updateShotFields(shotId, { videoWorkflowProfileId: profileId })}
      onRejectAndRebuild={(shotId, reason) => {
        const row = rows.find((item) => item.shotId === shotId);
        if (!row) return;
        const report = applyVideoQualityDecision(row.report, { decision: "reject", reason });
        const request = planVideoRebuildRequest({
          shotId,
          orderedShotIds: scopedShots.map((shot) => shot.id),
          reason,
          boundary: row.boundary
        });
        updateShotFields(shotId, { videoQualityStatus: "rejected" });
        emitReview("storyboard:video-quality-decision", report);
        emitReview("storyboard:video-rebuild-request", request satisfies VideoRebuildRequest);
      }}
    />
  );
}

function ReviewImageStrip({ label, paths }: { label: string; paths: Array<[string, string]> }) {
  return (
    <div className="video-review-strip">
      <small>{label}</small>
      <div className="video-review-strip__images">
        {paths.length > 0 ? paths.map(([name, path]) => (
          <figure key={`${name}:${path}`}>
            {path ? <img alt={name} loading="lazy" src={toDesktopMediaSource(path)} /> : <div className="video-review-strip__missing">缺失</div>}
            <figcaption>{name}{path ? ` · ${fileLabel(path)}` : ""}</figcaption>
          </figure>
        )) : <span className="video-review-strip__none">未提供</span>}
      </div>
    </div>
  );
}

function buildProductionRows(shots: Shot[], assets: Asset[]): VideoProductionRow[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  return shots.map((shot, index) => {
    const extended = shot as Shot & {
      videoInspection?: VideoInspection;
      videoReviewFrames?: VideoReviewFrames;
      videoNormalizationCredential?: Record<string, unknown>;
      videoAssemblyReceipt?: Record<string, unknown>;
      videoQualityReport?: VideoQualityReport;
      videoProfilePreflight?: VideoProductionRow["preflight"];
    };
    const next = shots[index + 1];
    const characterReferences = (shot.characterRefs ?? []).flatMap((assetId) => {
      const asset = assetById.get(assetId);
      if (!asset) return [];
      return uniquePaths([
        asset.characterIdentityPack?.faceMasterPath,
        asset.characterIdentityPack?.bodyFrontPath,
        asset.characterFaceRefPath,
        asset.characterFrontPath,
        asset.filePath
      ]).slice(0, 2);
    });
    const scene = shot.sceneRefId ? assetById.get(shot.sceneRefId) : undefined;
    const sceneReferences = scene ? uniquePaths([scene.filePath, ...Object.values(scene.skyboxFaces ?? {})]) : [];
    const boundaryKind = shot.videoBoundaryKind ?? "hard_cut";
    const boundary = next ? { kind: boundaryKind, fromShotId: shot.id, toShotId: next.id } : undefined;
    const boundaryFrame = shot.approvedBoundaryFramePath ?? next?.approvedBoundaryFramePath;
    const report = extended.videoQualityReport ?? createVideoQualityReport(shot.id, {
      normalized: Boolean(extended.videoNormalizationCredential),
      inspection: extended.videoInspection,
      normalizationReceipt: extended.videoNormalizationCredential,
      assemblyReceipt: extended.videoAssemblyReceipt,
      reviewFrames: extended.videoReviewFrames,
      boundaryFrame
    });
    return {
      shotId: shot.id,
      title: shot.title,
      order: shot.order,
      selectedProfileId: shot.videoGenerationReceipt?.profileId ?? (shot.videoWorkflowProfileId !== "auto" ? shot.videoWorkflowProfileId : undefined),
      routeReason: shot.videoRouteReason ?? "",
      manualProfileId: shot.videoWorkflowProfileId ?? "auto",
      preflight: extended.videoProfilePreflight,
      reviewFrames: report.reviewFrames,
      characterReferences: uniquePaths(characterReferences),
      sceneReferences,
      boundaryFrame,
      boundary,
      report
    };
  });
}

function uniquePaths(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const path = value?.trim() ?? "";
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (!path || seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function qualityStatusLabel(status: VideoQualityReport["status"]) {
  return status === "approved" ? "已批准" : status === "needs_review" ? "待人工审核" : "已拒绝";
}

function fileLabel(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
