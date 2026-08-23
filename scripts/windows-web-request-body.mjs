const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;

export async function readLimitedJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const declared = Number(req?.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error("request_body_too_large"); error.statusCode = 413; throw error;
  }
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); total += bytes.length;
    if (total > maxBytes) {
      const error = new Error("request_body_too_large"); error.statusCode = 413; throw error;
    }
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
