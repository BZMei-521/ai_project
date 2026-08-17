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

## Important 修复：legacy hydrate 不自动写回桌面项目

独立审查指出，旧快照经 `hydrateFromSnapshot` 补齐默认字段后会改变 `shots` 引用，而原桌面自动保存 effect 只检查工作区路径和 ready 状态，导致无编辑也在 1.2 秒后写盘。

### 修复 TDD

先抽取与原 effect 等价的纯同步策略并新增可执行场景。首次运行得到预期 RED：

```text
AssertionError [ERR_ASSERTION]: initial hydrate must establish a synchronized baseline without saving
true !== false
```

GREEN 使用通用的“工作区路径 + 完整持久化快照 JSON 指纹”基线，不包含任何 MiniMax/H3 字段特判：

- 初始化、桌面加载、项目切换及重新 hydrate 后，当前内存快照被标记为已同步，不安排写盘。
- 同一工作区发生后续真实状态修改，快照指纹变化，自动保存仍会执行。
- 定时保存 flush 前再次检查当前工作区、ready 状态和最新快照，旧工作区的待执行定时器不能写入新工作区。
- 自动保存成功后推进基线；创建项目后的显式保存、重命名及删除后切换也建立对应路径基线。

专项 checker 现覆盖：无基线初始化不写、首次 hydrate 不写、后续编辑写、旧工作区 pending flush 不写、项目切换不写、等价重新 hydrate 不写。

### Important 修复提交边界

- 新增纯 helper `src/modules/persistence/desktopSnapshotSync.ts` 可独立安全提交。
- `scripts/check-video-production-schema.mjs` 与本报告属于已跟踪 Task 3 文件，可提交本次增量。
- `src/app/App.tsx` 在修复前已有大量 lazy panel、generation task 等其他未提交改动。本次仅做同步基线相关小补丁；若无法从共享 hunks 安全隔离，App 修复保持未暂存并由集成者连同现有共享改动处理。

## r2 复审修复：失败转移与手动保存

r2 复审确认正常 hydrate 路径已关闭，但发现 ready、baseline 与 workspace path 分散在多个 ref/异常分支，create/switch/delete 失败可能造成永久停存；手动保存也没有推进基线。

### r2 RED

先为纯异步同步状态增加 create-null、create-save-throw、switch-load-throw、delete-load-throw、manual-save/pending-timeout 场景。首次执行在 create-null 恢复处按预期失败：

```text
AssertionError [ERR_ASSERTION]: create null must restore the previous synchronized workspace
+ actual - expected
+ 'transitioning'
- 'synced'
```

### r2 GREEN

同步 helper 现在管理单一原子状态：

- `disabled`：没有可同步工作区。
- `transitioning`：create/load/switch/delete 正在改变后端目标，禁止保存。
- `synced`：路径和基线与已加载/已保存快照一致；仅真实快照变化触发保存。
- `unsynced`：新工作区已由后端创建并成为当前目标，但首次显式保存失败；允许自动重试及后续编辑保存。
- `blocked`：后端目标已切换，但目标快照加载失败；禁止把旧内存快照写到新目标，成功重新加载后恢复。

工作区转换递增 `workspaceToken`，用于失效旧工作区 pending flush；同一工作区的保存完成只推进实际提交快照的指纹基线，不改变 token。同内容 pending flush 因指纹相等自然跳过，保存期间产生的新内容仍可继续保存。

App 失败路径处理：

1. create 返回 null/创建前抛错：恢复创建前完整 Zustand state、workspace sync-state 和路径语义；后续真实编辑仍可正常保存。
2. create 已返回新路径但 list/显式 save 抛错：新路径进入 `unsynced`，不会永久 not-ready，并可由自动保存重试。
3. switch/delete 已得到新目标路径但 load 抛错：新路径进入 `blocked`，不会恢复成“新路径 + 旧路径基线 + ready”的无效组合；手动重新加载成功后建立新基线，后续编辑可安全保存。
4. 手动保存成功：以实际提交的 snapshot 和当前 workspace 推进 `synced` 基线；同内容 timeout 跳过，不取消保存期间产生的新内容。

专项 checker 直接执行生产状态机，覆盖上述失败与恢复路径；没有使用 App source-string 断言，也未硬编码 H3 字段。

## r3 复审修复：null load、手动守卫与 in-flight 编辑

### 三轮 RED

1. switch/delete load 返回 null：

```text
AssertionError [ERR_ASSERTION]: switch load null must remain blocked
+ actual: 'synced'
- expected: 'blocked'
```

2. blocked/transitioning 手动保存：

```text
AssertionError [ERR_ASSERTION]: manual save must be denied while the target workspace is blocked
true !== false
```

3. 保存 A 在途时产生 B：

```text
AssertionError [ERR_ASSERTION]: saving submitted snapshot A must not cancel pending snapshot B created while A was in flight
false !== true
```

### r3 GREEN

- `completeDesktopSnapshotLoad` 把 null 明确转成 `blocked`；switch/delete 只有拿到并 hydrate 真实目标快照后才进入 `synced`。null 后自动编辑不能跨写，手动 reload 成功后恢复。
- `canManuallySaveDesktopSnapshot` 是自动/手动共享的 phase/path 授权：仅同路径 `synced`/`unsynced` 可保存；`blocked`、`transitioning`、`disabled` 和路径不匹配均不会调用后端 save。
- `workspaceToken` 只表示工作区转换；begin/restore/switch/delete 使旧工作区 timer 失效，内容保存完成不改变 token。
- auto/manual/create 初始保存都捕获实际提交的 snapshot 与 workspace token。成功只能用提交的 A 推进基线，不能在 await 后用 latest B；若期间出现 B，B 与基线 A 指纹不同，pending timer 保留并继续保存。
- 保存完成时若工作区 path/token 已变化，不推进当前基线。

checker 直接执行生产 helper 的 null-load、phase guard、A/B in-flight、create A/B、恢复后编辑以及旧 workspace token 场景。最终专项 checker 与 `npm.cmd run build` 均退出 0；Vite 转换 460 个模块，仅保留既有 chunk 体积警告。

## r4 复审修复：桌面写入单飞串行化

### RED

用可控 deferred promises 复现原 App 的真实调用方式：同一 workspace 的 A 尚未完成时直接启动 B，再让 B 先完成、A 后完成。首次执行观察到两个后端写入同时在途：

```text
AssertionError [ERR_ASSERTION]: desktop snapshot writes must be single-flight
2 !== 1
```

该时序会使磁盘最终从 B 回退到 A，且两个 completion 依次推进状态后，baseline 同样回退到 A。

### GREEN

- 新增生产 `createDesktopSnapshotSaveCoordinator`，对桌面快照写入执行全局单飞；任意时刻最多一个后端 save。
- A 在途时到来的 B 保留为 queued；B/C 连续到来时合并为最新 C，写入顺序为 A→C。被合并的手动/自动调用方共同等待实际提交 C 的完成结果，后端错误则正确 reject 对应 waiters。
- 同 workspace、同快照指纹的手动/自动请求加入同一在途或 queued job，不产生重复磁盘写入。
- workspace path/token 激活变化会取消旧 workspace queued job；已在途旧 path 可完成，但 App 的 path/token guard 不允许它推进新 workspace 状态。新 workspace 写入等待旧在途调用 settle 后才启动。
- 单次 writer 失败不会毒化队列：较新的 queued snapshot 继续执行，后续显式重试也可正常启动。
- App 的 auto、manual、create 初始保存全部通过同一个 coordinator 实例；所有 sync-state 转移通过统一 setter 同步 coordinator 的 workspace key，没有保留直接 `saveSnapshotToDesktop(...)` 旁路。

专项 checker 直接执行生产 coordinator，覆盖最大并发 1、A→B 顺序与最终磁盘/baseline、B/C 合并及手动 completion、旧 workspace queue 取消、跨 workspace 串行、失败后继续与重试。

### r4 提交边界

- `src/modules/persistence/desktopSnapshotSync.ts`、`scripts/check-video-production-schema.mjs` 与本报告可安全隔离提交。
- `src/app/App.tsx` 是任务开始前已存在大量其他改动的共享脏文件；r4 仅加入 coordinator 实例、统一 sync-state setter 和三个保存入口接线，保持未暂存，由集成者连同共享改动处理。
- 未执行 reset、checkout 或 clean；未开始 Task 4。
