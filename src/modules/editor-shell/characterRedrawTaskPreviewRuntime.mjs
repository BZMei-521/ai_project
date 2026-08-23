const CHARACTER_REDRAW_SCOPES = new Set(["face_hair", "upper_body", "full_character"]);
const REVIEWABLE_STATUSES = new Set(["needs_review", "failed", "cancelled"]);

export function selectCharacterRedrawReviewPreviews(tasks, target) {
  const shotId = String(target?.shotId ?? "").trim();
  const characterAssetId = String(target?.characterAssetId ?? "").trim();
  if (!shotId || !characterAssetId) return [];

  const latestTaskByScope = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const snapshot = task?.retrySnapshot;
    const redraw = snapshot?.characterRedraw;
    const scope = String(redraw?.scope ?? "").trim();
    if (
      task?.shotId !== shotId ||
      snapshot?.shot?.id !== shotId ||
      redraw?.characterAssetId !== characterAssetId ||
      !CHARACTER_REDRAW_SCOPES.has(scope)
    ) {
      continue;
    }
    latestTaskByScope.set(scope, task);
  }

  return [...latestTaskByScope.entries()]
    .filter(([, task]) => REVIEWABLE_STATUSES.has(task?.status) && String(task?.bestPreviewPath ?? "").trim())
    .map(([scope, task]) => ({ scope, task }));
}
