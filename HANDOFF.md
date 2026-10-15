# Plums 工程状态

核对时间：2026-10-15 11:33 UTC。交接更新前基线为 `main` @ `3d9601b1805d6976efd0f26cf14edb14bb641027`，核对时工作区干净；交接提交后的版本以本地 Git HEAD 为准。未推送或部署。

## 当前状态与缺口

Mac 最小原型实现与独立定向审查完成。当前包括 Tauri 2 / React / Rust 外壳、公开实验 SDK、本地 ESM 加载、服务提供者与有状态消费者、默认/画布/故障布局，以及权限、取消、资源释放和原生状态路径；实现入口见[架构](docs/ARCHITECTURE.md)、[扩展契约](docs/EXTENSION-CONTRACTS.md)与[M1 证据](evidence/RESULTS.md)。

Android 已在单一 API 36 / ARM64 模拟器完成随包加载、授权、保存、替换/停用、拒绝/恢复、触控取消、后台短任务和冷启动恢复；原生 Insets 修正通过限定独立复核。修正仍只在隔离生成工程的 MainActivity，主项目运行实现未改。独立复现与自验的具体划分见[模拟器记录](docs/M1-EXPERIMENTS.md#android-模拟器运行记录)，不等于真机或全 Android 验收。

提供者选择和整套组合配置尚不持久化；完整状态迁移、写入中断恢复及凭据服务未完成。Windows/Linux 无实际原生运行证据，完整 A11 五端验收与长期后台等后续范围见[路线图](docs/ROADMAP.md)和[原型限制](docs/M1-EXPERIMENTS.md#原型限制)。

## 证据与复现入口

- [M1 证据](evidence/RESULTS.md)保留受验 49 文件源码基线、Mac 包、测试与独立审查范围。本地交付整理仅另改 `.gitignore` 和源码盘点工具以排除根 `release/`；旧测试仍绑定原受验基线。
- Android 构建与运行入口见[M1 实验](docs/M1-EXPERIMENTS.md)。外置实验根 `plums-android-20261015T082500Z/` 的 `runtime-20261015T094547Z/` 保留 `RESULTS.md`、`INDEPENDENT-REVIEW.md`、`environment.sh` 和 `tools/` 下的 `start-emulator.py`、`stop-emulator.py`、`rebuild-candidate.py`；启动保护及使用限制见该目录的 `RESULTS.md`。
- 停止工具的 KO 误报已修正，六项合成回归及真实进程/端口退出验证通过；模拟器已关闭，AVD 保留。结果位于同一运行目录的 `metadata/STOP-TOOL-REGRESSION.json`、`metadata/STOP-TOOL-VALIDATION.json`。交付整理的有限独立审查与提交记录为 `metadata/RELEASE-DELIVERY-CLOSEOUT-3d9601b.json`。

外置 `plums-android` 工具目录已有 Android 工具链、Emulator 37.2.12 和 API 36 ARM64 镜像，无需重新安装。隔离 Insets 前后文件、摘要与重建入口见[保存与复现](docs/M1-EXPERIMENTS.md#隔离-insets-修正的保存与复现)。

## 本地查看产物

仓库根 `release/` 保留 `Plums M1.app` 与 `plums-m1-0.0.1-android-arm64-debug.apk`，均为 0.0.1 / M1 调试原型；版本、用途、受验来源与摘要见同目录 `README.md`、`CHECKSUMS.json`。这些是已校验的交付副本，隔离实验原件保留；更新与旧版本清理见[交付约定](docs/DEVELOPMENT.md#本地交付目录)。

## 新增接续点

整体 UI 优化与正式 Android 工程化尚未开始。接续顺序为核清当前能力与限制、整体 UI 设计，再推进 Android 工程化。

UI 待形成桌面/移动信息架构、设计 token、留白排版和下拉框/弹窗/卡片等统一组件；首条完整体验是进入应用、查看扩展、授权、运行和观察状态。替换边界与现有验收入口见[UI 边界](docs/ARCHITECTURE.md#应用-ui-的扩展边界)和[A12](docs/ACCEPTANCE.md#a12-ui-替换专项路径)。

Android 待决定生成工程保存方式、构建回调入口及 Insets 的正式维护与复现策略，再接入主项目。服务消费/提供、UI 替换及停用恢复已有覆盖可作缺口盘点依据，范围见[M1 证据](evidence/RESULTS.md)和[模拟器记录](docs/M1-EXPERIMENTS.md#android-模拟器运行记录)。

iOS 早期原生实验继续暂缓，完整 Xcode、模拟器与对应 SDK/target 尚未就绪；M1 剩余门槛仍包含该实验及据证据收敛的选型/限制结论。M1 未关闭，M2 未开始，详见[阶段边界](docs/M1-EXPERIMENTS.md#阶段边界与记录)。
