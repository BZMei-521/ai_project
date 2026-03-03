# 角色三视图与天空盒成熟工作流

日期：2026-03-03

这份文档只解决两件事：

1. 角色三视图应该怎么做才算成熟流程。
2. 天空盒为什么不能六次独立文生图，以及应该怎么改。

## 现状判断

当前项目内置的两个资产预设都只是最基础的单张文生图模板。

- 角色三视图预设只有 `CheckpointLoaderSimple -> CLIPTextEncode -> EmptyLatentImage -> KSampler -> VAEDecode -> SaveImage` 这一条链路，没有任何多视角一致性节点，也没有参考图一致性链路，见 [asset-character-threeview-default.json](/Users/duole/Desktop/Comfyui/src/modules/comfy-pipeline/presets/asset-character-threeview-default.json#L1C1)。
- 天空盒预设也是同一类单张文生图模板，没有全景生成、没有 cubemap 拆面，见 [asset-skybox-default.json](/Users/duole/Desktop/Comfyui/src/modules/comfy-pipeline/presets/asset-skybox-default.json#L1C1)。
- UI 代码里其实已经把这两个基础模式定义成“基础正交三视图模板”和“基础六次文生图模板”，并且说明高级模式应该是 `MV-Adapter / MultiView` 和“全景转六面”，见 [ComfyPipelinePanel.tsx](/Users/duole/Desktop/Comfyui/src/modules/comfy-pipeline/ComfyPipelinePanel.tsx#L107C1)。

结论：你现在遇到的结果不对，不是调参问题，根因是工作流类型就不对。

2026-03-03 补充：

- 项目内已新增内置高级角色模板：`asset-character-mvadapter-default.json`
- 项目内已新增内置高级天空盒模板：`asset-skybox-panorama-default.json`
- UI 中选择高级模式后，可以直接点击“写入内置高级多视角模板”或“写入内置高级全景转六面模板”

## 推荐工作流

### A. 角色三视图

推荐方案：`单张角色参考图 -> MV-Adapter image-to-multi-view -> 选择 front/right/back -> 必要时逐张修图`

原因：

- MV-Adapter 官方项目就是做 multi-view consistent image generation。
- ComfyUI-MVAdapter 官方插件明确支持 text-to-multi-view、image-to-multi-view、视角选择、以及和 ControlNet 的集成。
- 对你这种“要标准 front/side/back 设定板”的需求，最合适的是 `i2mv`，不是三次普通 txt2img。

推荐节点链：

1. `LoadImage`
2. `CheckpointLoaderSimple` 或 MV-Adapter 的 Diffusers/ldm loader
3. `CLIPTextEncode` 正负提示词
4. `MV-Adapter` 相关节点
5. `View Selector`
6. `SaveImage`

推荐输出策略：

1. 先出一张干净的角色参考正面图。
2. 把这张图喂给 `i2mv_sdxl` 工作流，一次出多视角。
3. 只保留 `front/right/back` 三张。
4. 如果 side 不稳定，再用 ControlNet 只修这一张，不要整套重做。

推断说明：
基于 MV-Adapter 官方 README 里对 `image-to-multi-view`、`view selection`、`ControlNet` 集成、以及 SDXL 768 分辨率多视角能力的描述，我建议先在 768 级别稳定出板，再单张精修到更高分辨率。这一条是基于官方能力做的工程化组合，不是 README 的原句。

### B. 角色三视图可用兜底

如果你暂时不想装 MV-Adapter，当前机器最接近能跑通的兜底方案是：

`角色参考图 -> IPAdapter -> ControlNet(OpenPose/Depth) -> 固定 seed 的 front/right/back 三次定向出图`

这不是最终推荐，只是过渡方案。

原因：

- 你本机已经装了 `comfyui_ipadapter_plus`、`ComfyUI-Advanced-ControlNet`、`clip_vision_h.safetensors`。
- 但你现在只有 `ip-adapter_sd15.safetensors` 和 `control_v11p_sd15_canny_fp16.safetensors`，缺少更适合角色转视角的 OpenPose/Depth 组合。

### C. 天空盒

推荐方案：`SDXL base + 360Redmond LoRA -> 2:1 equirectangular panorama -> seam fix -> E2C/E2Face 拆六面`

原因：

- `360Redmond` 模型卡明确说明它是基于 `SD XL 1.0` 的 panorama LoRA，并建议先生成 `1600x800`。
- `ComfyUI_pytorch360convert` 官方仓库直接提供 `E2C`、`E2Face`、`E2E`、`Roll Image`、`Create Seam Mask` 这些 360 处理节点。
- 真正的天空盒应该先保证同一张全景内部连续，再拆六面。六次独立 txt2img 不能保证面与面之间连续。

推荐节点链：

1. `CheckpointLoaderSimple` 加载 `sd_xl_base_1.0.safetensors`
2. `LoRA Loader` 加载 `360Redmond`
3. `CLIPTextEncode`
4. `KSampler`
5. `Preview 360 Panorama` 可选预览
6. `Roll Image` 或 `E2E` 把接缝转到中间
7. `Create Seam Mask` + 局部修补
8. `E2C` 或 `E2Face`
9. `SaveImage`

建议参数：

- 首轮：`1600x800`
- 提示词尽量简单
- 先做纯环境，不要混人物
- 先确认 seam 再拆六面

## 本机已装与缺失

以下结论基于 2026-03-03 对 `/Users/duole/Documents/ComfyUI/custom_nodes` 和 `/Users/duole/Documents/ComfyUI/models` 的本地扫描。

### 已装节点

- `ComfyUI-Advanced-ControlNet`
- `comfyui_ipadapter_plus`
- `comfyui_controlnet_aux`
- `ComfyUI-Impact-Pack`
- `comfyui-easy-use`
- `comfyui-frame-interpolation`
- `comfyui-videohelpersuite`

### 已装模型

- checkpoint: `sd_xl_base_1.0.safetensors`
- checkpoint: `sd_xl_refiner_1.0.safetensors`
- checkpoint: `Qwen-Rapid-AIO-SFW-v5.safetensors`
- `clip_vision/clip_vision_h.safetensors`
- `ipadapter/ip-adapter_sd15.safetensors`
- `controlnet/control_v11p_sd15_canny_fp16.safetensors`

### 缺失节点

角色三视图成熟方案缺：

- `ComfyUI-MVAdapter`

天空盒成熟方案缺：

- `ComfyUI_pytorch360convert`
- `ComfyUI_preview360panorama` 可选但建议装

当前目录中未发现这些 3D/360/多视角类节点：

- `MVAdapter`
- `Wonder3D`
- `Zero123`
- `CRM`
- `InstantMesh`
- `pytorch360convert`
- `preview360panorama`

### 缺失模型

角色三视图成熟方案缺：

- `mvadapter_i2mv_sdxl.safetensors`
- 可选：`mvadapter_i2mv_sdxl_beta.safetensors`
- 可选：`sdxl-vae-fp16-fix`

角色三视图兜底方案还缺：

- OpenPose ControlNet 模型
- Depth ControlNet 模型
- 如果你要继续走 SDXL 角色一致性，也建议补一套 SDXL 版 IPAdapter 权重

天空盒成熟方案缺：

- `360Redmond` LoRA

如果你还想沿用当前 UI 里原先的默认推荐模型，本机也缺：

- `juggernautXL_v8Rundiffusion.safetensors`
- `architecturerealmix_v11.safetensors`
- `interiordesignsuperm_v2.safetensors`
- `dreamshaper_8.safetensors`
- `animagine-xl-4.0.safetensors`
- `realisticVisionV60B1_v51VAE.safetensors`

## 建议下载顺序

### 第一优先级

1. `ComfyUI-MVAdapter`
2. `mvadapter_i2mv_sdxl.safetensors`
3. `ComfyUI_pytorch360convert`
4. `pytorch360convert` Python 依赖
5. `360Redmond`

### 第二优先级

1. `ComfyUI_preview360panorama`
2. OpenPose ControlNet
3. Depth ControlNet
4. SDXL 版 IPAdapter 权重

### 第三优先级

1. 适合你风格的 SDXL checkpoint
2. 放大模型
3. Inpaint 模型

## 精确下载表

### 先装节点

| 用途 | 官方来源 | 安装目标目录 | 安装方式 |
| --- | --- | --- | --- |
| 角色多视角 | `huanngzh/ComfyUI-MVAdapter` | `/Users/duole/Documents/ComfyUI/custom_nodes/ComfyUI-MVAdapter` | `git clone` 到 `custom_nodes` 后执行 `pip install -r requirements.txt` |
| 全景转六面 | `ProGamerGov/ComfyUI_pytorch360convert` | `/Users/duole/Documents/ComfyUI/custom_nodes/ComfyUI_pytorch360convert` | `git clone --recursive` 到 `custom_nodes` 后执行 `python -m pip install pytorch360convert` |
| 360 预览 | `ProGamerGov/ComfyUI_preview360panorama` | `/Users/duole/Documents/ComfyUI/custom_nodes/ComfyUI_preview360panorama` | `git clone --recursive` 后执行 `python install.py` |

建议命令：

```bash
cd /Users/duole/Documents/ComfyUI/custom_nodes
git clone https://github.com/huanngzh/ComfyUI-MVAdapter
git clone --recursive https://github.com/ProGamerGov/ComfyUI_pytorch360convert
git clone --recursive https://github.com/ProGamerGov/ComfyUI_preview360panorama
```

MVAdapter 依赖：

```bash
cd /Users/duole/Documents/ComfyUI/custom_nodes/ComfyUI-MVAdapter
python -m pip install -r requirements.txt
```

360Convert 依赖：

```bash
python -m pip install pytorch360convert
```

360 预览节点安装脚本：

```bash
cd /Users/duole/Documents/ComfyUI/custom_nodes/ComfyUI_preview360panorama
python install.py
```

### 再放模型

| 用途 | 文件名 | 官方来源 | 放置目录 | 备注 |
| --- | --- | --- | --- | --- |
| 天空盒全景 LoRA | `View360.safetensors` | `multimodalart/360Redmond` | `/Users/duole/Documents/ComfyUI/models/loras/` | 这是 360Redmond 的实际文件名 |
| SD15 OpenPose | `control_v11p_sd15_openpose.pth` | `lllyasviel/ControlNet-v1-1` | `/Users/duole/Documents/ComfyUI/models/controlnet/` | 角色三视图兜底修姿 |
| SD15 Depth | `control_v11f1p_sd15_depth.pth` | `lllyasviel/ControlNet-v1-1` | `/Users/duole/Documents/ComfyUI/models/controlnet/` | 角色三视图兜底定体块 |
| SDXL IPAdapter | `ip-adapter_sdxl_vit-h.safetensors` | `h94/IP-Adapter` | `/Users/duole/Documents/ComfyUI/models/ipadapter/` | 基础版 |
| SDXL IPAdapter Plus | `ip-adapter-plus_sdxl_vit-h.safetensors` | `h94/IP-Adapter` | `/Users/duole/Documents/ComfyUI/models/ipadapter/` | 更适合角色一致性 |
| SDXL VAE | `sdxl.vae.safetensors` | `madebyollin/sdxl-vae-fp16-fix` | `/Users/duole/Documents/ComfyUI/models/vae/` | 可选，但推荐 |

### MV-Adapter 权重说明

`ComfyUI-MVAdapter` 官方说明里写得比较明确：它依赖 `diffusers`，首次运行时会自动从 Hugging Face 下载权重到 HF cache，`ckpt_name` 直接填 HF 模型名，例如 `stabilityai/stable-diffusion-xl-base-1.0`。

所以你这里有两种用法：

1. 推荐：只装 `ComfyUI-MVAdapter`，第一次跑 `i2mv_sdxl` 工作流时让它自动拉取 `mvadapter_i2mv_sdxl.safetensors` 或 `mvadapter_i2mv_sdxl_beta.safetensors`。
2. 手动：提前从 `huanngzh/mv-adapter` 下载下面两个文件，供离线环境使用。

手动下载的文件名：

- `mvadapter_i2mv_sdxl.safetensors`
- `mvadapter_i2mv_sdxl_beta.safetensors`

这里我不建议你手工乱放到 `models/checkpoints` 或 `models/loras`，因为官方插件文档明确按 Hugging Face cache 方式处理这类权重，不是普通 Comfy checkpoint/LoRA 的加载路径。

## 装完后的最短接线

### 角色三视图正式方案

1. 用一张干净角色参考图作为输入。
2. 走 `ComfyUI-MVAdapter` 的 `i2mv_sdxl_ldm_view_selector.json` 或 `i2mv_sdxl_diffusers.json`。
3. 如果只要三视图，优先选 `front + right + back`。
4. base model 直接用你本机已有的 `sd_xl_base_1.0.safetensors`。
5. 显存不富余时，加 `sdxl.vae.safetensors`。

### 天空盒正式方案

1. `CheckpointLoaderSimple -> LoRA Loader(View360.safetensors) -> CLIPTextEncode -> KSampler`
2. 先输出 `1600x800` 的 equirectangular 全景。
3. 用 `Preview 360 Panorama` 检查接缝。
4. 有缝就 `Roll Image` 到中间，再配 `Create Seam Mask` 修补。
5. 最后 `E2C` 或 `E2Face` 拆成 `Front/Right/Back/Left/Up/Down`。

## 你现在最该先下的 8 个东西

1. `ComfyUI-MVAdapter`
2. `ComfyUI_pytorch360convert`
3. `ComfyUI_preview360panorama`
4. `View360.safetensors`
5. `control_v11p_sd15_openpose.pth`
6. `control_v11f1p_sd15_depth.pth`
7. `ip-adapter-plus_sdxl_vit-h.safetensors`
8. `sdxl.vae.safetensors`

## 下载链接

- MV-Adapter 官方项目: <https://github.com/huanngzh/MV-Adapter>
- ComfyUI-MVAdapter: <https://github.com/huanngzh/ComfyUI-MVAdapter>
- ComfyUI_pytorch360convert: <https://github.com/ProGamerGov/ComfyUI_pytorch360convert>
- pytorch360convert: <https://github.com/ProGamerGov/pytorch360convert>
- 360Redmond: <https://huggingface.co/multimodalart/360Redmond>
- Preview 360 Panorama: <https://github.com/ProGamerGov/ComfyUI_preview360panorama>

## 参考依据

- MV-Adapter 官方 README：说明它是 multi-view consistent generation，支持 text/image condition、SDXL、ControlNet、View Selector。
- ComfyUI-MVAdapter 官方 README：说明插件支持 image-to-multi-view、视角选择、ControlNet 集成，且首次运行会自动从 Hugging Face cache 拉权重。
- 360Redmond 模型卡：说明它是基于 SDXL 1.0 的 panorama LoRA，建议从 `1600x800` 开始。
- ComfyUI_pytorch360convert 官方 README：说明它提供 `E2C`、`E2Face`、`E2E`、`Roll Image`、`Create Seam Mask` 等 360 节点，并要求额外安装 `pytorch360convert`。
- ComfyUI_preview360panorama 官方 README：说明它用于交互式预览 equirectangular 360 图，并提供 `python install.py` 安装方式。
- h94/IP-Adapter 文件树：列出 `ip-adapter_sdxl_vit-h.safetensors`、`ip-adapter-plus_sdxl_vit-h.safetensors`、`ip-adapter-plus-face_sdxl_vit-h.safetensors`。
- madebyollin/sdxl-vae-fp16-fix 模型卡：说明 `SDXL-VAE-FP16-Fix` 可在 `float16` 下稳定运行，主文件名是 `sdxl.vae.safetensors`。
