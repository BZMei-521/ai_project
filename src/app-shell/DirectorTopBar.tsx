import React, { type ReactNode } from "react";

export type DirectorPrimaryAction = {
  label: string;
  onInvoke: () => void;
  disabled?: boolean;
};

export type DirectorTopBarProps = {
  projectName: string;
  projectPath?: string;
  saveStatus: string;
  primaryAction?: DirectorPrimaryAction;
  projectMenuOpen?: boolean;
  projectMenu?: ReactNode;
  onOpenCommands: () => void;
  onOpenProjectMenu: () => void;
};

export function DirectorTopBar({
  projectName,
  projectPath,
  saveStatus,
  primaryAction,
  projectMenuOpen = false,
  projectMenu,
  onOpenCommands,
  onOpenProjectMenu
}: DirectorTopBarProps) {
  return (
    <header data-director-top-bar>
      <div data-director-product-mark>Director Desk</div>
      <div data-director-project>
        <button
          type="button"
          aria-label="打开项目菜单"
          aria-expanded={projectMenuOpen}
          onClick={onOpenProjectMenu}
        >
          {projectName}
        </button>
        {projectPath ? <span data-director-project-path>{projectPath}</span> : null}
        <span aria-label={`保存状态：${saveStatus}`} data-director-save-status>{saveStatus}</span>
        {projectMenuOpen && projectMenu ? <div data-director-project-menu>{projectMenu}</div> : null}
      </div>
      <div data-director-top-actions>
        <button type="button" aria-label="搜索命令" onClick={onOpenCommands}>搜索</button>
        {primaryAction ? (
          <button
            type="button"
            data-director-primary
            disabled={primaryAction.disabled}
            onClick={primaryAction.onInvoke}
          >
            {primaryAction.label}
          </button>
        ) : null}
      </div>
    </header>
  );
}
