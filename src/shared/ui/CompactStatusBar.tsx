import type { WorkbenchStatus } from "../../app-shell/workbenchStatus";

export type CompactStatusBarProps = {
  status: WorkbenchStatus;
};

export function CompactStatusBar({ status }: CompactStatusBarProps): JSX.Element {
  return (
    <footer className="compact-status-bar" data-workbench-status aria-label="工作台状态">
      <span className="compact-status-item"><strong>保存</strong>{status.save}</span>
      <span className="compact-status-item"><strong>引擎</strong>{status.engine}</span>
      <span className="compact-status-item"><strong>任务</strong>{status.task}</span>
    </footer>
  );
}
