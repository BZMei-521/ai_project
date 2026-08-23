import type { StageCapabilityReport } from "./types";
import { auditMogeWorkflow, buildMogePanoramaWorkflow, type MogeWorkflowOptions } from "./mogeWorkflow";

export type MogeOutputReferences = { depthUrl: string; normalUrl: string; maskUrl: string };
export type MogeTransport = { queue(workflow: Record<string, unknown>): Promise<string>; wait?(promptId: string): Promise<{ outputs?: MogeOutputReferences }> };
export type MogeInitializationResult = { status: "queued" | "completed" | "manual_fallback" | "failed"; promptId?: string; outputs?: MogeOutputReferences; errors: string[]; workflow?: Record<string, unknown> };

export async function runMogeInitialization(options: MogeWorkflowOptions, capabilities: Pick<StageCapabilityReport, "overall" | "mogeNode" | "mogeModel">, transport?: MogeTransport): Promise<MogeInitializationResult> {
  const workflow = buildMogePanoramaWorkflow(options);
  const audit = auditMogeWorkflow(workflow);
  if (!audit.valid) return { status: "failed", errors: audit.errors, workflow };
  const unavailable = capabilities.overall !== "available" || capabilities.mogeNode.status !== "available" || capabilities.mogeModel.status !== "available";
  if (unavailable || !transport) return { status: "manual_fallback", errors: ["MoGe capability or transport unavailable"], workflow };
  try {
    const promptId = await transport.queue(workflow);
    if (!transport.wait) return { status: "queued", promptId, errors: [], workflow };
    const completed = await transport.wait(promptId);
    if (!completed.outputs) return { status: "failed", promptId, errors: ["ComfyUI completed without MoGe image outputs"], workflow };
    return { status: "completed", promptId, outputs: completed.outputs, errors: [], workflow };
  }
  catch (error) { return { status: "failed", errors: [error instanceof Error ? error.message : String(error)], workflow }; }
}
