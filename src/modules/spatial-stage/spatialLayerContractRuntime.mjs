const ROLES = new Set(["environment", "subject", "interaction", "foreground_occluder", "effect"]);
const RELATIONS = new Set(["inside", "front_of", "behind", "contact", "occludes", "allows_occlusion"]);
const normalizeId = (value) => typeof value === "string" && value.trim() ? value.trim() : "";
const isValidId = (value) => typeof value === "string" && value.trim().length > 0;

export function normalizeSpatialShotContract(value) {
  const layers = [...(value?.layers ?? [])]
    .map((layer) => ({ id: normalizeId(layer?.id), order: Number(layer?.order), role: String(layer?.role), entityIds: [...new Set((layer?.entityIds ?? []).map(normalizeId))] }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    shotId: normalizeId(value?.shotId),
    cameraId: normalizeId(value?.cameraId),
    layers,
    relations: (value?.relations ?? []).map((item) => ({ ...item, kind: String(item?.kind), subjectEntityId: normalizeId(item?.subjectEntityId), targetEntityId: normalizeId(item?.targetEntityId) })),
    expectedHands: (value?.expectedHands ?? []).map((hand) => ({ ...hand, entityId: normalizeId(hand?.entityId), side: hand?.side === "left" ? "left" : "right", visible: hand?.visible !== false })),
    riskFlags: [...new Set((value?.riskFlags ?? []).map(String))].sort()
  };
}

export const orderedLayerIds = (contract) => contract.layers.map((layer) => layer.id);

export function validateSpatialShotContract(contract) {
  if (!contract.shotId || !contract.cameraId) return { valid: false, reason: "spatial_contract_identity_missing" };
  const layerIds = new Set();
  const entityIds = new Set();
  for (const layer of contract.layers) {
    if (!isValidId(layer?.id) || layerIds.has(layer.id) || !Number.isFinite(layer.order) || !ROLES.has(layer.role) || !Array.isArray(layer.entityIds) || layer.entityIds.some((id) => !isValidId(id))) return { valid: false, reason: `spatial_contract_layer_invalid:${layer?.id ?? ""}` };
    layerIds.add(layer.id);
    layer.entityIds.forEach((id) => entityIds.add(id));
  }
  for (const relation of contract.relations) {
    if (!RELATIONS.has(relation.kind)) return { valid: false, reason: `spatial_contract_relation_invalid:${relation.kind}` };
    if (!entityIds.has(relation.subjectEntityId)) return { valid: false, reason: `spatial_contract_relation_subject_missing:${relation.subjectEntityId}` };
    if (!entityIds.has(relation.targetEntityId)) return { valid: false, reason: `spatial_contract_relation_target_missing:${relation.targetEntityId}` };
  }
  return { valid: true };
}
