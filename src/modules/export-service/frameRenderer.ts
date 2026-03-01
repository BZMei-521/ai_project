import type { Shot, ShotLayer } from "../storyboard-core/types";
import type { Stroke } from "../storyboard-core/store";

export type RenderedFrame = {
  pngBase64: string;
  durationFrames: number;
};

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke
): void {
  if (stroke.points.length === 0) return;

  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);

  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x, point.y);
  }

  context.stroke();
}

async function canvasToBase64(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (!value) {
        reject(new Error("Unable to convert canvas to PNG blob"));
        return;
      }
      resolve(value);
    }, "image/png");
  });

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export async function renderShotsToFrames(
  shots: Shot[],
  shotStrokes: Record<string, Stroke[]>,
  layers: ShotLayer[],
  width: number,
  height: number,
  options?: {
    onProgress?: (progress: number, message: string) => void;
    signal?: AbortSignal;
  }
): Promise<RenderedFrame[]> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  const output: RenderedFrame[] = [];

  for (const [index, shot] of shots.entries()) {
    if (options?.signal?.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f8fbff";
    context.fillRect(0, 0, width, height);

    const shotLayers = layers
      .filter((layer) => layer.shotId === shot.id && layer.visible)
      .sort((a, b) => a.zIndex - b.zIndex);
    const layerOrder = new Map<string, number>();
    shotLayers.forEach((layer, layerIndex) => layerOrder.set(layer.id, layerIndex));

    const strokes = [...(shotStrokes[shot.id] ?? [])].sort((a, b) => {
      const aOrder = a.layerId ? (layerOrder.get(a.layerId) ?? -1) : -1;
      const bOrder = b.layerId ? (layerOrder.get(b.layerId) ?? -1) : -1;
      return aOrder - bOrder;
    });
    for (const stroke of strokes) {
      drawStroke(context, stroke);
    }

    const overlayHeight = Math.max(84, Math.round(height * 0.12));
    context.fillStyle = "rgba(15, 23, 42, 0.78)";
    context.fillRect(0, height - overlayHeight, width, overlayHeight);

    context.fillStyle = "#f8fafc";
    context.font = "bold 24px sans-serif";
    context.fillText(
      `Shot ${index + 1}: ${shot.title || "Untitled"} (${shot.durationFrames}f)`,
      24,
      height - overlayHeight + 34
    );

    context.font = "18px sans-serif";
    const dialogue = shot.dialogue?.trim() ? shot.dialogue : shot.notes || "-";
    const clipped = dialogue.length > 120 ? `${dialogue.slice(0, 117)}...` : dialogue;
    context.fillText(clipped, 24, height - overlayHeight + 64);

    const pngBase64 = await canvasToBase64(canvas);
    output.push({
      pngBase64,
      durationFrames: shot.durationFrames
    });

    options?.onProgress?.(
      (index + 1) / Math.max(shots.length, 1) * 0.85,
      `Rendering shot ${index + 1}/${shots.length}`
    );
  }

  return output;
}
