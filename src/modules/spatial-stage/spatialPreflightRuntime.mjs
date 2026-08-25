const REQUIRED_JOINT_NAMES = Object.freeze([
  "head",
  "neck",
  "leftShoulder",
  "leftElbow",
  "leftWrist",
  "rightShoulder",
  "rightElbow",
  "rightWrist"
]);

const centerDepth = (box) => (Number(box.min[2]) + Number(box.max[2])) / 2;

const isValidBounds = (box) => {
  if (!box || !Array.isArray(box.min) || !Array.isArray(box.max) || box.min.length !== 3 || box.max.length !== 3) return false;
  return [0, 1, 2].every((axis) => Number.isFinite(box.min[axis]) && Number.isFinite(box.max[axis]) && box.min[axis] <= box.max[axis]);
};

export function runSpatialPreflight(input) {
  const errors = [];
  const warnings = [];
  const contract = input?.contract ?? {};
  const entities = input?.entities ?? {};
  const validEntities = new Set();

  for (const [entityId, bounds] of Object.entries(entities)) {
    if (isValidBounds(bounds)) validEntities.add(entityId);
    else errors.push({ code: `spatial_bounds_invalid:${entityId}`, entityId });
  }

  for (const relation of contract.relations ?? []) {
    const subject = entities[relation.subjectEntityId];
    const target = entities[relation.targetEntityId];
    if (!validEntities.has(relation.subjectEntityId) || !validEntities.has(relation.targetEntityId)) continue;

    if (relation.kind === "inside") {
      const inside = [0, 1, 2].every(
        (axis) => subject.min[axis] >= target.min[axis] && subject.max[axis] <= target.max[axis]
      );
      if (!inside) errors.push({ code: "spatial_relation_inside_failed", relation });
    }
    if (relation.kind === "behind" && centerDepth(subject) <= centerDepth(target)) {
      errors.push({ code: "spatial_relation_behind_failed", relation });
    }
    if (relation.kind === "front_of" && centerDepth(subject) >= centerDepth(target)) {
      errors.push({ code: "spatial_relation_front_of_failed", relation });
    }
  }

  for (const contact of input?.contacts ?? []) {
    if (
      contact === null ||
      typeof contact !== "object" ||
      !Number.isFinite(contact.distance) ||
      !Number.isFinite(contact.maxDistance) ||
      contact.distance < 0 ||
      contact.maxDistance < 0 ||
      contact.distance > contact.maxDistance
    ) {
      errors.push({ code: "spatial_contact_failed", contact });
    }
  }

  const joints = Array.isArray(input?.joints) ? input.joints : [];
  if ((contract.layers ?? []).some((layer) => layer?.role === "subject") && joints.length === 0) {
    errors.push({ code: "spatial_skeleton_evidence_missing" });
  }
  for (const skeleton of joints) {
    const names = Array.isArray(skeleton.names) ? skeleton.names : [];
    const missing = REQUIRED_JOINT_NAMES.filter((name) => !names.includes(name));
    if (missing.length) {
      errors.push({ code: "spatial_skeleton_incomplete", entityId: skeleton.entityId, missing });
    }
  }

  return { ok: errors.length === 0, errors, warnings, input };
}
