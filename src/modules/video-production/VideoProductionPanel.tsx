import { useEffect, useMemo, useRef, useState } from "react";
import type { ComfySettings } from "../comfy-pipeline/comfyService";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import { useStoryboardStore } from "../storyboard-core/store";
import type { Asset, Shot } from "../storyboard-core/types";
import { planVideoContinuity, type VideoBoundaryPlan } from "./continuityPlanner";
import { createControllerInputFromShot, createVideoProductionController } from "./videoProductionController";
import { MINIMAX_H3_PROFILES, preflightVideoProfile } from "./workflowProfiles";
import { routeVideoWorkflow } from "./videoRouter";
import { createRoutedVideoProductionGenerator } from "./videoRoutedGeneration";
import { registerVideoProductionGateway } from "./videoProductionEntry";
export { generateQualityGatedVideoBatch, generateQualityGatedVideoShot, registerVideoProductionGateway } from "./videoProductionEntry";
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

export const videoProductionStoreHarness = useStoryboardStore;

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

export interface VideoProductionPanelServices {
  routedGenerator?: ReturnType<typeof createRoutedVideoProductionGenerator>;
  controllerFactory?: typeof createVideoProductionController;
}

export function VideoProductionPanel({ settings, services }: { settings: ComfySettings; services?: VideoProductionPanelServices }) {
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore((state) => state.shots);
  const assets = useStoryboardStore((state) => state.assets);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const updateShotFields = useStoryboardStore((state) => state.updateShotFields);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const processing = useRef(new Set<string>());
  const stagedOperations = useRef(new Map<string, StagedOperation>());
  const attemptEpochs = useRef(new Map<string, ProcessingAttempt>());
  const rebuildGuards = useRef(new Map<string, VideoProductionEvidence["operation"]>());
  const settingsIdentity = videoProcessingSettingsIdentity(settings);
  const lastComfySettingsIdentity = useRef(settingsIdentity);
  const scopedShots = useMemo(() => shots.filter((shot) => shot.sequenceId === currentSequenceId).slice().sort((a, b) => a.order - b.order || compare(a.id, b.id)), [currentSequenceId, shots]);
  const contexts = useMemo(() => buildContexts(scopedShots, assets), [assets, scopedShots]);
  const routedGenerator = useMemo(() => services?.routedGenerator ?? createRoutedVideoProductionGenerator({
    settings,
    readSnapshot: (shotId) => {
      const state = useStoryboardStore.getState();
      const allShots = state.shots.filter((item) => item.sequenceId === state.currentSequenceId).slice().sort((a, b) => a.order - b.order || compare(a.id, b.id));
      const shot = allShots.find((item) => item.id === shotId);
      if (!shot) throw new Error("video_generation_shot_missing");
      const context = buildContexts(allShots, state.assets).get(shotId);
      return { sequenceId: state.currentSequenceId, shot, index: allShots.indexOf(shot), allShots, assets: state.assets, project: state.project, incomingBoundary: context?.incomingBoundary, outgoingBoundary: context?.outgoingBoundary };
    }
  }), [services?.routedGenerator, settings]);
  const controller = useMemo(() => (services?.controllerFactory ?? createVideoProductionController)({
    persistEvidence: (shotId, evidence) => updateShotFields(shotId, { videoProductionEvidence: evidence, videoQualityStatus: evidence.qualityReport?.status ?? (evidence.status === "processing" ? "checking" : "rejected") }),
    generateShot: async (shotId, rebuildOptions) => {
      const generated = await routedGenerator.generate(shotId, { previousEvidence: rebuildOptions?.previousEvidence });
      stagedOperations.current.set(shotId, { sequenceId: generated.request.shot.sequenceId, path: generated.generatedVideoPath, digest: generated.generationContractDigest, token: generated.request.operationToken, settingsIdentity: generated.request.settings?.baseUrl });
      if ((rebuildOptions?.request?.shotIds.length ?? 1) === 1) {
        updateShotFields(shotId, { generatedVideoPath: generated.generatedVideoPath, videoGenerationReceipt: generated.videoGenerationReceipt, videoGenerationContractDigest: generated.generationContractDigest });
      }
      return generated;
    },
    isOperationCurrent: (operation: any) => operationMatchesCurrent(operation, stagedOperations.current),
    persistEvidenceCAS: (operation: any, evidence) => persistEvidenceCAS(operation, evidence, stagedOperations.current),
    persistBatchCAS: (items: any[]) => persistEvidenceBatchCAS(items, stagedOperations.current)
  }), [routedGenerator, services?.controllerFactory, updateShotFields]);
  const rows = useMemo(() => buildRows(scopedShots, assets, contexts), [assets, contexts, scopedShots]);

  const executeGeneration = async (shotIds: string[], reason: string) => {
    const request = { kind: shotIds.length > 1 ? "batch" as const : "shot" as const, shotIds, reason };
    const before = useStoryboardStore.getState().shots;
    shotIds.forEach((id) => rebuildGuards.current.set(id, before.find((shot) => shot.id === id)?.videoProductionEvidence?.operation));
    try {
      await controller.rebuild(request, async (targetId, generatedVideoPath, _previousEvidence, generated) => {
        const latest = useStoryboardStore.getState().shots.find((item) => item.id === targetId);
        const details = generated as any;
        if (!latest || !details?.routeDecision || !details?.profilePreflight || !details?.videoGenerationReceipt) throw new Error("video_rebuild_context_missing");
    const operation = { sequenceId: latest.sequenceId, shotId: targetId, contractDigest: details.generationContractDigest, sourceVideoPath: generatedVideoPath, boundaryIdentity: boundaryIdentity(details.request?.outgoingBoundary), operationToken: details.request?.operationToken, settingsIdentity: details.request?.settings?.baseUrl };
        return { ...createControllerInputFromShot({ shot: { ...latest, generatedVideoPath, videoGenerationReceipt: details.videoGenerationReceipt }, project: useStoryboardStore.getState().project, routeDecision: details.routeDecision, profilePreflight: details.profilePreflight, boundary: details.request?.outgoingBoundary, operation, generationReceipt: details.videoGenerationReceipt }), contractDigest: details.generationContractDigest };
      });
      return true;
    } catch (error) {
      persistRebuildFailureCAS(shotIds, stagedOperations.current, rebuildGuards.current, error);
      return false;
    } finally {
      shotIds.forEach((id) => { stagedOperations.current.delete(id); rebuildGuards.current.delete(id); });
    }
  };

  useEffect(() => registerVideoProductionGateway({
    generateShot: (shotId) => executeGeneration([shotId], "manual_generation"),
    generateBatch: (shotIds) => executeGeneration(shotIds, "bulk_generation")
  }), [controller, currentSequenceId]);

  const processShot = async (shotId: string) => {
    const shot = useStoryboardStore.getState().shots.find((item) => item.id === shotId);
    if (!shot?.generatedVideoPath) return;
    const attemptKey = `${shot.sequenceId}:${shotId}`;
    const processingKey = `${attemptKey}:${settingsIdentity}:${shot.videoGenerationContractDigest ?? "unprepared"}:${shot.videoGenerationReceipt?.operationToken ?? "legacy"}`;
    if (processing.current.has(processingKey)) return;
    processing.current.add(processingKey);
    const preparationOperation: StagedOperation = {
      sequenceId: shot.sequenceId, path: shot.generatedVideoPath,
      digest: shot.videoGenerationContractDigest ?? "0".repeat(64),
      token: shot.videoGenerationReceipt?.operationToken ?? globalThis.crypto.randomUUID(), settingsIdentity: settings.baseUrl
    };
    const attempt: ProcessingAttempt = {
      epoch: (attemptEpochs.current.get(attemptKey)?.epoch ?? 0) + 1,
      operationToken: preparationOperation.token,
      settingsIdentity
    };
    attemptEpochs.current.set(attemptKey, attempt);
    const attemptIsCurrent = () => {
      const current = attemptEpochs.current.get(attemptKey);
      return current?.epoch === attempt.epoch && current.operationToken === attempt.operationToken && current.settingsIdentity === attempt.settingsIdentity;
    };
    stagedOperations.current.set(shotId, preparationOperation);
    try {
      if (!attemptIsCurrent()) return;
      const prepared = await routedGenerator.prepare(shotId, { operationToken: preparationOperation.token });
      if (!attemptIsCurrent()) return;
      routedGenerator.verifyReceipt(shot.videoGenerationReceipt, prepared, shot.generatedVideoPath);
      if (!attemptIsCurrent()) return;
      stagedOperations.current.set(shotId, { sequenceId: shot.sequenceId, path: shot.generatedVideoPath, digest: prepared.generationContractDigest, token: prepared.request.operationToken, settingsIdentity: settings.baseUrl });
      if (!attemptIsCurrent()) return;
      await controller.processGeneratedShot({ ...createControllerInputFromShot({ shot, project, routeDecision: prepared.routeDecision, profilePreflight: prepared.profilePreflight, boundary: prepared.request.outgoingBoundary }), contractDigest: prepared.generationContractDigest, generationReceipt: shot.videoGenerationReceipt, operation: { sequenceId: shot.sequenceId, shotId, contractDigest: prepared.generationContractDigest, sourceVideoPath: shot.generatedVideoPath, boundaryIdentity: boundaryIdentity(prepared.request.outgoingBoundary), operationToken: prepared.request.operationToken, settingsIdentity: settings.baseUrl } });
      if (!attemptIsCurrent()) return;
    }
    catch (error) {
      if (!attemptIsCurrent()) return;
      const latest = useStoryboardStore.getState().shots.find((item) => item.id === shotId);
      if (latest?.videoProductionEvidence?.status !== "failed") persistPreparationFailureCAS(shot, contexts.get(shotId), preparationOperation, stagedOperations.current, error);
    }
    finally {
      processing.current.delete(processingKey);
      const active = stagedOperations.current.get(shotId);
      if (active?.token === preparationOperation.token && active.settingsIdentity === preparationOperation.settingsIdentity) stagedOperations.current.delete(shotId);
    }
  };

  useEffect(() => {
    for (const shot of scopedShots) {
      const evidence = shot.videoProductionEvidence;
      if (shot.generatedVideoPath?.trim() && (!evidence || evidence.sourceVideoPath !== shot.generatedVideoPath || evidence.contractDigest !== shot.videoGenerationContractDigest || evidence.status === "pending")) void processShot(shot.id);
    }
  }, [scopedShots, contexts]);

  useEffect(() => {
    const settingsChanged = lastComfySettingsIdentity.current !== settingsIdentity;
    lastComfySettingsIdentity.current = settingsIdentity;
    for (const shot of useStoryboardStore.getState().shots) {
      if (shot.sequenceId === useStoryboardStore.getState().currentSequenceId && shot.generatedVideoPath?.trim() && (settingsChanged || shot.videoProductionEvidence?.status === "failed")) void processShot(shot.id);
    }
  }, [settingsIdentity]);

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
      const captured = shot.videoProductionEvidence;
      try {
        const fresh = await controller.verifyForDecision(captured);
        const decided = applyVideoQualityDecision(fresh, { decision: "approve" });
        persistDecisionCAS(shotId, captured, decided);
      } catch (error) { persistDecisionFailureCAS(captured, error); }
    })()}
    onRejectAndRebuild={(shotId, reason) => void (async () => {
      const state = useStoryboardStore.getState();
      const shot = state.shots.find((item) => item.id === shotId);
      const row = rows.find((item) => item.shotId === shotId);
      if (!shot?.videoProductionEvidence || !row) return;
      const captured = shot.videoProductionEvidence;
      let fresh: VideoQualityReport;
      try { fresh = await controller.verifyForDecision(captured); }
      catch (error) { persistDecisionFailureCAS(captured, error); return; }
      const decided = applyVideoQualityDecision(fresh, { decision: "reject", reason });
      if (!persistDecisionCAS(shotId, captured, decided)) return;
      setReasons((previous) => { const next = { ...previous }; delete next[row.artifactKey]; return next; });
      const request = planVideoRebuildRequest({ shotId, orderedShotIds: scopedShots.map((item) => item.id), reason, boundary: row.boundary });
      request.shotIds.forEach((id) => rebuildGuards.current.set(id, useStoryboardStore.getState().shots.find((item) => item.id === id)?.videoProductionEvidence?.operation));
      await controller.rebuild(request, async (targetId, generatedVideoPath, _previousEvidence, generated) => {
        const latest = useStoryboardStore.getState().shots.find((item) => item.id === targetId);
        const details = generated as any;
        if (!latest || !details?.routeDecision || !details?.profilePreflight) throw new Error("video_rebuild_context_missing");
        const operation = { sequenceId: latest.sequenceId, shotId: targetId, contractDigest: details.generationContractDigest, sourceVideoPath: generatedVideoPath, boundaryIdentity: boundaryIdentity(details.request?.outgoingBoundary), operationToken: details.request?.operationToken, settingsIdentity: details.request?.settings?.baseUrl };
        return { ...createControllerInputFromShot({ shot: { ...latest, generatedVideoPath, videoGenerationReceipt: details.videoGenerationReceipt }, project: useStoryboardStore.getState().project, routeDecision: details.routeDecision, profilePreflight: details.profilePreflight, boundary: details.request?.outgoingBoundary, operation, generationReceipt: details.videoGenerationReceipt }), contractDigest: details.generationContractDigest };
      });
      request.shotIds.forEach((id) => { stagedOperations.current.delete(id); rebuildGuards.current.delete(id); });
    })().catch((error) => {
      const failedRow = rows.find((item) => item.shotId === shotId);
      const failedRequest = planVideoRebuildRequest({ shotId, orderedShotIds: scopedShots.map((item) => item.id), reason, boundary: failedRow?.boundary });
      persistRebuildFailureCAS(failedRequest.shotIds, stagedOperations.current, rebuildGuards.current, error);
      failedRequest.shotIds.forEach((id) => { stagedOperations.current.delete(id); rebuildGuards.current.delete(id); });
    })}
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
    const routeDecision = shot.videoProductionEvidence?.routeDecision ?? routeForShot(shot, assets);
    const profilePreflight = shot.videoProductionEvidence?.profilePreflight ?? preflightForRoute(shot, routeDecision);
    const incomingBoundary = plan.boundaries.find((item) => item.toShotId === shot.id);
    const outgoingBoundary = plan.boundaries.find((item) => item.fromShotId === shot.id);
    return [shot.id, { routeDecision, profilePreflight, incomingBoundary, outgoingBoundary, boundary: outgoingBoundary }] as const;
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
      const fresh = createVideoQualityReport(shot.id, { normalized: true, normalizationCredential: evidence.normalizationCredential, inspection: evidence.inspection, reviewFrames: evidence.reviewFrames, reviewRecord: evidence.reviewRecord, assemblyReceipt: evidence.assemblyReceipt, boundaryFrame: context.boundary?.sharedFramePath });
      report = resolvePersistedVideoDecision(fresh, evidence.decision);
    } else report = { shotId: shot.id, status: "rejected", structuralIssues: [evidence?.failureReason || "video_production_evidence_missing"], semanticReviewItems: ["character_identity", "scene_anchor", "costume_prop", "motion_boundary", "color_continuity"], reviewFrames: { first: "", middle: "", last: "" } };
    const characters = (shot.characterRefs ?? []).flatMap((id) => { const asset = assetById.get(id); return asset ? unique([asset.characterIdentityPack?.faceMasterPath, asset.characterIdentityPack?.bodyFrontPath, asset.characterFaceRefPath, asset.characterFrontPath, asset.filePath]).slice(0, 2) : []; });
    const scene = shot.sceneRefId ? assetById.get(shot.sceneRefId) : undefined;
    const artifactKey = `${shot.sequenceId}:${shot.id}:${report.artifactBinding?.receiptId ?? "none"}:${report.artifactBinding?.sha256 ?? shot.generatedVideoPath ?? "none"}`;
    return { sequenceId: shot.sequenceId, shotId: shot.id, title: shot.title, order: shot.order, selectedProfileId: context.routeDecision.status === "selected" ? context.routeDecision.profileId : undefined, routeReason: context.routeDecision.reason, manualProfileId: shot.videoWorkflowProfileId ?? "auto", preflight: context.profilePreflight, reviewFrames: report.reviewFrames, characterReferences: characters, sceneReferences: scene ? unique([scene.filePath, ...Object.values(scene.skyboxFaces ?? {})]) : [], boundaryFrame: context.boundary?.sharedFramePath, boundary: context.boundary, artifactKey, report, evidenceStatus: evidence?.status ?? "pending", failureReason: evidence?.failureReason };
  });
}

function ReviewStrip({ label, paths }: { label: string; paths: Array<[string, string]> }) { return <div className="video-review-strip"><small>{label}</small><div className="video-review-strip__images">{paths.length ? paths.map(([name, path]) => <figure key={`${name}:${path}`}>{path ? <img alt={name} loading="lazy" src={toDesktopMediaSource(path)} /> : <div className="video-review-strip__missing">缺失</div>}<figcaption>{name}{path ? ` · ${path.replace(/\\/g, "/").split("/").pop()}` : ""}</figcaption></figure>) : <span className="video-review-strip__none">未提供</span>}</div></div>; }
type StagedOperation = { sequenceId: string; path: string; digest: string; token: string; settingsIdentity?: string };
type ProcessingAttempt = { epoch: number; operationToken: string; settingsIdentity: string };

function videoProcessingSettingsIdentity(settings: ComfySettings) {
  return JSON.stringify(stableSettingsValue(settings));
}

function stableSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSettingsValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stableSettingsValue(child)]));
  }
  return value;
}
function operationMatchesCurrent(operation: any, staged: Map<string, StagedOperation>) {
  const state = useStoryboardStore.getState();
  const shot = state.shots.find((item) => item.id === operation?.shotId);
  if (!shot || shot.sequenceId !== operation?.sequenceId || state.currentSequenceId !== operation.sequenceId) return false;
  const active = staged.get(shot.id);
  return active
    ? active.sequenceId === operation.sequenceId && active.path === operation.sourceVideoPath && active.digest === operation.contractDigest && active.token === operation.operationToken && active.settingsIdentity === operation.settingsIdentity
    : shot.generatedVideoPath === operation.sourceVideoPath && shot.videoGenerationContractDigest === operation.contractDigest && shot.videoGenerationReceipt?.operationToken === operation.operationToken && shot.videoProductionEvidence?.operation?.settingsIdentity === operation.settingsIdentity;
}
function persistEvidenceCAS(operation: any, evidence: VideoProductionEvidence, staged: Map<string, StagedOperation>) {
  if (!operationMatchesCurrent(operation, staged)) return false;
  let persisted = false;
  useStoryboardStore.setState((state) => ({ shots: state.shots.map((shot) => {
    if (shot.id !== operation.shotId || shot.sequenceId !== operation.sequenceId) return shot;
    persisted = true;
    return { ...shot, generatedVideoPath: operation.sourceVideoPath, videoGenerationContractDigest: operation.contractDigest, videoProductionEvidence: evidence, videoQualityStatus: evidence.qualityReport?.status ?? (evidence.status === "processing" ? "checking" : "rejected") };
  }) }));
  return persisted;
}
function persistEvidenceBatchCAS(items: any[], staged: Map<string, StagedOperation>) {
  if (!items.length || items.some((item) => !operationMatchesCurrent(item.operation, staged))) return false;
  const byShot = new Map(items.map((item) => [item.operation.shotId, item]));
  useStoryboardStore.setState((state) => ({ shots: state.shots.map((shot) => {
    const item: any = byShot.get(shot.id);
    if (!item) return shot;
    return { ...shot, generatedVideoPath: item.operation.sourceVideoPath, videoGenerationContractDigest: item.operation.contractDigest, videoGenerationReceipt: item.generated.videoGenerationReceipt, videoProductionEvidence: item.evidence, videoQualityStatus: item.evidence.qualityReport?.status ?? "needs_review" };
  }) }));
  return true;
}
function persistDecisionCAS(shotId: string, captured: VideoProductionEvidence, decided: VideoQualityReport) {
  let persisted = false;
  useStoryboardStore.setState((state) => ({ shots: state.shots.map((shot) => {
    if (state.currentSequenceId !== captured.sequenceId || shot.id !== shotId || shot.videoProductionEvidence?.operation?.operationToken !== captured.operation?.operationToken || shot.generatedVideoPath !== captured.sourceVideoPath || shot.videoGenerationContractDigest !== captured.contractDigest) return shot;
    persisted = true;
    return { ...shot, videoProductionEvidence: { ...captured, qualityReport: decided, decision: decided.decision }, videoQualityStatus: decided.status };
  }) }));
  return persisted;
}
export function persistDecisionFailureCAS(captured: VideoProductionEvidence, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "video_operation_stale" || (error instanceof DOMException && error.name === "AbortError")) return false;
  let persisted = false;
  useStoryboardStore.setState((state) => ({ shots: state.shots.map((shot) => {
    const evidence = shot.videoProductionEvidence;
    if (state.currentSequenceId !== captured.sequenceId || shot.id !== captured.shotId || shot.sequenceId !== captured.sequenceId || !evidence || evidence.operation?.operationToken !== captured.operation?.operationToken || shot.generatedVideoPath !== captured.sourceVideoPath || shot.videoGenerationContractDigest !== captured.contractDigest || JSON.stringify(evidence.artifactBinding) !== JSON.stringify(captured.artifactBinding)) return shot;
    persisted = true;
    return { ...shot, videoProductionEvidence: { ...evidence, status: "failed", failureReason: message }, videoQualityStatus: "rejected" };
  }) }));
  return persisted;
}
function persistRebuildFailureCAS(shotIds: string[], staged: Map<string, StagedOperation>, fallback: Map<string, VideoProductionEvidence["operation"]>, error: unknown) {
  const stagedTargets = new Map(shotIds.map((id) => [id, staged.get(id)]));
  const stagedAllCurrent = [...stagedTargets.entries()].every(([shotId, operation]) => operation && operationMatchesCurrent({ shotId, sequenceId: operation.sequenceId, sourceVideoPath: operation.path, contractDigest: operation.digest, operationToken: operation.token, settingsIdentity: operation.settingsIdentity }, staged));
  const targets = stagedAllCurrent
    ? new Map([...stagedTargets.entries()].map(([id, operation]) => [id, operation!]))
    : new Map(shotIds.map((id) => [id, fallback.get(id)]));
  if ([...targets.entries()].some(([shotId, operation]) => !operation || !operationMatchesPersisted(shotId, operation as NonNullable<VideoProductionEvidence["operation"]>))) return false;
  const message = error instanceof Error ? error.message : String(error);
  useStoryboardStore.setState((state) => ({ shots: state.shots.map((shot) => !targets.has(shot.id) ? shot : {
    ...shot,
    videoProductionEvidence: shot.videoProductionEvidence ? { ...shot.videoProductionEvidence, status: "failed", failureReason: message, decision: undefined } : shot.videoProductionEvidence,
    videoQualityStatus: "rejected"
  }) }));
  return true;
}
function operationMatchesPersisted(shotId: string, operation: NonNullable<VideoProductionEvidence["operation"]>) {
  const state = useStoryboardStore.getState();
  const shot = state.shots.find((item) => item.id === shotId && item.sequenceId === operation.sequenceId);
  return Boolean(shot && state.currentSequenceId === operation.sequenceId && shot.generatedVideoPath === operation.sourceVideoPath && shot.videoGenerationContractDigest === operation.contractDigest && shot.videoProductionEvidence?.operation?.operationToken === operation.operationToken);
}
function persistPreparationFailureCAS(shot: Shot, context: (ReturnType<typeof buildContexts> extends Map<string, infer V> ? V : never) | undefined, operation: StagedOperation, staged: Map<string, StagedOperation>, error: unknown) {
  if (!operationMatchesCurrent({ shotId: shot.id, sequenceId: operation.sequenceId, sourceVideoPath: operation.path, contractDigest: operation.digest, operationToken: operation.token, settingsIdentity: operation.settingsIdentity }, staged) || !context) return false;
  const message = error instanceof Error ? error.message : String(error);
  useStoryboardStore.setState((state) => ({ shots: state.shots.map((item) => item.id !== shot.id || item.sequenceId !== shot.sequenceId ? item : {
    ...item, videoProductionEvidence: {
      schemaVersion: 1, shotId: shot.id, sequenceId: shot.sequenceId, status: "failed", sourceVideoPath: operation.path,
      contractDigest: operation.digest, boundaryIdentity: boundaryIdentity(context.outgoingBoundary),
      operation: { sequenceId: shot.sequenceId, shotId: shot.id, contractDigest: operation.digest, sourceVideoPath: operation.path, boundaryIdentity: boundaryIdentity(context.outgoingBoundary), operationToken: operation.token, settingsIdentity: operation.settingsIdentity },
      routeDecision: context.routeDecision, profilePreflight: context.profilePreflight, boundary: context.outgoingBoundary, failureReason: message
    }, videoQualityStatus: "rejected"
  }) }));
  return true;
}
function unique(values: Array<string | undefined>) { return [...new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))]; }
function statusLabel(status: VideoQualityReport["status"]) { return status === "approved" ? "已批准" : status === "needs_review" ? "待人工审核" : "已拒绝"; }
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
function boundaryIdentity(boundary?: VideoBoundaryPlan) { return boundary ? [boundary.id, boundary.fromShotId, boundary.toShotId, boundary.kind, boundary.sharedFramePath ?? "", boundary.approvalStatus].join(":") : ""; }
