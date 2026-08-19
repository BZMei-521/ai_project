export type WorkbenchStage =
  | "project"
  | "script"
  | "assets"
  | "preview"
  | "storyboard"
  | "production";

export type WorkbenchRoute = {
  stage: WorkbenchStage;
  label: string;
  path: string;
};

export const WORKBENCH_STAGES: readonly WorkbenchRoute[] = [
  { stage: "project", label: "项目", path: "/project" },
  { stage: "script", label: "剧本", path: "/script" },
  { stage: "assets", label: "资产", path: "/assets" },
  { stage: "preview", label: "预演", path: "/preview" },
  { stage: "storyboard", label: "分镜", path: "/storyboard" },
  { stage: "production", label: "成片", path: "/production" }
] as const;

export function getWorkbenchRoute(stage: string): WorkbenchRoute | undefined {
  return WORKBENCH_STAGES.find((route) => route.stage === stage);
}
