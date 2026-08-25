export type StageRenderKind = "color" | "depth" | "normal" | "character_id" | "prop_id" | "pose";
export type StageRenderArtifact = {
  kind: StageRenderKind;
  filePath: string;
  sha256: string;
  width: number;
  height: number;
};
export type SpatialControlPack = {
  schemaVersion: 1;
  stageId: string;
  stageRevision: number;
  stageDigest: string;
  shotId: string;
  snapshotId: string;
  cameraId: string;
  cameraDigest: string;
  artifacts: StageRenderArtifact[];
  expectedHands: Array<{ side: "left" | "right"; visible: boolean; contactTargetId?: string }>;
  expectedProps: Array<{ entityId: string; count: number; state: string }>;
  packDigest: string;
};

export type SpatialControlPackInput = Omit<SpatialControlPack, "schemaVersion" | "packDigest">;
export type ControlPackValidation = { valid: true } | { valid: false; reason: string };
export type AnySpatialControlPack = SpatialControlPack | import("./layeredSpatialControlPack").LayeredSpatialControlPack;

export const STAGE_RENDER_KINDS: readonly StageRenderKind[] = [
  "color", "depth", "normal", "character_id", "prop_id", "pose"
];
const HEX64 = /^[a-f0-9]{64}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

function sha256(input: string): string {
  const rightRotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const ascii = unescape(encodeURIComponent(input));
  const bitLength = ascii.length * 8;
  const hash: number[] = [];
  const constants: number[] = [];
  const composite: Record<number, boolean> = {};
  for (let candidate = 2, count = 0; count < 64; candidate += 1) {
    if (composite[candidate]) continue;
    for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) composite[multiple] = true;
    hash[count] = (Math.sqrt(candidate) * maxWord) | 0;
    constants[count] = (candidate ** (1 / 3) * maxWord) | 0;
    count += 1;
  }
  let padded = `${ascii}\x80`;
  while ((padded.length % 64) !== 56) padded += "\x00";
  for (let index = 0; index < padded.length; index += 1) {
    words[index >> 2] = (words[index >> 2] ?? 0) | padded.charCodeAt(index) << ((3 - index) % 4) * 8;
  }
  words.push(Math.floor(bitLength / maxWord), bitLength);
  for (let offset = 0; offset < words.length; offset += 16) {
    const initial = hash.slice(0, 8);
    const schedule = words.slice(offset, offset + 16);
    let working = initial.slice();
    for (let index = 0; index < 64; index += 1) {
      if (index >= 16) {
        const x = schedule[index - 15];
        const y = schedule[index - 2];
        schedule[index] = (schedule[index - 16] + (rightRotate(x, 7) ^ rightRotate(x, 18) ^ (x >>> 3)) + schedule[index - 7] + (rightRotate(y, 17) ^ rightRotate(y, 19) ^ (y >>> 10))) | 0;
      }
      const e = working[4];
      const a = working[0];
      const temp1 = (working[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & working[5]) ^ (~e & working[6])) + constants[index] + schedule[index]) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & working[1]) ^ (a & working[2]) ^ (working[1] & working[2]))) | 0;
      working = [(temp1 + temp2) | 0, working[0], working[1], working[2], (working[3] + temp1) | 0, working[4], working[5], working[6]];
    }
    for (let index = 0; index < 8; index += 1) hash[index] = (initial[index] + working[index]) | 0;
  }
  return hash.slice(0, 8).map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

export function computeSpatialCameraDigest(camera: import("./types").StageCamera): string {
  return sha256(JSON.stringify(canonicalize(camera)));
}

function packDigest(pack: Omit<SpatialControlPack, "packDigest">): string {
  return sha256(JSON.stringify(canonicalize(pack)));
}

function orderedArtifacts(artifacts: StageRenderArtifact[]): StageRenderArtifact[] {
  return STAGE_RENDER_KINDS.flatMap((kind) => artifacts.filter((artifact) => artifact.kind === kind));
}

export function createSpatialControlPack(input: SpatialControlPackInput): SpatialControlPack {
  const core: Omit<SpatialControlPack, "packDigest"> = {
    schemaVersion: 1,
    ...input,
    artifacts: orderedArtifacts(input.artifacts)
  };
  return { ...core, packDigest: packDigest(core) };
}

export function validateSpatialControlPack(
  pack: SpatialControlPack,
  current: Pick<SpatialControlPackInput, "stageId" | "stageRevision" | "stageDigest" | "shotId" | "snapshotId" | "cameraId" | "cameraDigest">
): ControlPackValidation {
  if (!pack || pack.schemaVersion !== 1) return { valid: false, reason: "control_pack_schema_invalid" };
  for (const kind of STAGE_RENDER_KINDS) {
    const matches = pack.artifacts.filter((artifact) => artifact.kind === kind);
    if (matches.length === 0) return { valid: false, reason: `control_pack_artifact_missing:${kind}` };
    if (matches.length > 1) return { valid: false, reason: `control_pack_artifact_duplicate:${kind}` };
    const artifact = matches[0];
    if (!artifact.filePath || !HEX64.test(artifact.sha256) || !Number.isInteger(artifact.width) || artifact.width <= 0 || !Number.isInteger(artifact.height) || artifact.height <= 0) {
      return { valid: false, reason: `control_pack_artifact_invalid:${kind}` };
    }
  }
  if (pack.stageId !== current.stageId || pack.stageRevision !== current.stageRevision || pack.stageDigest !== current.stageDigest) {
    return { valid: false, reason: "control_pack_stage_stale" };
  }
  if (pack.shotId !== current.shotId || pack.snapshotId !== current.snapshotId) {
    return { valid: false, reason: "control_pack_snapshot_stale" };
  }
  if (pack.cameraId !== current.cameraId || pack.cameraDigest !== current.cameraDigest) {
    return { valid: false, reason: "control_pack_camera_stale" };
  }
  const { packDigest: claimed, ...core } = pack;
  if (!HEX64.test(claimed) || packDigest(core) !== claimed) return { valid: false, reason: "control_pack_digest_invalid" };
  return { valid: true };
}
