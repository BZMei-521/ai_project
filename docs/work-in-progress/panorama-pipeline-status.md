# 360 全景工作流续作状态

更新时间：2026-08-21 16:51（Asia/Shanghai）

## 已确认完成

- FLUX.2 Klein 9B FP8、Qwen 8B、360 LoRA 已安装并被 ComfyUI 识别。
- 已有多张 2:1 测试图；当前验证输入为 `output/wooden-spear-flux2-klein9b-360-live-trial-1920x960.png`。
- ComfyUI 运行正常，队列为空。
- 球面后处理节点已安装：等距柱状旋转、接缝遮罩、极点遮罩、等距柱状转透视。

## 已排除

- 不再把整张 2:1 展开图直接送入 H3。
- 不再生成六面图或六面缓存。
- 不重复下载模型，不重复旧 SDXL/宽画幅测试。

## 当前阶段

1. 四方向透视验证已完成：0°、90°、270°空间可用；180°中央存在清晰竖直断缝。
2. 根据用户提供的 Panorama Stickers 方案，暂停手工 9B 接缝重绘链。
3. 已安装 `ComfyUI-Panorama-Stickers`（提交 `af0357f68bf16506524dfa952f0e8a7c525fc248`）和官方 4B ERP Outpaint LoRA；LoRA SHA-256 校验通过。
4. 使用现有 Base 4B、Qwen 4B、Flux2 VAE 和普通开场透视帧作为贴纸，直接 outpaint 成 ERP。
5. 新 ERP 通过 Preview/Cutout 验证后，再导出首尾透视帧并接入 H3。

## 已保存工件

- `workflows/panorama-perspective-validation-api.json`
- `workflows/panorama-seam-repair-flux2-klein9b-api.json`
- `workflows/panorama-stickers-wooden-spear-state.json`
- `state/inventory.json`（2026-08-21 实时库存刷新）
- `output/panorama-validation/`（四方向透视验证图）
