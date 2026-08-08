const uniqueReferences = (items) => {
  const seen = new Set();
  return items.flatMap((item) => {
    const path = String(item?.path ?? "").trim();
    if (!path || seen.has(path)) return [];
    seen.add(path);
    return [{ ...item, path }];
  }).slice(0, 3);
};

export function inferCharacterView(yaw = 0) {
  const normalized = ((((Number(yaw) || 0) + 180) % 360) + 360) % 360 - 180;
  if (normalized >= -25 && normalized <= 25) return "front";
  if (normalized > 25 && normalized <= 50) return "right_three_quarter";
  if (normalized < -25 && normalized >= -50) return "left_three_quarter";
  if (normalized > 50 && normalized <= 135) return "right_profile";
  if (normalized < -50 && normalized >= -135) return "left_profile";
  return "back";
}

export function inferShotScale(text = "") {
  const value = String(text).toLowerCase();
  if (/特写|近景|close(?:[- ]?up| shot)?|portrait/.test(value)) return "close";
  if (/远景|全景|建立镜头|wide(?: shot)?|long(?: shot)?|establishing/.test(value)) return "wide";
  return "medium";
}

export function routeCharacterReferences({ identityPack, view, shotScale, continuityPath = "" }) {
  const anglePath = view.startsWith("left")
    ? identityPack.faceLeftPath
    : view.startsWith("right")
      ? identityPack.faceRightPath
      : view === "back"
        ? identityPack.hairBackPath
        : identityPack.faceMasterPath;
  const bodyPath = view === "back"
    ? identityPack.bodyBackPath
    : view === "front"
      ? identityPack.bodyFrontPath
      : identityPack.bodySidePath;
  const candidates = shotScale === "close"
    ? [
        { kind: "face_angle", path: anglePath },
        { kind: "face_master", path: identityPack.faceMasterPath },
        { kind: "body_view", path: bodyPath }
      ]
    : shotScale === "wide"
      ? [
          { kind: "body_view", path: bodyPath },
          { kind: "hair_back", path: view === "back" ? identityPack.hairBackPath : "" },
          { kind: "face_master", path: identityPack.faceMasterPath }
        ]
      : [
          { kind: "body_view", path: bodyPath },
          { kind: "face_angle", path: anglePath },
          { kind: "face_master", path: identityPack.faceMasterPath }
        ];
  const canonical = uniqueReferences(candidates);
  return uniqueReferences([
    ...canonical,
    ...(canonical.length < 3 ? [{ kind: "continuity", path: continuityPath }] : [])
  ]);
}

export function buildCharacterPassPlan({ shot, characters, provider, continuityPath = "" }) {
  const shotText = [shot.title, shot.storyPrompt, shot.notes, ...(shot.tags ?? [])].filter(Boolean).join(" ");
  const view = inferCharacterView(shot.cameraYaw);
  const shotScale = inferShotScale(shotText);
  return characters
    .filter((character) => character.characterIdentityPack)
    .map((character, roleIndex) => ({
      characterAssetId: character.id,
      characterName: character.name,
      roleIndex,
      provider,
      view,
      shotScale,
      references: routeCharacterReferences({
        identityPack: character.characterIdentityPack,
        view,
        shotScale,
        continuityPath: character.continuityPath ?? continuityPath
      }),
      triggerWord: character.characterIdentityPack.triggerWord,
      protectPreviousCharacters: roleIndex > 0,
      refineHead: shotScale !== "wide"
    }));
}
