# MiniMax H3 Task 3 实施报告

## 结果

- `Shot` 已支持可持久化的工作流 Profile、质量档、加速模式、连续段、边界、路由原因、质量状态及生成凭证。
- legacy 项目快照只在 `hydrateFromSnapshot` 的内存导入路径补齐安全默认值，不修改传入对象，也不触发磁盘保存。
- 镜头脚本导入 `replaceShotsForCurrentSequence` 与人工更新 `updateShotFields` 均逐字段透传新计划字段。
- 备份/JSON 序列化与重载沿用真实 `createSnapshotBackup`、`parseSnapshotBackup`、`hydrateFromSnapshot` 路径，无测试内复制的迁移实现。

## TDD 证据

### RED

在任何生产代码修改前创建 `scripts/check-video-production-schema.mjs`，导入仅带 `videoMode: "first_last_frame"` 的 legacy 镜头，并执行真实 store/持久化模块。首次有效运行退出码为 1：

```text
AssertionError [ERR_ASSERTION]: legacy project import should default videoWorkflowProfileId
+ actual - expected
+ undefined
- 'auto'
```

失败原因是 legacy 导入路径尚未进行视频计划内存迁移，符合预期 RED。

### GREEN

最小实现后，checker 输出：

```text
PASS video production schema: legacy migration, import, update, serialization, and reload
```

覆盖路径：

1. `hydrateFromSnapshot`：保留 legacy `first_last_frame`，补齐 `auto` / `production` / `standard` / `hard_cut` / `pending`，并验证源镜头对象序列化前后完全一致、导入后为新对象。
2. `replaceShotsForCurrentSequence`：导入九个新增计划字段及完整生成凭证，并验证输入对象不变。
3. `updateShotFields`：用第二组值更新全部新增字段，并验证 patch 不变。
4. `createSnapshotBackup` + `JSON.stringify` + `parseSnapshotBackup` + `hydrateFromSnapshot`：验证全部字段和凭证经真实备份序列化、解析及 store 重载后保持一致。

## 验证

执行：

```text
node scripts/check-video-production-schema.mjs
npm.cmd run build
```

结果：两条命令均退出码 0；TypeScript/Vite 构建完成，Vite 转换 459 个模块。构建仅保留既有的“大于 500 kB chunk”提示，无编译错误。

## 提交与未提交边界

- 安全提交范围仅包含新建的 checker 与本报告。
- `src/modules/storyboard-core/types.ts`、`src/modules/storyboard-core/store.ts` 和 `package.json` 在任务开始前已有大量其他未提交改动。为避免 Task 3 hunks 与 character identity、generation task、其他测试脚本等共享改动交叉暂存，这三个共享文件的 Task 3 实现及单条 `test:video-production-schema` 脚本均保持未暂存/未提交。
- 工作区其他大量 modified/untracked 文件均未纳入本任务提交；未执行 reset、checkout、clean，也未替换整文件。

## 风险

- Task 3 的字段依赖已存在的 `src/modules/video-production/types.ts`（Task 2 接口）；未修改该文件。
- `hydrateFromSnapshot` 的默认迁移是纯内存行为。应用现有自动保存机制后，用户后续正常编辑/保存可能把已迁移默认值写入新快照，这是正常持久化行为；本迁移本身不会主动覆盖源项目。
- Vite 仍提示少数构建 chunk 超过 500 kB；这是既有打包体积提示，与本任务 schema/store 变更无直接关系。
- 未开始 Task 4。
