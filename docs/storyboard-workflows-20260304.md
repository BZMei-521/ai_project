# 分镜图成熟工作流（2026-03-04）

> 2026-04-08 更新：当前工程默认内置分镜模板已切换为 `storyboard-image-qwen-backside-v11.json`。  
> 这条链路的当前最佳实践来自后视双人案例验证，但工程内置模板本身已经做成通用 shot-script 驱动版本：
> `固定 scene + 双角色 primary 参考 + 小范围 body-hugging mask + Qwen 2511 Lightning 4 steps`。  
> 目标优先级也同步调整为：`人物同层生成 > 场景整体不漂 > 动作由脚本驱动 > 地面/边界材质尽量保留`。

## 结论

当前项目里旧的 Qwen/Fisher 分镜图模板适合快速出图，不适合高一致性项目。

如果目标是：

- 人物持续保持同一张脸、同一套衣服、同一发型
- 同场景镜头持续保持同一桥、河岸、建筑朝向
- 双人镜头仍能稳住角色和空间关系

更成熟的链路应改为：

`天空盒主面/场景底图 -> scene-first img2img -> IPAdapter 角色一致性 -> 可选 ControlNet(OpenPose/Depth/Canny) -> 可选 InstantID / PuLID`

## 推荐工作流

### 方案 A：内置 Qwen 背视双人模板（当前项目默认）

适用：

- 固定场景下的双人分镜图生成
- 由 shot script 决定人物动作、镜头和参考视角
- 希望两个人像同一层里一起生成，而不是贴纸合成
- 已经有固定 scene 和角色多视图资产

节点链建议：

1. `LoadImage`
   使用固定场景底图做主图
2. `QwenEditConfigPreparer`
   主图做 main ref，同时带入 body-hugging mask
3. `QwenEditConfigPreparer`
   角色 A primary 参考
4. `QwenEditConfigPreparer`
   角色 B primary 参考
5. `TextEncodeQwenImageEditPlusCustom_lrzjason`
6. `KSampler`
   `Lightning 4 steps`
7. `VAEDecode`
8. `SaveImage`

说明：

- 这是当前项目默认内置的新分镜模板，文件在 `src/modules/comfy-pipeline/presets/storyboard-image-qwen-backside-v11.json`
- 它优先解决“人物像同一张图里一起生成”这个问题
- 当前最佳输入不是三视图整板，而是单张 `scene + char1_primary + char2_primary`
- `primary` 视角由工程 token 决定，可随 shot 选择 front / side / back
- 具体动作、镜头、人数关系不应再写死在 workflow 里，而应由分镜脚本驱动
- 当前最佳 mask 是贴着人物和牵手区域的小范围 mask，不能过大，否则会把河边石头洗成路面

### 方案 B：旧成熟资产约束模板（保留作兼容/对照）

适用：

- 需要兼容旧 SD1.5 / IPAdapter / ControlNet 工作流
- 需要对照测试旧模板，不建议作为当前默认主线

说明：

- 对当前河边双人后视场景，旧成熟模板一直存在：
  - 人物贴纸感
  - 场景漂移
  - 第二人消失
  - 局部重绘反复改坏地面
- 因此当前项目默认不再优先推荐它作为双人主生成链

## 推荐插件

- `comfyui_ipadapter_plus`
- 可选：`ComfyUI-Advanced-ControlNet`
- 可选：`comfyui_controlnet_aux`
- 可选：`ComfyUI-InstantID`
- 可选：`PuLID_ComfyUI` 或其他 PuLID ComfyUI 封装

## 推荐模型

### 必装

- 一个可用的写实底模（建议 SDXL）
- `clip_vision_h.safetensors`
- `ip-adapter-plus_sdxl_vit-h.safetensors`

### 选装

- `control_v11p_sd15_openpose.pth`
- `control_v11f1p_sd15_depth.pth`
- `control_v11p_sd15_canny_fp16.safetensors`
- InstantID 对应权重
- InsightFace 模型
- PuLID v1.1 权重

## 精确下载表

| 类别 | 文件/插件 | 放置位置 | 说明 |
| --- | --- | --- | --- |
| 节点 | `comfyui_ipadapter_plus` | `ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus` | 内置成熟分镜模板必需 |
| 模型 | 写实底模（SDXL） | `ComfyUI/models/checkpoints/` | 例如 `sd_xl_base_1.0.safetensors` |
| 模型 | `clip_vision_h.safetensors` | `ComfyUI/models/clip_vision/` | IPAdapter 必需 |
| 模型 | `ip-adapter-plus_sdxl_vit-h.safetensors` | `ComfyUI/models/ipadapter/` | 角色一致性必需 |
| 可选节点 | `ComfyUI-Advanced-ControlNet` | `ComfyUI/custom_nodes/ComfyUI-Advanced-ControlNet` | 第二阶段增强 |
| 可选模型 | `control_v11p_sd15_openpose.pth` | `ComfyUI/models/controlnet/` | 动作姿态增强 |
| 可选模型 | `control_v11f1p_sd15_depth.pth` | `ComfyUI/models/controlnet/` | 空间体块增强 |
| 可选模型 | `control_v11p_sd15_canny_fp16.safetensors` | `ComfyUI/models/controlnet/` | 边缘结构增强 |
| 可选节点 | `ComfyUI-InstantID` | `ComfyUI/custom_nodes/ComfyUI-InstantID` | 正脸镜头锁脸 |
| 可选节点 | `PuLID_ComfyUI` | `ComfyUI/custom_nodes/PuLID_ComfyUI` | 强身份一致性 |

## 工程建议

- 双人/全景镜头：场景图必须做第一参考
- 单人近景镜头：人物主参考必须做第一参考
- 不要让固定风格 LoRA 或剧情 LoRA 常驻分镜工作流
- 不要让 `NextScene` 文本主导当前镜头画面
- 分镜图阶段要优先保角色和空间一致性，再追求“好看”

## 当前项目建议

当前项目当前应把“分镜图工作流模式”切到：

- `兼容内置 Qwen 模板`

如果你还没导入自己的工作流，可以直接点 UI 里的：

- `写入内置兼容模板`

不建议继续使用：

- 旧的 `storyboard-image-fisher-light-v1` 作为默认主线
- 直接把三视图拼成 turnaround sheet 喂给 Qwen
- 大范围 path mask 去强压站位

因为当前验证结果已经很明确：工程里最稳的双人合格结果，是基于 `scene + 双角色 back 参考 + 小范围 mask` 跑出来的 `v11` 结构，而不是旧的 Fisher light 近景链。

## 官方参考

- IP-Adapter: <https://github.com/tencent-ailab/IP-Adapter>
- ComfyUI IPAdapter Plus: <https://github.com/cubiq/ComfyUI_IPAdapter_plus>
- Advanced ControlNet: <https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet>
