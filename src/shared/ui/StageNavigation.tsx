import { type ReactNode } from "react";
import { WORKBENCH_STAGES, type WorkbenchStage } from "../../app-shell/workbenchRoutes";

export type StageNavigationProps = {
  activeStage: WorkbenchStage;
  onStageChange?: (stage: WorkbenchStage) => void;
  footer?: ReactNode;
};

export function StageNavigation({ activeStage, onStageChange, footer }: StageNavigationProps): JSX.Element {
  return (
    <nav aria-label="工作台阶段" className="stage-navigation" data-workbench-navigation>
      <div className="stage-navigation-brand">空间导演</div>
      <div className="stage-navigation-list" role="list">
        {WORKBENCH_STAGES.map((route) => (
          <button
            aria-current={activeStage === route.stage ? "page" : undefined}
            aria-label={route.label}
            className={activeStage === route.stage ? "stage-navigation-item active" : "stage-navigation-item"}
            key={route.stage}
            onClick={() => onStageChange?.(route.stage)}
            type="button"
          >
            <span className="stage-navigation-index" aria-hidden="true">{WORKBENCH_STAGES.indexOf(route) + 1}</span>
            <span>{route.label}</span>
          </button>
        ))}
      </div>
      {footer}
    </nav>
  );
}
