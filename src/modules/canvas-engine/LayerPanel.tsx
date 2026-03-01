import {
  selectActiveLayerIdForSelectedShot,
  selectSelectedShot,
  selectSelectedShotLayers,
  useStoryboardStore
} from "../storyboard-core/store";
import { confirmDialog, promptDialog } from "../ui/dialogStore";

export function LayerPanel() {
  const selectedShot = useStoryboardStore(selectSelectedShot);
  const layers = useStoryboardStore(selectSelectedShotLayers);
  const activeLayerId = useStoryboardStore(selectActiveLayerIdForSelectedShot);
  const setActiveLayerForShot = useStoryboardStore((state) => state.setActiveLayerForShot);
  const addLayerToShot = useStoryboardStore((state) => state.addLayerToShot);
  const removeLayerFromShot = useStoryboardStore((state) => state.removeLayerFromShot);
  const moveLayerInShot = useStoryboardStore((state) => state.moveLayerInShot);
  const renameLayer = useStoryboardStore((state) => state.renameLayer);
  const toggleLayerVisibility = useStoryboardStore((state) => state.toggleLayerVisibility);
  const toggleLayerLock = useStoryboardStore((state) => state.toggleLayerLock);

  if (!selectedShot) {
    return (
      <section className="panel layer-panel">
        <header className="panel-header">
          <h2>图层</h2>
        </header>
        <p>请先选择一个镜头再管理图层。</p>
      </section>
    );
  }

  const onRename = async (layerId: string, currentName: string) => {
    const input = await promptDialog({
      title: "图层名称",
      defaultValue: currentName,
      confirmText: "重命名"
    });
    if (!input) return;
    renameLayer(layerId, input);
  };
  const onDeleteLayer = async (layerId: string, layerName: string) => {
    const confirmed = await confirmDialog({
      title: "删除图层",
      message: `确认删除图层“${layerName}”吗？`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    removeLayerFromShot(selectedShot.id, layerId);
  };

  return (
    <section className="panel layer-panel">
      <header className="panel-header">
        <h2>图层</h2>
        <button onClick={() => addLayerToShot(selectedShot.id)} type="button">+ 新增图层</button>
      </header>
      <ul className="layer-list">
        {layers.map((layer) => (
          <li key={layer.id}>
            <label>
              <input
                checked={activeLayerId === layer.id}
                onChange={() => setActiveLayerForShot(selectedShot.id, layer.id)}
                type="radio"
              />
              <span>{layer.name}</span>
            </label>
            <div className="layer-actions">
              <button onClick={() => toggleLayerVisibility(layer.id)} type="button">
                {layer.visible ? "隐藏" : "显示"}
              </button>
              <button onClick={() => toggleLayerLock(layer.id)} type="button">
                {layer.locked ? "解锁" : "锁定"}
              </button>
              <button onClick={() => onRename(layer.id, layer.name)} type="button">重命名</button>
              <button onClick={() => moveLayerInShot(selectedShot.id, layer.id, "up")} type="button">
                上移
              </button>
              <button onClick={() => moveLayerInShot(selectedShot.id, layer.id, "down")} type="button">
                下移
              </button>
              <button
                disabled={layers.length <= 1}
                onClick={() => void onDeleteLayer(layer.id, layer.name)}
                type="button"
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
