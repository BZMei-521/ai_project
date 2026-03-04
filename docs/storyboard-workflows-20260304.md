# 分镜图成熟工作流（2026-03-04）

## 结论

当前项目内置的 Qwen/Fisher 分镜图模板适合快速出图，不适合高一致性项目。

如果目标是：

- 人物持续保持同一张脸、同一套衣服、同一发型
- 同场景镜头持续保持同一桥、河岸、建筑朝向
- 双人镜头仍能稳住角色和空间关系

更成熟的链路应改为：

`天空盒主面/场景底图 -> scene-first img2img -> IPAdapter 角色一致性 -> 可选 ControlNet(OpenPose/Depth/Canny) -> 可选 InstantID / PuLID`

## 推荐工作流

### 方案 A：内置成熟分镜模板（当前项目默认推荐）

适用：

- 双人对戏
- 连续动作镜头
- 同场景多镜头连续分镜
- 希望最大程度参考角色三视图和天空盒

节点链建议：

1. `LoadImage`
   使用天空盒主面或上一镜头稳定场景图做底图
2. `VAEEncode`
3. `KSampler`
   低到中等 `denoise`，避免完全重画
4. `IPAdapterUnifiedLoader`
   推荐 `PLUS (high strength)` 预设
5. `IPAdapterAdvanced`
   分别喂主角色主视图、主角色辅视图、次角色主视图
6. `VAEDecode`
7. `SaveImage`

说明：

- 这是当前项目内置的新分镜模板，文件在 `src/modules/comfy-pipeline/presets/storyboard-image-asset-guided-v1.json`
- 它先用天空盒主面锁场景，再用 IPAdapter 锁角色，不再靠 Qwen 图编辑模板“猜”参考关系
- 它不强绑 ControlNet，这样依赖更少，先把场景和角色一致性基础打稳

### 方案 B：高约束增强版（第二阶段）

适用：

- 动作姿态必须稳定
- 双人关系和肢体走位必须更准
- 角色正脸特写要更稳

可选增强：

- `Apply Advanced ControlNet`
  推荐至少接 `OpenPose` 或 `Depth`
- `InstantID`
  适合正脸/半身对白镜头
- `PuLID`
  适合更强的人脸身份锁定

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

## 工程建议

- 双人/全景镜头：场景图必须做第一参考
- 单人近景镜头：人物主参考必须做第一参考
- 不要让固定风格 LoRA 或剧情 LoRA 常驻分镜工作流
- 不要让 `NextScene` 文本主导当前镜头画面
- 分镜图阶段要优先保角色和空间一致性，再追求“好看”

## 当前项目建议

当前项目应把“分镜图工作流模式”切到：

- `成熟资产约束流程（推荐）`

如果你还没导入自己的工作流，可以直接点 UI 里的：

- `写入内置成熟分镜模板`

不建议继续使用：

- 内置 `storyboard-image-fisher-light-v1`

因为它本质上是兼容模板，不是高一致性生产模板。

## 官方参考

- IP-Adapter: <https://github.com/tencent-ailab/IP-Adapter>
- ComfyUI IPAdapter Plus: <https://github.com/cubiq/ComfyUI_IPAdapter_plus>
- Advanced ControlNet: <https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet>
