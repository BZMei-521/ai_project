import type { DragEvent } from "react";
import type { Shot } from "../../modules/storyboard-core/types";
import { toDesktopMediaSource } from "../../modules/platform/desktopBridge";

export type ShotNodeProps = {
  shot: Shot;
  index: number;
  fps: number;
  selected: boolean;
  dropTarget: boolean;
  canMoveBack: boolean;
  canMoveForward: boolean;
  onSelect: () => void;
  onMove: (offset: -1 | 1) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export function ShotNode({ shot, index, fps, selected, dropTarget, canMoveBack, canMoveForward, onSelect, onMove, onDragStart, onDragOver, onDragEnd, onDrop }: ShotNodeProps): JSX.Element {
  const status = shot.generatedVideoPath ? "已生成" : shot.generatedImagePath ? "分镜就绪" : "待生成";
  return (
    <article data-shot-node data-selected={selected || undefined} data-drop-target={dropTarget || undefined} draggable onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDrop={onDrop}>
      <button type="button" className="script-shot-select" aria-pressed={selected} onClick={onSelect}>
        <span className="script-shot-thumb">{shot.generatedImagePath ? <img src={toDesktopMediaSource(shot.generatedImagePath)} alt="" /> : <span>暂无画面</span>}</span>
        <strong>{String(index + 1).padStart(2, "0")} · {shot.title}</strong>
        <small>{(shot.durationFrames / Math.max(1, fps)).toFixed(1)} 秒 · {status}</small>
      </button>
      <span className="script-shot-order-actions">
        <button type="button" aria-label={`镜头 ${shot.title} 向前移动`} disabled={!canMoveBack} onClick={() => onMove(-1)}>←</button>
        <button type="button" aria-label={`镜头 ${shot.title} 向后移动`} disabled={!canMoveForward} onClick={() => onMove(1)}>→</button>
      </span>
    </article>
  );
}
