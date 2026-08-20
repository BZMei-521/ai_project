import { WORKBENCH_STAGES, type WorkbenchStage } from "./workbenchRoutes";

export const LAST_WORKBENCH_STAGE_KEY = "storyboard-pro/director-desk/last-stage/v1";

type StageStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StageStorage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function normalizeWorkbenchStage(
  value: unknown,
  fallback: WorkbenchStage = "project"
): WorkbenchStage {
  return typeof value === "string" && WORKBENCH_STAGES.some(({ stage }) => stage === value)
    ? value as WorkbenchStage
    : fallback;
}

export function readLastWorkbenchStage(storage: StageStorage | null = browserStorage()): WorkbenchStage {
  if (!storage) return "project";
  try { return normalizeWorkbenchStage(storage.getItem(LAST_WORKBENCH_STAGE_KEY)); }
  catch { return "project"; }
}

export function writeLastWorkbenchStage(
  stage: WorkbenchStage,
  storage: StageStorage | null = browserStorage()
): void {
  if (!storage) return;
  try { storage.setItem(LAST_WORKBENCH_STAGE_KEY, stage); } catch { /* unavailable storage */ }
}
