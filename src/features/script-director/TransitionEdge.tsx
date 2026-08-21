import type { ShotTransition } from "../../modules/storyboard-core/types";

export type TransitionEdgeProps = { transition: ShotTransition; selected: boolean; onSelect: () => void };

const LABELS = { continuous: "连续动作", match_cut: "匹配剪辑", hard_cut: "硬切", scene_change: "换场" } as const;

export function TransitionEdge({ transition, selected, onSelect }: TransitionEdgeProps): JSX.Element {
  return (
    <div data-transition-edge data-type={transition.type} data-selected={selected || undefined}>
      <button type="button" aria-pressed={selected} onClick={onSelect}>{LABELS[transition.type]} · {transition.durationSeconds.toFixed(1)}s</button>
    </div>
  );
}
