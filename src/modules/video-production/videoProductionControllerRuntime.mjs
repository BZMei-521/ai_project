import { createVideoQualityReport, createVideoArtifactBinding, artifactBindingsEqual, evaluateVideoQuality } from "./videoQualityRuntime.mjs";

export async function createVideoGenerationContractDigest(value = {}) {
  const source = record(value);
  const effective = record(source.effectiveRequest);
  if (Object.keys(effective).length > 0) {
    const contract = {
      schemaVersion: 2,
      sequenceId: text(effective.sequenceId),
      shotId: text(effective.shotId),
      profileId: text(effective.profileId),
      accelerationMode: text(effective.accelerationMode),
      qualityTier: text(effective.qualityTier),
      prompt: text(effective.prompt),
      seed: finite(effective.seed) ? effective.seed : 0,
      workflowDigest: text(effective.workflowDigest),
      references: clone(Array.isArray(effective.references) ? effective.references : []),
      firstFramePath: text(effective.firstFramePath),
      lastFramePath: text(effective.lastFramePath),
      boundaryDependency: effective.boundaryDependency ? clone(effective.boundaryDependency) : null,
      width: effective.width,
      height: effective.height,
      durationSeconds: effective.durationSeconds
    };
    return sha256(stable(contract));
  }
  const shot = record(source.shot);
  const project = record(source.project);
  const contract = {
    schemaVersion: 1,
    sequenceId: text(source.sequenceId),
    shot: {
      id: text(shot.id), title: text(shot.title), storyPrompt: text(shot.storyPrompt), videoPrompt: text(shot.videoPrompt),
      notes: text(shot.notes), dialogue: text(shot.dialogue), seed: finite(shot.seed) ? shot.seed : 0,
      characterRefs: stringArray(shot.characterRefs), sceneRefId: text(shot.sceneRefId), generatedImagePath: text(shot.generatedImagePath),
      videoStartFramePath: text(shot.videoStartFramePath), videoEndFramePath: text(shot.videoEndFramePath),
      durationFrames: finite(shot.durationFrames) ? shot.durationFrames : 0, continuitySegmentId: text(shot.continuitySegmentId),
      videoBoundaryKind: text(shot.videoBoundaryKind), videoAccelerationMode: text(shot.videoAccelerationMode),
      videoQualityTier: text(shot.videoQualityTier)
    },
    project: { id: text(project.id), width: project.width, height: project.height, fps: project.fps },
    routeDecision: clone(source.routeDecision), profilePreflight: clone(source.profilePreflight),
    workflowDigest: text(source.workflowDigest), references: clone(Array.isArray(source.references) ? source.references : []),
    boundary: source.boundary ? clone(source.boundary) : null,
    boundaryDependency: source.boundaryDependency ? clone(source.boundaryDependency) : null
  };
  return sha256(stable(contract));
}

export function createVideoOperationIdentity(input = {}) {
  const source = record(input);
  const operation = {
    sequenceId: text(source.sequenceId), shotId: text(source.shotId), contractDigest: text(source.contractDigest),
    sourceVideoPath: text(source.sourceVideoPath), boundaryIdentity: text(source.boundaryIdentity),
    operationToken: text(source.operationToken) || randomToken()
  };
  if (!operation.sequenceId || !operation.shotId || !/^[a-f0-9]{64}$/.test(operation.contractDigest) || !operation.sourceVideoPath || !operation.operationToken) {
    throw new Error("video_operation_identity_invalid");
  }
  return Object.freeze(operation);
}

export function createVideoProductionController(dependencies = {}) {
  const required = ["beginRun", "stage", "probe", "normalize", "extractReviewFrames", "verifyCredential", "verifyReviewRecord", "completeRun", "cleanupRun", "persistEvidence", "generateShot"];
  for (const name of required) if (typeof dependencies[name] !== "function") throw new Error(`video_controller_dependency_missing:${name}`);

  const assertCurrent = async (operation) => {
    if (typeof dependencies.isOperationCurrent === "function" && !(await dependencies.isOperationCurrent(operation))) throw new Error("video_operation_stale");
  };
  const persist = async (operation, evidence) => {
    await assertCurrent(operation);
    if (typeof dependencies.persistEvidenceCAS === "function") {
      if (!(await dependencies.persistEvidenceCAS(operation, evidence))) throw new Error("video_operation_stale");
    } else dependencies.persistEvidence(evidence.shotId, evidence);
  };

  async function processGeneratedShot(input, options = {}) {
    const operation = input.operation ?? createVideoOperationIdentity({
      sequenceId: input.sequenceId ?? "legacy", shotId: input.shotId,
      contractDigest: input.contractDigest ?? "0".repeat(64), sourceVideoPath: input.generatedVideoPath,
      boundaryIdentity: boundaryIdentity(input.boundary)
    });
    assertGenerationReceipt(input.generationReceipt, input, operation);
    const pending = baseEvidence(input, operation, "processing");
    if (!options.deferPersist) await persist(operation, pending);
    let runCapability;
    let retained = false;
    let published = false;
    let handedOff = false;
    try {
      await assertCurrent(operation);
      runCapability = await dependencies.beginRun();
      await assertCurrent(operation);
      const staged = await dependencies.stage({ runCapability, inputPath: input.generatedVideoPath });
      await assertCurrent(operation);
      await dependencies.probe({ inputPath: staged.stagedPath, projectAssetsDir: staged.projectAssetsDir });
      await assertCurrent(operation);
      const normalized = await dependencies.normalize({
        runCapability, inputPath: staged.stagedPath, projectAssetsDir: staged.projectAssetsDir,
        segmentId: safeSegmentId(input.shotId), projectWidth: input.projectWidth,
        projectHeight: input.projectHeight, durationFrames: input.durationFrames
      });
      await assertCurrent(operation);
      const reviewFrames = await dependencies.extractReviewFrames({ runCapability, projectAssetsDir: staged.projectAssetsDir, credential: normalized.credential });
      await assertCurrent(operation);
      const verified = await dependencies.verifyCredential({ projectAssetsDir: staged.projectAssetsDir, credential: normalized.credential });
      await assertCurrent(operation);
      const reviewRecord = await dependencies.verifyReviewRecord({ projectAssetsDir: staged.projectAssetsDir, credential: normalized.credential, reviewFrames });
      await assertCurrent(operation);
      const qualityInput = { normalized: true, normalizationCredential: normalized.credential, inspection: verified, reviewFrames, reviewRecord, boundaryFrame: input.boundary?.sharedFramePath };
      if (stable(normalized.probe) !== stable(verified.probe) || stable(normalized.anomalies) !== stable(verified.anomalies)) throw new Error("credential_verification_mismatch");
      const qualityReport = createVideoQualityReport(input.shotId, qualityInput);
      const evidence = {
        ...baseEvidence(input, operation, "ready"), projectAssetsDir: staged.projectAssetsDir, runCapability,
        stagingReceiptId: staged.stagingReceiptId, normalizationCredential: normalized.credential,
        inspection: verified, reviewFrames, reviewRecord, artifactBinding: createVideoArtifactBinding(qualityInput), qualityReport
      };
      if (options.deferPersist) {
        handedOff = true;
      } else {
        await dependencies.completeRun({ runCapability, retainEvidence: true });
        retained = true;
        await assertCurrent(operation);
        await persist(operation, evidence);
        published = true;
      }
      return evidence;
    } catch (error) {
      if (!options.deferPersist && String(error instanceof Error ? error.message : error) !== "video_operation_stale") {
        const failed = { ...pending, status: "failed", failureReason: String(error instanceof Error ? error.message : error) };
        try { await persist(operation, failed); } catch { /* stale failures are intentionally discarded */ }
      }
      throw error;
    } finally {
      if (runCapability && !published && !handedOff) {
        try {
          if (retained && typeof dependencies.releaseRun === "function") await dependencies.releaseRun({ runCapability });
          else await dependencies.cleanupRun({ runCapability });
        } catch { /* primary failure wins */ }
      }
    }
  }

  async function verifyForDecision(evidence, operation = evidence?.operation) {
    if (!evidence || evidence.status !== "ready") throw new Error("video_evidence_not_ready");
    if (operation) await assertCurrent(operation);
    const verified = await dependencies.verifyCredential({ projectAssetsDir: evidence.projectAssetsDir, credential: evidence.normalizationCredential });
    if (operation) await assertCurrent(operation);
    const reviewRecord = await dependencies.verifyReviewRecord({ projectAssetsDir: evidence.projectAssetsDir, credential: evidence.normalizationCredential, reviewFrames: evidence.reviewFrames });
    if (operation) await assertCurrent(operation);
    if (stable(reviewRecord) !== stable(evidence.reviewRecord)) throw new Error("review_record_mismatch");
    if (evidence.assemblyReceipt) {
      if (typeof dependencies.verifyAssemblyReceipt !== "function") throw new Error("video_controller_dependency_missing:verifyAssemblyReceipt");
      if (!evidence.assemblyReceipt.orderedReceiptIds?.includes(evidence.normalizationCredential.receiptId)) throw new Error("assembly_receipt_foreign_normalization");
      const verifiedOutputPath = await dependencies.verifyAssemblyReceipt(evidence.assemblyReceipt);
      if (verifiedOutputPath !== evidence.assemblyReceipt.outputPath) throw new Error("assembly_receipt_output_mismatch");
      if (operation) await assertCurrent(operation);
    }
    const input = { normalized: true, normalizationCredential: evidence.normalizationCredential, inspection: verified, reviewFrames: evidence.reviewFrames, reviewRecord, boundaryFrame: evidence.boundary?.sharedFramePath, assemblyReceipt: evidence.assemblyReceipt };
    const evaluation = evaluateVideoQuality(input);
    if (evaluation.status === "rejected") throw new Error(`credential_structural_recheck_failed:${evaluation.structuralIssues.join(",")}`);
    const binding = createVideoArtifactBinding(input);
    if (!artifactBindingsEqual(binding, evidence.artifactBinding)) throw new Error("artifact_binding_mismatch");
    return createVideoQualityReport(evidence.shotId, input);
  }

  async function rebuild(request, resolveInput) {
    const staged = [];
    const retained = [];
    let published = false;
    let previousEvidence;
    try {
      for (const shotId of request.shotIds) {
        const generated = await dependencies.generateShot(shotId, { request, previousEvidence });
        if (!generated?.ok || !generated.generatedVideoPath) throw new Error(`video_rebuild_failed:${shotId}`);
        const input = await resolveInput(shotId, generated.generatedVideoPath, previousEvidence, generated);
        previousEvidence = await processGeneratedShot(input, { deferPersist: request.shotIds.length > 1 });
        staged.push({ input, evidence: previousEvidence, generated });
      }
      if (staged.length > 1) {
        for (const item of staged) {
          await assertCurrent(item.input.operation);
          await dependencies.completeRun({ runCapability: item.evidence.runCapability, retainEvidence: true });
          retained.push(item);
          await assertCurrent(item.input.operation);
        }
        if (typeof dependencies.persistBatchCAS !== "function" || !(await dependencies.persistBatchCAS(staged.map(({ input, evidence, generated }) => ({ operation: input.operation, evidence, generated }))))) throw new Error("video_pair_atomic_commit_failed");
        published = true;
      }
      return staged.map((item) => item.evidence);
    } catch (error) {
      if (staged.length > 1 && typeof dependencies.markBatchFailed === "function") await dependencies.markBatchFailed(staged, error);
      throw error;
    } finally {
      if (!published && staged.length > 1) {
        for (const item of staged) {
          try {
            if (retained.includes(item) && typeof dependencies.releaseRun === "function") await dependencies.releaseRun({ runCapability: item.evidence.runCapability });
            else await dependencies.cleanupRun({ runCapability: item.evidence.runCapability });
          } catch { /* primary failure wins */ }
        }
      }
    }
  }
  return { processGeneratedShot, verifyForDecision, rebuild };
}

function baseEvidence(input, operation, status) {
  return {
    schemaVersion: 1, shotId: input.shotId, status, sourceVideoPath: input.generatedVideoPath,
    sequenceId: operation.sequenceId, contractDigest: operation.contractDigest,
    boundaryIdentity: operation.boundaryIdentity, operation: clone(operation),
    routeDecision: clone(input.routeDecision), profilePreflight: clone(input.profilePreflight),
    boundary: input.boundary ? clone(input.boundary) : undefined,
    generationReceipt: clone(input.generationReceipt), decision: undefined
  };
}
function assertGenerationReceipt(receipt, input, operation) {
  const item = record(receipt);
  if (item.profileId !== input.routeDecision?.profileId || item.accelerationMode !== input.accelerationMode) throw new Error("video_generation_receipt_route_mismatch");
  if (!/^[a-f0-9]{64}$/.test(text(item.workflowDigest)) || !/^[a-f0-9]{64}$/.test(text(item.inputDigest)) || !text(item.promptId) || !finite(Date.parse(item.generatedAt))) throw new Error("video_generation_receipt_invalid");
  if (normalizePath(item.normalizedPath) !== normalizePath(input.generatedVideoPath)) throw new Error("video_generation_receipt_output_mismatch");
  if (item.contractDigest !== operation.contractDigest || item.operationToken !== operation.operationToken) throw new Error("video_generation_receipt_contract_mismatch");
}
function boundaryIdentity(boundary) { const item = record(boundary); return [text(item.id), text(item.fromShotId), text(item.toShotId), text(item.kind), text(item.sharedFramePath), text(item.approvalStatus)].join(":"); }
function safeSegmentId(value) { const id = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80); if (!id) throw new Error("video_segment_id_invalid"); return id; }
function stable(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function normalizePath(value) { return text(value).replace(/\\/g, "/").toLowerCase(); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function stringArray(value) { return Array.isArray(value) ? value.map(text).filter(Boolean).sort() : []; }
function randomToken() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }
async function sha256(value) { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
