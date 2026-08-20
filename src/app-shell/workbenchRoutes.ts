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
  shortLabel: string;
  description: string;
  path: string;
};

export const WORKBENCH_STAGES: readonly WorkbenchRoute[] = [
  { stage: "project", label: "项目", shortLabel: "项", description: "管理项目与版本", path: "/project" },
  { stage: "script", label: "剧本", shortLabel: "剧", description: "整理故事与场次", path: "/script" },
  { stage: "assets", label: "资产", shortLabel: "资", description: "准备角色场景道具", path: "/assets" },
  { stage: "preview", label: "预演", shortLabel: "演", description: "确认空间姿态机位", path: "/preview" },
  { stage: "storyboard", label: "分镜", shortLabel: "镜", description: "生成筛选修订镜头", path: "/storyboard" },
  { stage: "production", label: "成片", shortLabel: "片", description: "装配检查导出影片", path: "/production" }
] as const;

export function getWorkbenchRoute(stage: string): WorkbenchRoute | undefined {
  return WORKBENCH_STAGES.find((route) => route.stage === stage);
}
