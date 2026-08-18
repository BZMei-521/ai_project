import { createVideoQualityReport, createVideoArtifactBinding, artifactBindingsEqual, evaluateVideoQuality } from "./videoQualityRuntime.mjs";

export function createVideoProductionController(dependencies = {}) {
  const required = ["beginRun", "stage", "probe", "normalize", "extractReviewFrames", "verifyCredential", "persistEvidence", "generateShot"];
  for (const name of required) if (typeof dependencies[name] !== "function") throw new Error(`video_controller_dependency_missing:${name}`);

  async function processGeneratedShot(input) {
    const pending = baseEvidence(input, "processing");
    dependencies.persistEvidence(input.shotId, pending);
    try {
      const runCapability = await dependencies.beginRun();
      const staged = await dependencies.stage({ runCapability, inputPath: input.generatedVideoPath });
      await dependencies.probe({ inputPath: staged.stagedPath, projectAssetsDir: staged.projectAssetsDir });
      const normalized = await dependencies.normalize({
        runCapability, inputPath: staged.stagedPath, projectAssetsDir: staged.projectAssetsDir,
        segmentId: safeSegmentId(input.shotId), projectWidth: input.projectWidth,
        projectHeight: input.projectHeight, durationFrames: input.durationFrames
      });
      const reviewFrames = await dependencies.extractReviewFrames({ runCapability, projectAssetsDir: staged.projectAssetsDir, credential: normalized.credential });
      const verified = await dependencies.verifyCredential({ projectAssetsDir: staged.projectAssetsDir, credential: normalized.credential });
      const qualityInput = { normalized: true, normalizationCredential: normalized.credential, inspection: verified, reviewFrames, boundaryFrame: input.boundary?.sharedFramePath };
      if (stable(normalized.probe) !== stable(verified.probe) || stable(normalized.anomalies) !== stable(verified.anomalies)) throw new Error("credential_verification_mismatch");
      const qualityReport = createVideoQualityReport(input.shotId, qualityInput);
      const evidence = {
        ...baseEvidence(input, "ready"), projectAssetsDir: staged.projectAssetsDir, runCapability,
        stagingReceiptId: staged.stagingReceiptId, normalizationCredential: normalized.credential,
        inspection: verified, reviewFrames, artifactBinding: createVideoArtifactBinding(qualityInput), qualityReport
      };
      dependencies.persistEvidence(input.shotId, evidence);
      return evidence;
    } catch (error) {
      const failed = { ...pending, status: "failed", failureReason: String(error instanceof Error ? error.message : error) };
      dependencies.persistEvidence(input.shotId, failed);
      throw error;
    }
  }

  async function verifyForDecision(evidence) {
    if (!evidence || evidence.status !== "ready") throw new Error("video_evidence_not_ready");
    const verified = await dependencies.verifyCredential({ projectAssetsDir: evidence.projectAssetsDir, credential: evidence.normalizationCredential });
    if (evidence.assemblyReceipt) {
      if (typeof dependencies.verifyAssemblyReceipt !== "function") throw new Error("video_controller_dependency_missing:verifyAssemblyReceipt");
      const verifiedOutputPath = await dependencies.verifyAssemblyReceipt(evidence.assemblyReceipt);
      if (verifiedOutputPath !== evidence.assemblyReceipt.outputPath) throw new Error("assembly_receipt_output_mismatch");
    }
    const input = { normalized: true, normalizationCredential: evidence.normalizationCredential, inspection: verified, reviewFrames: evidence.reviewFrames, boundaryFrame: evidence.boundary?.sharedFramePath, assemblyReceipt: evidence.assemblyReceipt };
    const evaluation = evaluateVideoQuality(input);
    if (evaluation.status === "rejected") throw new Error(`credential_structural_recheck_failed:${evaluation.structuralIssues.join(",")}`);
    const binding = createVideoArtifactBinding(input);
    if (!artifactBindingsEqual(binding, evidence.artifactBinding)) throw new Error("artifact_binding_mismatch");
    return createVideoQualityReport(evidence.shotId, input);
  }

  async function rebuild(request, resolveInput) {
    const results = [];
    for (const shotId of request.shotIds) {
      const generated = await dependencies.generateShot(shotId);
      if (!generated?.ok || !generated.generatedVideoPath) throw new Error(`video_rebuild_failed:${shotId}`);
      results.push(await processGeneratedShot(await resolveInput(shotId, generated.generatedVideoPath)));
    }
    return results;
  }
  return { processGeneratedShot, verifyForDecision, rebuild };
}

function baseEvidence(input, status) {
  return {
    schemaVersion: 1, shotId: input.shotId, status, sourceVideoPath: input.generatedVideoPath,
    routeDecision: clone(input.routeDecision), profilePreflight: clone(input.profilePreflight),
    boundary: input.boundary ? clone(input.boundary) : undefined, decision: undefined
  };
}
function safeSegmentId(value) { const id = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80); if (!id) throw new Error("video_segment_id_invalid"); return id; }
function stable(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
