# AI 导演与 360° 场景生产工作流设计

- 状态：已批准
- 日期：2026-08-17
- 首个实施范围：阶段 1「导演基础」
- 后续阶段：360° 场景、一键成片、产品化与云端 Provider

## 1. 背景

当前项目已经具备角色身份包、三视图、场景天空盒、分镜图、镜头视频、配音音效、质量检查、时间线和导出能力。它的底层生成深度较强，但大量流程集中在 `ComfyPipelinePanel.tsx`，用户需要理解工作流、模型和生成顺序，才能完成从故事到成片的生产。

灰豆 AI 光影引擎 6.8.5 展示了更完整的产品化路径：故事进入 AI 剧本导演，形成角色、场景、道具、连续性规则和镜头计划，再进入图片、视频、声音和时间线。其技术路线同样基于 Tauri、Rust、WebView、SQLite 和 FFmpeg。借鉴重点是产品流程、领域模型和任务编排，不复制其代码、资源或服务接口。

本设计在现有项目上新增独立的「AI 导演工作台」，将已有 ComfyUI 能力保留为底层执行器，并把 2:1 真全景提升为核心场景的权威空间资产。

## 2. 目标

1. 同时支持读取当前小说项目和导入外部故事文本。
2. 从故事生成可审核的故事圣经、资产计划、镜头表和机位计划。
3. 在高成本生成前设置强制人工审核门。
4. 由 AI 导演自动识别需要 360° 母版的核心场景，用户可以手动升降级。
5. 以 2:1 equirectangular 全景作为核心场景唯一权威空间源。
6. 允许 AI 自动选择镜头机位，并允许用户在 360° 查看器中调整 `yaw`、`pitch` 和 `FOV`。
7. 将一键成片实现为持久化、可恢复、可局部重跑的任务依赖图。
8. 复用小说角色 Skill 产出的 `report.html`、内嵌 cast JSON 和角色设定图，避免重复生成角色。
9. 为未来云端模型保留 Provider 接口，但当前不接入任何云服务。
10. 保持现有项目、天空盒、角色资产、镜头媒体和传统编辑流程可用。
11. 第一阶段使用本地文件和现有规则解析器形成可审核草稿，不依赖尚未实现的云端 AI。

## 3. 非目标

1. 当前阶段不实现云端模型、账号、计费或登录系统。
2. 不照搬灰豆的代码、资源、模型路由或服务地址。
3. 第一阶段不实现自由节点画布。
4. 不一次性重写 `ComfyPipelinePanel.tsx`。
5. 不要求所有场景都生成 360° 全景。
6. 不把六个方向分别随机生成的图片继续当作新项目的场景母版。
7. 不自动删除或覆盖用户已有角色图、分镜图、视频和成片。
8. 不在未经审核的导演草稿上启动高成本生成。
9. 第一阶段不从桌面应用内部启动 Codex Skill；应用只读取 Skill 已经写入项目的结构化产物。

## 4. 已批准的核心决策

### 4.1 产品路线

采用「新建 AI 导演工作台，复用现有生成引擎」路线。

固定的导演生产流程优先于自由节点画布。领域数据和任务接口保持模块化，未来若需要高级节点视图，可将同一套任务图投影为节点，不重写执行引擎。

### 4.2 内容入口

支持两个入口：

1. 当前小说项目：默认读取正文、大纲、角色设定和追踪状态。
2. 外部故事：支持粘贴文本或文件导入，作为快速新建入口。

两类入口最终都转换成相同的 `StorySourceSnapshot`，后续导演逻辑不区分来源类型。

### 4.3 生成前审核

AI 导演先生成草稿，并停在导演审片台。用户审核故事圣经、角色资产、核心场景判定、镜头表、连续性警告和成本摘要后，才能批准计划。

批准会冻结一个 `PlanRevision`。所有生成任务必须引用已批准的 revision。存在阻断项或 revision 未批准时，任务编排器不得启动高成本任务。

### 4.4 核心场景判定

AI 导演根据以下信号建议核心场景：

- 场景在镜头中反复出现；
- 存在正反打、多朝向或环绕运镜；
- 存在多人走位、战斗调度或明显空间移动；
- 后续镜头依赖稳定的地标、入口、出口或方向关系。

核心场景生成 360° 母版；普通一次性场景使用单张设定图。用户可以在导演审片台中手动升降级。

### 4.5 全景与六面天空盒

核心场景以 2:1 equirectangular 全景为唯一权威母版。

六面 cubemap 仍保留，但职责降为：

- 兼容现有 `skyboxFaces` 数据；
- 适配需要 cubemap 的 ComfyUI 或 3D 工作流；
- 用于诊断接缝、顶部或地面问题；
- 作为可删除、可重建的派生缓存。

用户不再分别维护六张方向图，也不分别为六个方向编写生成提示词。

### 4.6 镜头取景

AI 导演为每个使用核心场景的镜头生成 `CameraPlan`：

- `yaw`：水平朝向；
- `pitch`：俯仰角；
- `fov`：视场角；
- `shotScale`：景别；
- `orientationAnchors`：镜头朝向的空间锚点；
- `continuityGroupId`：需要连续维护机位关系的镜头组。

系统从全景母版派生透视场景底图。用户可在 360° 查看器中拖动视角、缩放 FOV，并保存为当前镜头机位。调整后只将受影响镜头标记为待重建，不重生成全景母版。

## 5. 系统架构

```text
当前小说项目 ─┐
              ├─> StorySourceAdapter ─> AI 导演领域层
外部故事文本 ─┘                         │
                                        ├─ StoryBible
角色 Skill 报告 ─> CharacterReportAdapter ├─ ProductionPlan
                                        ├─ CameraPlan
                                        └─ PlanRevision
                                                  │
                                            人工审核门
                                                  │
                                      PersistentTaskOrchestrator
                                      ┌───────────┴───────────┐
                                LocalComfyProvider       CloudProvider
                                   当前实现               预留接口
                                      │
                        角色 / 全景 / 分镜 / 视频 / 音频
                                      │
                             质量门、时间线与导出
```

### 5.1 模块边界

#### `director-ingest`

负责把当前小说项目、外部文本和角色报告转换为标准输入快照。它不生成媒体，也不直接修改故事圣经。

#### `director-domain`

负责故事圣经、生产计划、场景等级、镜头计划、机位计划、审核 revision 和影响范围计算。该层不依赖 ComfyUI 节点名称。

#### `director-analysis`

定义导演分析协议。第一阶段实现 `LocalArtifactDirectorAnalyzer`：优先读取角色报告、大纲、细纲、已有镜头脚本和追踪文件，并适配当前 `parseStoryToShotScript` 的规则解析能力，为缺少结构化镜头的外部文本生成低置信度候选镜头。模型驱动的分析器以后作为可替换实现加入。

#### `director-review`

负责导演审片台 UI、阻断项和警告展示、用户修改、revision 对比和批准动作。

#### `panorama-assets`

负责 2:1 全景母版、空间锚点、光照变体、360° 查看器、镜头透视取景、cubemap 缓存和母版质量检查。

#### `production-orchestrator`

负责持久化任务依赖、并发、暂停、恢复、取消、重试、幂等、失效传播和结果凭证。

#### `generation-providers`

定义标准生成 Provider 协议。首个实现为 `LocalComfyProvider`，通过适配器调用现有角色、场景、分镜、视频和音频能力。`CloudProvider` 只有接口，不提供运行实现。

#### `production-results`

负责媒体结果、checksum、生成凭证、质量报告、时间线装配和导出引用。

## 6. 领域模型

以下为设计契约，不要求第一阶段一次实现所有字段。

### 6.1 `StorySourceSnapshot`

```ts
type StorySourceSnapshot = {
  id: string;
  sourceType: "current_project" | "external_text";
  sourcePaths: string[];
  contentDigest: string;
  body: string;
  outline?: string;
  settings?: string;
  trackingContext?: string;
  structuredArtifacts: Array<{
    kind: "cast" | "outline" | "shot_script" | "tracking" | "other";
    path: string;
    digest: string;
  }>;
  analysisMode: "local_artifact" | "model_assisted";
  capturedAt: string;
};
```

快照保存导演解析时实际读取的内容摘要，确保后续 revision 可追溯。源文件变化不会静默改写已批准计划。

### 6.2 `StoryBible`

```ts
type StoryBible = {
  id: string;
  sourceSnapshotId: string;
  title: string;
  summary: string;
  genre: string;
  visualStyle: string;
  characters: CharacterSpec[];
  scenes: SceneSpec[];
  props: PropSpec[];
  continuityRules: ContinuityRule[];
  sourceEvidence: SourceEvidence[];
};
```

故事圣经是叙事事实的权威源。提示词、资产任务和镜头上下文都由它派生，不反向成为叙事事实。

### 6.3 `CharacterSpec`

```ts
type CharacterSpec = {
  id: string;
  name: string;
  aliases: string[];
  importance: "protagonist" | "major" | "supporting" | "minor";
  oneLiner?: string;
  persona: {
    gender?: string;
    ageRange?: string;
    identity?: string;
    appearance?: string;
    personality: string[];
    temperament?: string;
    motivation?: string;
    arc?: string;
    relationships: Array<{ name: string; relation: string }>;
    evidence: string[];
  };
  imageProfile?: CharacterImageProfile;
  voiceProfile?: CharacterVoiceProfile;
  source?: CharacterSource;
};
```

### 6.4 `CharacterSource`

```ts
type CharacterSource = {
  type: "existing_asset" | "character_report" | "generated" | "story_inference";
  reportPath?: string;
  reportDigest?: string;
  sourceCharacterName?: string;
  sourceImagePath?: string;
  sourceImageDigest?: string;
  mappingVersion: number;
  importedAt: string;
};
```

### 6.5 `SceneSpec`

```ts
type SceneSpec = {
  id: string;
  name: string;
  description: string;
  spatialAnchors: SpatialAnchor[];
  variants: SceneVariant[];
  occurrenceShotIds: string[];
  recommendedTier: "standard" | "panorama";
  approvedTier: "standard" | "panorama";
  tierReasons: string[];
};
```

`recommendedTier` 由 AI 计算，`approvedTier` 由用户在审片台确认。

### 6.6 `PanoramaMaster`

```ts
type PanoramaMaster = {
  id: string;
  sceneId: string;
  variantId: string;
  projection: "equirectangular";
  width: number;
  height: number;
  filePath: string;
  checksum: string;
  version: number;
  spatialAnchorSnapshot: SpatialAnchor[];
  generationReceiptId?: string;
  qualityReportId: string;
  status: "candidate" | "approved" | "rejected";
  createdAt: string;
};
```

批准母版必须精确满足 `width === 2 * height`。候选若宽高比误差不超过 1%，可以先进入显式的裁剪/补边规范化步骤；规范化结果重新质检且达到精确 2:1 后，才能批准为母版。误差超过 1% 的候选直接拒绝。

### 6.7 `DerivedPanoramaArtifact`

```ts
type DerivedPanoramaArtifact = {
  id: string;
  panoramaMasterId: string;
  panoramaMasterChecksum: string;
  kind: "cubemap_face" | "shot_view" | "thumbnail";
  parameters: Record<string, unknown>;
  filePath: string;
  checksum: string;
};
```

派生物只要母版 checksum 或参数变化即可失效和重建，不作为用户创作事实。

### 6.8 `ProductionPlan` 与 `PlanRevision`

```ts
type CameraPlan = {
  id: string;
  shotId: string;
  sceneId: string;
  sceneVariantId: string;
  panoramaMasterId?: string;
  yaw: number;
  pitch: number;
  fov: number;
  outputAspectRatio: string;
  shotScale: string;
  orientationAnchorIds: string[];
  continuityGroupId?: string;
  source: "director_suggestion" | "user_adjusted";
};

type PlannedShot = {
  id: string;
  order: number;
  title: string;
  visual: string;
  dialogue: string;
  durationSec: number;
  characterIds: string[];
  sceneId?: string;
  sceneVariantId?: string;
  cameraPlanId?: string;
  imagePrompt: string;
  videoPrompt: string;
};

type DirectorIssue = {
  id: string;
  severity: "blocker" | "warning";
  code: string;
  entityType: "project" | "character" | "scene" | "shot" | "provider";
  entityId?: string;
  message: string;
  resolutionHint: string;
};

type ProductionPlan = {
  id: string;
  storyBibleId: string;
  shots: PlannedShot[];
  cameraPlans: CameraPlan[];
  assetRequirements: AssetRequirement[];
  warnings: DirectorIssue[];
  estimatedDurationSec: number;
  estimatedCost?: CostEstimate;
};

type PlanRevision = {
  id: string;
  productionPlanId: string;
  revision: number;
  snapshotDigest: string;
  status: "draft" | "approved" | "superseded";
  approvedAt?: string;
  approvedWithWarningReasons?: string[];
};
```

### 6.9 `GenerationTask`

```ts
type GenerationTask = {
  id: string;
  runId: string;
  planRevisionId: string;
  kind: GenerationTaskKind;
  entityId: string;
  dependencyTaskIds: string[];
  providerId: string;
  idempotencyKey: string;
  inputDigest: string;
  settingsDigest: string;
  status:
    | "queued"
    | "running"
    | "interrupted"
    | "succeeded"
    | "needs_review"
    | "failed"
    | "cancelled"
    | "stale";
  retryCount: number;
  retrySnapshot?: Record<string, unknown>;
  resultReceiptId?: string;
  error?: { code: string; message: string; retryable: boolean };
};
```

### 6.10 `GenerationReceipt`

```ts
type GenerationReceipt = {
  id: string;
  taskId: string;
  providerId: string;
  modelOrWorkflowVersion: string;
  inputDigest: string;
  settingsDigest: string;
  seed?: number;
  outputs: Array<{ path: string; checksum: string; mediaType: string }>;
  parentTaskIds: string[];
  durationMs: number;
  retryCount: number;
  qualityScores: Record<string, number>;
  createdAt: string;
};
```

## 7. 角色报告适配器

### 7.1 支持的报告结构

角色 Skill 的示例输出位于：

```text
{project}/角色设定/
  report.html
  {作品名}-cast.json
  {作品名}-cast.md
  images/
    {角色名}-sheet.png
```

示例 `report.html` 包含：

- `script#cast-data[type="application/json"]`：完整结构化角色数据；
- `sheetImage`：相对于报告目录的设定图路径；
- `persona`：身份、外貌、性格、动机、弧光、关系和原文证据；
- `image`：画风、正向提示词、反向提示词、标签和角色设定图提示词；
- `voice`：音色、音高、语速、口音、情绪和中英文音色提示词。

适配器按 `novel-characters` 1.7.0 的公开 cast 契约校验必填字段、`importance` 枚举、语言分工和角色数组。`image._layoutVersion` 属于可选扩展，不作为 cast 合法性的必填条件。

### 7.2 读取优先级

1. 如果同目录同时存在 `*-cast.json` 和 `report.html#cast-data`，两者都解析并按稳定键序列化后计算 digest。
2. digest 相同时使用独立 JSON，并记录 HTML 为等价来源。
3. digest 不同时产生阻断项，展示来源冲突并要求用户选择，不静默合并。
4. 只有独立 JSON 时直接读取 JSON。
5. 只有 HTML 时读取 `report.html` 中的 `#cast-data`。
6. 不通过页面可见文本或 CSS 选择器拼凑角色字段。

HTML 的职责是可携带报告容器；稳定接口是其内嵌 JSON，而不是展示 DOM。

### 7.3 角色匹配

按以下顺序匹配故事圣经角色：

1. 规范化后的角色名精确一致；
2. 规范化后的 aliases 精确一致；
3. 无唯一结果时进入人工映射。

禁止仅凭模糊相似度覆盖已有角色资产。

### 7.4 资产来源优先级

1. 用户已确认的现有角色资产；
2. 匹配成功且图片有效的角色报告；
3. 角色报告中的描述和提示词补生成；
4. 故事圣经自动推导并生成。

当现有资产与角色报告图片不同且二者都有效时，导演审片台展示冲突，由用户决定使用哪一个。系统不自动覆盖。

### 7.5 设定图母版与裁片

示例设定图是单张 16:9 合成母版：

- 左侧约 34%：高质量正面头像；
- 右上：正面、侧面和背面全身；
- 右下：服装、道具与材质细节。

导入后保存 `characterSheetMasterPath`。`image._layoutVersion` 只选择预期的三分区拓扑，不代表固定像素坐标。适配器必须先检测实际分隔线和人物区域，再生成派生裁片：

- `faceMasterPath`；
- `bodyFrontPath`；
- `bodySidePath`；
- `bodyBackPath`；
- 可选细节参考图。

`novel-characters` v1 三分区检测规则为：在图像宽度 25%–45% 范围寻找贯穿大部分高度的竖向分隔，在右侧高度 55%–85% 范围寻找横向分隔；检测出的右上区域还必须包含三个可分离的全身人物区域。检测结果需保存归一化矩形和检测置信度，不能把「约 34%」直接硬编码为裁切线。

原始设定图不修改。裁片是可删除重建的派生资产。分镜生成只注入需要的单视角裁片，避免完整三视图被图像模型误判为多个角色。

若 layout 版本未知、分隔线检测失败、右上不是三个全身人物，或裁片质检失败，停止自动映射并打开人工裁片确认 UI，不猜测裁剪区域。用户仍可保留完整 sheet 作为设定档案，但在单人物参考裁片确认前，角色资产状态为阻断。

### 7.6 可携带性和来源

导入角色报告时：

- 不修改原始报告或原始图片；
- 将图片按内容摘要复制到当前项目的角色资产仓库；相同 checksum 只登记一次，不产生重复副本；
- 保存原始 `sourcePath` 和 checksum；
- 项目备份必须包含已登记的角色设定图和派生裁片；
- 原报告移走后，项目仍能继续生成。

报告或源图片 checksum 更新时，相关角色和依赖镜头标记为 `stale`。用户先看到影响范围，再决定是否重新导入和重建。

### 7.7 第一阶段的本地导演分析

第一阶段不需要云端模型即可形成草稿：

1. `LocalArtifactDirectorAnalyzer` 先读取 cast JSON、角色报告、项目大纲、细纲、已有镜头脚本和追踪文件。
2. 已有结构化字段直接映射到故事圣经和生产计划，并保存来源路径与 digest。
3. 外部纯文本或缺少镜头脚本的正文，通过从现有 `parseStoryToShotScript` 提取的 `LegacyStoryParserAdapter` 生成低置信度候选镜头。
4. 核心场景依据出现次数、正反打词、环绕/移动词和多人调度信号进行确定性评分。
5. 规则无法确认的角色、场景和镜头事实产生警告或阻断项，不伪装成高置信度 AI 结论。
6. 草稿保存 `analysisMode: "local_artifact"`。未来模型驱动分析器输出相同领域模型，并使用 `analysisMode: "model_assisted"`。

桌面应用不负责执行 Codex Skill。用户继续在 Codex 工程中运行角色、剧本或短剧 Skill；应用读取这些 Skill 已生成的文件。这样第一阶段没有云端依赖，也不把 Codex 会话运行时耦合进桌面产品。

核心场景默认评分规则：出现 4 个及以上镜头记 3 分；检测到至少两组正反打或明显朝向变化记 2 分；包含环绕、穿行、追逐、战斗或多人调度记 2 分；存在两个及以上必须稳定的空间锚点记 1 分。总分达到 4 分时建议 `panorama`，否则建议 `standard`。评分只产生建议，用户批准的 `approvedTier` 才是执行依据。

## 8. 导演审片台

### 8.1 导航

导演审片台包含：

1. 项目概览；
2. 故事圣经；
3. 场景计划；
4. 角色资产；
5. 镜头表；
6. 连续性检查；
7. 成本与模型摘要。

### 8.2 可编辑内容

- 角色、场景、道具和连续性规则；
- 角色报告映射和资产来源；
- 场景 `standard/panorama` 等级；
- 全景空间锚点和光照变体；
- 镜头标题、画面、对白、时长和资产引用；
- AI 建议的镜头机位；
- 警告放行说明。

### 8.3 阻断项与警告

阻断项示例：

- 角色引用无法唯一匹配；
- 核心场景缺少必要空间说明；
- 镜头引用不存在的场景或角色；
- 故事时间线存在互斥事实；
- Provider 不具备批准计划要求的能力；
- 输入媒体无效。

警告示例：

- 普通场景存在较多正反打，建议升级为 360°；
- 某角色缺少侧面或背面参考；
- 某镜头时长与对白长度不匹配；
- 预计生成成本或时间偏高。

阻断项必须清零。警告允许带理由批准。

### 8.4 Revision 规则

- AI 重新解析会创建新草稿 revision；
- 用户编辑不会被后台重新解析静默覆盖；
- 批准 revision 后冻结快照摘要；
- 已批准 revision 被新 revision 取代时状态变为 `superseded`；
- 旧 revision 的运行和成果保持可追溯。

## 9. 360° 场景工作室

### 9.1 生成流程

```text
场景说明与空间锚点
  -> 生成一个或多个 2:1 全景候选
  -> 尺寸、投影、接缝、地平线、语义和媒体质检
  -> 自动选择最佳候选或进入人工审核
  -> 批准 PanoramaMaster
  -> 生成 CameraPlan
  -> 派生镜头透视底图
```

### 9.2 场景变体

同一空间可以拥有多个命名变体，例如白天、寒潮夜和战后清晨。每个变体拥有独立全景母版，但共享 `SceneSpec` 和空间锚点定义。

变体生成必须以已批准的空间母版或空间锚点约束为基础，避免光照变化同时改变建筑、道路或地标位置。

### 9.3 取景交互

- 鼠标拖动：调整 yaw 和 pitch；
- 滚轮或滑块：调整 FOV；
- 画幅框：展示当前输出比例；
- 空间锚点：标记入口、出口、地标和行动区域；
- 镜头条：快速切换引用该场景的镜头；
- 保存：写入当前镜头 `CameraPlan`；
- AI 重新建议：仅重算机位，不重生成全景；
- 重建相关镜头：先展示 stale 传播范围。

### 9.4 全景质量门

至少检查：

- 文件可解码；
- 宽高比为 2:1；
- 分辨率达到项目下限；批准母版必须精确为 2:1；
- 左右接缝误差不超过策略阈值；
- 地平线没有不可接受的断裂或倾斜；
- 场景语义和关键空间锚点存在；
- 不包含错误人物、版式网格、文字或多幅拼贴；
- 候选清晰度达到要求。

自动修复设置有限次数。仍不合格时状态为 `needs_review`，不能自动晋升为母版。

### 9.5 安全失效

全景母版变化后：

- cubemap、缩略图和镜头透视底图立即标记 stale；
- 引用这些底图的分镜和视频根据依赖关系标记 stale；
- 不删除旧媒体；
- 不自动启动高成本重生成；
- UI 展示预计重建范围，用户确认后提交任务。

## 10. Provider 协议

### 10.1 目标

导演层只描述标准任务，不知道 ComfyUI 节点名称或云端 API 形态。

```ts
interface GenerationProvider {
  id: string;
  capabilities(): Promise<ProviderCapabilities>;
  preflight(task: StandardGenerationTask): Promise<PreflightResult>;
  submit(task: StandardGenerationTask): Promise<ProviderJobHandle>;
  inspect(handle: ProviderJobHandle): Promise<ProviderJobState>;
  cancel(handle: ProviderJobHandle): Promise<CancelResult>;
  collect(handle: ProviderJobHandle): Promise<ProviderResult>;
}
```

### 10.2 `LocalComfyProvider`

首个 Provider 通过适配器复用现有能力：

- 角色设定图和身份裁片；
- 2:1 场景全景工作流；
- 分镜图工作流；
- 单帧或首尾帧视频工作流；
- Comfy 音频工作流；
- 当前质量检查和结果路径处理。

迁移过程中，UI 不再直接调用这些工作流，但底层实现可以先继续调用现有服务函数。

### 10.3 `CloudProvider`

当前只保留接口、能力声明和配置槽位。不得内置真实服务地址、API Key、账号逻辑或默认云模型。

### 10.4 MiniMax H3 视频工作流族

`LocalComfyProvider` 的视频能力不能再由单个 `videoWorkflowJson` 表示。第一批内置视频 Profile 来自用户提供的 MiniMax H3 工作流文档，并在入库时转换为可校验的 ComfyUI API 模板：

- `minimax_h3_t2v`：没有角色身份或固定场景要求的空镜、氛围和抽象镜头；
- `minimax_h3_i2v`：对白、反应、特写、轻动作和以单张分镜为稳定锚点的镜头；
- `minimax_h3_flf2v`：存在明确起点与终点姿态、位移、运镜或连续边界的首尾帧镜头；
- `minimax_h3_r2v`：多角色、强身份约束、服装/道具/风格参考或参考音视频驱动的镜头。

TE Speed 不是独立的镜头语义 Profile，而是可叠加到兼容 H3 Profile 的 `draft` 加速变体。这样镜头仍保留 T2V、I2V、FLF2V 或 R2V 的真实能力标识，执行凭证另外记录是否应用了 TE Speed。

每个 Profile 必须声明输入能力、输出媒体、必需节点、模型绑定、参考数量上限、是否支持首尾帧、是否支持参考音视频、质量级别和来源摘要。工作流文件名不是能力依据；注册时必须通过当前 ComfyUI `/object_info` 和模型清单预检。

自动路由按以下优先级执行：

1. 用户对镜头明确指定的 Profile；
2. 强身份、多角色或多参考约束选择 `r2v`；
3. 明确首尾状态或属于连续段边界选择 `flf2v`；
4. 有可靠分镜锚点选择 `i2v`；
5. 只有无命名角色且不要求场景连续的镜头才允许选择 `t2v`；
6. 无可安全执行的 Profile 时阻断，不静默降级到 T2V。

TE Speed 默认只能用于 `draft`。在同一镜头、同一输入和同一 seed 的 A/B 基准未证明身份、场景和时序质量达到生产阈值前，不得自动用于 `production`。

## 11. 任务编排

### 11.1 任务依赖顺序

```text
批准的 PlanRevision
  -> 预检
  -> 角色资产任务 || 场景资产任务
  -> 机位取景任务
  -> 分镜图任务 || 配音音效任务
  -> 镜头视频任务
  -> 自动质量门
  -> 人工例外处理
  -> 时间线装配
  -> 成片与报告
```

不同角色、场景和无依赖镜头可以并行。同一实体的依赖任务必须按图顺序执行。

### 11.2 持久化

任务、依赖、外部句柄、重试快照、状态转换和结果凭证写入 SQLite。媒体仍存放在项目资产目录。

应用重启后：

- `queued` 保持排队；
- `running` 转为 `interrupted`；
- 编排器先通过 Provider 查询外部任务状态；
- 无法查询时，根据幂等能力安全重新提交；
- 已有有效结果不得重复提交。

### 11.3 幂等键

幂等键至少包含：

- plan revision ID；
- 任务类型；
- 实体 ID；
- 输入摘要；
- 设置摘要；
- Provider ID。

相同幂等键且结果有效时直接复用。

### 11.4 错误策略

#### 临时错误

网络、进程暂时不可用和可恢复队列错误默认在首次失败后自动重试 2 次，即最多尝试 3 次，并使用指数退避。任务策略可以降低自动重试次数；若要超过 2 次自动重试，必须由用户在运行设置中明确批准。实际次数写入凭证。

#### 质量错误

质量失败默认允许再生成 2 个恢复候选。第三次仍不合格时进入 `needs_review`，不无限烧算力。高成本任务可以将自动恢复上限降为 0，但不能在没有用户确认时提高上限。

#### 配置和依赖错误

缺模型、缺资产、规则冲突和能力不匹配直接阻断，并提供可操作的错误码和修复说明。

#### 失败隔离

一个镜头失败只阻断依赖它的任务。其他无依赖镜头继续运行。

#### 取消

取消只停止未开始和可中止任务。已完成媒体和凭证继续入库，下次运行可复用。

### 11.5 连续段与无缝装配

导演计划把相邻镜头划分为 `ContinuitySegment`。同一连续段共享角色身份裁片、场景母版、色彩锚点、时间/天气状态和边界策略。

- `continuous` 边界使用前一镜头获批尾帧作为后一镜头的首帧，或为两镜头生成同一张共享边界关键帧；
- `match_cut` 边界保持主体位置、运动方向或构图形状的匹配，但允许画面内容切换；
- `hard_cut` 是有意图的剪辑，不使用生成模型把两个场景强行变形成一个过渡；
- `scene_change` 必须重置场景连续性锚点，但继续保持跨场景角色身份锚点；
- 不再默认把下一镜头的分镜图直接当作当前镜头尾帧，除非边界已标记为 `continuous` 或 `match_cut` 并通过导演审核。

每个镜头先规范化为相同分辨率、精确 24 fps、H.264、`yuv420p` 和统一音频参数，再进入装配。连续边界必须检查黑帧、重复帧、冻结、时间戳、音画时长、主体身份、场景锚点、色彩跳变和边界运动突变。质量失败只重建相关镜头或边界修复任务，不重跑整段。

## 12. 持久化和迁移

### 12.1 新数据

建议独立保存导演领域数据和执行数据，避免继续扩张单一前端 store。具体表名在实施计划中确定，但边界必须覆盖：

- source snapshots；
- story bibles；
- production plans；
- plan revisions；
- character report imports；
- panorama masters；
- camera plans；
- production runs；
- generation tasks；
- generation receipts；
- quality reports；
- derived artifacts。

### 12.2 旧项目迁移

- 现有 `Asset`、`Shot`、`AudioTrack` 和生成媒体保持可读；
- 现有 `skyboxFaces` 登记为 legacy cubemap 缓存；
- 若旧项目只有六面图，不虚构 2:1 母版；用户可继续使用旧缓存或选择升级；
- 升级可以从已有单图或六面图生成候选全景，但必须经过质量门和人工批准；
- 未进入 AI 导演工作流的项目继续使用现有编辑、生成、时间线和导出功能。

## 13. 分期交付

### 阶段 1：导演基础

首个实施计划只包含：

- 当前小说项目和外部文本双入口；
- `StorySourceSnapshot`、`StoryBible`、`ProductionPlan` 和 `PlanRevision`；
- `LocalArtifactDirectorAnalyzer` 和 `LegacyStoryParserAdapter`；
- 角色报告适配器、角色映射预览和设定图登记；
- 导演审片台；
- 核心场景自动判定和人工升降级；
- Provider 标准接口；
- `LocalComfyProvider` 适配壳；
- 审核门和持久化草稿。

阶段 1 不启动真实批量生成。

### 阶段 2：360° 场景闭环

- `PanoramaMaster` 和场景变体；
- 2:1 全景生成接入；
- 全景质量门；
- 360° 查看器；
- 空间锚点；
- `CameraPlan` 编辑；
- 透视底图派生；
- cubemap 缓存；
- 旧天空盒迁移。

### 阶段 3：一键成片

- SQLite 持久化任务依赖图；
- 现有角色、场景、分镜、视频和音频能力接入；
- MiniMax H3 T2V、I2V、首尾帧和 R2V Profile 注册表；
- 基于镜头意图、参考资产和连续段的工作流路由；
- 共享边界帧、视频规范化和连续性质量门；
- 暂停、恢复、取消、重试和局部重跑；
- 自动质量门和人工例外处理台；
- 时间线自动装配；
- 成片和运行报告。

### 阶段 4：产品化与扩展

- 性能和可观测性；
- 项目模板和成本报告；
- 高级节点视图的重新评估；
- CloudProvider 的独立实现；
- 发布迁移和用户文档。

每阶段通过自动测试、示例项目和人工 UI 验收后才能进入下一阶段。

## 14. 测试与验收

### 14.1 阶段 1 验收

1. 当前小说项目可生成并重新打开导演草稿。
2. 外部文本可生成相同领域结构的导演草稿。
3. 同一 source snapshot 重复解析不会静默覆盖用户编辑。
4. `report.html` 内嵌 cast JSON 和同目录 cast JSON 均可导入。
5. 角色报告图片路径能相对报告目录正确解析。
6. 示例报告中的 5 位角色能与故事角色精确映射。
7. 设定图有效时角色资产计划标记为复用，不创建角色图片生成任务。
8. 未知 `_layoutVersion` 不自动裁图，并产生阻断项。
9. 角色名冲突进入人工映射，不覆盖已有资产。
10. revision 未批准或存在阻断项时不能启动高成本任务。
11. 在没有网络和云端 Provider 的环境中，示例项目仍能依靠已有结构化文件生成导演草稿。
12. 外部纯文本通过 legacy 规则解析器产生的镜头必须标记为 `analysisMode: "local_artifact"`，并显示低置信度警告。
13. v1 设定图布局检测必须在示例图片上定位纵向、横向分隔，并输出脸部、正面、侧面、背面候选裁切框；不能使用固定百分比直接裁切。
14. 当分隔线或人物区域检测置信度低于策略阈值（初始为 `0.90`），或无法确认右上区域恰有三个可分离全身人物时，导入必须停止自动裁切并打开人工裁切确认界面。
15. 同一内容摘要的角色报告和设定图重复导入时必须去重，并保留原始来源路径与摘要记录。

### 14.2 阶段 2 验收

1. 非 2:1、不可解码或低于最低分辨率的全景不能成为母版。
2. 接缝、地平线或场景语义不合格的候选进入恢复或人工审核。
3. 同一全景、yaw、pitch、FOV 和输出尺寸重复派生得到稳定结果。
4. 修改机位只使相关镜头底图和下游任务 stale。
5. 修改全景母版使所有派生缓存 stale，但不删除旧媒体。
6. cubemap 可从母版重建，并与母版 checksum 绑定。
7. 旧 `skyboxFaces` 数据可继续读取。

### 14.3 阶段 3 验收

1. 运行中关闭应用，再启动后任务不重复提交。
2. 单镜头失败不阻止无依赖镜头继续运行。
3. 取消运行保留已完成媒体和凭证。
4. 相同幂等键复用有效结果。
5. 质量失败超过恢复上限后进入 `needs_review`。
6. 修改角色身份或全景母版能准确计算 stale 传播范围。
7. 用户确认后可以只重建受影响任务。
8. 时间线装配使用有效的最新批准结果，不混用已 stale 媒体。
9. 命名角色镜头在没有身份参考时不得自动路由到 T2V。
10. 对白或轻动作特写默认路由到 I2V，明确首尾状态的动作镜头默认路由到 FLF2V，多角色或强参考镜头默认路由到 R2V；人工指定优先于自动规则。
11. 工作流注册表必须在提交任务前报告缺失节点、缺失模型和不支持的输入，不能等到 ComfyUI 队列执行后才失败。
12. TE Speed 在生产模式下默认禁用；只有通过相同输入 A/B 基准且用户批准后才能启用。
13. `continuous` 边界复用同一获批边界帧，修改该帧时只使相邻两个镜头及其下游装配任务 stale。
14. `hard_cut` 和 `scene_change` 不自动使用首尾帧生成跨场景变形过渡。
15. 装配前所有片段被规范化为相同分辨率、精确 24 fps、H.264、`yuv420p` 和统一音频参数；规范化失败时禁止拼接。
16. 连续边界出现黑帧、重复帧、冻结、时间戳错误、身份明显漂移、场景锚点丢失或异常色彩/运动跳变时进入局部恢复或 `needs_review`。

### 14.4 回归验收

1. 不使用 AI 导演的新旧项目仍能打开和保存。
2. 当前镜头编辑、资产面板、Comfy 生成、时间线、PDF 和 MP4 导出仍可使用。
3. 现有角色身份证据和 benchmark 数据不丢失。
4. 现有已生成图片、视频和音频不被迁移过程删除或覆盖。

## 15. 安全与隐私

- 角色报告、小说正文、提示词和生成资产默认只在本地处理。
- 当前设计不向灰豆或其他第三方服务发送内容。
- Provider 配置不得把 API Key 写入项目备份或生成凭证。
- 报告导入只读取允许的 JSON 数据和本地图片路径，不执行 `report.html` 中的脚本。
- HTML 解析器只提取 `#cast-data` 文本，不加载远程资源，不运行 DOM 事件。
- 导入路径必须解析并验证在用户选择的报告目录或明确允许的资产目录内。

## 16. 完成标准

本设计完成实施后，用户应能：

1. 打开一个现有小说项目或粘贴外部故事；
2. 自动复用小说角色 Skill 已产出的设定报告和图片；
3. 审核故事圣经、角色、场景、镜头和连续性；
4. 确认哪些场景使用 360° 母版；
5. 批准计划后让系统按任务图生成资产和镜头；
6. 在 360° 场景中调整每个镜头机位；
7. 从中断、失败或局部修改处安全恢复；
8. 在不理解具体 ComfyUI 节点的情况下完成从小说到成片的流程。
