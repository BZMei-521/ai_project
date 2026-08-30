export const CODEX_STORYBOARD_REFERENCE_USAGES = [
  "spatial_authority", "pose_reference", "face_identity", "body_costume",
  "prop_detail", "style_only", "lighting_only", "negative_example"
] as const;

export type CodexStoryboardReferenceUsage = typeof CODEX_STORYBOARD_REFERENCE_USAGES[number];
export type CodexStoryboardReference = { id: string; usage: CodexStoryboardReferenceUsage; instruction: string; relativePath: string; sha256: string; width: number; height: number; mimeType: "image/png" | "image/jpeg" };
export type CodexStoryboardRequest = {
  schemaVersion: 1; jobId: string; projectId: string; episodeId: string; shotId: string; provider: "codex_task_package"; createdAt: string;
  prompt: { useCase: "stylized-concept"; primaryRequest: string; [key: string]: unknown };
  references: CodexStoryboardReference[]; acceptedImagePath: string | null;
  expectedOutput: { candidatePath: "outputs/candidate.png"; resultPath: "outputs/result.json"; mimeTypes: ["image/png"] };
};
export type CodexStoryboardResult = {
  schemaVersion: 1; jobId: string; projectId: string; episodeId: string; shotId: string; provider: "codex_task_package"; requestDigest: string;
  referenceDigests: Array<Pick<CodexStoryboardReference, "id" | "sha256">>; generationMode: "codex_builtin_imagegen" | "user_authorized_local_deterministic_crop"; finalPrompt: string;
  derivedTransform?: { operation: "user_authorized_local_deterministic_crop"; authorization: { observedAt: string; context: string }; tool: { name: "ffmpeg"; generative: false; filter: string }; source: { absolutePath: string; sha256: string; width: number; height: number }; cropRectangle: { x: number; y: number; width: number; height: number }; output: { absolutePath: string; sha256: string; width: number; height: number }; pixelExactCrop: true };
  output: { relativePath: "outputs/candidate.png"; sha256: string; width: number; height: number; mimeType: "image/png" }; completedAt: string; state: "completed";
};
export type CodexStoryboardImageSpec = { taxonomy: "stylized-concept"; assetType: "AI comic-drama storyboard frame"; referenceUsages: CodexStoryboardReferenceUsage[]; referencedRelativePaths: string[]; compiledPrompt: string };
export type CodexStoryboardExportReceipt = { jobId: string; packagePath: string; requestDigest: string };
export type CodexStoryboardImportReceipt = { jobId: string; resultPath: string; result: CodexStoryboardResult };
