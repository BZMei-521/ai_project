# Unity 空间预演试验

隔离分支：`codex/unity-previs-prototype`。独立 Windows 原型，不替换正式 Storyboard Pro，不触发 AI 生成。

## 打开与操作

本机已构建程序：

`C:\Users\Administrator\Desktop\小说\应用项目\Unity预演试验-20260826\Builds\StoryboardPrevis.exe`

- 顶部切换「容器内撑掌」「桌后持杯」。两套 JSON 数据使用同一个场景构建器。
- 左侧选择实体，调整根位置、根旋转；选择人体后可逐关节调整局部旋转。下方可调整镜头位置、目标、FOV、接触目标点和容差。左栏可滚动。
- 「检查空间与接触」检查包含关系、接触距离、接触点是否在镜头内。预检通过仍需人工查看画面。
- 「保存新版本 JSON」生成独立目录；路径自动填入输入框，可点击「读取 JSON」重新打开。保留原始输入 sidecar，并检查来源一致。
- 「导出控制图」先检查，再创建新目录。旧导出不会覆盖；任何编辑都需要重新导出。失败留下的不完整目录不会通过导入验证。

项目、缓存、截图及导出均位于上面的应用项目目录，代码仓库只存源代码。

## 已实现的范围

RH/Y-up/米制 JSON 边界；Unity 侧统一反射 Z 和四元数。程序构建 box/sphere/capsule/cylinder 部件、父子局部关节、骨段、手指及接触附件。

导出同镜头 color、线性眼空间 depth（近白远黑）、RH view normal、每实体可见遮罩和隔离图、人体 body18、双手 hand21、接触诊断图、投影关节和预检报告。manifest 最后写入，包含编码、尺寸、SHA-256；Node 检查路径、PNG、哈希、完整性及预期场景新鲜度后才组装现有 layered control pack。编码 sidecar 随包保留，不声称自动兼容所有下游模型。

主体遮挡使用真实深度测试。关节控制图包含投影可见性诊断；接触图依据实际附件点与目标点绘制。灰模不提供人物身份一致性保证。

## SceneStage 适配边界

`scripts/lib/unity-previs/stage-adapter.mjs` 是受限适配 API，尚未接入工作台 UI。显式指定 snapshotId、cameraId、原始 stageDigest。只支持 RH/Y-up/metre、零原点、forward `[0,0,-1]`、metric scale、empty_stage，以及显式声明角色且可见的 box/sphere/capsule；不支持已有 rig、subject pose、约束、panorama、mesh/GLB。

反向仅允许根变换和相机位置/目标/FOV/near/far，保留原始数据中的其他字段；其他编辑必须拒绝，不能默默丢弃。完整人体姿态目前通过本原型的交换 JSON 保存/恢复，不代表已经迁移正式角色系统。

## 重建与检查

本机 Unity：`C:\Program Files\Unity\Hub\Editor\2022.3.62f1c1\Editor\Unity.exe`。仅用内置模块，无第三方资产。关闭此原型程序后，在试验 worktree 执行：

```powershell
& .\integrations\unity-previs\prepare-project.ps1
& 'C:\Program Files\Unity\Hub\Editor\2022.3.62f1c1\Editor\Unity.exe' -batchmode -projectPath 'C:\Users\Administrator\Desktop\小说\应用项目\Unity预演试验-20260826' -executeMethod StoryboardPrevis.PrevisBatch.VerifyAndBuild -logFile 'C:\Users\Administrator\Desktop\小说\应用项目\Unity预演试验-20260826\Logs\verify-build.log'
```

需要 GPU，不加 `-nographics`。检查包括 JSON/坐标/父子关节恢复、无效输入、包含与接触、镜头编辑、遮挡像素、深度顺序、隔离颜色和来源 sidecar。独立程序可用 `-batchmode --previs-smoke -logFile <日志路径>` 自动导出两套场景并退出。

```powershell
node --test scripts/check-unity-previs-contract.mjs scripts/check-unity-previs-adapter.mjs scripts/check-unity-previs-layered.mjs
node scripts/check-spatial-layer-contract.mjs
node scripts/check-spatial-preflight.mjs
node scripts/check-layered-spatial-control-pack.mjs
node scripts/unity-previs.mjs verify <导出目录> <预期场景JSON>
node scripts/import-unity-previs-layered.mjs <导出目录> <预期场景JSON> --write
```

最后一项只新增 `layered-control-receipt.json`（已存在则拒绝覆盖），不提交生成任务。预期场景应来自独立输入/已确认版本；拿导出的 scene.json 自验只能验证内部完整性，不能证明它是最新编辑。

## 尚未验证或实现

没有正式工作台嵌入、完整生产场景迁移、角色模型导入、IK/自动动作、动画时间线或 AI 成图质量验证。深度为 8 位诊断控制图；不是高精度距离资产。接触检查不等于物理求解或全身碰撞检测。两套灰模只能证明通用构建/导出流程，不能证明所有故事场景都能直接转换。

下一步需先由用户确认两套真实预演与控制图，再决定是否接入一条隔离的 AI 生成测试。
