export type ProviderJobKind = "character" | "panorama" | "storyboard" | "video" | "audio" | "quality" | "export";

export type ProviderJobPayload = {
  requestId?: string;
  workflowId?: string;
  inputPaths?: string[];
  outputPath?: string;
  [key: string]: unknown;
};

export type JobResult = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  outputPath?: string;
  errorMessage?: string;
};

export type GenerationProvider = {
  character: (payload: ProviderJobPayload) => Promise<JobResult>;
  panorama: (payload: ProviderJobPayload) => Promise<JobResult>;
  storyboard: (payload: ProviderJobPayload) => Promise<JobResult>;
  video: (payload: ProviderJobPayload) => Promise<JobResult>;
  audio: (payload: ProviderJobPayload) => Promise<JobResult>;
  quality: (payload: ProviderJobPayload) => Promise<JobResult>;
  export: (payload: ProviderJobPayload) => Promise<JobResult>;
};

export type GenerationProviderDelegates = GenerationProvider;
