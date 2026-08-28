import type { CodexStoryboardExportReceipt, CodexStoryboardRequest } from "./codexTaskPackage";
import type { GenerationProvider, JobResult, ProviderJobKind, ProviderJobPayload } from "./providerContracts";

export type CodexTaskPackageProviderOptions<TRequest = CodexStoryboardRequest> = { exportStoryboardJob: (request: TRequest) => Promise<CodexStoryboardExportReceipt> };

export class CodexTaskPackageProvider<TRequest = CodexStoryboardRequest> implements GenerationProvider {
  private readonly exportStoryboardJob: CodexTaskPackageProviderOptions<TRequest>["exportStoryboardJob"];

  constructor({ exportStoryboardJob }: CodexTaskPackageProviderOptions<TRequest>) { this.exportStoryboardJob = exportStoryboardJob; }

  private unsupported(kind: Exclude<ProviderJobKind, "storyboard">): Promise<JobResult> {
    return Promise.reject(new Error(`codex_task_package_unsupported_job_kind:${kind}`));
  }

  async storyboard(payload: ProviderJobPayload): Promise<JobResult> {
    const receipt = await this.exportStoryboardJob(payload.request as TRequest);
    return { jobId: receipt.jobId, status: "queued", outputPath: receipt.packagePath, metadata: { provider: "codex_task_package", requestDigest: receipt.requestDigest } };
  }

  character = (_payload: ProviderJobPayload) => this.unsupported("character");
  panorama = (_payload: ProviderJobPayload) => this.unsupported("panorama");
  video = (_payload: ProviderJobPayload) => this.unsupported("video");
  audio = (_payload: ProviderJobPayload) => this.unsupported("audio");
  quality = (_payload: ProviderJobPayload) => this.unsupported("quality");
  export = (_payload: ProviderJobPayload) => this.unsupported("export");
}
