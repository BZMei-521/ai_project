import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  selectActiveLayerIdForSelectedShot,
  selectSelectedShot,
  selectSelectedShotLayers,
  selectSelectedShotStrokes,
  useStoryboardStore
} from "../storyboard-core/store";

export function CanvasViewport() {
  const selectedShot = useStoryboardStore(selectSelectedShot);
  const selectedShotLayers = useStoryboardStore(selectSelectedShotLayers);
  const activeLayerId = useStoryboardStore(selectActiveLayerIdForSelectedShot);
  const selectedShotStrokes = useStoryboardStore(selectSelectedShotStrokes);
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore((state) => state.shots);
  const shotStrokes = useStoryboardStore((state) => state.shotStrokes);
  const canvasTool = useStoryboardStore((state) => state.canvasTool);
  const setCanvasMode = useStoryboardStore((state) => state.setCanvasMode);
  const setBrushColor = useStoryboardStore((state) => state.setBrushColor);
  const setBrushSize = useStoryboardStore((state) => state.setBrushSize);
  const setOnionSkinEnabled = useStoryboardStore((state) => state.setOnionSkinEnabled);
  const setOnionSkinRange = useStoryboardStore((state) => state.setOnionSkinRange);
  const addStroke = useStoryboardStore((state) => state.addStroke);
  const undoStroke = useStoryboardStore((state) => state.undoStroke);
  const redoStroke = useStoryboardStore((state) => state.redoStroke);
  const shotHistory = useStoryboardStore((state) => state.shotHistory);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeStroke, setActiveStroke] = useState<{ x: number; y: number }[]>([]);

  const ratio = useMemo(() => project.width / project.height, [project.height, project.width]);
  const selectedShotId = selectedShot?.id ?? "";
  const activeLayer = selectedShotLayers.find((layer) => layer.id === activeLayerId);
  const canUndo = (shotHistory[selectedShotId]?.past.length ?? 0) > 0;
  const canRedo = (shotHistory[selectedShotId]?.future.length ?? 0) > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f8fbff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const drawStroke = (
      points: { x: number; y: number }[],
      color: string,
      size: number,
      alpha = 1
    ) => {
      const safePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (safePoints.length === 0) return;
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.lineWidth = size;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(safePoints[0].x, safePoints[0].y);
      for (const point of safePoints.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      context.stroke();
      context.restore();
    };

    if (canvasTool.onionSkinEnabled && selectedShotId) {
      const index = shots.findIndex((shot) => shot.id === selectedShotId);
      if (index >= 0) {
        for (let offset = 1; offset <= canvasTool.onionSkinRange; offset += 1) {
          const prev = shots[index - offset];
          const next = shots[index + offset];
          const alpha = Math.max(0.08, 0.22 - offset * 0.06);
          if (prev) {
            for (const stroke of shotStrokes[prev.id] ?? []) {
              drawStroke(stroke.points, "#64748b", stroke.size, alpha);
            }
          }
          if (next) {
            for (const stroke of shotStrokes[next.id] ?? []) {
              drawStroke(stroke.points, "#1d4ed8", stroke.size, alpha);
            }
          }
        }
      }
    }

    for (const stroke of selectedShotStrokes) {
      const layer = stroke.layerId
        ? selectedShotLayers.find((item) => item.id === stroke.layerId)
        : undefined;
      if (layer && !layer.visible) continue;
      drawStroke(stroke.points, stroke.color, stroke.size);
    }

    drawStroke(activeStroke, canvasTool.brushColor, canvasTool.brushSize);
  }, [
    activeStroke,
    canvasTool.brushColor,
    canvasTool.brushSize,
    canvasTool.onionSkinEnabled,
    canvasTool.onionSkinRange,
    selectedShotId,
    selectedShotLayers,
    selectedShotStrokes,
    shotStrokes,
    shots
  ]);

  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scaleX = event.currentTarget.width / rect.width;
    const scaleY = event.currentTarget.height / rect.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x,
      y
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!selectedShotId) return;
    if (canvasTool.mode === "select") return;
    if (canvasTool.mode === "erase") {
      undoStroke(selectedShotId);
      return;
    }
    if (!activeLayer || !activeLayer.visible || activeLayer.locked) return;
    const point = toCanvasPoint(event);
    if (!point) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture errors in environments with partial pointer-capture support.
    }
    setActiveStroke([point]);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (canvasTool.mode !== "draw") return;
    if (activeStroke.length === 0) return;
    const point = toCanvasPoint(event);
    if (!point) return;
    setActiveStroke((previous) => [...previous, point]);
  };

  const onPointerUp = () => {
    const safePoints = activeStroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!selectedShotId || safePoints.length < 2) {
      setActiveStroke([]);
      return;
    }

    addStroke(selectedShotId, {
      id: `${selectedShotId}_${Date.now()}`,
      points: safePoints,
      color: canvasTool.brushColor,
      size: canvasTool.brushSize,
      layerId: activeLayerId
    });
    setActiveStroke([]);
  };

  return (
    <section className="panel canvas-panel">
      <header className="panel-header">
        <h2>画布</h2>
        <span>{project.width}x{project.height} · {project.fps}fps</span>
      </header>
      <div className="canvas-modebar">
        <button
          className={canvasTool.mode === "draw" ? "active" : ""}
          onClick={() => setCanvasMode("draw")}
          type="button"
        >
          绘制
        </button>
        <button
          className={canvasTool.mode === "select" ? "active" : ""}
          onClick={() => setCanvasMode("select")}
          type="button"
        >
          选择
        </button>
        <button
          className={canvasTool.mode === "erase" ? "active" : ""}
          onClick={() => setCanvasMode("erase")}
          type="button"
        >
          擦除
        </button>
      </div>
      <div className="canvas-frame" style={{ aspectRatio: String(ratio) }}>
        <canvas
          className="draw-canvas"
          height={project.height}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerLeave={onPointerUp}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          ref={canvasRef}
          style={{
            cursor:
              canvasTool.mode === "draw"
                ? "crosshair"
                : canvasTool.mode === "erase"
                  ? "not-allowed"
                  : "default"
          }}
          width={project.width}
        />
        <div className="canvas-toolbar">
          <p className="canvas-toolbar-title">{selectedShot?.title ?? "未选择镜头"}</p>
          <div className="canvas-toolbar-grid">
            <label>
              颜色
              <input
                onChange={(event) => setBrushColor(event.target.value)}
                type="color"
                value={canvasTool.brushColor}
              />
            </label>
            <label>
              大小
              <input
                max={64}
                min={1}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                type="range"
                value={canvasTool.brushSize}
              />
              <small>{canvasTool.brushSize}px</small>
            </label>
            <label className="canvas-check">
              <input
                checked={canvasTool.onionSkinEnabled}
                onChange={(event) => setOnionSkinEnabled(event.target.checked)}
                type="checkbox"
              />
              洋葱皮
            </label>
            <label>
              范围
              <input
                max={3}
                min={1}
                onChange={(event) => setOnionSkinRange(Number(event.target.value))}
                type="range"
                value={canvasTool.onionSkinRange}
              />
              <small>{canvasTool.onionSkinRange}</small>
            </label>
          </div>
          <div className="toolbar-actions">
            <button className="btn-ghost" disabled={!canUndo} onClick={() => undoStroke(selectedShotId)} type="button">
              撤销
            </button>
            <button className="btn-ghost" disabled={!canRedo} onClick={() => redoStroke(selectedShotId)} type="button">
              重做
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
