# Storyboard Pro ComfyUI 分镜生产闭环设计

## 目标

第一阶段打通“镜头脚本/镜头卡片 -> ComfyUI 生成分镜图 -> 回写镜头 -> 时间轴预览 -> PDF/MP4 导出”的稳定闭环。

范围限定为分镜图生产稳定性和可诊断性，不把角色资产、配音、音效和复杂视频生成扩展成第一阶段主线。

## 系统边界与数据流

```text
镜头脚本/镜头卡片
  -> 生成请求标准化
  -> ComfyUI 能力与依赖检查
  -> 工作流 token 注入
  -> ComfyUI 排队与进度监听
  -> 输出图片定位
  -> 回写 Shot.generatedImagePath
  -> 时间轴/预览/PDF/MP4 使用结果
```

- `storyboard-core` 只负责项目、镜头和生成结果状态。
- `comfyService` 负责 ComfyUI HTTP/WebSocket、工作流解析、token 替换和输出定位。
- `ComfyPipelinePanel` 负责配置、诊断、批量任务和用户操作。
- `export-service` 只消费已回写的镜头结果，不参与生成。
- 新增轻量 `workflowRegistry`，记录工作流用途、依赖、输入 token、输出规则和质量等级。

每条可接入的工作流必须声明用途 `storyboard-image`、输入 token、可选参考图、输出节点/文件名规则及 checkpoint/VAE/ControlNet/IPAdapter/自定义节点依赖。

## 主工作流与降级策略

采用二阶段分镜图路线：

1. Stage A 负责镜头构图、人数、站位、动作方向、空间关系和机位。
2. Stage B 以 Stage A 输出为基础，结合角色/场景参考细化脸部、服装、手部、光照和画面完成度，同时保持构图稳定。

工作流优先级：本机已有且依赖完整的二阶段工作流 -> 工程内置 Qwen/SDXL 预设 -> 单阶段参考图 fallback -> 仅诊断不可生成。

- 缺少 Stage B 依赖时允许 Stage A 单独生成。
- 缺少 IPAdapter 时允许纯文本加场景参考，但标记一致性较弱。
- 缺少 checkpoint/VAE/节点时阻止排队并显示具体缺失项。
- 单镜头失败只重试该镜头，不影响其他镜头。
- 输出文件缺失时标记异常，不报告为成功。

批量顺序为：依赖检查 -> 准备参考图 -> Stage A 批量生成 -> 保存结果 -> Stage B 批量细化 -> 回写 Shot -> 生成报告。

## 工程改造

- `src/modules/comfy-pipeline/comfyService.ts`
  - 统一工作流注册、token 注入、连接/队列/进度/输出解析。
  - 增加模型、节点和路径依赖扫描及 Stage A/B/fallback 能力判断。
- `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`
  - 展示可用工作流和缺失依赖。
  - 增加单镜头测试、批量生成、阶段状态和逐镜头重试。
- 新增 `src/modules/comfy-pipeline/workflowRegistry.ts`
  - 管理工作流元数据、token 契约、依赖、输出节点、能力等级和降级关系。
- `src/modules/storyboard-core/types.ts` / `store.ts`
  - 增加生成任务阶段、状态、错误、工作流 ID 和批次信息。
  - 支持批量结果绑定、保存和恢复。
- `scripts/`
  - 增加 ComfyUI 环境扫描、工作流契约检查、单镜头 smoke test 和批量结果校验。

## 验收标准

1. 识别 ComfyUI 在线状态。
2. 列出 checkpoint、VAE、ControlNet、IPAdapter 和自定义节点。
3. 对候选工作流显示可用、缺少依赖或 token 不完整。
4. 至少一条主工作流完成单镜头生成。
5. 连续生成 3-5 个镜头并正确回写对应 `Shot`。
6. 失败镜头可单独重试。
7. 结果可用于预览、时间轴、PDF 和 MP4。
8. ComfyUI 或模型缺失时显示明确诊断，不出现假成功。
9. `npm run build` 与现有工作流检查通过。

## 下载与安全边界

- 先扫描本机，避免重复下载。
- 只下载主链所需的最小依赖。
- 优先使用官方仓库、模型作者页面或 Hugging Face 官方发布。
- 记录下载清单、版本、大小和安装路径。
- 不覆盖现有模型和自定义节点。
- 大模型下载前生成清单，下载支持恢复。

