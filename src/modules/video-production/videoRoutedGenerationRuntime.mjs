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
    let firstFramePath = clean(snapshot.shot.videoStartFramePath) || clean(snapshot.shot.approvedBoundaryFramePath) || clean(snapshot.shot.generatedImagePath) || undefined;
    let boundaryDependency;
    if (options.previousEvidence) {
      const previousShotId = clean(options.previousEvidence.shotId);
      const previousIndex = (snapshot.allShots ?? []).findIndex((shot) => shot.id === previousShotId);
      if (previousIndex < 0 || previousIndex + 1 !== snapshot.index) throw new Error("video_boundary_dependency_nonadjacent");
      firstFramePath = clean(await dependencies.verifyFreshTail(options.previousEvidence));
      if (!firstFramePath) throw new Error("video_boundary_fresh_tail_missing");
      boundaryDependency = { fromShotId: previousShotId, toShotId: shotId, firstFramePath, receiptId: clean(options.previousEvidence.normalizationCredential?.receiptId) || undefined };
    }
    const lastFramePath = clean(snapshot.shot.videoEndFramePath) || undefined;
    const durationSeconds = Number(snapshot.shot.durationFrames) / Number(snapshot.project.fps);
    const contractSource = {
      sequenceId: snapshot.sequenceId,
      shot: snapshot.shot,
      project: snapshot.project,
      routeDecision,
      profilePreflight,
      workflowDigest: profileWorkflowJson,
      references,
      boundary: snapshot.boundary,
      boundaryDependency
    };
    const generationContractDigest = await dependencies.contractDigest(contractSource);
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
      prompt: snapshot.shot.videoPrompt || snapshot.shot.storyPrompt || snapshot.shot.notes || snapshot.shot.title,
      seed: snapshot.shot.seed,
      boundaryDependency,
      boundary: snapshot.boundary,
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
    return { ...result, ok: true, generatedVideoPath, ...prepared };
  }

  return { prepare, generate };
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
