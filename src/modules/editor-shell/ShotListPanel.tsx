import { useEffect, useRef, useState } from "react";
import {
  selectAvailableShotTagsForCurrentSequence,
  selectFilteredShotsForCurrentSequence,
  selectShotStartFrame,
  useStoryboardStore
} from "../storyboard-core/store";
import { confirmDialog, promptDialog } from "../ui/dialogStore";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import { inferSkyboxReferencePlan } from "../comfy-pipeline/comfyService";

export function ShotListPanel() {
  const shots = useStoryboardStore(selectFilteredShotsForCurrentSequence);
  const availableTags = useStoryboardStore(selectAvailableShotTagsForCurrentSequence);
  const sequences = useStoryboardStore((state) => state.sequences);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const shotFilterQuery = useStoryboardStore((state) => state.shotFilterQuery);
  const shotFilterTag = useStoryboardStore((state) => state.shotFilterTag);
  const shotStrokes = useStoryboardStore((state) => state.shotStrokes);
  const assets = useStoryboardStore((state) => state.assets);
  const selectedShotId = useStoryboardStore((state) => state.selectedShotId);
  const selectedShotIds = useStoryboardStore((state) => state.selectedShotIds);
  const selectShot = useStoryboardStore((state) => state.selectShot);
  const setCurrentFrame = useStoryboardStore((state) => state.setCurrentFrame);
  const selectSequence = useStoryboardStore((state) => state.selectSequence);
  const addSequence = useStoryboardStore((state) => state.addSequence);
  const renameSequence = useStoryboardStore((state) => state.renameSequence);
  const duplicateSequence = useStoryboardStore((state) => state.duplicateSequence);
  const deleteSequence = useStoryboardStore((state) => state.deleteSequence);
  const moveSequence = useStoryboardStore((state) => state.moveSequence);
  const toggleShotSelection = useStoryboardStore((state) => state.toggleShotSelection);
  const clearShotSelection = useStoryboardStore((state) => state.clearShotSelection);
  const selectAllShots = useStoryboardStore((state) => state.selectAllShots);
  const setShotFilterQuery = useStoryboardStore((state) => state.setShotFilterQuery);
  const setShotFilterTag = useStoryboardStore((state) => state.setShotFilterTag);
  const clearShotFilters = useStoryboardStore((state) => state.clearShotFilters);
  const moveSelectedShots = useStoryboardStore((state) => state.moveSelectedShots);
  const batchSetDurationForSelectedShots = useStoryboardStore(
    (state) => state.batchSetDurationForSelectedShots
  );
  const batchAddTagForSelectedShots = useStoryboardStore(
    (state) => state.batchAddTagForSelectedShots
  );
  const batchRemoveTagForSelectedShots = useStoryboardStore(
    (state) => state.batchRemoveTagForSelectedShots
  );
  const addShot = useStoryboardStore((state) => state.addShot);
  const moveShot = useStoryboardStore((state) => state.moveShot);
  const duplicateShot = useStoryboardStore((state) => state.duplicateShot);
  const deleteShot = useStoryboardStore((state) => state.deleteShot);
  const deleteSelectedShots = useStoryboardStore((state) => state.deleteSelectedShots);
  const [batchDurationInput, setBatchDurationInput] = useState<string>("");
  const [batchTagInput, setBatchTagInput] = useState<string>("");
  const [cardDensity, setCardDensity] = useState<"comfortable" | "compact">(
    () => (localStorage.getItem("storyboard-pro/shot-density") === "compact" ? "compact" : "comfortable")
  );
  const maxDuration = Math.max(1, ...shots.map((shot) => shot.durationFrames));
  const totalDuration = shots.reduce((sum, shot) => sum + shot.durationFrames, 0);
  const shotCardRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const shotRailRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sceneAssetById = new Map(
    assets
      .filter((asset) => asset.type === "scene" || asset.type === "skybox")
      .map((asset) => [asset.id, asset] as const)
  );

  const onDeleteShot = async (shotId: string) => {
    const confirmed = await confirmDialog({
      title: "删除镜头",
      message: "确定删除这个镜头吗？此操作不可撤销。",
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    deleteShot(shotId);
  };

  const onDeleteSelectedShots = async () => {
    if (selectedShotIds.length === 0) return;
    const confirmed = await confirmDialog({
      title: "批量删除镜头",
      message: `确定删除已选的 ${selectedShotIds.length} 个镜头吗？`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    deleteSelectedShots();
  };

  const onRenameCurrentSequence = async () => {
    if (!currentSequenceId) return;
    const current = sequences.find((sequence) => sequence.id === currentSequenceId);
    const next = await promptDialog({
      title: "重命名序列",
      defaultValue: current?.name ?? "",
      confirmText: "重命名"
    });
    if (!next) return;
    renameSequence(currentSequenceId, next);
  };

  const onDeleteCurrentSequence = async () => {
    if (!currentSequenceId || sequences.length <= 1) return;
    const current = sequences.find((sequence) => sequence.id === currentSequenceId);
    const confirmed = await confirmDialog({
      title: "删除序列",
      message: `确定删除序列“${current?.name ?? currentSequenceId}”及其全部镜头吗？`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    deleteSequence(currentSequenceId);
  };

  const onBatchSetDuration = () => {
    if (selectedShotIds.length === 0) return;
    const duration = Number(batchDurationInput);
    if (!Number.isFinite(duration)) return;
    batchSetDurationForSelectedShots(duration);
  };

  const onBatchAddTag = () => {
    if (selectedShotIds.length === 0) return;
    if (!batchTagInput.trim()) return;
    batchAddTagForSelectedShots(batchTagInput);
  };

  const onBatchRemoveTag = () => {
    if (selectedShotIds.length === 0) return;
    if (!batchTagInput.trim()) return;
    batchRemoveTagForSelectedShots(batchTagInput);
  };

  useEffect(() => {
    if (!selectedShotId) return;
    shotCardRefs.current[selectedShotId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
    shotRailRefs.current[selectedShotId]?.scrollIntoView({
      inline: "nearest",
      behavior: "smooth"
    });
  }, [selectedShotId]);

  useEffect(() => {
    localStorage.setItem("storyboard-pro/shot-density", cardDensity);
  }, [cardDensity]);

  return (
    <aside className={`panel shot-panel ${cardDensity === "compact" ? "shot-panel-compact" : ""}`}>
      <header className="panel-header">
        <h2>镜头列表</h2>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={() => setCardDensity((value) => (value === "compact" ? "comfortable" : "compact"))}
            type="button"
          >
            {cardDensity === "compact" ? "舒适视图" : "紧凑视图"}
          </button>
          <button className="btn-primary" onClick={addShot} type="button">+ 新增镜头</button>
        </div>
      </header>
      <div className="shot-actions">
        <select
          onChange={(event) => selectSequence(event.target.value)}
          value={currentSequenceId}
        >
          {sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.id}>
              {sequence.order}. {sequence.name}
            </option>
          ))}
        </select>
        <button onClick={addSequence} type="button">+ 新增序列</button>
        <button onClick={() => moveSequence(currentSequenceId, "up")} type="button">序列上移</button>
        <button onClick={() => moveSequence(currentSequenceId, "down")} type="button">序列下移</button>
        <button onClick={onRenameCurrentSequence} type="button">重命名序列</button>
        <button onClick={() => duplicateSequence(currentSequenceId)} type="button">复制序列</button>
        <button
          disabled={sequences.length <= 1}
          onClick={onDeleteCurrentSequence}
          type="button"
        >
          删除序列
        </button>
      </div>
      <div className="shot-actions">
        <button onClick={selectAllShots} type="button">全选</button>
        <button onClick={clearShotSelection} type="button">清空选择</button>
        <button onClick={() => moveSelectedShots("up")} type="button">上移</button>
        <button onClick={() => moveSelectedShots("down")} type="button">下移</button>
        <button onClick={onDeleteSelectedShots} type="button">删除已选</button>
      </div>
      <div className="shot-batch-grid">
        <label>
          批量时长
          <input
            min={1}
            onChange={(event) => setBatchDurationInput(event.target.value)}
            placeholder="帧数"
            type="number"
            value={batchDurationInput}
          />
        </label>
        <button
          disabled={selectedShotIds.length === 0}
          onClick={onBatchSetDuration}
          type="button"
        >
          应用时长
        </button>
        <label>
          批量标签
          <input
            onChange={(event) => setBatchTagInput(event.target.value)}
            placeholder="标签"
            type="text"
            value={batchTagInput}
          />
        </label>
        <button
          disabled={selectedShotIds.length === 0}
          onClick={onBatchAddTag}
          type="button"
        >
          添加标签
        </button>
        <button
          disabled={selectedShotIds.length === 0}
          onClick={onBatchRemoveTag}
          type="button"
        >
          移除标签
        </button>
      </div>
      <div className="shot-filter-grid">
        <input
          onChange={(event) => setShotFilterQuery(event.target.value)}
          placeholder="搜索标题/备注/对白"
          type="text"
          value={shotFilterQuery}
        />
        <select
          onChange={(event) => setShotFilterTag(event.target.value)}
          value={shotFilterTag}
        >
          <option value="">全部标签</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <button onClick={clearShotFilters} type="button">重置筛选</button>
      </div>
      <section className="shot-rail">
        <header className="shot-rail-header">
          <strong>序列节奏</strong>
          <small>总计 {totalDuration} 帧</small>
        </header>
        <div className="shot-rail-track">
          {shots.length === 0 && <span className="shot-rail-empty">暂无镜头</span>}
          {shots.map((shot) => (
            <button
              className={shot.id === selectedShotId ? "shot-rail-block active" : "shot-rail-block"}
              key={`rail_${shot.id}`}
              onClick={() => {
                selectShot(shot.id);
                const start = selectShotStartFrame(useStoryboardStore.getState(), shot.id);
                setCurrentFrame(start);
              }}
              ref={(node) => {
                shotRailRefs.current[shot.id] = node;
              }}
              style={{
                flexGrow: Math.max(1, shot.durationFrames),
                flexBasis: 0
              }}
              title={`${shot.order}. ${shot.title} (${shot.durationFrames}f)`}
              type="button"
            >
              <span>{shot.order}</span>
            </button>
          ))}
        </div>
      </section>
      <ul className="shot-list">
        {shots.map((shot) => (
          <li
            key={shot.id}
            ref={(node) => {
              shotCardRefs.current[shot.id] = node;
            }}
          >
            {(() => {
              const sceneAsset = shot.sceneRefId ? sceneAssetById.get(shot.sceneRefId) : undefined;
              const skyboxPlan = sceneAsset?.type === "skybox" ? inferSkyboxReferencePlan(shot) : null;
              return (
                <>
                  <label className="shot-select">
                    <input
                      checked={selectedShotIds.includes(shot.id)}
                      onChange={() => toggleShotSelection(shot.id)}
                      type="checkbox"
                    />
                    <span>选择</span>
                  </label>
                  <button
                    className={shot.id === selectedShotId ? "shot-card selected" : "shot-card"}
                    onClick={() => selectShot(shot.id)}
                    type="button"
                  >
                    <div className="shot-card-main">
                      <div className={shot.generatedImagePath?.trim() ? "shot-thumb has-image" : "shot-thumb"}>
                        {toDesktopMediaSource(shot.generatedImagePath) ? (
                          <img
                            alt={`${shot.title} 分镜图`}
                            loading="lazy"
                            src={toDesktopMediaSource(shot.generatedImagePath)}
                          />
                        ) : (
                          <span>{String(shot.order).padStart(2, "0")}</span>
                        )}
                      </div>
                      <div className="shot-meta">
                        <strong>{shot.order}. {shot.title}</strong>
                        <small>
                          {shot.durationFrames} 帧 · {(shotStrokes[shot.id]?.length ?? 0)} 条笔画
                        </small>
                        {skyboxPlan && (
                          <small className="shot-skybox-meta">
                            天空盒：{sceneAsset?.name ?? "未命名天空盒"} · {skyboxPlan.faces.join("+")}
                          </small>
                        )}
                        {shot.tags.length > 0 && (
                          <div className="shot-tags">
                            {shot.tags.slice(0, 3).map((tag) => (
                              <span key={`${shot.id}_${tag}`}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </>
              );
            })()}
            <div className="shot-duration-bar">
              <span style={{ width: `${Math.round((shot.durationFrames / maxDuration) * 100)}%` }} />
            </div>
            <div className="shot-actions shot-item-actions">
              <button onClick={() => moveShot(shot.id, "up")} type="button">上移</button>
              <button onClick={() => moveShot(shot.id, "down")} type="button">下移</button>
              <button onClick={() => duplicateShot(shot.id)} type="button">复制</button>
              <button className="btn-danger" onClick={() => onDeleteShot(shot.id)} type="button">删除</button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
