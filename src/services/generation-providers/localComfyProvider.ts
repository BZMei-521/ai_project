import type { GenerationProvider, GenerationProviderDelegates, ProviderJobKind, ProviderJobPayload, JobResult } from "./providerContracts";

export class LocalComfyProvider implements GenerationProvider {
  private readonly delegates: GenerationProviderDelegates;

  constructor(delegates: GenerationProviderDelegates) {
    this.delegates = delegates;
  }

  private run(kind: ProviderJobKind, payload: ProviderJobPayload): Promise<JobResult> {
    const delegate = this.delegates[kind];
    if (!delegate) return Promise.reject(new Error(`LocalComfyProvider delegate unavailable for ${kind}`));
    return delegate(payload);
  }

  character = (payload: ProviderJobPayload) => this.run("character", payload);
  panorama = (payload: ProviderJobPayload) => this.run("panorama", payload);
  storyboard = (payload: ProviderJobPayload) => this.run("storyboard", payload);
  video = (payload: ProviderJobPayload) => this.run("video", payload);
  audio = (payload: ProviderJobPayload) => this.run("audio", payload);
  quality = (payload: ProviderJobPayload) => this.run("quality", payload);
  export = (payload: ProviderJobPayload) => this.run("export", payload);
}
