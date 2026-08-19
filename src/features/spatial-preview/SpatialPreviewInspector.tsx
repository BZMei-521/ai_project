import type { ChangeEvent } from "react";
import type { SpatialScene } from "../../domains/spatial-scene/types";
import { useSpatialPreviewStore, type SpatialPreviewTool } from "./spatialPreviewStore";

export type SpatialPreviewInspectorProps = {
  scene: SpatialScene;
  selection: string | null;
  onSelectionChange: (selection: string | null) => void;
  onSceneChange: (scene: SpatialScene) => void;
};

const tools: Array<{ id: SpatialPreviewTool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "translate", label: "Move" },
  { id: "rotate", label: "Rotate" },
  { id: "scale", label: "Scale" }
];

export function SpatialPreviewInspector({ scene, selection, onSelectionChange, onSceneChange }: SpatialPreviewInspectorProps): JSX.Element {
  const activeTool = useSpatialPreviewStore((state) => state.activeTool);
  const isDirty = useSpatialPreviewStore((state) => state.isDirty);
  const setActiveTool = useSpatialPreviewStore((state) => state.setActiveTool);
  const recordScene = useSpatialPreviewStore((state) => state.recordScene);
  const selectedObject = scene.objects.find((object) => object.id === selection);

  const updateNumber = (event: ChangeEvent<HTMLInputElement>, axis: "x" | "y" | "z") => {
    if (!selectedObject) return;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    const next = { ...selectedObject, position: { ...selectedObject.position, [axis]: value } };
    recordScene(scene);
    onSceneChange({ ...scene, revision: scene.revision + 1, objects: scene.objects.map((object) => object.id === next.id ? next : object) });
  };

  return (
    <aside aria-label="Spatial preview inspector" style={{ display: "grid", gap: 16, padding: 16, minWidth: 0, color: "#dbe7f3", background: "#17222d", border: "1px solid #2d4356" }}>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, color: "#91a6b9" }}>Object</span>
        <select value={selection ?? ""} onChange={(event) => onSelectionChange(event.target.value || null)} style={{ minHeight: 36, width: "100%", background: "#0f1821", color: "inherit", border: "1px solid #3b5367" }}>
          <option value="">Scene</option>
          {scene.objects.map((object) => <option key={object.id} value={object.id}>{object.label || object.id}</option>)}
        </select>
      </label>
      <div role="toolbar" aria-label="Transform tools" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
        {tools.map((tool) => <button type="button" key={tool.id} aria-pressed={activeTool === tool.id} onClick={() => setActiveTool(tool.id)} style={{ minHeight: 34, padding: "6px 4px", color: activeTool === tool.id ? "#101820" : "#c9d8e5", background: activeTool === tool.id ? "#79c2ff" : "#223443", border: "1px solid #3b5367", cursor: "pointer" }}>{tool.label}</button>)}
      </div>
      {selectedObject ? <div style={{ display: "grid", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{selectedObject.label || selectedObject.id}</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
          {(["x", "y", "z"] as const).map((axis) => <label key={axis} style={{ display: "grid", gap: 4, minWidth: 0 }}><span style={{ fontSize: 11, color: "#91a6b9" }}>{axis.toUpperCase()}</span><input type="number" step="0.1" value={selectedObject.position[axis]} onChange={(event) => updateNumber(event, axis)} style={{ width: "100%", boxSizing: "border-box", minHeight: 32, background: "#0f1821", color: "inherit", border: "1px solid #3b5367" }} /></label>)}
        </div>
      </div> : <p style={{ margin: 0, color: "#91a6b9", fontSize: 13 }}>Select a proxy in the preview.</p>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "#91a6b9" }}><span>Revision {scene.revision}</span><span aria-label={isDirty ? "Unsaved changes" : "Saved"}>{isDirty ? "Unsaved" : "Saved"}</span></div>
    </aside>
  );
}
