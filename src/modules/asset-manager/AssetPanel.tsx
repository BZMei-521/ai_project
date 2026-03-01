import { useMemo, useState } from "react";
import {
  DEFAULT_TOKEN_MAPPING,
  generateSkyboxFaceUpdate,
  generateSkyboxFaces,
  type ComfySettings
} from "../comfy-pipeline/comfyService";
import { useStoryboardStore } from "../storyboard-core/store";
import type { AssetType, SkyboxFace } from "../storyboard-core/types";
import { confirmDialog } from "../ui/dialogStore";
import { pushToast } from "../ui/toastStore";

const SETTINGS_KEY = "storyboard-pro/comfy-settings/v1";

const SKYBOX_FACES: SkyboxFace[] = ["front", "right", "back", "left", "up", "down"];

function loadComfySettingsFromLocalStorage(): ComfySettings | null {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ComfySettings>;
    if (!parsed.baseUrl || !parsed.imageWorkflowJson) return null;
    return {
      baseUrl: parsed.baseUrl,
      outputDir: parsed.outputDir ?? "",
      comfyInputDir: parsed.comfyInputDir ?? "",
      comfyRootDir: parsed.comfyRootDir ?? "",
      imageWorkflowJson: parsed.imageWorkflowJson ?? "",
      videoWorkflowJson: parsed.videoWorkflowJson ?? parsed.imageWorkflowJson ?? "",
      tokenMapping: {
        ...DEFAULT_TOKEN_MAPPING,
        ...(parsed.tokenMapping ?? {})
      }
    };
  } catch {
    return null;
  }
}

export function AssetPanel() {
  const assets = useStoryboardStore((state) => state.assets);
  const addAsset = useStoryboardStore((state) => state.addAsset);
  const updateAsset = useStoryboardStore((state) => state.updateAsset);
  const removeAsset = useStoryboardStore((state) => state.removeAsset);
  const [tab, setTab] = useState<AssetType>("character");
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [frontPath, setFrontPath] = useState("");
  const [sidePath, setSidePath] = useState("");
  const [backPath, setBackPath] = useState("");
  const [voiceProfile, setVoiceProfile] = useState("");
  const [skyboxDescription, setSkyboxDescription] = useState("");
  const [skyboxTagsInput, setSkyboxTagsInput] = useState("");
  const [skyboxFacePaths, setSkyboxFacePaths] = useState<Partial<Record<SkyboxFace, string>>>({});
  const [eventFaceByAsset, setEventFaceByAsset] = useState<Record<string, SkyboxFace>>({});
  const [eventPromptByAsset, setEventPromptByAsset] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const scopedAssets = useMemo(
    () => assets.filter((asset) => asset.type === tab),
    [assets, tab]
  );

  const onAdd = () => {
    const skyboxTags = skyboxTagsInput
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const skyboxMainPath = skyboxFacePaths.front || filePath;
    addAsset({
      type: tab,
      name,
      filePath: tab === "character" ? frontPath : tab === "skybox" ? skyboxMainPath : filePath,
      characterFrontPath: tab === "character" ? frontPath : undefined,
      characterSidePath: tab === "character" ? sidePath : undefined,
      characterBackPath: tab === "character" ? backPath : undefined,
      voiceProfile: tab === "character" ? voiceProfile : undefined,
      skyboxDescription: tab === "skybox" ? skyboxDescription : undefined,
      skyboxTags: tab === "skybox" ? skyboxTags : undefined,
      skyboxFaces: tab === "skybox" ? skyboxFacePaths : undefined,
      skyboxUpdateEvents: tab === "skybox" ? [] : undefined
    });
    setName("");
    setFilePath("");
    setFrontPath("");
    setSidePath("");
    setBackPath("");
    setVoiceProfile("");
    setSkyboxDescription("");
    setSkyboxTagsInput("");
    setSkyboxFacePaths({});
  };

  const onGenerateSkybox = async () => {
    const comfySettings = loadComfySettingsFromLocalStorage();
    if (!comfySettings) {
      pushToast("请先在 AI 流水线配置并保存 Comfy 设置", "error");
      return;
    }
    const desc = skyboxDescription.trim();
    if (!desc) {
      pushToast("请先填写场景描述", "warning");
      return;
    }
    try {
      setBusy(true);
      const result = await generateSkyboxFaces(comfySettings, desc);
      setSkyboxFacePaths(result.faces);
      if (result.faces.front) setFilePath(result.faces.front);
      pushToast("天空盒六面生成完成", "success");
    } catch (error) {
      pushToast(`天空盒生成失败：${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const onUpdateSkyboxFace = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId && item.type === "skybox");
    if (!asset) return;
    const face = eventFaceByAsset[assetId] ?? "front";
    const eventPrompt = (eventPromptByAsset[assetId] ?? "").trim();
    if (!eventPrompt) {
      pushToast("请填写事件描述（例如：墙面出现弹孔）", "warning");
      return;
    }
    const comfySettings = loadComfySettingsFromLocalStorage();
    if (!comfySettings) {
      pushToast("请先在 AI 流水线配置并保存 Comfy 设置", "error");
      return;
    }
    try {
      setBusy(true);
      const description = asset.skyboxDescription?.trim() || asset.name;
      const generated = await generateSkyboxFaceUpdate(comfySettings, description, face, eventPrompt);
      const nextFaces = { ...(asset.skyboxFaces ?? {}), [face]: generated.filePath };
      const nextEvents = [
        ...(asset.skyboxUpdateEvents ?? []),
        {
          id: `skybox_evt_${Date.now()}`,
          face,
          prompt: eventPrompt,
          filePath: generated.filePath,
          createdAt: new Date().toISOString()
        }
      ];
      updateAsset(assetId, {
        filePath: nextFaces.front || generated.filePath,
        skyboxFaces: nextFaces,
        skyboxUpdateEvents: nextEvents
      });
      setEventPromptByAsset((prev) => ({ ...prev, [assetId]: "" }));
      pushToast(`已更新天空盒 ${face} 面`, "success");
    } catch (error) {
      pushToast(`更新天空盒失败：${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (assetId: string) => {
    const ok = await confirmDialog({
      title: "删除人物",
      message: "删除后会从镜头引用中移除，是否继续？",
      confirmText: "删除",
      danger: true
    });
    if (!ok) return;
    removeAsset(assetId);
  };

  return (
    <section className="panel asset-panel">
      <header className="panel-header">
        <h2>人物/场景库</h2>
      </header>
      <div className="timeline-actions">
        <button className={tab === "character" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("character")} type="button">
          人物
        </button>
        <button className={tab === "scene" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("scene")} type="button">
          场景
        </button>
        <button className={tab === "prop" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("prop")} type="button">
          道具
        </button>
        <button className={tab === "skybox" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("skybox")} type="button">
          天空盒
        </button>
      </div>
      <div className="shot-batch-grid">
        <label>
          名称
          <input onChange={(event) => setName(event.target.value)} placeholder="例如：女主" type="text" value={name} />
        </label>
        <button className="btn-primary" onClick={onAdd} type="button">添加</button>
        {tab === "character" ? (
          <>
            <label>
              正视图
              <input
                onChange={(event) => setFrontPath(event.target.value)}
                placeholder="/Users/.../character_front.png"
                type="text"
                value={frontPath}
              />
            </label>
            <label>
              侧视图
              <input
                onChange={(event) => setSidePath(event.target.value)}
                placeholder="/Users/.../character_side.png"
                type="text"
                value={sidePath}
              />
            </label>
            <label>
              背视图
              <input
                onChange={(event) => setBackPath(event.target.value)}
                placeholder="/Users/.../character_back.png"
                type="text"
                value={backPath}
              />
            </label>
            <label>
              音色绑定
              <input
                onChange={(event) => setVoiceProfile(event.target.value)}
                placeholder="例如：young_female_calm 或具体音色提示"
                type="text"
                value={voiceProfile}
              />
            </label>
          </>
        ) : tab === "skybox" ? (
          <>
            <label>
              场景描述
              <textarea
                onChange={(event) => setSkyboxDescription(event.target.value)}
                placeholder="例如：赛博朋克室内酒吧，霓虹灯、木质吧台、雨夜窗外反光..."
                rows={4}
                value={skyboxDescription}
              />
            </label>
            <label>
              标签（逗号分隔）
              <input
                onChange={(event) => setSkyboxTagsInput(event.target.value)}
                placeholder="室内,霓虹,夜景"
                type="text"
                value={skyboxTagsInput}
              />
            </label>
            <div className="timeline-actions">
              <button className="btn-ghost" disabled={busy} onClick={() => void onGenerateSkybox()} type="button">
                用 Comfy 生成天空盒六面
              </button>
            </div>
            {SKYBOX_FACES.map((face) => (
              <label key={face}>
                {face.toUpperCase()} 面路径
                <input
                  onChange={(event) => setSkyboxFacePaths((prev) => ({ ...prev, [face]: event.target.value }))}
                  placeholder={`/Users/.../skybox_${face}.png`}
                  type="text"
                  value={skyboxFacePaths[face] ?? ""}
                />
              </label>
            ))}
          </>
        ) : (
          <label>
            图片路径
            <input
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="/Users/.../scene_or_prop.png"
              type="text"
              value={filePath}
            />
          </label>
        )}
      </div>
      <ul className="asset-list">
        {scopedAssets.map((asset) => (
          <li key={asset.id}>
            <div>
              <strong>{asset.name}</strong>
              <small>
                {asset.type === "character"
                  ? `正:${asset.characterFrontPath || "-"} | 侧:${asset.characterSidePath || "-"} | 背:${asset.characterBackPath || "-"} | 音色:${asset.voiceProfile || "-"}`
                  : asset.type === "skybox"
                    ? `标签:${(asset.skyboxTags ?? []).join("、") || "-"} | 描述:${asset.skyboxDescription || "-"}`
                  : asset.filePath}
              </small>
            </div>
            {asset.type === "character" && (
              <label>
                音色绑定
                <input
                  onChange={(event) => updateAsset(asset.id, { voiceProfile: event.target.value })}
                  placeholder="例如：young_female_calm"
                  type="text"
                  value={asset.voiceProfile ?? ""}
                />
              </label>
            )}
            {asset.type === "skybox" && (
              <div className="shot-batch-grid">
                <small>
                  六面：{SKYBOX_FACES.map((face) => `${face}:${asset.skyboxFaces?.[face] ? "✓" : "-"}`).join(" | ")}
                </small>
                <label>
                  事件作用面
                  <select
                    onChange={(event) =>
                      setEventFaceByAsset((prev) => ({ ...prev, [asset.id]: event.target.value as SkyboxFace }))
                    }
                    value={eventFaceByAsset[asset.id] ?? "front"}
                  >
                    {SKYBOX_FACES.map((face) => (
                      <option key={face} value={face}>
                        {face.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  事件描述
                  <input
                    onChange={(event) =>
                      setEventPromptByAsset((prev) => ({ ...prev, [asset.id]: event.target.value }))
                    }
                    placeholder="例如：墙上出现子弹孔和碎裂涂层"
                    type="text"
                    value={eventPromptByAsset[asset.id] ?? ""}
                  />
                </label>
                <button className="btn-ghost" disabled={busy} onClick={() => void onUpdateSkyboxFace(asset.id)} type="button">
                  更新该面
                </button>
              </div>
            )}
            <button className="btn-ghost" onClick={() => void onDelete(asset.id)} type="button">删除</button>
          </li>
        ))}
        {scopedAssets.length === 0 && <li><small>暂无条目</small></li>}
      </ul>
    </section>
  );
}
