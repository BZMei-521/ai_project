import { selectSelectedShot, useStoryboardStore } from "../storyboard-core/store";
import { toDesktopMediaSource } from "../platform/desktopBridge";

export function ShotInspectorPanel() {
  const selectedShot = useStoryboardStore(selectSelectedShot);
  const updateShotFields = useStoryboardStore((state) => state.updateShotFields);
  const assets = useStoryboardStore((state) => state.assets);
  const toggleCharacterRefForShot = useStoryboardStore((state) => state.toggleCharacterRefForShot);
  const characterAssets = assets.filter((asset) => asset.type === "character");
  const sceneAssets = assets.filter((asset) => asset.type === "scene" || asset.type === "skybox");
  const selectedSceneAsset = sceneAssets.find((asset) => asset.id === (selectedShot?.sceneRefId ?? ""));
  const selectedSkyboxFaces = selectedShot?.skyboxFaces ?? [];
  const selectedSkyboxFaceWeights = selectedShot?.skyboxFaceWeights ?? {};

  if (!selectedShot) {
    return (
      <section className="panel inspector-panel">
        <header className="panel-header">
          <h2>镜头检查器</h2>
        </header>
        <p>请选择一个镜头后再编辑详细信息。</p>
      </section>
    );
  }

  const previewSource = toDesktopMediaSource(selectedShot.generatedImagePath);

  return (
    <section className="panel inspector-panel">
      <header className="panel-header">
        <h2>镜头检查器</h2>
        <span>#{selectedShot.order}</span>
      </header>
      <label>
        标题
        <input
          onChange={(event) =>
            updateShotFields(selectedShot.id, { title: event.target.value })
          }
          type="text"
          value={selectedShot.title}
        />
      </label>
      <label>
        对白
        <textarea
          onChange={(event) =>
            updateShotFields(selectedShot.id, { dialogue: event.target.value })
          }
          rows={3}
          value={selectedShot.dialogue}
        />
      </label>
      <label>
        备注
        <textarea
          onChange={(event) =>
            updateShotFields(selectedShot.id, { notes: event.target.value })
          }
          rows={3}
          value={selectedShot.notes}
        />
      </label>
      <label>
        标签（逗号分隔）
        <input
          onChange={(event) =>
            updateShotFields(selectedShot.id, {
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }
          type="text"
          value={selectedShot.tags.join(", ")}
        />
      </label>
      <section className="export-panel inspector-shot-preview">
        <h3>生成预览</h3>
        {previewSource ? (
          <a href={previewSource} rel="noreferrer" target="_blank" title="点击查看原图">
            <img alt={`${selectedShot.title} 分镜图`} loading="lazy" src={previewSource} />
          </a>
        ) : (
          <small>当前镜头还没有生成分镜图</small>
        )}
      </section>
      <section className="export-panel">
        <h3>场景引用</h3>
        <label>
          选择场景
          <select
            onChange={(event) => updateShotFields(selectedShot.id, { sceneRefId: event.target.value })}
            value={selectedShot.sceneRefId ?? ""}
          >
            <option value="">未选择</option>
            {sceneAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}{asset.type === "skybox" ? "（天空盒）" : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedSceneAsset?.type === "skybox" && (
          <>
            <label>
              主面向（兼容单面）
              <select
                onChange={(event) =>
                  updateShotFields(selectedShot.id, {
                    skyboxFace: event.target.value as "auto" | "front" | "right" | "back" | "left" | "up" | "down"
                  })
                }
                value={selectedShot.skyboxFace ?? "auto"}
              >
                <option value="auto">自动判断</option>
                <option value="front">front</option>
                <option value="right">right</option>
                <option value="back">back</option>
                <option value="left">left</option>
                <option value="up">up</option>
                <option value="down">down</option>
              </select>
            </label>
            <div>
              <small>多面参考（可多选）</small>
              <div className="shot-tags">
                {(["front", "right", "back", "left", "up", "down"] as const).map((face) => {
                  const active = selectedSkyboxFaces.includes(face);
                  const weight = Number.isFinite(selectedSkyboxFaceWeights[face] ?? NaN)
                    ? Math.max(0, Math.min(1, selectedSkyboxFaceWeights[face] ?? 1))
                    : 1;
                  return (
                    <div key={face} style={{ display: "grid", gap: 6 }}>
                      <label className="timeline-snap-toggle">
                        <input
                          checked={active}
                          onChange={() => {
                            const next = active
                              ? selectedSkyboxFaces.filter((item) => item !== face)
                              : [...selectedSkyboxFaces, face];
                            updateShotFields(selectedShot.id, { skyboxFaces: next });
                          }}
                          type="checkbox"
                        />
                        {face}
                      </label>
                      {active && (
                        <label>
                          权重 {weight.toFixed(2)}
                          <input
                            max={1}
                            min={0}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (!Number.isFinite(value)) return;
                              updateShotFields(selectedShot.id, {
                                skyboxFaceWeights: {
                                  ...selectedSkyboxFaceWeights,
                                  [face]: Math.max(0, Math.min(1, value))
                                }
                              });
                            }}
                            step={0.05}
                            type="range"
                            value={weight}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
      <section className="export-panel">
        <h3>人物引用</h3>
        <div className="shot-tags">
          {characterAssets.map((asset) => {
            const active = (selectedShot.characterRefs ?? []).includes(asset.id);
            return (
              <label className="timeline-snap-toggle" key={asset.id}>
                <input
                  checked={active}
                  onChange={() => toggleCharacterRefForShot(selectedShot.id, asset.id)}
                  type="checkbox"
                />
                {asset.name}
              </label>
            );
          })}
        </div>
      </section>
    </section>
  );
}
