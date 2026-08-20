export type DirectorCommandId =
  | "project.create" | "project.open" | "project.rename" | "project.delete"
  | "project.save" | "project.load" | "backup.export" | "backup.import"
  | "app.settings" | "app.help" | "app.nodeflow" | "app.advanced";

export type DirectorCommand = {
  id: DirectorCommandId;
  label: string;
  keywords: readonly string[];
  shortcut?: string;
  danger?: boolean;
  run: () => void;
};

export type DirectorCommandActions = {
  createProject: () => void; openProject: () => void; renameProject: () => void;
  deleteProject: () => void; saveProject: () => void; loadProject: () => void;
  exportBackup: () => void; importBackup: () => void; openSettings: () => void;
  openHelp: () => void; openNodeflow: () => void; openAdvancedTools: () => void;
};

export function buildDirectorCommands(actions: DirectorCommandActions): DirectorCommand[] {
  return [
    { id: "project.create", label: "新建项目", keywords: [], run: actions.createProject },
    { id: "project.open", label: "打开项目", keywords: [], run: actions.openProject },
    { id: "project.rename", label: "重命名项目", keywords: [], run: actions.renameProject },
    { id: "project.delete", label: "删除项目", keywords: [], danger: true, run: actions.deleteProject },
    { id: "project.save", label: "保存项目", keywords: [], run: actions.saveProject },
    { id: "project.load", label: "加载桌面快照", keywords: [], run: actions.loadProject },
    { id: "backup.export", label: "导出备份", keywords: ["备份"], run: actions.exportBackup },
    { id: "backup.import", label: "导入备份", keywords: ["备份"], run: actions.importBackup },
    { id: "app.settings", label: "项目设置", keywords: [], run: actions.openSettings },
    { id: "app.help", label: "帮助", keywords: [], run: actions.openHelp },
    { id: "app.nodeflow", label: "导演工作流", keywords: [], run: actions.openNodeflow },
    { id: "app.advanced", label: "高级工具", keywords: [], run: actions.openAdvancedTools }
  ];
}

export function searchDirectorCommands(
  commands: readonly DirectorCommand[],
  query: string
): DirectorCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...commands];
  return commands.filter(({ label, keywords }) =>
    [label, ...keywords].some((value) => value.toLocaleLowerCase().includes(needle))
  );
}
