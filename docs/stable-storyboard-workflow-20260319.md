# 稳定分镜生成工作流（2026-03-19）

> 2026-04-08 补充：
> 对当前“河边桥景 + 双角色三视图资产”这类项目，真正跑通并达到阶段可用的工程默认链路，已经收敛到：
>
> `scene 主图 + 角色 A primary + 角色 B primary + 小范围 body-hugging mask + Qwen 2511 Lightning 4 steps`
>
> 当前最有效的约束规则：
> - 不拼三视图整板给 Qwen
> - 不做贴纸式抠图合成
> - 不做大范围 path mask 强压站位
> - 优先保住“双人同层生成”和“场景整体不漂”
> - 地面材质边界只做保守修正
> - 动作、镜头和 primary 视角选择交给 shot script，不再在 workflow 里写死具体桥边牵手动作

## 当前生产建议（2026-08-08）

当前生产链路采用与具体提供方解耦的逐角色顺序流程：

`版本化 canonical identity pack -> 严格 provider preflight 与 workflow proof -> 每次只生成一个锁定角色 pass -> 一致性评分与有界重试 -> 近景/中景的头发与头部细化 -> 原子提交角色图层 -> 单角色范围重绘或人工复核`

执行规则：

- canonical identity pack 是角色身份的唯一真源。上一镜头只可作为低优先级连续性参考，绝不能替代、覆盖或改变 canonical 身份参考。
- provider 只有在商业许可、精确模型、必需节点和 terminal-bound workflow proof 全部通过后才能进入生成。
- 每个角色 pass 最多使用三张路由后的身份参考；后续 pass 以已接受合成为基底并保护此前角色遮罩，不能重画已接受角色。
- 验证失败必须进入动态评分后的有界重试或 `needs_review`。cutout/composite rescue 只能保留为失败预览，绝不能发布成成功生成。
- 中景/近景验证通过后再做头发/头部细化；角色 RGBA、遮罩、位置、接受合成与生成元数据必须作为一个原子图层结果提交。
- 返工优先做单角色的脸/头发、上半身或完整角色范围重绘，并保留场景及其他已接受角色。

提供方选择：

- 默认：`Qwen-Image-Edit-2511`（`qwen_image_edit_2511`）。
- 可选商业本地候选：`FLUX.2 Klein 4B`（`flux2_klein_4b`）；只有八镜头硬门槛全部通过，且加权分更高，或速度显著更快且分差不超过 `0.03`，才可替换默认。
- `SD1.5 / IPAdapter` 不再是当前生产推荐，只作为兼容旧项目的 historical fallback。

## Legacy / historical fallback：SD1.5 双 IPAdapter（仅兼容旧项目）

> 本节以下内容记录 2026-03-19 的旧架构及其历史参数，不代表当前生产推荐。legacy 路径同样不能把 cutout/composite rescue 发布为成功；上一镜头参考永远不能覆盖 canonical identity pack。

### Legacy 背景与旧架构问题

当时使用的分镜工作流不适合“连续且一致”的 AI 分镜生产。

旧主流程的问题不是单纯参数不对，而是架构不对：

- 当时使用的预设 [storyboard-image-asset-guided-v1.json](/Users/duole/Desktop/ai_project/src/modules/comfy-pipeline/presets/storyboard-image-asset-guided-v1.json) 只有 1 个 ControlNet 槽位。
- 这个槽位在代码里被动态切成 `Canny` 或 `OpenPose`，没有同时使用 `OpenPose + Depth`。
- 场景既被当作 img2img seed，又被当作 IPAdapter 输入，人物参考、场景参考、上一帧回流在一条链上互相拉扯。
- 旧链路还曾把 `scene_character_composite` 这种“伪人物合成图”塞进 `FRAME_IMAGE_PATH`，会把坏的人体结构锁进最终采样。
- 旧流程没有把“场景锁定”“姿态锁定”“身份锁定”“上一帧连续性”分成独立控制层，所以会反复出现：
  - 人物残缺
  - 场景崩坏
  - 人物贴纸感
  - 动作丢失
  - 分镜间不连续

当时提出的 legacy 改造链路是：

`固定场景图 -> 固定场景深度图 -> 每镜头 OpenPose -> IPAdapter 锁人物 -> 上一帧低幅回流 -> 双阶段采样`

### Legacy SD1.5 双阶段方案

该历史方案曾建议使用 **SD1.5 双阶段分镜工作流**，而不是继续扩展当时的单 ControlNet 模板；它现在仅用于旧项目兼容。

原因：

- 在当时，SD1.5 的 `OpenPose / Depth / IPAdapter` 生态更成熟，连续分镜比 SDXL 更稳。
- 目标是“稳定分镜”，不是极致单张画质。
- 你的输入已经有固定场景和人物三视图，不需要依赖大模型自由发挥。

### Legacy 输入

工作流输入固定为 4 类：

1. 人物三视图
   - `CHAR1_FRONT`
   - `CHAR1_SIDE`
   - `CHAR1_BACK`
   - `CHAR2_FRONT`
   - `CHAR2_SIDE`
   - `CHAR2_BACK`
2. 固定场景图
   - `SCENE_REF`
3. 固定场景深度图
   - `SCENE_DEPTH`
   - 由 `SCENE_REF` 预处理生成一次并缓存，所有镜头共用
4. 分镜批量清单
   - 每个镜头 1 条记录，至少包含：
   - `shot_id`
   - `prompt`
   - `negative_prompt`
   - `pose_path`
   - `camera_delta`
   - `prev_frame_path`
   - `seed`

### Legacy 工作流结构

### Stage 0：缓存阶段

只做一次，不要每镜头重复算。

节点：

1. `LoadImage(SCENE_REF)`
2. `DepthAnythingPreprocessor` 或 `MiDaS-DepthMapPreprocessor`
3. `SaveImage(SCENE_DEPTH)`

作用：

- 把固定场景图转换成固定深度图。
- 所有镜头复用同一张 `SCENE_DEPTH`，这样场景透视、地平线、桥体积、河岸结构不会乱飘。

### Stage 1：布局生成 Pass A

这是“稳定构图阶段”，只负责把场景、人物个数、站位、姿态锁住。

节点链：

1. `LoadImage(FRAME_IMAGE_PATH)`
   - Shot 1：`FRAME_IMAGE_PATH = SCENE_REF`
   - Shot N：`FRAME_IMAGE_PATH = 上一镜头最终图`
2. `ImageScale`
3. `VAEEncode`
4. `CheckpointLoaderSimple`
5. `CLIPTextEncode(positive)`
6. `CLIPTextEncode(negative)`
7. `IPAdapterUnifiedLoader`
8. `LoadImage(CHAR1_FRONT)`
9. `LoadImage(CHAR1_VIEW)`
10. `LoadImage(CHAR2_FRONT)`
11. `LoadImage(CHAR2_VIEW)`
12. `IPAdapterAdvanced(CHAR1_FRONT, strong)`
13. `IPAdapterAdvanced(CHAR1_VIEW, weak)`
14. `IPAdapterAdvanced(CHAR2_FRONT, strong)`
15. `IPAdapterAdvanced(CHAR2_VIEW, weak)`
16. `LoadImage(POSE_GUIDE_PATH)`
17. `ControlNetLoader(OPENPOSE)`
18. `ControlNetApplyAdvanced(OPENPOSE)`
19. `LoadImage(SCENE_DEPTH)`
20. `ControlNetLoader(DEPTH)`
21. `ControlNetApplyAdvanced(DEPTH)`
22. `KSampler`
23. `VAEDecode`
24. `SaveImage(PASS_A)`

这一阶段的原则：

- 场景靠 `FRAME_IMAGE_PATH + SCENE_DEPTH` 锁定。
- 人物靠 `IPAdapter` 锁定。
- 动作靠 `OpenPose` 锁定。
- 不要在这一阶段追求高细节。

### Stage 2：一致性细化 Pass B

这是“稳定修整阶段”，只负责让人物更自然、动作更完整、场景边缘更干净。

节点链：

1. `LoadImage(PASS_A)`
2. `VAEEncode`
3. 重复使用：
   - 同一组正/负 prompt
   - 同一组人物 IPAdapter
   - 同一张 `POSE_GUIDE_PATH`
   - 同一张 `SCENE_DEPTH`
4. `KSampler(low denoise)`
5. `VAEDecode`
6. `SaveImage(FINAL)`

这一阶段的原则：

- 不再重构布局。
- 只做轻量修整。
- 如果 Pass A 已经坏了，Pass B 不能救；所以稳定性重点在 Pass A。

### Legacy 关键控制逻辑

### 1. 人物一致性

人物一致性由 2 组 IPAdapter 负责：

- `FRONT` 参考：高权重，锁脸、发型、服装、颜色
- `VIEW` 参考：低权重，辅助当前镜头角度

Legacy 参数范围：

- `CHAR_FRONT_WEIGHT = 0.75 ~ 0.9`
- `CHAR_VIEW_WEIGHT = 0.18 ~ 0.32`

规则：

- 每个镜头都重复注入正面身份参考，不能只在第一镜用一次。
- 侧面/背面参考不能替代正面参考，只能做弱辅助。
- 双人镜头不要把两个人的参考拼成一张图再喂给 IPAdapter。

### 2. 场景一致性

场景一致性由 3 层负责：

- `FRAME_IMAGE_PATH`
- `SCENE_DEPTH`
- 同一场景固定 prompt block

规则：

- Shot 1 用 `SCENE_REF` 起图。
- Shot N 先用上一帧回流，但深度仍使用固定 `SCENE_DEPTH`。
- 一旦镜头机位变化过大，不要强行用上一帧直接续；要回退到 `SCENE_REF + SCENE_DEPTH`。

Legacy 选择规则：

- `camera_delta` 小：上一帧回流
- `camera_delta` 大：回到固定场景图起图

### 3. 动作稳定

动作只靠 `OpenPose` 控，不要靠 prompt 猜。

规则：

- 每个镜头必须有独立 `POSE_GUIDE_PATH`
- 双人镜头必须画双人 pose
- 站位、重心、手臂方向、脚落点都进 pose

Legacy 参数范围：

- `OPENPOSE_STRENGTH = 0.85 ~ 1.0`
- `start_percent = 0`
- `end_percent = 0.9 ~ 1.0`

### 4. 透视与场景体积稳定

`Depth ControlNet` 只服务场景，不服务人物身份。

规则：

- `SCENE_DEPTH` 必须来自固定场景图，而不是上一帧
- 所有镜头共用同一张场景深度图
- 不要把人物合成图拿去做 depth

Legacy 参数范围：

- `DEPTH_STRENGTH = 0.55 ~ 0.75`
- `start_percent = 0`
- `end_percent = 1.0`

### Legacy 采样参数

### Pass A

- `steps = 24 ~ 32`
- `cfg = 5.0 ~ 6.5`
- `sampler = dpmpp_2m / dpmpp_2m_karras`

Legacy `denoise` 范围：

- Shot 1：`0.45 ~ 0.55`
- 连续小变动镜头：`0.28 ~ 0.4`
- 机位明显变化镜头：`0.4 ~ 0.52`

### Pass B

- `steps = 16 ~ 24`
- `cfg = 4.8 ~ 5.8`
- `denoise = 0.12 ~ 0.22`

### Legacy Prompt 结构

每个镜头 prompt 必须拆成 3 段：

### A. 全局人物块

所有镜头完全相同，逐镜重复：

- 角色姓名
- 性别
- 发型
- 脸型
- 服装
- 鞋子
- 身材比例

### B. 全局场景块

所有镜头完全相同，逐镜重复：

- 场景名称
- 主要地标
- 时间
- 光线方向
- 色调
- 透视关系

### C. 镜头变化块

每镜头只改这部分：

- 镜头远中近
- 机位角度
- 动作
- 表情
- 人物站位

原则：

- 不要让 prompt 负责“锁人物”和“锁场景”
- prompt 只负责告诉模型“这镜头和上一镜头相比改什么”

### Legacy 批量生成策略

批量分镜不要一次把所有镜头独立随机生成。

该 legacy 方案的串行顺序是：

1. 先生成 Shot 1
2. Shot 2 用 Shot 1 做 `FRAME_IMAGE_PATH`
3. Shot 3 用 Shot 2 做 `FRAME_IMAGE_PATH`
4. 依次串下去

同时保留：

- 固定 `SCENE_DEPTH`
- 固定人物 IPAdapter
- 固定全局 prompt block

Legacy 批处理字段：

| 字段 | 作用 |
| --- | --- |
| `shot_id` | 镜头编号 |
| `prompt_delta` | 当前镜头变化描述 |
| `pose_path` | 当前镜头 pose |
| `frame_image_path` | 上一镜头最终图或固定场景图 |
| `seed` | 建议 `base_seed + shot_index` |
| `camera_delta` | 判断是否允许上一帧回流 |
| `denoise_a` | Pass A 去噪 |
| `denoise_b` | Pass B 去噪 |

### Legacy 方案当时针对的问题

当时实现的问题集中在两处：

### 1. 预设结构不对

[storyboard-image-asset-guided-v1.json](/Users/duole/Desktop/ai_project/src/modules/comfy-pipeline/presets/storyboard-image-asset-guided-v1.json) 当时的结构是：

- 1 个 scene `LoadImage`
- 3 个人物 IPAdapter
- 1 个单独 scene IPAdapter
- 1 个 `Canny / OpenPose` 单 ControlNet
- 1 个 `KSampler`

这不是稳定分镜结构，因为它缺少：

- 独立 `Depth ControlNet`
- 独立 scene depth cache
- 独立上一帧回流策略
- 双阶段采样

### 2. 服务层接线不对

当时的服务层 [comfyService.ts](/Users/duole/Desktop/ai_project/src/modules/comfy-pipeline/comfyService.ts) 曾长期把“人物合成引导图”写回 `FRAME_IMAGE_PATH`，这是错的。

稳定流程里：

- `FRAME_IMAGE_PATH` 只能是 `SCENE_REF`、上一帧最终图、或同场景 continuity 图
- 不能是“人物贴在场景上的伪成品图”

### Legacy 依赖节点和模型

仅在兼容这套 legacy 方案时需要以下依赖：

### 节点

- `ComfyUI_IPAdapter_plus`
- `comfyui_controlnet_aux`

### 模型

- 一个稳定的 SD1.5 分镜底模
- `clip_vision_h.safetensors`
- `ip-adapter-plus_sd15.safetensors` 或同等级 SD1.5 IPAdapter Plus 权重
- `control_v11p_sd15_openpose.pth` 或同级 SD1.5 OpenPose ControlNet
- `control_v11f1p_sd15_depth.pth` 或同级 SD1.5 Depth ControlNet

兼容 legacy SDXL 时，必须下载 **同一模型家族** 的成套权重：

- SDXL checkpoint
- SDXL IPAdapter
- SDXL OpenPose ControlNet
- SDXL Depth ControlNet

不能再出现：

- SDXL checkpoint + SD1.5 ControlNet
- SD1.5 checkpoint + SDXL ControlNet

这种混搭会直接导致不稳定或报错。

## 当前 release gate 状态（2026-08-08）

静态门禁与视觉门禁必须分开记录。2026-08-08 的 fresh release gate 中，11 个确定性测试/构建命令退出 `0`；`test:workflow-presets` 仅保留批准的三个环境失败：

- `asset-skybox-panorama-default`：缺少 `Apply Circular Padding Model`、`Apply Circular Padding VAE`、`Equirectangular to Face`。
- `fisher-nextscene-v1`：缺少 `Power Lora Loader (rgthree)`、`TextEncodeQwenImageEditPlusAdvance_lrzjason`、`easy promptLine`。
- `storyboard-image-qwen-backside-v11`：缺少 `QwenEditAdaptiveLongestEdge`、`QwenEditConfigPreparer`、`TextEncodeQwenImageEditPlusCustom_lrzjason`。

当前 ComfyUI Desktop 在线，Qwen 与 Klein 的必需节点均存在，但分别缺少精确模型 `qwen_image_edit_2511_bf16.safetensors` 与 `flux-2-klein-4b-fp8.safetensors`，仓库内也没有可通过 Task 10 严格 provider proof 的连接工作流。因此代码/静态门禁为“通过但有环境阻塞”，八镜头视觉 benchmark 未运行，不能据此声明视觉验证或发布就绪；Qwen 继续保持默认。
