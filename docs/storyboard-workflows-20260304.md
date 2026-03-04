# 分镜图成熟工作流（2026-03-04）

## 结论

当前项目内置的 Qwen/Fisher 分镜图模板适合快速出图，不适合高一致性项目。

如果目标是：

- 人物持续保持同一张脸、同一套衣服、同一发型
- 同场景镜头持续保持同一桥、河岸、建筑朝向
- 双人镜头仍能稳住角色和空间关系

更成熟的链路应改为：

`天空盒主面/场景底图 -> img2img 构图底图 -> IPAdapter 角色一致性 -> ControlNet(OpenPose/Depth) 锁姿态/空间 -> 可选 InstantID / PuLID 锁脸`

## 推荐工作流

### 方案 A：高一致性分镜图（推荐）

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
4. `IPAdapter Advanced / IPAdapter Apply`
   分别喂主角色和次角色参考图
5. `CLIP Vision Loader`
6. `Apply Advanced ControlNet`
   推荐至少接 `OpenPose` 或 `Depth`
7. `VAEDecode`
8. `SaveImage`

可选增强：

- `InstantID`
  适合正脸/半身对白镜头
- `PuLID`
  适合更强的人脸身份锁定

### 方案 B：场景优先分镜图

适用：

- 建立镜头
- 双人远景
- 环境占比很大的动作镜头

节点链建议：

1. `LoadImage`
   使用天空盒主面或场景底图
2. `VAEEncode`
3. `KSampler`
   `denoise` 更低，优先保场景
4. `IPAdapter`
   只保留主角色或弱化角色
5. `SaveImage`

## 推荐插件

- `comfyui_ipadapter_plus`
- `ComfyUI-Advanced-ControlNet`
- `comfyui_controlnet_aux`
- 可选：`ComfyUI-InstantID`
- 可选：`PuLID_ComfyUI` 或其他 PuLID ComfyUI 封装

## 推荐模型

### 必装

- `clip_vision_h.safetensors`
- `ip-adapter-plus_sdxl_vit-h.safetensors`
- `control_v11p_sd15_openpose.pth`
- `control_v11f1p_sd15_depth.pth`

### 选装

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

然后粘贴一套专用外部分镜工作流 JSON。

不建议继续使用：

- 内置 `storyboard-image-fisher-light-v1`

因为它本质上是兼容模板，不是高一致性生产模板。
