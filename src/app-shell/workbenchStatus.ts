export type WorkbenchStatus = {
  save: string;
  engine: string;
  task: string;
};

export type WorkbenchStatusSnapshot = {
  save?: unknown;
  saveState?: unknown;
  saveStatus?: unknown;
  engine?: unknown;
  engineState?: unknown;
  engineStatus?: unknown;
  task?: unknown;
  taskState?: unknown;
  taskStatus?: unknown;
  persistence?: { status?: unknown };
  generationTasks?: readonly unknown[];
};

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function getWorkbenchStatus(snapshot: WorkbenchStatusSnapshot | null | undefined): WorkbenchStatus {
  const source = snapshot ?? {};
  const taskFallback = source.generationTasks && source.generationTasks.length > 0 ? "处理中" : "空闲";
  return {
    save: firstText(source.save, source.saveState, source.saveStatus, source.persistence?.status) ?? "未保存",
    engine: firstText(source.engine, source.engineState, source.engineStatus) ?? "待机",
    task: firstText(source.task, source.taskState, source.taskStatus) ?? taskFallback
  };
}
