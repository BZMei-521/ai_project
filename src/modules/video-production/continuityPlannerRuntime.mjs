const BOUNDARY_KINDS = new Set(["continuous", "match_cut", "hard_cut", "scene_change"]);
const FRAME_DEPENDENCIES = new Set(["none", "previous_tail", "shared_frame"]);

export function planVideoContinuity(input = {}) {
  const shots = normalizeShots(input.shots);
  const boundaryInputs = normalizeBoundaryInputs(input.boundaries);
  const assemblyTaskId = cleanText(input.assemblyTaskId) || "video-assembly";
  const boundaries = [];

  for (let index = 0; index < shots.length - 1; index += 1) {
    const fromShot = shots[index];
    const toShot = shots[index + 1];
    const key = boundaryKey(fromShot.id, toShot.id);
    const configured = boundaryInputs.get(key) ?? {};
    const kind = normalizeBoundaryKind(
      configured.kind ?? fromShot.videoBoundaryKind ?? toShot.videoBoundaryKind
    );
    const frameDependency = normalizeFrameDependency(configured.frameDependency, kind);
    const durationSeconds = normalizeBoundaryDuration(configured.durationSeconds, kind);
    boundaries.push({
      id: boundaryId(fromShot.id, toShot.id),
      fromShotId: fromShot.id,
      toShotId: toShot.id,
      kind,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...normalizedBoundaryGuidance(configured),
      frameDependency,
      ...(frameDependency === "shared_frame" && cleanText(configured.sharedFramePath)
        ? { sharedFramePath: cleanText(configured.sharedFramePath) }
        : {}),
      requiresApproval: frameDependency !== "none",
      approvalStatus: normalizeApprovalStatus(configured.approvalStatus),
      ...(frameDependency === "shared_frame" && cleanText(configured.sharedFrameSource)
        ? { sharedFrameSource: cleanText(configured.sharedFrameSource) }
        : {})
    });
  }

  const shotExecutions = shots.map((shot) => ({
    shotId: shot.id,
    taskId: shotTaskId(shot.id),
    status: "ready",
    dependencyTaskIds: []
  }));
  const shotsById = new Map(shots.map((shot) => [shot.id, shot]));
  const executionByShotId = new Map(shotExecutions.map((execution) => [execution.shotId, execution]));

  for (const boundary of boundaries) {
    const fromShot = shotsById.get(boundary.fromShotId);
    const target = executionByShotId.get(boundary.toShotId);
    if (!fromShot || !target) continue;

    if (boundary.frameDependency === "previous_tail") {
      target.dependencyTaskIds = [shotTaskId(boundary.fromShotId)];
      if (boundary.approvalStatus !== "approved") {
        target.status = "awaiting_approval";
        target.blockReason = boundary.kind === "continuous"
          ? "continuous_boundary_not_approved"
          : "previous_tail_boundary_not_approved";
        continue;
      }
      const approvedTailPath = cleanText(fromShot.approvedTailFramePath);
      if (fromShot.tailFrameApprovalStatus !== "approved" || !approvedTailPath) {
        target.status = "awaiting_approval";
        target.blockReason = "continuous_tail_frame_not_approved";
        continue;
      }
      target.firstFrameInput = {
        kind: "approved_tail_frame",
        path: approvedTailPath,
        boundaryId: boundary.id,
        fromShotId: boundary.fromShotId
      };
      continue;
    }

    if (boundary.frameDependency === "shared_frame") {
      const sharedFramePath = cleanText(boundary.sharedFramePath);
      if (
        boundary.approvalStatus !== "approved" ||
        boundary.sharedFrameSource !== "independent" ||
        !sharedFramePath
      ) {
        target.status = "awaiting_approval";
        target.blockReason = boundary.kind === "match_cut"
          ? "match_cut_shared_frame_not_independently_approved"
          : "shared_frame_not_independently_approved";
        continue;
      }
      target.firstFrameInput = {
        kind: "approved_shared_frame",
        path: sharedFramePath,
        boundaryId: boundary.id
      };
    }
  }

  const segments = buildSegments(shots, boundaries);
  const shotStateSignatures = shots.map((shot) => ({
    shotId: shot.id,
    signature: stableSerialize(normalizeShotState(shot))
  }));
  const ready = shotExecutions.filter((execution) => execution.status === "ready").length;

  return {
    segments,
    boundaries,
    shotExecutions,
    assemblyTaskId,
    shotStateSignatures,
    statusSummary: {
      total: shotExecutions.length,
      ready,
      awaitingApproval: shotExecutions.length - ready
    }
  };
}

export function planContinuityInvalidation(previousPlan = {}, nextPlan = {}) {
  const staleShotIds = new Set();
  const reasons = [];
  const previousBoundaries = indexById(previousPlan.boundaries);
  const nextBoundaries = indexById(nextPlan.boundaries);

  for (const id of sortedUnique([...previousBoundaries.keys(), ...nextBoundaries.keys()])) {
    const previous = previousBoundaries.get(id);
    const next = nextBoundaries.get(id);
    if (stableSerialize(previous) === stableSerialize(next)) continue;
    if (previous) {
      staleShotIds.add(previous.fromShotId);
      staleShotIds.add(previous.toShotId);
    }
    if (next) {
      staleShotIds.add(next.fromShotId);
      staleShotIds.add(next.toShotId);
    }
    reasons.push(`boundary_changed:${id}`);
  }

  const previousStates = indexSignatures(previousPlan.shotStateSignatures);
  const nextStates = indexSignatures(nextPlan.shotStateSignatures);
  const changedStateShots = [];
  for (const shotId of sortedUnique([...previousStates.keys(), ...nextStates.keys()])) {
    if (previousStates.get(shotId) === nextStates.get(shotId)) continue;
    changedStateShots.push(shotId);
    reasons.push(`shot_state_changed:${shotId}`);
  }

  const dependents = buildDependentShotIndex([
    ...(Array.isArray(previousPlan.shotExecutions) ? previousPlan.shotExecutions : []),
    ...(Array.isArray(nextPlan.shotExecutions) ? nextPlan.shotExecutions : [])
  ]);
  const stateQueue = [...changedStateShots];
  const traversedStateShots = new Set();
  while (stateQueue.length > 0) {
    const shotId = stateQueue.shift();
    if (!shotId || traversedStateShots.has(shotId)) continue;
    traversedStateShots.add(shotId);
    staleShotIds.add(shotId);
    for (const dependentShotId of dependents.get(shotTaskId(shotId)) ?? []) {
      if (!traversedStateShots.has(dependentShotId)) stateQueue.push(dependentShotId);
    }
  }

  const staleShotList = sortedUnique(staleShotIds);
  const assemblyTaskId = cleanText(nextPlan.assemblyTaskId) || cleanText(previousPlan.assemblyTaskId) || "video-assembly";
  const staleTaskIds = staleShotList.map(shotTaskId);
  if (staleShotList.length > 0) staleTaskIds.push(assemblyTaskId);

  return {
    staleShotIds: staleShotList,
    staleTaskIds: sortedUnique(staleTaskIds),
    reasons: sortedUnique(reasons)
  };
}

function buildSegments(shots, boundaries) {
  if (shots.length === 0) return [];
  const boundaryByPair = new Map(boundaries.map((boundary) => [
    boundaryKey(boundary.fromShotId, boundary.toShotId),
    boundary
  ]));
  const shotGroups = [[shots[0]]];

  for (let index = 1; index < shots.length; index += 1) {
    const previous = shots[index - 1];
    const current = shots[index];
    const boundary = boundaryByPair.get(boundaryKey(previous.id, current.id));
    const mustSplit = boundary?.kind === "scene_change" || continuityContext(previous) !== continuityContext(current);
    if (mustSplit) shotGroups.push([current]);
    else shotGroups[shotGroups.length - 1].push(current);
  }

  return shotGroups.map((group) => {
    const shotIds = group.map((shot) => shot.id);
    const shotIdSet = new Set(shotIds);
    const internalBoundaries = boundaries.filter((boundary) =>
      shotIdSet.has(boundary.fromShotId) && shotIdSet.has(boundary.toShotId)
    );
    const sceneAnchorPath = commonNonEmptyValue(group.map((shot) => shot.sceneAnchorPath));
    const colorAnchorPath = commonNonEmptyValue(group.map((shot) => shot.colorAnchorPath));
    return {
      id: `continuity-segment:${encodeId(shotIds[0])}:${encodeId(shotIds[shotIds.length - 1])}`,
      shotIds,
      characterAnchorPaths: sortedUnique(group.flatMap((shot) => normalizeTextArray(shot.characterAnchorPaths))),
      ...(sceneAnchorPath ? { sceneAnchorPath } : {}),
      ...(colorAnchorPath ? { colorAnchorPath } : {}),
      boundaries: internalBoundaries
    };
  });
}

function normalizeShots(value) {
  const candidates = Array.isArray(value) ? value.filter((shot) => shot && typeof shot === "object") : [];
  const grouped = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const id = cleanText(candidate.id);
    if (!id) continue;
    const sceneState = normalizeSummary(candidate.sceneState, "sceneState");
    const characterState = normalizeSummary(candidate.characterState, "characterState");
    const timeState = normalizeSummary(candidate.timeState, "timeState");
    const statusSummary = normalizeSummary(candidate.statusSummary, "statusSummary");
    const normalized = {
      ...candidate,
      id,
      order: Number.isFinite(candidate.order) ? candidate.order : index,
      sceneState,
      characterState,
      timeState,
      statusSummary
    };
    const existing = grouped.get(id) ?? [];
    const definition = {
      id,
      ...(Number.isFinite(candidate.order) ? { order: candidate.order } : {}),
      videoBoundaryKind: normalizeBoundaryKind(candidate.videoBoundaryKind),
      characterAnchorPaths: normalizeTextArray(candidate.characterAnchorPaths),
      sceneAnchorPath: cleanText(candidate.sceneAnchorPath),
      colorAnchorPath: cleanText(candidate.colorAnchorPath),
      sceneState,
      characterState,
      timeState,
      statusSummary,
      approvedTailFramePath: cleanText(candidate.approvedTailFramePath),
      tailFrameApprovalStatus: normalizeApprovalStatus(candidate.tailFrameApprovalStatus)
    };
    existing.push({ shot: normalized, signature: stableSerialize(definition) });
    grouped.set(id, existing);
  }
  return [...grouped.values()]
    .map((duplicates) => {
      const signatures = sortedUnique(duplicates.map((item) => item.signature));
      if (signatures.length > 1) {
        throw new Error(`duplicate_shot_id_conflict:${duplicates[0].shot.id}`);
      }
      return duplicates
        .sort((left, right) => left.shot.order - right.shot.order || compareText(left.signature, right.signature))[0]
        .shot;
    })
    .sort((left, right) => left.order - right.order || compareText(left.id, right.id));
}

function normalizeBoundaryInputs(value) {
  const groupedByPair = new Map();
  const groupedByIdentity = new Map();
  for (const candidate of Array.isArray(value) ? value : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const fromShotId = cleanText(candidate.fromShotId);
    const toShotId = cleanText(candidate.toShotId);
    if (!fromShotId || !toShotId) continue;
    const pairKey = boundaryKey(fromShotId, toShotId);
    const explicitId = cleanText(candidate.id);
    const kind = normalizeBoundaryKind(candidate.kind);
    const frameDependency = normalizeFrameDependency(candidate.frameDependency, kind);
    const durationSeconds = normalizeBoundaryDuration(candidate.durationSeconds, kind);
    const normalized = {
      ...(explicitId ? { id: explicitId } : {}),
      fromShotId,
      toShotId,
      kind,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...normalizedBoundaryGuidance(candidate),
      frameDependency,
      approvalStatus: normalizeApprovalStatus(candidate.approvalStatus),
      ...(frameDependency === "shared_frame" && cleanText(candidate.sharedFramePath)
        ? { sharedFramePath: cleanText(candidate.sharedFramePath) }
        : {}),
      ...(frameDependency === "shared_frame" && cleanText(candidate.sharedFrameSource)
        ? { sharedFrameSource: cleanText(candidate.sharedFrameSource) }
        : {})
    };
    const entry = { value: normalized, signature: stableSerialize(normalized), pairKey };
    const pairEntries = groupedByPair.get(pairKey) ?? [];
    pairEntries.push(entry);
    groupedByPair.set(pairKey, pairEntries);
    if (explicitId) {
      const identityEntries = groupedByIdentity.get(explicitId) ?? [];
      identityEntries.push(entry);
      groupedByIdentity.set(explicitId, identityEntries);
    }
  }

  for (const [identity, duplicates] of groupedByIdentity) {
    if (sortedUnique(duplicates.map((item) => item.signature)).length > 1) {
      throw new Error(`duplicate_boundary_conflict:${identity}`);
    }
  }

  return new Map([...groupedByPair.entries()].map(([pairKey, duplicates]) => {
    const signatures = sortedUnique(duplicates.map((item) => item.signature));
    if (signatures.length > 1) {
      const { fromShotId, toShotId } = duplicates[0].value;
      throw new Error(`duplicate_boundary_conflict:${fromShotId}:${toShotId}`);
    }
    return [pairKey, duplicates[0].value];
  }));
}

function normalizeShotState(shot) {
  return {
    characterAnchorPaths: sortedUnique(normalizeTextArray(shot.characterAnchorPaths)),
    sceneAnchorPath: cleanText(shot.sceneAnchorPath),
    colorAnchorPath: cleanText(shot.colorAnchorPath),
    sceneState: normalizeSummary(shot.sceneState, "sceneState"),
    characterState: normalizeSummary(shot.characterState, "characterState"),
    timeState: normalizeSummary(shot.timeState, "timeState"),
    statusSummary: normalizeSummary(shot.statusSummary, "statusSummary"),
    approvedTailFramePath: cleanText(shot.approvedTailFramePath),
    tailFrameApprovalStatus: normalizeApprovalStatus(shot.tailFrameApprovalStatus)
  };
}

function continuityContext(shot) {
  return stableSerialize({
    characterAnchorPaths: sortedUnique(normalizeTextArray(shot.characterAnchorPaths)),
    sceneAnchorPath: cleanText(shot.sceneAnchorPath),
    colorAnchorPath: cleanText(shot.colorAnchorPath),
    sceneState: normalizeSummary(shot.sceneState, "sceneState"),
    characterState: normalizeSummary(shot.characterState, "characterState"),
    timeState: normalizeSummary(shot.timeState, "timeState")
  });
}

function normalizeSummary(value, fieldName) {
  if (value === undefined || value === null) return "";
  return normalizeJsonContinuityState(value, fieldName, new WeakSet());
}

function normalizeJsonContinuityState(value, fieldName, ancestors) {
  if (value === null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throwUnsupportedContinuityState(fieldName, "non_finite_number");
  }
  if (typeof value !== "object") {
    throwUnsupportedContinuityState(fieldName, typeof value);
  }
  if (ancestors.has(value)) {
    throwUnsupportedContinuityState(fieldName, "cycle");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (item === undefined) throwUnsupportedContinuityState(fieldName, "undefined");
        return normalizeJsonContinuityState(item, fieldName, ancestors);
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throwUnsupportedContinuityState(fieldName, "non_plain_object");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throwUnsupportedContinuityState(fieldName, "symbol_key");
    }
    const normalized = {};
    for (const key of Object.keys(value).sort(compareText)) {
      const item = value[key];
      if (item === undefined) throwUnsupportedContinuityState(fieldName, "undefined");
      normalized[key] = normalizeJsonContinuityState(item, fieldName, ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function throwUnsupportedContinuityState(fieldName, reason) {
  throw new Error(`unsupported_continuity_state:${fieldName}:${reason}`);
}

function buildDependentShotIndex(executions) {
  const index = new Map();
  for (const execution of executions) {
    if (!execution || typeof execution !== "object") continue;
    const shotId = cleanText(execution.shotId);
    if (!shotId) continue;
    for (const dependencyTaskId of normalizeTextArray(execution.dependencyTaskIds)) {
      const current = index.get(dependencyTaskId) ?? [];
      current.push(shotId);
      index.set(dependencyTaskId, sortedUnique(current));
    }
  }
  return index;
}

function indexById(value) {
  return new Map((Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && cleanText(item.id))
    .map((item) => [cleanText(item.id), item]));
}

function indexSignatures(value) {
  return new Map((Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && cleanText(item.shotId))
    .map((item) => [cleanText(item.shotId), cleanText(item.signature)]));
}

function normalizeBoundaryKind(value) {
  return BOUNDARY_KINDS.has(value) ? value : "hard_cut";
}

function normalizeFrameDependency(value, kind) {
  if (kind === "hard_cut") return "none";
  if (FRAME_DEPENDENCIES.has(value)) return value;
  if (kind === "continuous") return "previous_tail";
  if (kind === "match_cut") return "shared_frame";
  return "none";
}

function normalizeBoundaryDuration(value, kind) {
  if (kind === "hard_cut") return 0;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizedBoundaryGuidance(value) {
  return Object.fromEntries([
    ["prompt", cleanText(value.prompt)],
    ["negativePrompt", cleanText(value.negativePrompt)],
    ["actionContinuity", cleanText(value.actionContinuity)],
    ["characterPosition", cleanText(value.characterPosition)],
    ["cameraDirection", cleanText(value.cameraDirection)],
    ["notes", cleanText(value.notes)]
  ].filter(([, item]) => item));
}

function normalizeApprovalStatus(value) {
  return value === "approved" || value === "rejected" ? value : "pending";
}

function commonNonEmptyValue(values) {
  const normalized = sortedUnique(values.map(cleanText).filter(Boolean));
  return normalized.length === 1 ? normalized[0] : "";
}

function normalizeTextArray(value) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

function sortedUnique(value) {
  return [...new Set(value)].sort(compareText);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableSerialize(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function boundaryKey(fromShotId, toShotId) {
  return JSON.stringify([fromShotId, toShotId]);
}

function boundaryId(fromShotId, toShotId) {
  return `video-boundary:${encodeId(fromShotId)}:${encodeId(toShotId)}`;
}

function shotTaskId(shotId) {
  return `video-shot:${shotId}`;
}

function encodeId(value) {
  return encodeURIComponent(value);
}
