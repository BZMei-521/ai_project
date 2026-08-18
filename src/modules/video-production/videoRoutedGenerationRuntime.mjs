export function createRoutedVideoGenerationExecutor(dependencies = {}) {
  for (const name of ["readSnapshot", "inspectInventory", "routeShot", "preflightProfile", "workflowJsonForProfile", "contractDigest", "generateRoutedVideoShot", "verifyFreshTail"]) {
    if (typeof dependencies[name] !== "function") throw new Error(`video_routed_dependency_missing:${name}`);
  }

  async function prepare(shotId, options = {}) {
    const snapshot = await dependencies.readSnapshot(shotId);
    if (!snapshot?.shot || snapshot.shot.id !== shotId) throw new Error("video_generation_snapshot_missing");
    const inventory = await dependencies.inspectInventory();
    const routeDecision = dependencies.routeShot(snapshot, inventory);
    if (!routeDecision || routeDecision.status !== "selected") throw new Error(routeDecision?.reason || "video_route_blocked");
    const profilePreflight = dependencies.preflightProfile(routeDecision, inventory);
    if (!profilePreflight?.available) throw new Error(`video_profile_preflight_blocked:${routeDecision.profileId}`);
    const profileWorkflowJson = dependencies.workflowJsonForProfile(routeDecision.profileId);
    const references = collectReferences(snapshot.shot, snapshot.assets ?? []);
    let firstFramePath = clean(snapshot.shot.videoStartFramePath) || clean(snapshot.shot.generatedImagePath) || undefined;
    let boundaryDependency;
    const incomingBoundary = snapshot.incomingBoundary;
    const outgoingBoundary = snapshot.outgoingBoundary;
    if (incomingBoundary?.kind === "continuous") {
      if (incomingBoundary.approvalStatus !== "approved" || !options.previousEvidence) throw new Error("video_incoming_continuous_not_ready");
      if (!clean(options.previousEvidence.normalizationCredential?.receiptId)) throw new Error("video_incoming_continuous_receipt_missing");
      const previousShotId = clean(options.previousEvidence.shotId);
      const previousIndex = (snapshot.allShots ?? []).findIndex((shot) => shot.id === previousShotId);
      if (previousShotId !== incomingBoundary.fromShotId || incomingBoundary.toShotId !== shotId || previousIndex < 0 || previousIndex + 1 !== snapshot.index) throw new Error("video_boundary_dependency_nonadjacent");
      firstFramePath = clean(await dependencies.verifyFreshTail(options.previousEvidence));
      if (!firstFramePath) throw new Error("video_boundary_fresh_tail_missing");
      boundaryDependency = boundaryBinding(incomingBoundary, firstFramePath, options.previousEvidence);
    } else if (incomingBoundary?.kind === "match_cut") {
      if (incomingBoundary.approvalStatus !== "approved" || incomingBoundary.sharedFrameSource !== "independent") throw new Error("video_incoming_match_cut_not_ready");
      firstFramePath = clean(incomingBoundary.sharedFramePath);
      if (!firstFramePath) throw new Error("video_incoming_match_cut_frame_missing");
      boundaryDependency = boundaryBinding(incomingBoundary, firstFramePath, options.previousEvidence);
    }
    const lastFramePath = clean(snapshot.shot.videoEndFramePath) || (outgoingBoundary?.approvalStatus === "approved" ? clean(outgoingBoundary.sharedFramePath) : "") || undefined;
    const durationSeconds = Number(snapshot.shot.durationFrames) / Number(snapshot.project.fps);
    const prompt = snapshot.shot.videoPrompt || snapshot.shot.storyPrompt || snapshot.shot.notes || snapshot.shot.title;
    const operationToken = clean(options.operationToken) || dependencies.createOperationToken?.() || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const effectiveRequest = {
      sequenceId: snapshot.sequenceId, shotId, profileId: routeDecision.profileId,
      accelerationMode: snapshot.shot.videoAccelerationMode ?? "standard", qualityTier: snapshot.shot.videoQualityTier ?? "production",
      prompt, seed: snapshot.shot.seed ?? 0, workflowDigest: profileWorkflowJson, references,
      firstFramePath, lastFramePath, boundaryDependency, width: snapshot.project.width,
      height: snapshot.project.height, durationSeconds
    };
    const generationContractDigest = await dependencies.contractDigest({ effectiveRequest });
    const request = {
      settings: snapshot.settings ?? dependencies.settings,
      shot: snapshot.shot,
      index: snapshot.index,
      allShots: snapshot.allShots,
      assets: snapshot.assets,
      routeDecision,
      profileWorkflowJson,
      durationSeconds,
      width: snapshot.project.width,
      height: snapshot.project.height,
      qualityTier: snapshot.shot.videoQualityTier ?? "production",
      accelerationMode: snapshot.shot.videoAccelerationMode ?? "standard",
      references,
      firstFramePath,
      lastFramePath,
      prompt,
      seed: snapshot.shot.seed,
      boundaryDependency,
      incomingBoundary,
      outgoingBoundary,
      operationToken,
      generationContractDigest,
      profilePreflight
    };
    return { request, routeDecision, profilePreflight, generationContractDigest };
  }

  async function generate(shotId, options = {}) {
    const prepared = await prepare(shotId, options);
    const result = await dependencies.generateRoutedVideoShot(prepared.request);
    const generatedVideoPath = clean(result?.generatedVideoPath || result?.localPath);
    if (!generatedVideoPath) throw new Error("video_generation_output_missing");
    assertGenerationReceipt(result?.videoGenerationReceipt, prepared, generatedVideoPath);
    return { ...result, ok: true, generatedVideoPath, ...prepared };
  }

  return { prepare, generate, verifyReceipt: (receipt, prepared, path) => assertGenerationReceipt(receipt, prepared, path) };
}

export function assertGenerationReceipt(receipt, prepared, generatedVideoPath) {
  const item = receipt && typeof receipt === "object" ? receipt : {};
  const route = prepared?.routeDecision;
  const request = prepared?.request ?? {};
  if (item.profileId !== route?.profileId || item.accelerationMode !== request.accelerationMode) throw new Error("video_generation_receipt_route_mismatch");
  for (const field of ["workflowDigest", "inputDigest"]) if (!/^[a-f0-9]{64}$/.test(clean(item[field]))) throw new Error(`video_generation_receipt_${field}_invalid`);
  if (!clean(item.promptId) || !Number.isFinite(Date.parse(item.generatedAt))) throw new Error("video_generation_receipt_invalid");
  if (normalizePath(item.normalizedPath) !== normalizePath(generatedVideoPath)) throw new Error("video_generation_receipt_output_mismatch");
  if (item.contractDigest !== prepared.generationContractDigest || item.operationToken !== request.operationToken) throw new Error("video_generation_receipt_contract_mismatch");
  return true;
}

function boundaryBinding(boundary, framePath, evidence) {
  return {
    boundaryId: clean(boundary.id), kind: boundary.kind, approvalStatus: boundary.approvalStatus,
    sharedFrameSource: clean(boundary.sharedFrameSource), fromShotId: clean(boundary.fromShotId),
    toShotId: clean(boundary.toShotId), framePath,
    predecessorReceiptId: clean(evidence?.normalizationCredential?.receiptId) || undefined
  };
}

function collectReferences(shot, assets) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const collected = [];
  for (const id of shot.characterRefs ?? []) {
    const asset = byId.get(id);
    if (!asset) continue;
    push(collected, "character_face", asset.characterIdentityPack?.faceMasterPath || asset.characterFaceRefPath);
    push(collected, "character_body", asset.characterIdentityPack?.bodyFrontPath || asset.characterFrontPath || asset.filePath);
  }
  const scene = byId.get(shot.sceneRefId);
  if (scene) push(collected, "scene", scene.filePath || scene.panoramaPath);
  return collected;
}

function push(target, kind, path) {
  const normalized = clean(path);
  if (normalized && !target.some((item) => item.path.toLowerCase() === normalized.toLowerCase())) target.push({ kind, path: normalized });
}

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function normalizePath(value) { return clean(value).replace(/\\/g, "/").toLowerCase(); }
