const ROLES = new Set(["environment", "subject", "interaction", "foreground_occluder", "effect"]);
const RELATIONS = new Set(["inside", "front_of", "behind", "contact", "occludes", "allows_occlusion"]);

export function normalizeSpatialShotContract(value) {
  const layers = [...(value?.layers ?? [])]
    .map((layer) => ({ id: String(layer.id), order: Number(layer.order), role: String(layer.role), entityIds: [...new Set((layer.entityIds ?? []).map(String))] }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    shotId: String(value?.shotId ?? ""),
    cameraId: String(value?.cameraId ?? ""),
    layers,
    relations: (value?.relations ?? []).map((item) => ({ ...item, kind: String(item.kind), subjectEntityId: String(item.subjectEntityId), targetEntityId: String(item.targetEntityId) })),
    expectedHands: (value?.expectedHands ?? []).map((hand) => ({ ...hand, entityId: String(hand.entityId), side: hand.side === "left" ? "left" : "right", visible: hand.visible !== false })),
    riskFlags: [...new Set((value?.riskFlags ?? []).map(String))].sort()
  };
}

export const orderedLayerIds = (contract) => contract.layers.map((layer) => layer.id);

export function validateSpatialShotContract(contract) {
  if (!contract.shotId || !contract.cameraId) return { valid: false, reason: "spatial_contract_identity_missing" };
  const layerIds = new Set();
  const entityIds = new Set();
  for (const layer of contract.layers) {
    if (!layer.id || layerIds.has(layer.id) || !Number.isFinite(layer.order) || !ROLES.has(layer.role)) return { valid: false, reason: `spatial_contract_layer_invalid:${layer.id}` };
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
