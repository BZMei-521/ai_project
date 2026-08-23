import { invokeDesktopCommand, isDesktopRuntime } from "../platform/desktopBridge";

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export async function stageMogePanoramaAsset(sourcePath: string, stageId: string): Promise<{ fileName: string; filePath: string }> {
  if (!isDesktopRuntime()) throw new Error("未检测到桌面文件桥接，无法登记 ComfyUI input 资产");
  const dirs = await invokeDesktopCommand<{ inputDir?: string }>("comfy_discover_local_dirs");
  const inputDir = dirs.inputDir?.trim();
  if (!inputDir) throw new Error("未检测到 ComfyUI input 目录");
  const extension = sourcePath.match(/\.[a-zA-Z0-9]+$/)?.[0].toLowerCase() || ".png";
  const fileName = `${safeName(stageId)}_moge_panorama${extension}`;
  const result = await invokeDesktopCommand<{ filePath?: string }>("copy_file_to", {
    sourcePath,
    targetPath: `${inputDir.replace(/[\\/]$/, "")}/${fileName}`
  });
  return { fileName, filePath: result.filePath?.trim() || `${inputDir}/${fileName}` };
}
