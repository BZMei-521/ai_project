export const RUNNING_HUB_WORKFLOW_ID = "2090035427871903746";
export const RUNNING_HUB_WORKFLOW_URL = "https://www.runninghub.cn/workflow/2090035427871903746?source=workspace";

const ALLOWED = {
  local_default: ["cloud_recommended"],
  cloud_recommended: ["awaiting_approval", "declined"],
  awaiting_approval: ["approved", "declined", "cancelled"],
  approved: ["submitted", "cancelled"],
  submitted: ["running", "output_collected", "failed", "timed_out", "cancelled"],
  running: ["output_collected", "recovered_primary_output", "failed", "timed_out", "cancelled"],
  recovered_primary_output: ["watermark_checked"],
  output_collected: ["watermark_checked"],
  watermark_checked: ["quality_review", "watermark_review_required"],
  quality_review: ["accepted", "failed"]
};

const EVENT_TARGETS = {
  RECOMMEND_CLOUD: "cloud_recommended",
  REQUEST_APPROVAL: "awaiting_approval",
  APPROVE: "approved",
  DECLINE: "declined",
  CANCEL: "cancelled",
  SUBMIT: "submitted",
  POLL_RUNNING: "running",
  COLLECT_OUTPUT: "output_collected",
  RECOVER_PRIMARY_OUTPUT: "recovered_primary_output",
  FAIL: "failed",
  TIME_OUT: "timed_out",
  CHECK_WATERMARK: "watermark_checked",
  REQUIRE_WATERMARK_REVIEW: "watermark_review_required",
  BEGIN_QUALITY_REVIEW: "quality_review",
  ACCEPT: "accepted"
};

function stableCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(message) {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15], y = words[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[i] + words[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + temp1) >>> 0, c, b, a, (temp1 + temp2) >>> 0];
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}

function isAbsoluteReference(value) {
  return typeof value === "string" && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/"));
}

function normalizeInput(input) {
  const references = Array.isArray(input?.references) ? input.references.map((value) => String(value).trim()) : [];
  const createdAt = typeof input?.createdAt === "string" ? input.createdAt : "";
  if (typeof input?.shotId !== "string" || !input.shotId.trim()) throw new Error("runninghub_shot_id_required");
  if (input.workflowId !== RUNNING_HUB_WORKFLOW_ID || input.workflowUrl !== RUNNING_HUB_WORKFLOW_URL) throw new Error("runninghub_workflow_not_pinned");
  if (references.length !== 2 || new Set(references).size !== 2 || !references.every(isAbsoluteReference)) throw new Error("runninghub_references_invalid");
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("runninghub_prompt_required");
  if (!Number.isInteger(input.width) || input.width <= 0 || input.width % 2 || !Number.isInteger(input.height) || input.height <= 0 || input.height % 2) throw new Error("runninghub_dimensions_invalid");
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 15) throw new Error("runninghub_duration_invalid");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new Error("runninghub_created_at_invalid");
  return { shotId: input.shotId.trim(), workflowId: input.workflowId, workflowUrl: input.workflowUrl, references, prompt: input.prompt.trim(), width: input.width, height: input.height, durationSeconds: input.durationSeconds, createdAt };
}

export function createRunningHubApprovalSnapshot(input) {
  const normalized = normalizeInput(input);
  return { schemaVersion: 1, ...normalized, inputDigest: sha256Hex(stableCanonicalJson(normalized)) };
}

export function validateRunningHubApproval(snapshot, currentInput, consumedDigests = new Set()) {
  try {
    if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.inputDigest !== "string") {
      return { ok: false, reason: "approval_input_changed" };
    }
    const reconstructedSnapshot = createRunningHubApprovalSnapshot({
      shotId: snapshot.shotId,
      workflowId: snapshot.workflowId,
      workflowUrl: snapshot.workflowUrl,
      references: snapshot.references,
      prompt: snapshot.prompt,
      width: snapshot.width,
      height: snapshot.height,
      durationSeconds: snapshot.durationSeconds,
      createdAt: snapshot.createdAt
    });
    const snapshotInput = {
      shotId: snapshot.shotId,
      workflowId: snapshot.workflowId,
      workflowUrl: snapshot.workflowUrl,
      references: snapshot.references,
      prompt: snapshot.prompt,
      width: snapshot.width,
      height: snapshot.height,
      durationSeconds: snapshot.durationSeconds,
      createdAt: snapshot.createdAt
    };
    const canonicalSnapshotInput = {
      shotId: reconstructedSnapshot.shotId,
      workflowId: reconstructedSnapshot.workflowId,
      workflowUrl: reconstructedSnapshot.workflowUrl,
      references: reconstructedSnapshot.references,
      prompt: reconstructedSnapshot.prompt,
      width: reconstructedSnapshot.width,
      height: reconstructedSnapshot.height,
      durationSeconds: reconstructedSnapshot.durationSeconds,
      createdAt: reconstructedSnapshot.createdAt
    };
    if (stableCanonicalJson(snapshotInput) !== stableCanonicalJson(canonicalSnapshotInput)) return { ok: false, reason: "approval_input_changed" };
    if (snapshot.inputDigest !== reconstructedSnapshot.inputDigest) return { ok: false, reason: "approval_input_changed" };
    const expected = createRunningHubApprovalSnapshot(currentInput);
    if (snapshot.inputDigest !== expected.inputDigest) return { ok: false, reason: "approval_input_changed" };
    if (consumedDigests.has(snapshot.inputDigest)) return { ok: false, reason: "approval_already_consumed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "approval_input_changed" };
  }
}

export function consumeRunningHubApproval(snapshot, currentInput, consumedDigests = new Set()) {
  const validation = validateRunningHubApproval(snapshot, currentInput, consumedDigests);
  if (!validation.ok) return validation;
  consumedDigests.add(snapshot.inputDigest);
  return { ok: true };
}

export function transitionRunningHubState(state, event) {
  const current = state?.status;
  if (!ALLOWED[current]) throw new Error("cloud_state_terminal");
  const next = EVENT_TARGETS[event?.type];
  if (!next || !ALLOWED[current].includes(next)) throw new Error("cloud_state_transition_invalid");
  return { ...state, status: next };
}
