# 分镜动画应用 技术方案 v1

## 1. 目标与约束
- 目标：支撑 PRD v1 的本地专业创作场景，优先稳定性和响应速度。
- 约束：MVP 阶段以单机为主，模块设计需为未来协作能力留扩展位。

## 2. 技术栈
1. 桌面容器：Tauri 2.x（Rust + WebView）。
2. 前端：React + TypeScript + Zustand + Vite。
3. 画布渲染：PixiJS（2D GPU）+ 自定义绘制工具层。
4. 本地数据：SQLite（结构化数据）+ 项目目录文件（位图/音频）。
5. 媒体导出：FFmpeg（通过 Tauri Command 调用）。
6. 测试：Vitest（单测）+ Playwright（E2E）。

## 3. 系统模块
1. `editor-shell`：应用框架、窗口布局、命令系统、快捷键。
2. `storyboard-core`：镜头、序列、时间轴、播放状态管理。
3. `canvas-engine`：图层栈、绘制工具、撤销重做、洋葱皮。
4. `asset-manager`：素材索引、分类、引用追踪。
5. `preview-engine`：时间轴解算、镜头切换、音画同步。
6. `export-service`：PDF 渲染、帧序列输出、FFmpeg 合成。
7. `persistence`：项目读写、自动保存、崩溃恢复、版本迁移。

## 4. 数据模型
### 4.1 领域对象（简化）
1. `Project`: id, name, fps, width, height, createdAt, updatedAt。
2. `Sequence`: id, projectId, name, order。
3. `Shot`: id, sequenceId, order, title, durationFrames, dialogue, notes, tags。
4. `ShotLayer`: id, shotId, name, visible, locked, zIndex, bitmapPath。
5. `Asset`: id, projectId, type(character|scene|prop), name, filePath, metadata。
6. `AudioTrack`: id, projectId, filePath, startFrame, gain。

### 4.2 SQLite 表
- `projects`, `sequences`, `shots`, `shot_layers`, `assets`, `audio_tracks`, `migrations`。

## 5. 项目文件结构
```text
MyProject.sbproj/
  project.json
  project.db
  autosave/
  assets/
    characters/
    scenes/
    props/
  shots/
    <shot-id>/
      layer-1.png
      layer-2.png
  audio/
  exports/
```

### 5.1 `project.json` 示例
```json
{
  "schemaVersion": 1,
  "projectId": "proj_001",
  "name": "Teaser Episode 01",
  "fps": 24,
  "resolution": { "width": 1920, "height": 1080 },
  "createdAt": "2026-02-25T10:00:00Z",
  "updatedAt": "2026-02-25T10:00:00Z"
}
```

## 6. 关键流程设计
### 6.1 编辑流程
1. UI 操作派发命令（`Command Bus`）。
2. 命令写入 `storyboard-core` 状态树。
3. 增量持久化到 SQLite。
4. 画布按变更范围重绘（脏区更新）。

### 6.2 撤销/重做
1. 使用命令日志（Command Pattern）记录可逆操作。
2. 图层位图变更采用快照 + patch 混合策略。
3. 默认历史深度 100，可在设置中调整。

### 6.3 自动保存与恢复
1. 30 秒周期自动保存到 `autosave/`。
2. 每次启动检查 `dirty shutdown marker`。
3. 若检测到异常退出，提示恢复最近 autosave。

### 6.4 导出流程
1. 读取时间轴并生成镜头帧序列（内存或临时目录）。
2. PDF：按模板渲染镜头页并附字段。
3. MP4：调用 FFmpeg 合成视频和音轨。
4. 输出写入 `exports/` 并返回导出报告。

## 7. 性能策略
1. 预览渲染使用 requestAnimationFrame + 帧缓存。
2. 大项目分页加载镜头缩略图，避免一次性解码。
3. 位图内存超阈值时触发 LRU 纹理回收。
4. 导出采用后台任务队列，UI 保持可交互。

## 8. 稳定性与可观测性
1. 全局错误边界 + Rust 层 panic 捕获。
2. 导出任务和 IO 操作都写结构化日志。
3. 本地崩溃报告（匿名）导出为 zip 供问题排查。

## 9. 测试策略
1. 单测：时间轴解算、数据迁移、命令撤销重做。
2. 集成测试：项目读写、自动恢复、素材引用。
3. E2E：创建项目 -> 画 3 镜头 -> 导出 PDF/MP4。
4. 性能基准：200 镜头项目加载与时间轴拖拽帧率。

## 10. 后续扩展位
1. 协作：将 `Command Bus` 接入 CRDT（Yjs）事件流。
2. 评论系统：在 `Shot` 上扩展 annotation 子表。
3. 云同步：项目目录与对象存储双向同步。
