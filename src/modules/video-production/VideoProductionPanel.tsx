import { useEffect, useMemo, useRef, useState } from "react";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import { useStoryboardStore } from "../storyboard-core/store";
import type { Asset, Shot } from "../storyboard-core/types";
import { planVideoContinuity, type VideoBoundaryPlan } from "./continuityPlanner";
import { createControllerInputFromShot, createVideoProductionController } from "./videoProductionController";
import { MINIMAX_H3_PROFILES, preflightVideoProfile } from "./workflowProfiles";
import { routeVideoWorkflow } from "./videoRouter";
import type { VideoProfilePreflightReport, VideoRouteDecision, VideoWorkflowProfileId } from "./types";
import {
  applyVideoQualityDecision,
  createVideoQualityReport,
  planVideoRebuildRequest,
  resolvePersistedVideoDecision,
  type VideoProductionEvidence,
  type VideoProductionRow,
  type VideoQualityReport
} from "./videoQuality";

const PROFILE_IDS = MINIMAX_H3_PROFILES.map((profile) => profile.id);
const REJECTION_REASONS = [
  ["character_identity", "人物身份不一致"], ["scene_anchor", "场景锚点漂移"],
  ["costume_prop", "服装或道具不一致"], ["motion_boundary", "连续边界不流畅"],
  ["color_continuity", "色彩连续性异常"], ["other", "其他人工问题"]
] as const;

export interface VideoProductionPanelViewProps {
  rows: VideoProductionRow[];
  rejectionReasons: Record<string, string>;
  onReasonChange: (artifactKey: string, reason: string) => void;
  onManualProfileChange: (shotId: string, profileId: VideoWorkflowProfileId | "auto") => void;
  onApprove: (shotId: string) => void;
  onRejectAndRebuild: (shotId: string, reason: string) => void;
  onRetryEvidence: (shotId: string) => void;
}

export function VideoProductionPanelView(props: VideoProductionPanelViewProps) {
  return (
    <section className="video-production-panel" aria-label="视频质量门与人工首中尾帧审核">
      <header className="video-production-panel__header"><div><h3>视频生产质量门</h3><p>结构检查通过后仍需人工批准；连续边界异常最多重建相邻镜头对。</p></div></header>
      {props.rows.length === 0 ? <p className="video-production-panel__empty">当前序列没有可审核镜头。</p> : (
        <div className="video-production-panel__list">{props.rows.map((row) => {
          const reason = props.rejectionReasons[row.artifactKey] ?? "";
          const blocked = row.report.status === "rejected" && !row.report.decision;
          return <article className="video-quality-card" data-quality-status={row.report.status} key={`${row.sequenceId}:${row.shotId}`}>
            <div className="video-quality-card__title"><strong>{row.order}. {row.title}</strong><span className={`video-quality-status is-${row.report.status}`}>{statusLabel(row.report.status)}</span></div>
            <div className="video-quality-grid">
              <div><small>自动选择 Profile</small><b>{row.selectedProfileId ?? "尚未选定"}</b></div>
              <div><small>选择理由</small><b>{row.routeReason || "尚无路由理由"}</b></div>
              <label><small>手动覆盖</small><select aria-label={`${row.title} 手动覆盖 Profile`} onChange={(event) => props.onManualProfileChange(row.shotId, event.target.value as VideoWorkflowProfileId | "auto")} value={row.manualProfileId}><option value="auto">自动</option>{PROFILE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
              <div><small>模型 / 节点预检</small><b>{row.preflight ? (row.preflight.available ? "可用" : "阻断") : "未运行"}</b>{row.preflight && !row.preflight.available && <ul>{row.preflight.missingNodes.map((item) => <li key={`n:${item}`}>节点：{item}</li>)}{row.preflight.missingModels.map((item) => <li key={`m:${item.kind}:${item.name}`}>模型：{item.name}</li>)}</ul>}</div>
              <div><small>证据处理</small><b>{row.evidenceStatus ?? "pending"}</b>{row.failureReason && <span>{row.failureReason}</span>}</div>
            </div>
            <ReviewStrip label="首 / 中 / 尾帧" paths={[["首帧", row.reviewFrames.first], ["中帧", row.reviewFrames.middle], ["尾帧", row.reviewFrames.last]]} />
            <ReviewStrip label="人物脸 / 身体参考" paths={row.characterReferences.map((path, index) => [`人物 ${index + 1}`, path])} />
            <ReviewStrip label="场景参考" paths={row.sceneReferences.map((path, index) => [`场景 ${index + 1}`, path])} />
            <ReviewStrip label="连续边界帧" paths={row.boundaryFrame ? [["边界帧", row.boundaryFrame]] : []} />
            <div className="video-quality-issues"><small>结构异常</small>{row.report.structuralIssues.length ? <ul>{row.report.structuralIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <span>未发现结构异常</span>}</div>
            <div className="video-quality-actions">
              {row.evidenceStatus === "failed" && <button className="btn-ghost" onClick={() => props.onRetryEvidence(row.shotId)} type="button">重试证据处理</button>}
              <button className="btn-primary" disabled={blocked || row.evidenceStatus !== "ready"} onClick={() => props.onApprove(row.shotId)} type="button">批准</button>
              <label><span>驳回原因</span><select aria-label={`${row.title} 驳回原因`} onChange={(event) => props.onReasonChange(row.artifactKey, event.target.value)} value={reason}><option value="">请选择</option>{REJECTION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <button className="btn-danger" disabled={!reason || row.evidenceStatus !== "ready"} onClick={() => props.onRejectAndRebuild(row.shotId, reason)} type="button">驳回并局部重建</button>
            </div>
          </article>;
        })}</div>
      )}
    </section>
  );
}

export function VideoProductionPanel({ onGenerateShot }: { onGenerateShot?: (shotId: string) => Promise<boolean> }) {
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore((state) => state.shots);
  const assets = useStoryboardStore((state) => state.assets);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const updateShotFields = useStoryboardStore((state) => state.updateShotFields);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const processing = useRef(new Set<string>());
  const scopedShots = useMemo(() => shots.filter((shot) => shot.sequenceId === currentSequenceId).slice().sort((a, b) => a.order - b.order || compare(a.id, b.id)), [currentSequenceId, shots]);
  const contexts = useMemo(() => buildContexts(scopedShots, assets), [assets, scopedShots]);
  const controller = useMemo(() => createVideoProductionController({
    persistEvidence: (shotId, evidence) => updateShotFields(shotId, { videoProductionEvidence: evidence, videoQualityStatus: evidence.qualityReport?.status ?? (evidence.status === "processing" ? "checking" : "rejected") }),
    generateShot: async (shotId) => {
      const ok = onGenerateShot ? await onGenerateShot(shotId) : false;
      const generatedVideoPath = useStoryboardStore.getState().shots.find((shot) => shot.id === shotId)?.generatedVideoPath;
      return { ok, generatedVideoPath };
    }
  }), [onGenerateShot, updateShotFields]);
  const rows = useMemo(() => buildRows(scopedShots, assets, contexts), [assets, contexts, scopedShots]);

  const processShot = async (shotId: string) => {
    if (processing.current.has(shotId)) return;
    const shot = useStoryboardStore.getState().shots.find((item) => item.id === shotId);
    const context = contexts.get(shotId);
    if (!shot?.generatedVideoPath || !context) return;
    processing.current.add(shotId);
    try { await controller.processGeneratedShot(createControllerInputFromShot({ shot, project, ...context })); }
    catch { /* failed evidence is persisted by the controller */ }
    finally { processing.current.delete(shotId); }
  };

  useEffect(() => {
    for (const shot of scopedShots) {
      const evidence = shot.videoProductionEvidence;
      if (shot.generatedVideoPath?.trim() && (!evidence || evidence.sourceVideoPath !== shot.generatedVideoPath || evidence.status === "pending")) void processShot(shot.id);
    }
  }, [scopedShots, contexts]);

  useEffect(() => {
    const active = new Set(rows.map((row) => row.artifactKey));
    setReasons((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => active.has(key))));
  }, [currentSequenceId, rows.map((row) => row.artifactKey).join("|")]);

  return <VideoProductionPanelView
    rows={rows} rejectionReasons={reasons}
    onReasonChange={(key, reason) => setReasons((previous) => ({ ...previous, [key]: reason }))}
    onManualProfileChange={(shotId, profileId) => updateShotFields(shotId, { videoWorkflowProfileId: profileId })}
    onRetryEvidence={(shotId) => void processShot(shotId)}
    onApprove={(shotId) => void (async () => {
      const shot = useStoryboardStore.getState().shots.find((item) => item.id === shotId);
      if (!shot?.videoProductionEvidence) return;
      const fresh = await controller.verifyForDecision(shot.videoProductionEvidence);
      const decided = applyVideoQualityDecision(fresh, { decision: "approve" });
      updateShotFields(shotId, { videoProductionEvidence: { ...shot.videoProductionEvidence, qualityReport: decided, decision: decided.decision }, videoQualityStatus: decided.status });
    })()}
    onRejectAndRebuild={(shotId, reason) => void (async () => {
      const state = useStoryboardStore.getState();
      const shot = state.shots.find((item) => item.id === shotId);
      const row = rows.find((item) => item.shotId === shotId);
      if (!shot?.videoProductionEvidence || !row) return;
      const fresh = await controller.verifyForDecision(shot.videoProductionEvidence);
      const decided = applyVideoQualityDecision(fresh, { decision: "reject", reason });
      updateShotFields(shotId, { videoProductionEvidence: { ...shot.videoProductionEvidence, qualityReport: decided, decision: decided.decision }, videoQualityStatus: "rejected" });
      setReasons((previous) => { const next = { ...previous }; delete next[row.artifactKey]; return next; });
      const request = planVideoRebuildRequest({ shotId, orderedShotIds: scopedShots.map((item) => item.id), reason, boundary: row.boundary });
      await controller.rebuild(request, async (targetId, generatedVideoPath) => {
        const latest = useStoryboardStore.getState().shots.find((item) => item.id === targetId);
        const context = contexts.get(targetId);
        if (!latest || !context) throw new Error("video_rebuild_context_missing");
        return createControllerInputFromShot({ shot: { ...latest, generatedVideoPath }, project, ...context });
      });
    })()}
  />;
}

function buildContexts(shots: Shot[], assets: Asset[]) {
  const boundaries = shots.slice(0, -1).map((shot, index) => ({
    fromShotId: shot.id, toShotId: shots[index + 1].id, kind: shot.videoBoundaryKind ?? "hard_cut",
    sharedFramePath: shot.approvedBoundaryFramePath,
    sharedFrameSource: shot.approvedBoundaryFramePath ? "independent" as const : undefined,
    approvalStatus: shot.approvedBoundaryFramePath ? "approved" as const : "pending" as const
  }));
  const plan = planVideoContinuity({ shots: shots.map((shot) => ({ id: shot.id, order: shot.order, videoBoundaryKind: shot.videoBoundaryKind, approvedTailFramePath: shot.approvedBoundaryFramePath, tailFrameApprovalStatus: shot.approvedBoundaryFramePath ? "approved" : "pending" })), boundaries });
  return new Map(shots.map((shot) => {
    const routeDecision = routeForShot(shot, assets);
    const profilePreflight = preflightForRoute(shot, routeDecision);
    const boundary = plan.boundaries.find((item) => item.fromShotId === shot.id);
    return [shot.id, { routeDecision, profilePreflight, boundary }] as const;
  }));
}

function routeForShot(shot: Shot, assets: Asset[]): VideoRouteDecision {
  const refs = (shot.characterRefs ?? []).filter((id) => assets.some((asset) => asset.id === id));
  return routeVideoWorkflow({
    manualProfileId: shot.videoWorkflowProfileId ?? "auto", qualityTier: shot.videoQualityTier ?? "production",
    accelerationMode: shot.videoAccelerationMode ?? "standard", availableProfileIds: PROFILE_IDS,
    namedCharacterCount: Math.max(refs.length, shot.sourceCharacterNames?.length ?? 0), identityReferenceCount: refs.length,
    extraReferenceCount: shot.sceneRefId ? 1 : 0, hasSceneContinuity: Boolean(shot.sceneRefId),
    hasStoryboardFrame: Boolean(shot.generatedImagePath), hasFirstFrame: Boolean(shot.videoStartFramePath || shot.generatedImagePath),
    hasLastFrame: Boolean(shot.videoEndFramePath), hasApprovedBoundaryFrame: Boolean(shot.approvedBoundaryFramePath),
    hasDialogue: Boolean(shot.dialogue.trim()), boundaryKind: shot.videoBoundaryKind ?? "hard_cut"
  });
}

function preflightForRoute(shot: Shot, route: VideoRouteDecision): VideoProfilePreflightReport {
  if (route.status === "blocked") return { profileId: route.profileId ?? "minimax_h3_t2v", available: false, missingNodes: [], missingModels: [], warnings: [route.reason] };
  const profile = MINIMAX_H3_PROFILES.find((item) => item.id === route.profileId)!;
  if (shot.videoGenerationReceipt?.profileId === route.profileId) return { profileId: route.profileId, available: true, missingNodes: [], missingModels: [], warnings: ["generation_execution_attested"] };
  return preflightVideoProfile(profile, { nodes: [], models: {} });
}

function buildRows(shots: Shot[], assets: Asset[], contexts: Map<string, { routeDecision: VideoRouteDecision; profilePreflight: VideoProfilePreflightReport; boundary?: VideoBoundaryPlan }>): VideoProductionRow[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  return shots.map((shot) => {
    const context = contexts.get(shot.id)!;
    const evidence = shot.videoProductionEvidence;
    let report: VideoQualityReport;
    if (evidence?.status === "ready" && evidence.normalizationCredential && evidence.inspection && evidence.reviewFrames) {
      const fresh = createVideoQualityReport(shot.id, { normalized: true, normalizationCredential: evidence.normalizationCredential, inspection: evidence.inspection, reviewFrames: evidence.reviewFrames, assemblyReceipt: evidence.assemblyReceipt, boundaryFrame: context.boundary?.sharedFramePath });
      report = resolvePersistedVideoDecision(fresh, evidence.decision);
    } else report = { shotId: shot.id, status: "rejected", structuralIssues: [evidence?.failureReason || "video_production_evidence_missing"], semanticReviewItems: ["character_identity", "scene_anchor", "costume_prop", "motion_boundary", "color_continuity"], reviewFrames: { first: "", middle: "", last: "" } };
    const characters = (shot.characterRefs ?? []).flatMap((id) => { const asset = assetById.get(id); return asset ? unique([asset.characterIdentityPack?.faceMasterPath, asset.characterIdentityPack?.bodyFrontPath, asset.characterFaceRefPath, asset.characterFrontPath, asset.filePath]).slice(0, 2) : []; });
    const scene = shot.sceneRefId ? assetById.get(shot.sceneRefId) : undefined;
    const artifactKey = `${shot.sequenceId}:${shot.id}:${report.artifactBinding?.receiptId ?? "none"}:${report.artifactBinding?.sha256 ?? shot.generatedVideoPath ?? "none"}`;
    return { sequenceId: shot.sequenceId, shotId: shot.id, title: shot.title, order: shot.order, selectedProfileId: context.routeDecision.status === "selected" ? context.routeDecision.profileId : undefined, routeReason: context.routeDecision.reason, manualProfileId: shot.videoWorkflowProfileId ?? "auto", preflight: context.profilePreflight, reviewFrames: report.reviewFrames, characterReferences: characters, sceneReferences: scene ? unique([scene.filePath, ...Object.values(scene.skyboxFaces ?? {})]) : [], boundaryFrame: context.boundary?.sharedFramePath, boundary: context.boundary, artifactKey, report, evidenceStatus: evidence?.status ?? "pending", failureReason: evidence?.failureReason };
  });
}

function ReviewStrip({ label, paths }: { label: string; paths: Array<[string, string]> }) { return <div className="video-review-strip"><small>{label}</small><div className="video-review-strip__images">{paths.length ? paths.map(([name, path]) => <figure key={`${name}:${path}`}>{path ? <img alt={name} loading="lazy" src={toDesktopMediaSource(path)} /> : <div className="video-review-strip__missing">缺失</div>}<figcaption>{name}{path ? ` · ${path.replace(/\\/g, "/").split("/").pop()}` : ""}</figcaption></figure>) : <span className="video-review-strip__none">未提供</span>}</div></div>; }
function unique(values: Array<string | undefined>) { return [...new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))]; }
function statusLabel(status: VideoQualityReport["status"]) { return status === "approved" ? "已批准" : status === "needs_review" ? "待人工审核" : "已拒绝"; }
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
