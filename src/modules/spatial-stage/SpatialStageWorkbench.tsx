import { useMemo, useRef, useState } from "react";
import { useStoryboardStore } from "../storyboard-core/store";
import { computeStageSourceDigest } from "./stageDigest";
import { SpatialStageViewport, type SpatialStageViewportHandle } from "./SpatialStageViewport";
import type { SceneStage, StageEntity } from "./types";
import { createStageSnapshot, inheritStageSnapshot, validateStageSnapshot } from "./stageState";
import { auditMogeWorkflow, buildMogePanoramaWorkflow } from "./mogeWorkflow";
import { runMogeInitialization } from "./mogeRunner";
import { createComfyMogeTransport } from "./comfyMogeTransport";
import { stageMogePanoramaAsset } from "./mogeAssetStaging";

function currentSceneId(
  selectedShotId: string,
  shots: ReturnType<typeof useStoryboardStore.getState>["shots"],
  currentSequenceId: string
): string {
  return shots.find((shot) => shot.id === selectedShotId)?.sceneRefId?.trim() || `sequence:${currentSequenceId || "unbound"}`;
}

function createProxy(stage: SceneStage, kind: StageEntity["geometry"]["kind"]): SceneStage {
  const index = stage.entities.length + 1;
  const entity: StageEntity = {
    id: `${stage.id}_proxy_${index}`,
    label: `${kind} proxy ${index}`,
    tags: ["manual_proxy"],
    transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    geometry: { kind, size: kind === "plane" ? [4, 1, 4] : [1, 1.8, 1] },
    visibility: "visible",
    metadata: {}
  };
  const next = { ...stage, entities: [...stage.entities, entity] };
  return { ...next, revision: stage.revision + 1, sourceDigest: computeStageSourceDigest(next) };
}

export function SpatialStageWorkbench() {
  const selectedShotId = useStoryboardStore((state) => state.selectedShotId);
  const shots = useStoryboardStore((state) => state.shots);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const assets = useStoryboardStore((state) => state.assets);
  const spatialStages = useStoryboardStore((state) => state.spatialStages);
  const createSpatialStage = useStoryboardStore((state) => state.createSpatialStage);
  const updateSpatialStage = useStoryboardStore((state) => state.updateSpatialStage);
  const removeSpatialStage = useStoryboardStore((state) => state.removeSpatialStage);
  const [selectedEntityId, setSelectedEntityId] = useState<string>();
  const [beatId, setBeatId] = useState("beat-1");
  const [snapshotMessage, setSnapshotMessage] = useState<string>("");
  const [mogeMessage, setMogeMessage] = useState<string>("");
  const [comfyBaseUrl, setComfyBaseUrl] = useState("http://127.0.0.1:8188");
  const [mogeBusy, setMogeBusy] = useState(false);
  const viewportRef = useRef<SpatialStageViewportHandle>(null);
  const sceneId = currentSceneId(selectedShotId, shots, currentSequenceId);
  const stage = spatialStages.find((item) => item.sceneId === sceneId);
  const panorama = useMemo(() => {
    const sceneAssetId = stage?.environment.sources.find((source) => source.kind === "panorama")?.assetId;
    return assets.find((asset) => asset.id === sceneAssetId && asset.type === "skybox")?.filePath;
  }, [assets, stage]);

  const update = (next: SceneStage) => updateSpatialStage(next.id, next);
  const addProxy = (kind: StageEntity["geometry"]["kind"]) => {
    if (!stage) return;
    const next = createProxy(stage, kind);
    update(next);
    setSelectedEntityId(next.entities[next.entities.length - 1]?.id);
  };

  if (!stage) {
    return (
      <section className="spatial-stage-workbench spatial-stage-empty">
        <div className="spatial-stage-empty-copy">
          <span className="spatial-stage-eyebrow">SPATIAL STAGE</span>
          <h2>先建立空间预演舞台</h2>
          <p>当前场景：{sceneId}。舞台建立后，角色、道具和相机才会进入可计算的空间。</p>
          <button className="btn-primary" type="button" onClick={() => createSpatialStage(sceneId)}>
            建立空间预演
          </button>
        </div>
      </section>
    );
  }

  const panoramaSource = stage.environment.sources.find((source) => source.kind === "panorama");
  const selectedEntity = stage.entities.find((entity) => entity.id === selectedEntityId);
  const updateEntity = (patch: Partial<StageEntity>) => {
    if (!selectedEntity) return;
    update({ ...stage, entities: stage.entities.map((entity) => entity.id === selectedEntity.id ? { ...entity, ...patch } : entity) });
  };
  const createInheritedSnapshot = () => {
    const previous = stage.snapshots[stage.snapshots.length - 1];
    const nextSnapshot = previous
      ? inheritStageSnapshot(stage, previous, beatId, {}, new Date().toISOString())
      : createStageSnapshot(stage, beatId, undefined, new Date().toISOString());
    const validation = validateStageSnapshot(stage, nextSnapshot);
    update({ ...stage, snapshots: [...stage.snapshots, nextSnapshot] });
    setSnapshotMessage(validation.valid ? `快照 ${nextSnapshot.id} 已确认` : `未解析 ${validation.unresolved.length} 项：${validation.unresolved.join(", ")}`);
    setBeatId(`beat-${stage.snapshots.length + 2}`);
  };
  const setPanorama = (assetId: string) => {
    const nextSources = stage.environment.sources.filter((source) => source.kind !== "panorama");
    update({
      ...stage,
      environment: {
        sources: assetId
          ? [...nextSources, { kind: "panorama", assetId, filePath: assets.find((asset) => asset.id === assetId)?.filePath, maxTextureWidth: 4096 }]
          : nextSources.length > 0 ? nextSources : [{ kind: "empty_stage" }]
      }
    });
  };
  const prepareMoge = () => {
    const filePath = panoramaSource?.assetId
      ? assets.find((asset) => asset.id === panoramaSource.assetId)?.filePath
      : undefined;
    if (!filePath) {
      setMogeMessage("未设置全景资产，保持手工代理模式");
      return;
    }
    try {
      const workflow = buildMogePanoramaWorkflow({ image: filePath, filenamePrefix: `spatial-stage/${stage.id}` });
      const audit = auditMogeWorkflow(workflow);
      if (!audit.valid) setMogeMessage(`MoGe 工作流无效：${audit.errors.join("、")}`);
      else if (stage.capabilities.overall === "available" && stage.capabilities.mogeNode.status === "available" && stage.capabilities.mogeModel.status === "available") setMogeMessage("MoGe 工作流已通过预检，可排队生成几何");
      else setMogeMessage("MoGe 能力未就绪，保持手工代理模式");
    } catch (error) {
      setMogeMessage(`MoGe 预检失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const queueMoge = async () => {
    const filePath = panoramaSource?.assetId ? assets.find((asset) => asset.id === panoramaSource.assetId)?.filePath : undefined;
    if (!filePath) { setMogeMessage("未设置全景资产，无法排队"); return; }
    setMogeBusy(true);
    try {
      const staged = await stageMogePanoramaAsset(filePath, stage.id);
      const result = await runMogeInitialization(
        { image: staged.fileName, filenamePrefix: `spatial-stage/${stage.id}` },
        stage.capabilities,
        createComfyMogeTransport({ baseUrl: comfyBaseUrl, timeoutMs: 120000, pollMs: 1000 })
      );
      if (result.status === "completed" && result.outputs && result.promptId) {
        const sources = stage.environment.sources.filter((source) => source.kind !== "depth_map" && source.kind !== "empty_stage");
        const next = { ...stage, revision: stage.revision + 1, environment: { sources: [...sources, { kind: "depth_map" as const, ...result.outputs, promptId: result.promptId, width: 1920, height: 960 }] } };
        update({ ...next, sourceDigest: computeStageSourceDigest(next) });
        setMogeMessage(`MoGe 局部几何已接入舞台：${result.promptId}`);
      } else setMogeMessage(result.status === "queued" ? `已排队 MoGe 几何任务：${result.promptId}` : `${result.status === "manual_fallback" ? "手工代理模式" : "MoGe 排队失败"}：${result.errors.join("、")}`);
    } catch (error) { setMogeMessage(`MoGe 排队失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setMogeBusy(false); }
  };

  return (
    <section className="spatial-stage-workbench">
      <header className="spatial-stage-toolbar">
        <div>
          <span className="spatial-stage-eyebrow">SPATIAL STAGE</span>
          <strong>{sceneId}</strong>
          <small>Revision {stage.revision}{stage.sourceDigest ? " · 已同步" : " · 待同步"}</small>
        </div>
        <div className="spatial-stage-actions">
          <select aria-label="全景环境" value={panoramaSource?.assetId ?? ""} onChange={(event) => setPanorama(event.target.value)}>
            <option value="">空舞台</option>
            {assets.filter((asset) => asset.type === "skybox").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
          {(["box", "capsule", "sphere", "plane"] as const).map((kind) => (
            <button className="btn-ghost" key={kind} type="button" onClick={() => addProxy(kind)}>{kind}</button>
          ))}
          <button className="btn-danger" type="button" disabled={!selectedEntityId} onClick={() => {
            if (!selectedEntityId) return;
            update({ ...stage, entities: stage.entities.filter((entity) => entity.id !== selectedEntityId) });
            setSelectedEntityId(undefined);
          }}>删除代理</button>
          <button className="btn-primary" type="button" onClick={createInheritedSnapshot}>继承上一节拍</button>
          <button className="btn-ghost" type="button" onClick={prepareMoge}>MoGe 几何预检</button>
          <button className="btn-primary" type="button" disabled={mogeBusy || stage.capabilities.overall !== "available"} onClick={queueMoge}>{mogeBusy ? "排队中…" : "排队生成几何"}</button>
        </div>
      </header>
      <div className="spatial-stage-main">
        <SpatialStageViewport ref={viewportRef} stage={stage} panoramaUrl={panorama} selectedEntityId={selectedEntityId} paused={false} onContextStatusChange={() => undefined} />
        <aside className="spatial-stage-inspector">
          <strong>场景树</strong>
          <small>{stage.capabilities.overall === "manual_fallback" ? "手工代理模式" : stage.capabilities.overall}</small>
          <div className="spatial-stage-entity-list">
            {stage.entities.length === 0 && <span>暂无代理</span>}
            {stage.entities.map((entity) => (
              <button className={entity.id === selectedEntityId ? "selected" : ""} key={entity.id} type="button" onClick={() => setSelectedEntityId(entity.id)}>
                <span>{entity.label}</span><small>{entity.geometry.kind}</small>
              </button>
            ))}
          </div>
          {selectedEntity && <div className="spatial-stage-entity-editor">
            <strong>实体检查器</strong>
            <label>Rig
              <select value={selectedEntity.rig?.kind ?? "custom"} onChange={(event) => updateEntity({ rig: { kind: event.target.value as NonNullable<StageEntity["rig"]>["kind"], joints: selectedEntity.rig?.joints ?? {} } })}>
                <option value="humanoid">humanoid</option>
                <option value="quadruped">quadruped</option>
                <option value="rigid_chain">rigid_chain</option>
                <option value="custom">custom</option>
              </select>
            </label>
            <div className="spatial-stage-vector-fields">
              {(["x", "y", "z"] as const).map((axis, index) => <label key={axis}>{axis.toUpperCase()}<input type="number" step="0.1" value={selectedEntity.transform.position[index]} onChange={(event) => {
                const position = [...selectedEntity.transform.position] as [number, number, number];
                position[index] = Number(event.target.value) || 0;
                updateEntity({ transform: { ...selectedEntity.transform, position } });
              }} /></label>)}
            </div>
            <label><input type="checkbox" checked={selectedEntity.visibility === "visible"} onChange={(event) => updateEntity({ visibility: event.target.checked ? "visible" : "hidden" })} /> 可见</label>
            <small>挂点：{selectedEntity.attachments?.map((point) => point.label).join("、") || "未定义"}</small>
          </div>}
          <label>节拍 ID<input value={beatId} onChange={(event) => setBeatId(event.target.value)} /></label>
          {snapshotMessage && <small className={snapshotMessage.startsWith("未解析") ? "spatial-stage-conflict" : "spatial-stage-ok"}>{snapshotMessage}</small>}
          {mogeMessage && <small className={mogeMessage.includes("失败") || mogeMessage.includes("未设置") ? "spatial-stage-conflict" : "spatial-stage-ok"}>{mogeMessage}</small>}
          <label>ComfyUI 地址<input value={comfyBaseUrl} onChange={(event) => setComfyBaseUrl(event.target.value)} /></label>
          <button className="btn-ghost" type="button" onClick={() => viewportRef.current?.releaseGpuResources()}>释放视口显存</button>
          <button className="btn-ghost" type="button" onClick={() => removeSpatialStage(stage.id)}>移除舞台</button>
        </aside>
      </div>
    </section>
  );
}
