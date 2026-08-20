import React, { type ReactNode } from "react";
import { WORKBENCH_STAGES, type WorkbenchStage } from "./workbenchRoutes";

export type ProductionStageRailProps = {
  activeStage: WorkbenchStage;
  completedStages?: readonly WorkbenchStage[];
  attentionStages?: readonly WorkbenchStage[];
  footer?: ReactNode;
  onStageChange: (stage: WorkbenchStage) => void;
};

function getStageState(
  stage: WorkbenchStage,
  activeStage: WorkbenchStage,
  completedStages: ReadonlySet<WorkbenchStage>
): "active" | "done" | "idle" {
  if (stage === activeStage) return "active";
  if (completedStages.has(stage)) return "done";
  return "idle";
}

export function ProductionStageRail({
  activeStage,
  completedStages = [],
  attentionStages = [],
  footer,
  onStageChange
}: ProductionStageRailProps) {
  const completed = new Set(completedStages);
  const attention = new Set(attentionStages);

  return (
    <nav aria-label="制作阶段" data-director-stage-rail>
      <ol>
        {WORKBENCH_STAGES.map((route) => {
          const state = getStageState(route.stage, activeStage, completed);
          return (
            <li key={route.stage}>
              <button
                type="button"
                data-stage={route.stage}
                data-stage-state={state}
                data-stage-attention={attention.has(route.stage) ? "true" : "false"}
                aria-current={route.stage === activeStage ? "page" : undefined}
                onClick={() => onStageChange(route.stage)}
              >
                <span aria-hidden="true">{route.shortLabel}</span>
                <span>{route.label}</span>
                <span className="sr-only">{route.description}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {footer ? <div data-director-stage-rail-footer>{footer}</div> : null}
    </nav>
  );
}
