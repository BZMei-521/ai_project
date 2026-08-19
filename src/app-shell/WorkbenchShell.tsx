import { useState, type ReactNode } from "react";
import { getWorkbenchStatus, type WorkbenchStatusSnapshot } from "./workbenchStatus";
import { type WorkbenchStage } from "./workbenchRoutes";
import { CompactStatusBar } from "../shared/ui/CompactStatusBar";
import { StageNavigation } from "../shared/ui/StageNavigation";

export type { WorkbenchStage } from "./workbenchRoutes";

export type WorkbenchShellProps = {
  stage: WorkbenchStage;
  children: ReactNode;
  inspector?: ReactNode;
  advancedTools?: ReactNode;
  statusSnapshot?: WorkbenchStatusSnapshot;
  onStageChange?: (stage: WorkbenchStage) => void;
};

export function WorkbenchShell({
  stage,
  children,
  inspector,
  advancedTools,
  statusSnapshot,
  onStageChange
}: WorkbenchShellProps): JSX.Element {
  const [activeStage, setActiveStage] = useState<WorkbenchStage>(stage);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedStage = onStageChange ? stage : activeStage;
  const status = getWorkbenchStatus(statusSnapshot);
  const handleStageChange = (nextStage: WorkbenchStage) => {
    setActiveStage(nextStage);
    onStageChange?.(nextStage);
  };

  return (
    <div className="workbench-shell" data-workbench-shell data-stage={selectedStage}>
      <StageNavigation activeStage={selectedStage} onStageChange={handleStageChange} />
      <div className="workbench-shell-content">
        <section className="workbench-shell-stage" data-workbench-stage aria-label="当前阶段">
          {children}
        </section>
        <aside className="workbench-shell-inspector" data-workbench-inspector aria-label="当前对象检查器">
          {inspector ?? <span className="workbench-empty-inspector">未选择对象</span>}
        </aside>
      </div>
      <CompactStatusBar status={status} />
      <details
        className="workbench-advanced-tools"
        data-workbench-advanced
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>高级工具</summary>
        {advancedOpen && (
          <div className="workbench-advanced-tools-body">{advancedTools ?? <span>暂无高级工具</span>}</div>
        )}
      </details>
    </div>
  );
}
