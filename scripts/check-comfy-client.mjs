import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/services/generation-providers/comfyClient.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "ComfyClient bundle should be available");
const { COMFY_DESKTOP_UNAVAILABLE_MESSAGE, ComfyClient, normalizeComfyBaseUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

assert.equal(normalizeComfyBaseUrl(" http://localhost:8188/// "), "http://localhost:8188");
assert.equal(normalizeComfyBaseUrl(""), "http://127.0.0.1:8188");

const httpCalls = [];
const httpClient = new ComfyClient({
  baseUrl: " http://localhost:8188/ ",
  fetchImpl: async (url, init) => {
    httpCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ CheckpointLoaderSimple: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
});
assert.deepEqual(await httpClient.getObjectInfo(), { CheckpointLoaderSimple: {} });
assert.equal(httpCalls[0]?.url, "http://localhost:8188/object_info");
assert.equal(httpCalls[0]?.init?.method, "GET");

const failedHttpClient = new ComfyClient({
  baseUrl: "http://localhost:8188",
  fetchImpl: async () => new Response("offline", { status: 503 })
});
await assert.rejects(() => failedHttpClient.getObjectInfo(), /HTTP 503/);

const unavailableClient = new ComfyClient({
  baseUrl: "http://127.0.0.1:8188",
  fetchImpl: async () => new Response("{}", { status: 200 })
});
const desktopOnlyCalls = [
  () => unavailableClient.queuePrompt({}, "client-a"),
  () => unavailableClient.getHistory("prompt-123"),
  () => unavailableClient.fetchViewBase64("http://127.0.0.1:8188/view?filename=a.png"),
  () => unavailableClient.writeBase64File("C:/ComfyUI/input/a.png", "ZmFrZQ=="),
  () => unavailableClient.copyFile("C:/ComfyUI/output/a.png", "C:/ComfyUI/input/a.png")
];
assert.equal(
  COMFY_DESKTOP_UNAVAILABLE_MESSAGE,
  "未检测到桌面运行环境。请使用 Tauri 桌面版或 Windows Web 启动脚本。"
);
for (const call of desktopOnlyCalls) {
  await assert.rejects(call, (error) => {
    assert.equal(error?.message, COMFY_DESKTOP_UNAVAILABLE_MESSAGE);
    return true;
  });
}

const desktopCalls = [];
const desktopClient = new ComfyClient({
  baseUrl: "http://127.0.0.1:8188/",
  desktopInvoke: async (command, args) => {
    desktopCalls.push({ command, args });
    if (command === "comfy_queue_prompt") return "prompt-123";
    if (command === "comfy_get_history") return { "prompt-123": { outputs: {} } };
    if (command === "comfy_fetch_view_base64") return "ZmFrZQ==";
    if (command === "write_base64_file") return { filePath: "C:/ComfyUI/input/frame.png" };
    if (command === "copy_file_to") return { filePath: "C:/ComfyUI/input/copied.png" };
    if (command === "comfy_get_object_info") return { DesktopNode: {} };
    throw new Error(`unexpected command: ${command}`);
  }
});
const prompt = { "1": { class_type: "KSampler", inputs: {} } };
assert.equal(await desktopClient.queuePrompt(prompt, "client-a"), "prompt-123");
assert.deepEqual(await desktopClient.getHistory("prompt-123"), { "prompt-123": { outputs: {} } });
assert.equal(await desktopClient.fetchViewBase64("http://127.0.0.1:8188/view?filename=a.png"), "ZmFrZQ==");
assert.deepEqual(
  await desktopClient.writeBase64File("C:/ComfyUI/input/frame.png", "ZmFrZQ=="),
  { filePath: "C:/ComfyUI/input/frame.png" }
);
assert.deepEqual(
  await desktopClient.copyFile("C:/ComfyUI/output/a.png", "C:/ComfyUI/input/copied.png"),
  { filePath: "C:/ComfyUI/input/copied.png" }
);
assert.deepEqual(await desktopClient.getObjectInfo(), { DesktopNode: {} });
assert.deepEqual(desktopCalls[0], {
  command: "comfy_queue_prompt",
  args: { baseUrl: "http://127.0.0.1:8188", prompt, clientId: "client-a" }
});
assert.deepEqual(desktopCalls[1], {
  command: "comfy_get_history",
  args: { baseUrl: "http://127.0.0.1:8188", promptId: "prompt-123" }
});

assert.equal(
  desktopClient.toViewUrl({ filename: "shot 1.png", subfolder: "storyboard/final", type: "output" }),
  "http://127.0.0.1:8188/view?filename=shot+1.png&subfolder=storyboard%2Ffinal&type=output"
);

const source = bundle.toLowerCase();
for (const roleName of ["character", "panorama", "storyboard", "quality"]) {
  assert.doesNotMatch(source, new RegExp(roleName), `transport boundary must not own ${roleName} behavior`);
}

console.log("PASS comfy client transport contract");
