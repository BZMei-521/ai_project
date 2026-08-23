import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";
import { DirectorTopBar, type DirectorPrimaryAction } from "./DirectorTopBar";
import { ObjectInspectorDrawer } from "./ObjectInspectorDrawer";
import { ProductionStageRail } from "./ProductionStageRail";
import { type DirectorCommand } from "./directorDeskCommands";
import { getWorkbenchStatus, type WorkbenchStatusSnapshot } from "./workbenchStatus";
import { type WorkbenchStage } from "./workbenchRoutes";
import { CompactStatusBar } from "../shared/ui/CompactStatusBar";

export type { WorkbenchStage } from "./workbenchRoutes";

export type WorkbenchShellProps = {
  stage: WorkbenchStage;
  children: ReactNode;
  inspector?: ReactNode;
  advancedTools?: ReactNode;
  statusSnapshot?: WorkbenchStatusSnapshot;
  projectName?: string;
  projectPath?: string;
  primaryAction?: DirectorPrimaryAction;
  commands?: readonly DirectorCommand[];
  completedStages?: readonly WorkbenchStage[];
  attentionStages?: readonly WorkbenchStage[];
  advancedToolsOpen?: boolean;
  onAdvancedToolsOpenChange?: (open: boolean) => void;
  onStageChange?: (stage: WorkbenchStage) => void;
};

const PROJECT_MENU_COMMAND_IDS = new Set<DirectorCommand["id"]>([
  "project.create",
  "project.open",
  "project.rename",
  "project.delete",
  "project.save",
  "project.load",
  "backup.export",
  "backup.import",
  "app.settings",
  "app.help"
]);

export function WorkbenchShell({
  stage,
  children,
  inspector,
  advancedTools,
  statusSnapshot,
  projectName = "未命名项目",
  projectPath,
  primaryAction,
  commands,
  completedStages,
  attentionStages,
  advancedToolsOpen,
  onAdvancedToolsOpenChange,
  onStageChange
}: WorkbenchShellProps): JSX.Element {
  const [activeStage, setActiveStage] = useState<WorkbenchStage>(stage);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [uncontrolledAdvancedOpen, setUncontrolledAdvancedOpen] = useState(false);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);
  const commandOpenerRef = useRef<HTMLElement | null>(null);
  const projectMenuButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const advancedCloseRef = useRef<HTMLButtonElement>(null);
  const advancedReturnFocusRef = useRef<HTMLElement | null>(null);
  const shellContentRef = useRef<HTMLDivElement>(null);
  const selectedStage = onStageChange ? stage : activeStage;
  const status = getWorkbenchStatus(statusSnapshot);
  const advancedOpen = advancedToolsOpen ?? uncontrolledAdvancedOpen;
  const setAdvancedOpen = useCallback((open: boolean) => {
    setUncontrolledAdvancedOpen(open);
    onAdvancedToolsOpenChange?.(open);
  }, [onAdvancedToolsOpenChange]);
  const activeElement = useCallback(() => {
    if (typeof document === "undefined" || typeof HTMLElement === "undefined") return null;
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const closeAdvanced = useCallback((restoreFocus = true) => {
    setAdvancedOpen(false);
    const returnTarget = advancedReturnFocusRef.current;
    advancedReturnFocusRef.current = null;
    if (restoreFocus) queueMicrotask(() => returnTarget?.focus());
  }, [setAdvancedOpen]);
  const openCommands = useCallback((opener?: HTMLElement | null) => {
    commandOpenerRef.current = opener ?? activeElement();
    setProjectMenuOpen(false);
    if (advancedOpen) closeAdvanced(false);
    setCommandsOpen(true);
  }, [activeElement, advancedOpen, closeAdvanced]);
  const effectiveCommands = (commands ?? []).map((command) => (
    command.id === "app.advanced"
      ? {
          ...command,
          run: () => {
            advancedReturnFocusRef.current = commandOpenerRef.current ?? activeElement();
            setProjectMenuOpen(false);
            setAdvancedOpen(true);
          }
        }
      : command
  ));
  const projectMenuCommands = effectiveCommands.filter((command) => PROJECT_MENU_COMMAND_IDS.has(command.id));

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (!event.metaKey && !event.ctrlKey) ||
        event.key.toLocaleLowerCase() !== "k"
      ) return;

      event.preventDefault();
      openCommands(activeElement());
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeElement, openCommands]);

  useEffect(() => {
    if (!advancedOpen) return;
    if (!advancedReturnFocusRef.current) advancedReturnFocusRef.current = commandOpenerRef.current ?? activeElement();
    queueMicrotask(() => advancedCloseRef.current?.focus());
  }, [activeElement, advancedOpen]);

  useEffect(() => {
    const shellContent = shellContentRef.current;
    if (!shellContent) return;
    if (commandsOpen) shellContent.setAttribute("inert", "");
    else shellContent.removeAttribute("inert");
    return () => shellContent.removeAttribute("inert");
  }, [commandsOpen]);

  useEffect(() => {
    if (!projectMenuOpen || typeof document === "undefined") return;
    queueMicrotask(() => projectMenuRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus());

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (projectMenuRef.current?.contains(target) || projectMenuButtonRef.current?.contains(target))) return;
      setProjectMenuOpen(false);
    };
    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProjectMenuOpen(false);
      queueMicrotask(() => projectMenuButtonRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleMenuKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, [projectMenuOpen]);
  const handleStageChange = (nextStage: WorkbenchStage) => {
    setActiveStage(nextStage);
    onStageChange?.(nextStage);
  };
  const handleAdvancedKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeAdvanced();
  };
  return (
    <div className="director-desk" data-director-desk data-stage={selectedStage}>
      <div
        ref={shellContentRef}
        data-director-shell-content
        aria-hidden={commandsOpen ? true : undefined}
      >
        <a className="director-skip-link" href="#director-workspace">跳到制作工作区</a>
        <DirectorTopBar
          projectName={projectName}
          projectPath={projectPath}
          saveStatus={status.save}
          primaryAction={primaryAction}
          projectMenuOpen={projectMenuOpen}
          commandTriggerRef={commandTriggerRef}
          projectMenuButtonRef={projectMenuButtonRef}
          projectMenuRef={projectMenuRef}
          projectMenu={(
            <div>
              {projectMenuCommands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  data-danger={command.danger ? "true" : undefined}
                  onClick={() => {
                    setProjectMenuOpen(false);
                    command.run();
                  }}
                >
                  {command.label}
                </button>
              ))}
            </div>
          )}
          onOpenCommands={() => openCommands(commandTriggerRef.current)}
          onOpenProjectMenu={() => {
            if (!projectMenuOpen && advancedOpen) closeAdvanced(false);
            setCommandsOpen(false);
            setProjectMenuOpen((open) => !open);
          }}
        />
        <ProductionStageRail
          activeStage={selectedStage}
          completedStages={completedStages}
          attentionStages={attentionStages}
          footer={<CompactStatusBar status={status} />}
          onStageChange={handleStageChange}
        />
        <section
          id="director-workspace"
          className="director-desk-workspace"
          data-workbench-stage
          aria-label="制作工作区"
          tabIndex={-1}
        >
          {children}
          {!inspectorOpen && (
            <button type="button" aria-label="打开当前对象检查器" onClick={() => setInspectorOpen(true)}>
              打开当前对象检查器
            </button>
          )}
        </section>
        <ObjectInspectorDrawer open={inspectorOpen} title="当前对象" onClose={() => setInspectorOpen(false)}>
          {inspector}
        </ObjectInspectorDrawer>
        {advancedOpen && (
          <aside className="director-advanced-drawer" role="dialog" aria-label="高级工具" onKeyDown={handleAdvancedKeyDown}>
            <button ref={advancedCloseRef} type="button" aria-label="关闭高级工具" onClick={() => closeAdvanced()}>关闭</button>
            {advancedTools}
          </aside>
        )}
      </div>
      <CommandPalette open={commandsOpen} commands={effectiveCommands} onClose={() => setCommandsOpen(false)} />
    </div>
  );
}
