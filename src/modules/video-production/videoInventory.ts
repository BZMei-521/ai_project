import { fetchComfyObjectInfo } from "../comfy-pipeline/comfyService";
import type { VideoWorkflowInventory } from "./workflowProfiles";

// @ts-ignore Plain ESM keeps inventory extraction executable in the contract checker.
import { inventoryFromComfyObjectInfo } from "./videoInventoryRuntime.mjs";

export async function inspectVideoProductionInventory(baseUrl: string): Promise<VideoWorkflowInventory> {
  return inventoryFromComfyObjectInfo(await fetchComfyObjectInfo(baseUrl)) as VideoWorkflowInventory;
}
