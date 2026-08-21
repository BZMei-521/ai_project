import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import type { Shot, ShotTransition } from "../../modules/storyboard-core/types";
import { parseShotScriptText, type NormalizedShotScript, type ShotScriptImportIssue } from "./shotScriptImport";
import { ShotNode } from "./ShotNode";
import { TransitionEdge } from "./TransitionEdge";

export type ScriptDirectorViewProps = {
  shots?: Shot[];
  transitions?: ShotTransition[];
  fps?: number;
  sequenceId?: string;
  selectedShotId?: string | null;
  selectedTransitionId?: string | null;
  onSelectionChange: (selection: { shotId: string | null; transitionId: string | null }) => void;
  onMoveShot?: (shotId: string, targetIndex: number) => void;
  onImportScript?: (script: NormalizedShotScript) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
};

const noop = () => undefined;

export function ScriptDirectorView({ shots = [], transitions = [], fps = 24, sequenceId = "sequence-main", selectedShotId = null, selectedTransitionId = null, onSelectionChange, onMoveShot = noop, onImportScript = noop, canUndo = false, canRedo = false, onUndo = noop, onRedo = noop }: ScriptDirectorViewProps): JSX.Element {
  const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
  const [dragOverShotId, setDragOverShotId] = useState<string | null>(null);
  const [issues, setIssues] = useState<ShotScriptImportIssue[]>([]);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (issues.length > 0) errorSummaryRef.current?.focus();
  }, [issues]);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const result = parseShotScriptText(await file.text(), { fps, sequenceId });
      if (!result.ok) { setIssues(result.issues); return; }
      setIssues([]);
      onImportScript(result.value);
    } catch {
      setIssues([{ code: "script_import_failed", path: "$", message: "无法读取镜头剧本，请检查文件后重试" }]);
    }
  };

  const importControl = <label className="script-import-trigger"><span>导入 JSON 镜头剧本</span><input id="script-shot-script-file" className="script-import-input" type="file" accept="application/json,.json" onChange={onFileChange} /></label>;
  const chainItems: ReactNode[] = [];
  const draggedShotIndex = draggedShotId ? shots.findIndex((shot) => shot.id === draggedShotId) : -1;
  shots.forEach((shot, index) => {
    const dropSide = dragOverShotId === shot.id && draggedShotIndex >= 0
      ? draggedShotIndex < index ? "right" : draggedShotIndex > index ? "left" : null
      : null;
    const onDragStart = (event: DragEvent<HTMLElement>) => {
      setDraggedShotId(shot.id);
      setDragOverShotId(null);
      event.dataTransfer?.setData("text/plain", shot.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    chainItems.push(
      <ShotNode key={shot.id} shot={shot} index={index} fps={fps} selected={selectedTransitionId === null && selectedShotId === shot.id} dropSide={dropSide} canMoveBack={index > 0} canMoveForward={index < shots.length - 1} onSelect={() => onSelectionChange({ shotId: shot.id, transitionId: null })} onMove={(offset) => onMoveShot(shot.id, index + offset)} onDragStart={onDragStart} onDragOver={(event) => { event.preventDefault(); if (draggedShotId && draggedShotId !== shot.id) setDragOverShotId(shot.id); }} onDragEnd={() => { setDraggedShotId(null); setDragOverShotId(null); }} onDrop={(event) => { event.preventDefault(); if (draggedShotId && draggedShotId !== shot.id) onMoveShot(draggedShotId, index); setDraggedShotId(null); setDragOverShotId(null); }} />
    );
    const nextShot = shots[index + 1];
    if (!nextShot) return;
    const transition = transitions.find((item) => item.fromShotId === shot.id && item.toShotId === nextShot.id);
    if (transition) chainItems.push(<TransitionEdge key={transition.id} transition={transition} selected={selectedTransitionId === transition.id} onSelect={() => onSelectionChange({ shotId: null, transitionId: transition.id })} />);
  });

  return (
    <section data-stage-view="script" aria-labelledby="script-director-heading">
      <header className="script-transition-toolbar">
        <div><p>阶段 1 · 线性导演台</p><h1 id="script-director-heading">镜头与转场</h1><small>{shots.length} 个镜头 · {transitions.length} 个转场</small></div>
        <div className="script-transition-toolbar-actions">
          <button type="button" aria-label="撤销镜头排序" disabled={!canUndo} onClick={onUndo}>撤销</button>
          <button type="button" aria-label="重做镜头排序" disabled={!canRedo} onClick={onRedo}>重做</button>
          {shots.length > 0 ? importControl : null}
        </div>
      </header>
      {issues.length > 0 ? <div ref={errorSummaryRef} className="script-import-errors" role="alert" tabIndex={-1}><strong>无法导入镜头剧本</strong><ul>{issues.map((issue) => <li key={`${issue.code}:${issue.path}`}><a href="#script-shot-script-file"><code>{issue.path}</code></a>：{issue.message}</li>)}</ul></div> : null}
      {shots.length === 0
        ? <div className="script-transition-empty"><h2>从镜头剧本开始</h2><p>导入 JSON 镜头剧本后，即可编排镜头顺序和镜头间的连续关系。</p>{importControl}</div>
        : <div className="script-shot-chain-viewport"><div data-script-shot-chain>{chainItems}</div></div>}
    </section>
  );
}
