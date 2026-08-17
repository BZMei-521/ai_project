const BOUNDARY_KINDS = new Set(["continuous", "match_cut", "hard_cut", "scene_change"]);

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
    boundaries.push({
      id: boundaryId(fromShot.id, toShot.id),
      fromShotId: fromShot.id,
      toShotId: toShot.id,
      kind,
      ...(cleanText(configured.sharedFramePath)
        ? { sharedFramePath: cleanText(configured.sharedFramePath) }
        : {}),
      requiresApproval: kind === "continuous" || kind === "match_cut",
      approvalStatus: normalizeApprovalStatus(configured.approvalStatus),
      ...(cleanText(configured.sharedFrameSource)
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

    if (boundary.kind === "continuous") {
      target.dependencyTaskIds = [shotTaskId(boundary.fromShotId)];
      if (boundary.approvalStatus !== "approved") {
        target.status = "awaiting_approval";
        target.blockReason = "continuous_boundary_not_approved";
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

    if (boundary.kind === "match_cut") {
      const sharedFramePath = cleanText(boundary.sharedFramePath);
      if (
        boundary.approvalStatus !== "approved" ||
        boundary.sharedFrameSource !== "independent" ||
        !sharedFramePath
      ) {
        target.status = "awaiting_approval";
        target.blockReason = "match_cut_shared_frame_not_independently_approved";
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
  while (stateQueue.length > 0) {
    const shotId = stateQueue.shift();
    if (!shotId || staleShotIds.has(shotId)) continue;
    staleShotIds.add(shotId);
    for (const dependentShotId of dependents.get(shotTaskId(shotId)) ?? []) {
      if (!staleShotIds.has(dependentShotId)) stateQueue.push(dependentShotId);
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
    const normalized = {
      ...candidate,
      id,
      order: Number.isFinite(candidate.order) ? candidate.order : index
    };
    const existing = grouped.get(id) ?? [];
    existing.push(normalized);
    grouped.set(id, existing);
  }
  return [...grouped.values()]
    .map((duplicates) => duplicates.sort((left, right) => compareText(stableSerialize(left), stableSerialize(right)))[0])
    .sort((left, right) => left.order - right.order || compareText(left.id, right.id));
}

function normalizeBoundaryInputs(value) {
  const grouped = new Map();
  for (const candidate of Array.isArray(value) ? value : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const fromShotId = cleanText(candidate.fromShotId);
    const toShotId = cleanText(candidate.toShotId);
    if (!fromShotId || !toShotId) continue;
    const key = boundaryKey(fromShotId, toShotId);
    const existing = grouped.get(key) ?? [];
    existing.push({ ...candidate, fromShotId, toShotId });
    grouped.set(key, existing);
  }
  return new Map([...grouped.entries()].map(([key, duplicates]) => [
    key,
    duplicates.sort((left, right) => compareText(stableSerialize(left), stableSerialize(right)))[0]
  ]));
}

function normalizeShotState(shot) {
  return {
    characterAnchorPaths: sortedUnique(normalizeTextArray(shot.characterAnchorPaths)),
    sceneAnchorPath: cleanText(shot.sceneAnchorPath),
    colorAnchorPath: cleanText(shot.colorAnchorPath),
    sceneState: normalizeSummary(shot.sceneState),
    characterState: normalizeSummary(shot.characterState),
    timeState: normalizeSummary(shot.timeState),
    statusSummary: normalizeSummary(shot.statusSummary),
    approvedTailFramePath: cleanText(shot.approvedTailFramePath),
    tailFrameApprovalStatus: normalizeApprovalStatus(shot.tailFrameApprovalStatus)
  };
}

function continuityContext(shot) {
  return stableSerialize({
    characterAnchorPaths: sortedUnique(normalizeTextArray(shot.characterAnchorPaths)),
    sceneAnchorPath: cleanText(shot.sceneAnchorPath),
    colorAnchorPath: cleanText(shot.colorAnchorPath),
    sceneState: normalizeSummary(shot.sceneState),
    characterState: normalizeSummary(shot.characterState),
    timeState: normalizeSummary(shot.timeState)
  });
}

function normalizeSummary(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return JSON.parse(stableSerialize(value));
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
  return `${fromShotId}\u0000${toShotId}`;
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
