# MiniMax H3 视频路由与连续性质量门 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本地 ComfyUI 的 MiniMax H3 T2V、I2V、首尾帧和 R2V 工作流注册为可预检、可自动路由的视频能力，并通过连续段、共享边界帧、规范化和人工质量门产出流畅且人物/场景一致的镜头视频。

**Architecture:** 新建 `video-production` 独立模块，负责工作流注册、镜头路由、连续段规划和质量判定；现有 `comfyService.ts` 继续作为底层 Comfy 队列执行器，只通过已有的 `workflowJsonOverride` 接收选中的 API 工作流。Rust 侧新增独立的 FFmpeg/FFprobe 视频规范化与探测模块，UI 只负责展示路由原因、边界依赖和首/中/尾帧审核。

**Tech Stack:** React 18、TypeScript 5.6、Zustand、Tauri 2/Rust、ComfyUI 0.30.2 API、MiniMax H3、FFmpeg/FFprobe、Node ESM 测试脚本。

## Global Constraints

- 本阶段只接本地 `LocalComfyProvider`；`CloudProvider` 仍只有接口，不配置真实服务。
- MiniMax H3 生成原生为精确 24 fps；工作流长度遵循 `17k + 5` 帧网格，生产范围限制为 124–362 帧。
- 横版生成尺寸固定为 1344×768，竖版固定为 768×1344；最终装配前再统一到项目分辨率。
- 当前硬件基线为 NVIDIA RTX 5070 Ti、约 16GB VRAM；R2V 的 `ref_image_size` 默认使用 `match`，单镜头最多注入 4 张参考图。
- 命名角色或要求场景连续的镜头不得自动降级到 T2V。
- TE Speed 默认仅用于 `draft`；生产模式必须有同输入 A/B 基准结果并由用户显式批准。
- `continuous` 边界共享同一获批边界帧；`hard_cut` 和 `scene_change` 不生成跨场景变形过渡。
- 交付片段统一为 H.264、`yuv420p`、精确 24 fps、48 kHz 双声道 AAC；规范化失败禁止拼接。
- 自动检查不能证明语义一致时，生产任务必须进入首/中/尾帧人工审核，不能把“已生成”当成“已通过”。
- 不依赖 RIFE：当前 ComfyUI 未安装 RIFE/FILM/VFI 节点；MiniMax H3 已原生输出 24 fps。
- 保留现有 `videoWorkflowJson` 和 `videoMode` 的读取兼容；旧项目不被静默改写。

---

## File Structure

- `src/modules/video-production/types.ts`：视频 Profile、路由、连续段、质量报告的唯一 TypeScript 类型定义。
- `src/modules/video-production/workflowProfilesRuntime.mjs`：可由 Node 测试直接执行的 Profile 注册与能力预检。
- `src/modules/video-production/workflowProfiles.ts`：Runtime 的类型安全包装。
- `src/modules/video-production/videoRouterRuntime.mjs`：纯函数镜头路由策略。
- `src/modules/video-production/videoRouter.ts`：路由器类型安全包装。
- `src/modules/video-production/continuityPlannerRuntime.mjs`：纯函数连续段和边界依赖规划。
- `src/modules/video-production/continuityPlanner.ts`：连续性规划类型安全包装。
- `src/modules/video-production/videoGeneration.ts`：引用暂存、H3 token 绑定和 `generateShotAsset` 调用。
- `src/modules/video-production/videoQualityRuntime.mjs`：结构质量报告和人工审核状态机。
- `src/modules/video-production/videoQuality.ts`：质量门类型安全包装。
- `src/modules/video-production/VideoProductionPanel.tsx`：工作流能力、逐镜头路由和质量审核 UI。
- `src/modules/comfy-pipeline/presets/minimax-h3-*.json`：生成得到的 Comfy API prompt 模板。
- `src/modules/comfy-pipeline/presets/minimax-h3-source-manifest.json`：用户工作流来源、SHA-256 和模型/节点基线。
- `scripts/build-minimax-h3-presets.mjs`：确定性生成 API prompt 模板，避免运行时展开 Comfy 前端子图。
- `scripts/check-minimax-h3-*.mjs`：四组无框架 Node 回归测试。
- `src-tauri/src/video_continuity.rs`：FFprobe 探测、FFmpeg 规范化、探帧和安全拼接。

---

### Task 1: 生成可排队的 MiniMax H3 API Preset

**Files:**
- Create: `scripts/build-minimax-h3-presets.mjs`
- Create: `src/modules/comfy-pipeline/presets/minimax-h3-t2v-v1.json`
- Create: `src/modules/comfy-pipeline/presets/minimax-h3-i2v-v1.json`
- Create: `src/modules/comfy-pipeline/presets/minimax-h3-flf2v-v1.json`
- Create: `src/modules/comfy-pipeline/presets/minimax-h3-r2v-v1.json`
- Create: `src/modules/comfy-pipeline/presets/minimax-h3-source-manifest.json`
- Create: `scripts/check-minimax-h3-presets.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: ComfyUI core节点 `MiniMaxH3ImageToVideo`、`MiniMaxH3ReferenceToVideo`、`CreateVideo`、`SaveVideo` 和已安装的 MiniMax H3 模型。
- Produces: 四个只含 API prompt 节点的 JSON 模板；token 为 `{{VIDEO_PROMPT}}`、`{{VIDEO_WIDTH}}`、`{{VIDEO_HEIGHT}}`、`{{H3_LENGTH}}`、`{{FIRST_FRAME_PATH}}`、`{{LAST_FRAME_PATH}}`、`{{REF_IMAGE_1_PATH}}` 至 `{{REF_IMAGE_4_PATH}}`、`{{SEED}}`。

- [ ] **Step 1: 写失败的 Preset 结构测试**

```js
// scripts/check-minimax-h3-presets.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cases = [
  ["minimax-h3-t2v-v1.json", "MiniMaxH3ImageToVideo", []],
  ["minimax-h3-i2v-v1.json", "MiniMaxH3ImageToVideo", ["{{FIRST_FRAME_PATH}}"]],
  ["minimax-h3-flf2v-v1.json", "MiniMaxH3ImageToVideo", ["{{FIRST_FRAME_PATH}}", "{{LAST_FRAME_PATH}}"]],
  ["minimax-h3-r2v-v1.json", "MiniMaxH3ReferenceToVideo", ["{{REF_IMAGE_1_PATH}}"]]
];

for (const [name, conditioningType, requiredTokens] of cases) {
  const raw = fs.readFileSync(path.join(root, "src/modules/comfy-pipeline/presets", name), "utf8");
  const prompt = JSON.parse(raw);
  const nodes = Object.values(prompt);
  assert.ok(nodes.length >= 12, `${name}: expected complete API prompt`);
  assert.ok(nodes.some((node) => node.class_type === conditioningType));
  assert.ok(nodes.some((node) => node.class_type === "CreateVideo"));
  assert.ok(nodes.some((node) => node.class_type === "SaveVideo"));
  assert.equal(nodes.some((node) => node.class_type === "TESpeedMiniMaxH3"), false);
  for (const token of ["{{VIDEO_PROMPT}}", "{{H3_LENGTH}}", "{{SEED}}", ...requiredTokens]) {
    assert.ok(raw.includes(token), `${name}: missing ${token}`);
  }
}

console.log("PASS minimax h3 API presets");
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node scripts/check-minimax-h3-presets.mjs`

Expected: FAIL with `ENOENT` for `minimax-h3-t2v-v1.json`.

- [ ] **Step 3: 编写确定性模板构建器**

`build-minimax-h3-presets.mjs` 必须用一个 `buildBase({ mode, teSpeed })` 函数生成四份 API prompt；公共采样链固定为 `UNETLoader -> BasicScheduler/BasicGuider -> SamplerCustomAdvanced -> VAEDecode/VAEDecodeAudio -> CreateVideo -> SaveVideo`，并使用以下精确模型：

```js
const MODELS = {
  fl2va: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  ref2va: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors"
};

const samplerInputs = {
  sampler_name: "res_multistep"
};

const schedulerInputs = {
  model: ["1", 0],
  scheduler: "simple",
  steps: 20,
  denoise: 1
};
```

I2V 只连接一个 `LoadImage` 到 `first_frame`；FLF2V 连接首尾两张；T2V 不写 `first_frame/last_frame`；R2V 使用 `ref2va`、`MiniMaxH3ReferenceToVideo` 和最多四个可由执行器裁掉的参考 `LoadImage` 节点。不要复制示例提示词、示例图片名、作者 UI 布局或 groups。

- [ ] **Step 4: 写入来源清单**

```json
{
  "version": 1,
  "sourceDirectory": "C:/Users/Administrator/Desktop/工作流",
  "sources": {
    "allSeries": "6ca194e4dd4d624a93eeb5ba1bdaef6a9918b22c6c4defdf6e364da102791963",
    "teSpeed": "363afc99504e88ff1a390ff24f5a925345927d031df0c34ffc52ad0188e0799f",
    "teSpeedFirstLast": "2a05247ab4d6781d98e579825589d9182bd4ad085e15f4763d0255b67eebc8a8",
    "i2v": "bb71aecdd3c0b62e56eafe03acb14d1cfeabec7072eaed9cbdf473c2aaf73009",
    "r2v": "099d24eda6263854818975c7209db6f29ebfd0339936c928f12293d5ab029ffb",
    "t2v": "31ab33fdb053a7834cc866bd7aa08b887518fc656e4a796c89779c6b5e1786e6"
  },
  "verifiedComfyVersion": "0.30.2",
  "verifiedFrontendVersion": "1.47.12",
  "nativeFps": 24,
  "h3LengthRange": [124, 362],
  "h3LengthGrid": "17k+5"
}
```

- [ ] **Step 5: 生成模板并使测试通过**

Run: `node scripts/build-minimax-h3-presets.mjs && node scripts/check-minimax-h3-presets.mjs`

Expected: `PASS minimax h3 API presets`.

- [ ] **Step 6: 注册 npm 测试命令并提交**

```json
"test:minimax-h3-presets": "node scripts/check-minimax-h3-presets.mjs"
```

```bash
git add scripts/build-minimax-h3-presets.mjs scripts/check-minimax-h3-presets.mjs src/modules/comfy-pipeline/presets/minimax-h3-*.json package.json
git commit -m "feat: add normalized MiniMax H3 video presets"
```

### Task 2: Profile 注册表与实时能力预检

**Files:**
- Create: `src/modules/video-production/types.ts`
- Create: `src/modules/video-production/workflowProfilesRuntime.mjs`
- Create: `src/modules/video-production/workflowProfiles.ts`
- Create: `scripts/check-minimax-h3-profile-registry.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 的 preset 路径、Comfy `/object_info` 节点名集合和 `/models/*` 模型名集合。
- Produces: `MINIMAX_H3_PROFILES`、`preflightVideoProfile(profile, inventory)`、`VideoProfilePreflightReport`。

- [ ] **Step 1: 写路由所需的稳定类型**

```ts
export type VideoWorkflowProfileId =
  | "minimax_h3_t2v"
  | "minimax_h3_i2v"
  | "minimax_h3_flf2v"
  | "minimax_h3_r2v";

export type VideoQualityTier = "draft" | "production";
export type VideoAccelerationMode = "standard" | "te_speed_preview";
export type VideoBoundaryKind = "continuous" | "match_cut" | "hard_cut" | "scene_change";

export interface VideoWorkflowProfile {
  id: VideoWorkflowProfileId;
  presetPath: string;
  qualityTier: VideoQualityTier;
  supports: { textOnly: boolean; firstFrame: boolean; lastFrame: boolean; referenceImages: number; referenceVideo: boolean; referenceAudio: boolean };
  requiredNodes: string[];
  requiredModels: Array<{ kind: "diffusion_models" | "text_encoders" | "vae"; name: string }>;
}

export interface VideoProfilePreflightReport {
  profileId: VideoWorkflowProfileId;
  available: boolean;
  missingNodes: string[];
  missingModels: Array<{ kind: string; name: string }>;
  warnings: string[];
}

export type VideoRouteDecision =
  | { status: "selected"; profileId: VideoWorkflowProfileId; reason: string }
  | { status: "blocked"; profileId?: VideoWorkflowProfileId; reason: string };

export interface VideoRouteInput {
  manualProfileId: VideoWorkflowProfileId | "auto";
  qualityTier: VideoQualityTier;
  accelerationMode: VideoAccelerationMode;
  availableProfileIds: VideoWorkflowProfileId[];
  namedCharacterCount: number;
  identityReferenceCount: number;
  extraReferenceCount: number;
  hasSceneContinuity: boolean;
  hasStoryboardFrame: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  hasApprovedBoundaryFrame: boolean;
  hasDialogue: boolean;
  boundaryKind: VideoBoundaryKind;
}
```

- [ ] **Step 2: 写失败测试**

测试必须覆盖：当前已验证 inventory 下四个生产 Profile 均可用；删除 `MiniMaxH3ReferenceToVideo` 后只有 R2V 不可用；删除 `ref2va` 后 R2V 报模型缺失；请求 TE Speed overlay 但缺少 `TESpeedMiniMaxH3` 时 overlay 预检不可用，基础 Profile 仍可使用标准模式。

- [ ] **Step 3: 实现纯函数预检**

```js
export function preflightVideoProfile(profile, inventory) {
  const nodes = new Set(inventory.nodes ?? []);
  const missingNodes = profile.requiredNodes.filter((name) => !nodes.has(name));
  const missingModels = profile.requiredModels.filter(
    ({ kind, name }) => !(inventory.models?.[kind] ?? []).includes(name)
  );
  return {
    profileId: profile.id,
    available: missingNodes.length === 0 && missingModels.length === 0,
    missingNodes,
    missingModels,
    warnings: []
  };
}

export function preflightVideoAcceleration(mode, qualityTier, inventory) {
  if (mode === "standard") return { available: true, warnings: [] };
  if (qualityTier !== "draft") return { available: false, warnings: ["te_speed_draft_only"] };
  return inventory.nodes?.includes("TESpeedMiniMaxH3")
    ? { available: true, warnings: ["te_speed_draft_only"] }
    : { available: false, warnings: ["missing_node:TESpeedMiniMaxH3"] };
}
```

- [ ] **Step 4: 运行测试并提交**

Run: `node scripts/check-minimax-h3-profile-registry.mjs`

Expected: `PASS minimax h3 profile registry`.

```bash
git add src/modules/video-production scripts/check-minimax-h3-profile-registry.mjs package.json
git commit -m "feat: register MiniMax H3 video capabilities"
```

### Task 3: 扩展镜头视频计划并兼容旧项目

**Files:**
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `src/modules/storyboard-core/store.ts`
- Create: `scripts/check-video-production-schema.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 现有 `Shot.videoMode`、首尾帧路径和场景/角色引用。
- Produces: 可持久化的人工 Profile 覆盖、连续段、边界类型、生成凭证与质量状态。

- [ ] **Step 1: 写失败的迁移测试**

测试导入一个只有 `videoMode: "first_last_frame"` 的旧镜头，断言它仍保持原值，同时新增字段使用安全默认值且不回写源文件。

- [ ] **Step 2: 扩展 `Shot`**

```ts
videoWorkflowProfileId?: VideoWorkflowProfileId | "auto";
videoQualityTier?: VideoQualityTier;
videoAccelerationMode?: VideoAccelerationMode;
continuitySegmentId?: string;
videoBoundaryKind?: VideoBoundaryKind;
approvedBoundaryFramePath?: string;
videoRouteReason?: string;
videoQualityStatus?: "pending" | "checking" | "needs_review" | "approved" | "rejected";
videoGenerationReceipt?: {
  profileId: VideoWorkflowProfileId;
  accelerationMode: VideoAccelerationMode;
  workflowDigest: string;
  inputDigest: string;
  promptId: string;
  normalizedPath?: string;
  generatedAt: string;
};
```

- [ ] **Step 3: 在 store 的导入、更新和序列化路径逐字段透传**

旧镜头默认：`videoWorkflowProfileId: "auto"`、`videoQualityTier: "production"`、`videoAccelerationMode: "standard"`、`videoBoundaryKind: "hard_cut"`、`videoQualityStatus: "pending"`。只有内存迁移，不自动覆盖磁盘项目。

- [ ] **Step 4: 运行测试、构建并提交**

Run: `node scripts/check-video-production-schema.mjs && npm run build`

Expected: schema test PASS；TypeScript/Vite build PASS。

```bash
git add src/modules/storyboard-core/types.ts src/modules/storyboard-core/store.ts scripts/check-video-production-schema.mjs package.json
git commit -m "feat: persist per-shot video production plans"
```

### Task 4: 实现确定性工作流路由器

**Files:**
- Create: `src/modules/video-production/videoRouterRuntime.mjs`
- Create: `src/modules/video-production/videoRouter.ts`
- Create: `scripts/check-video-workflow-router.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Shot`、参考资产统计、边界类型、质量级别和 Task 2 的可用 Profile 报告。
- Produces: `routeVideoWorkflow(input): VideoRouteDecision`。

- [ ] **Step 1: 写完整路由矩阵测试**

```js
const cases = [
  ["named character without refs", { namedCharacterCount: 1 }, "blocked"],
  ["empty establishing shot", { namedCharacterCount: 0, hasSceneContinuity: false }, "minimax_h3_t2v"],
  ["dialogue closeup", { namedCharacterCount: 1, identityReferenceCount: 1, hasStoryboardFrame: true, hasDialogue: true }, "minimax_h3_i2v"],
  ["explicit endpoint", { namedCharacterCount: 1, identityReferenceCount: 1, hasFirstFrame: true, hasLastFrame: true }, "minimax_h3_flf2v"],
  ["two characters", { namedCharacterCount: 2, identityReferenceCount: 2, hasStoryboardFrame: true }, "minimax_h3_r2v"],
  ["strong style refs", { namedCharacterCount: 1, identityReferenceCount: 1, extraReferenceCount: 2 }, "minimax_h3_r2v"]
];
```

还要覆盖：人工 Profile 优先；人工 Profile 不可用时阻断；production 不自动选 TE Speed；`hard_cut` 不因下一镜头有图而选择 FLF2V；连续边界在有共享帧时选择 FLF2V。

- [ ] **Step 2: 实现优先级规则**

```js
export function routeVideoWorkflow(input) {
  if (input.manualProfileId && input.manualProfileId !== "auto") {
    return availableOrBlocked(input.manualProfileId, "manual_override", input.availableProfileIds);
  }
  if (input.namedCharacterCount > 0 && input.identityReferenceCount === 0) {
    return { status: "blocked", reason: "named_character_missing_identity_reference" };
  }
  if (input.namedCharacterCount > 1 || input.identityReferenceCount + input.extraReferenceCount >= 3) {
    return availableOrBlocked("minimax_h3_r2v", "strong_reference_constraints", input.availableProfileIds);
  }
  if ((input.boundaryKind === "continuous" && input.hasApprovedBoundaryFrame) || (input.hasFirstFrame && input.hasLastFrame)) {
    return availableOrBlocked("minimax_h3_flf2v", "explicit_endpoints", input.availableProfileIds);
  }
  if (input.hasStoryboardFrame) {
    return availableOrBlocked("minimax_h3_i2v", input.hasDialogue ? "stable_dialogue_anchor" : "storyboard_anchor", input.availableProfileIds);
  }
  if (input.namedCharacterCount === 0 && !input.hasSceneContinuity) {
    return availableOrBlocked("minimax_h3_t2v", "unconstrained_establishing_shot", input.availableProfileIds);
  }
  return { status: "blocked", reason: "no_safe_video_profile" };
}

function availableOrBlocked(profileId, reason, availableProfileIds) {
  return availableProfileIds.includes(profileId)
    ? { status: "selected", profileId, reason }
    : { status: "blocked", profileId, reason: `profile_unavailable:${profileId}` };
}
```

- [ ] **Step 3: 运行测试并提交**

Run: `node scripts/check-video-workflow-router.mjs`

Expected: `PASS video workflow router`.

```bash
git add src/modules/video-production/videoRouter* scripts/check-video-workflow-router.mjs package.json
git commit -m "feat: route shots across MiniMax H3 workflows"
```

### Task 5: 绑定 H3 输入并调用现有 Comfy 执行器

**Files:**
- Create: `src/modules/video-production/videoGeneration.ts`
- Modify: `src/modules/comfy-pipeline/comfyService.ts`
- Create: `scripts/check-minimax-h3-binding.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `VideoRouteDecision`、Profile API JSON、`Shot`、角色身份裁片、场景参考和共享边界帧。
- Produces: `generateRoutedVideoShot(request)` 和可复现的 `videoGenerationReceipt`。

- [ ] **Step 1: 写长度和引用绑定测试**

断言 `secondsToH3Length(2) === 124`、`secondsToH3Length(5) === 124`、`secondsToH3Length(10) === 243`、超过 15 秒时抛出 `h3_shot_too_long`；R2V 参考按“角色脸/身体、场景、关键道具”排序并截为 4；未使用的参考 `LoadImage` 节点及连线被移除；draft + TE Speed 时在 UNET 与 guider/scheduler 之间注入 `TESpeedMiniMaxH3`，production 请求 TE Speed 时在排队前阻断。

- [ ] **Step 2: 实现长度函数和 token 集**

```ts
export function secondsToH3Length(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("invalid_video_duration");
  if (seconds > 15) throw new Error("h3_shot_too_long");
  const requested = Math.round(seconds * 24);
  const snapped = requested + ((5 - (requested % 17) + 17) % 17);
  return Math.min(362, Math.max(124, snapped));
}
```

`tokenOverrides` 必须包含 `VIDEO_PROMPT`、`VIDEO_WIDTH`、`VIDEO_HEIGHT`、`H3_LENGTH`、`SEED` 和当前 Profile 需要的路径。短于 H3 最小长度的镜头生成 124 帧，之后由 Task 7 按项目镜头时长裁尾。

- [ ] **Step 3: 只增加一个底层公开入口，不复制队列逻辑**

在 `comfyService.ts` 导出已有内部能力需要的最小函数；`videoGeneration.ts` 必须调用：

```ts
const result = await generateShotAsset(settings, shot, index, "video", allShots, assets, {
  workflowJsonOverride: profileWorkflowJson,
  tokenOverrides,
  onProgress,
  signal
});
```

禁止在新模块重复实现 `/prompt`、history 轮询、输出收集或 Comfy input 暂存。

- [ ] **Step 4: 运行测试与构建并提交**

Run: `node scripts/check-minimax-h3-binding.mjs && npm run build`

Expected: binding test PASS；build PASS。

```bash
git add src/modules/video-production/videoGeneration.ts src/modules/comfy-pipeline/comfyService.ts scripts/check-minimax-h3-binding.mjs package.json
git commit -m "feat: execute routed MiniMax H3 video profiles"
```

### Task 6: 连续段、共享边界帧和依赖失效

**Files:**
- Create: `src/modules/video-production/continuityPlannerRuntime.mjs`
- Create: `src/modules/video-production/continuityPlanner.ts`
- Create: `scripts/check-video-continuity-planner.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 有序镜头、人工边界类型、角色/场景/时间状态摘要。
- Produces: `ContinuitySegment[]`、`VideoBoundaryPlan[]`、镜头执行依赖和精确 stale 范围。

- [ ] **Step 1: 写失败测试**

覆盖同场景同人物三个镜头形成一个 segment；`continuous` 令后一镜头依赖前一镜头的获批尾帧；`hard_cut` 允许并行；`scene_change` 新建 segment；修改共享边界只使左右两个镜头和装配任务 stale。

- [ ] **Step 2: 定义纯数据计划**

```ts
export interface VideoBoundaryPlan {
  id: string;
  fromShotId: string;
  toShotId: string;
  kind: VideoBoundaryKind;
  sharedFramePath?: string;
  requiresApproval: boolean;
}

export interface ContinuitySegment {
  id: string;
  shotIds: string[];
  characterAnchorPaths: string[];
  sceneAnchorPath?: string;
  colorAnchorPath?: string;
  boundaries: VideoBoundaryPlan[];
}
```

- [ ] **Step 3: 实现边界规则**

只有 `continuous` 可把前镜头“获批尾帧”作为后镜头首帧；`match_cut` 必须有人工批准的独立共享关键帧；`hard_cut` 和 `scene_change` 不产生首尾帧依赖。移除当前 `inferVideoMode` 中“仅因下一镜头存在分镜且出现泛化转场词就使用下一镜头图”的隐式行为。

- [ ] **Step 4: 运行测试并提交**

Run: `node scripts/check-video-continuity-planner.mjs`

Expected: `PASS video continuity planner`.

```bash
git add src/modules/video-production/continuityPlanner* scripts/check-video-continuity-planner.mjs src/modules/comfy-pipeline/comfyService.ts package.json
git commit -m "feat: plan shared video continuity boundaries"
```

### Task 7: FFmpeg 规范化、探帧和安全拼接

**Files:**
- Create: `src-tauri/src/video_continuity.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/modules/platform/desktopBridge.ts`
- Create: `scripts/check-video-normalization-contract.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: MiniMax H3 输出路径、项目宽高、镜头精确时长和项目资产目录。
- Produces: `probe_video_segment`、`normalize_video_segment`、`extract_video_review_frames`、`concat_normalized_video_segments` Tauri commands。

- [ ] **Step 1: 写前端命令契约测试**

断言 command request/response 字段固定，拒绝空路径、非 24 fps、尺寸不一致和缺少规范化凭证的拼接请求。

- [ ] **Step 2: 新建 Rust 模块并保持 `main.rs` 只有注册代码**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub duration_seconds: f64,
    pub video_codec: String,
    pub pixel_format: String,
    pub audio_sample_rate: Option<u32>,
    pub audio_channels: Option<u32>,
    pub has_monotonic_timestamps: bool,
}
```

`normalize_video_segment` 使用 FFmpeg 明确写入：`fps=24,scale=<project>,setsar=1,format=yuv420p`、`libx264`、`aac`、`48000 Hz`、双声道，并用 `-t` 裁到镜头精确时长。不得使用 shell 字符串拼接参数；继续使用 `Command::new("ffmpeg").arg(...)`。

- [ ] **Step 3: 增加结构异常探测**

FFmpeg filters 使用 `blackdetect` 和 `freezedetect`；FFprobe 检查时间戳、codec、帧率、分辨率和音频参数。`extract_video_review_frames` 输出首帧、50% 中间帧和尾帧 PNG，文件写入项目派生资产目录。

- [ ] **Step 4: 安全拼接只接受规范化片段**

替换视频生产流程对旧 `concat_video_segments` 的调用；保留旧 command 供旧项目使用。新 command 拼接前逐个 probe 并要求完全一致，然后编码一次输出成片。

- [ ] **Step 5: 运行测试、Rust 检查并提交**

Run: `node scripts/check-video-normalization-contract.mjs && cargo check --manifest-path src-tauri/Cargo.toml`

Expected: contract test PASS；`cargo check` PASS。

```bash
git add src-tauri/src/video_continuity.rs src-tauri/src/main.rs src/modules/platform/desktopBridge.ts scripts/check-video-normalization-contract.mjs package.json
git commit -m "feat: normalize and inspect generated video segments"
```

### Task 8: 质量门和人工首/中/尾帧审核

**Files:**
- Create: `src/modules/video-production/videoQualityRuntime.mjs`
- Create: `src/modules/video-production/videoQuality.ts`
- Create: `src/modules/video-production/VideoProductionPanel.tsx`
- Create: `scripts/check-video-quality-gate.mjs`
- Modify: `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
- Modify: `src/styles/global.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 7 的 probe、异常事件、首/中/尾帧，角色身份裁片、场景参考和边界计划。
- Produces: `VideoQualityReport`、人工 `approve/reject` 决策、局部重建请求。

- [ ] **Step 1: 写质量状态机测试**

```js
const structuralFailure = {
  normalized: false,
  blackFrameCount: 0,
  freezeDurationSeconds: 0,
  timestampErrors: 0
};
assert.equal(evaluateVideoQuality(structuralFailure).status, "rejected");

const structurallyClean = {
  normalized: true,
  blackFrameCount: 0,
  freezeDurationSeconds: 0,
  timestampErrors: 0,
  identityEvaluatorAvailable: false
};
assert.equal(evaluateVideoQuality(structurallyClean).status, "needs_review");
```

还要覆盖：任意黑帧、超过 0.5 秒冻结、非单调时间戳直接拒绝；自动结构检查通过但缺少语义评估时仍需人工审核；用户批准后才变为 `approved`。

- [ ] **Step 2: 实现报告类型与状态机**

```ts
export interface VideoQualityReport {
  shotId: string;
  status: "rejected" | "needs_review" | "approved";
  structuralIssues: string[];
  semanticReviewItems: Array<"character_identity" | "scene_anchor" | "costume_prop" | "motion_boundary" | "color_continuity">;
  reviewFrames: { first: string; middle: string; last: string };
  boundaryFrame?: string;
  reviewedByUserAt?: string;
}
```

- [ ] **Step 3: 实现审核 UI**

`VideoProductionPanel` 每个镜头显示：自动选择的 Profile 和理由、手动下拉覆盖、模型/节点预检、首/中/尾帧、角色脸/身体参考、场景参考、边界帧、结构异常和“批准 / 驳回并局部重建”。人工驳回必须要求选择原因；局部重建只提交当前镜头，连续边界失败时只提交相邻两个镜头。

- [ ] **Step 4: 以子组件接入，不继续堆积业务逻辑**

`ComfyPipelinePanel.tsx` 只增加 import 和一个 `<VideoProductionPanel />` 挂载点；设置、路由、质量计算不得定义在该大文件内。

- [ ] **Step 5: 运行测试与构建并提交**

Run: `node scripts/check-video-quality-gate.mjs && npm run build`

Expected: quality gate test PASS；build PASS。

```bash
git add src/modules/video-production src/modules/comfy-pipeline/ComfyPipelinePanel.tsx src/styles/global.css scripts/check-video-quality-gate.mjs package.json
git commit -m "feat: gate video production on continuity review"
```

### Task 9: 端到端验证和回归保护

**Files:**
- Create: `scripts/run-minimax-h3-video-smoke.mjs`
- Modify: `scripts/check-workflow-presets.mjs`
- Modify: `package.json`
- Create: `docs/superpowers/verification/minimax-h3-video-routing-checklist.md`

**Interfaces:**
- Consumes: 运行中的 `http://127.0.0.1:8188`、四个 Profile、至少一个角色镜头、一个连续双镜头和一个换场镜头。
- Produces: 本地 smoke 报告、生成凭证、规范化片段、质量报告和最终拼接结果。

- [ ] **Step 1: 扩展静态工作流审计**

把四个 H3 preset 设为 core；检查对应 conditioning、`CreateVideo`、`SaveVideo`、模型 token 和代码引用。静态测试离线可运行；live inventory 检查只在 Comfy 在线时执行。

- [ ] **Step 2: 编写非破坏性 smoke 脚本**

默认只做 `/system_stats`、`/object_info`、模型清单、模板编译和 prompt payload 验证；只有传入 `--generate` 才实际排队一个 124 帧低成本 I2V 样例。脚本禁止自动下载模型或安装节点。

- [ ] **Step 3: 运行全套自动验证**

Run:

```bash
npm run test:minimax-h3-presets
node scripts/check-minimax-h3-profile-registry.mjs
node scripts/check-video-production-schema.mjs
node scripts/check-video-workflow-router.mjs
node scripts/check-minimax-h3-binding.mjs
node scripts/check-video-continuity-planner.mjs
node scripts/check-video-normalization-contract.mjs
node scripts/check-video-quality-gate.mjs
npm run test:workflow-presets
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
node scripts/run-minimax-h3-video-smoke.mjs
```

Expected: 全部 PASS；smoke 报告四个生产 Profile 可用，TE Speed overlay 标记 `draft_only`。

- [ ] **Step 4: 人工验收三种镜头**

1. 单角色对白特写：路由 I2V，身份裁片与首/中/尾帧人工对照通过。
2. 同场景动作双镜头：路由 FLF2V，复用获批边界帧，拼接处没有黑帧、冻结或异常跳动。
3. 场景切换：边界为 `scene_change`，保持角色身份但不生成跨场景变形。

- [ ] **Step 5: 记录限制并提交**

验证清单必须明确：生成模型无法数学保证零漂移；本功能通过约束输入、Profile 路由、共享边界和“未过审不入成片”来保证生产流程，不以一次生成成功作为完成标准。

```bash
git add scripts/run-minimax-h3-video-smoke.mjs scripts/check-workflow-presets.mjs package.json docs/superpowers/verification/minimax-h3-video-routing-checklist.md
git commit -m "test: verify MiniMax H3 routed video production"
```

---

## Execution Order and Checkpoints

1. Tasks 1–2 完成后：四种 H3 能力可离线注册并在线预检，但还不生成。
2. Tasks 3–5 完成后：单镜头可以按规则选择并执行不同 H3 工作流。
3. Tasks 6–8 完成后：连续段、共享边界、规范化和人工质量门闭环。
4. Task 9 完成后：运行 smoke 和三种人工验收，再允许生产项目启用。

每个 checkpoint 都必须保持旧 `videoWorkflowJson` 路径、旧项目打开保存、现有图片生成和时间线导出可用。
