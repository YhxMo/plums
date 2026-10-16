# Plums 工程状态

核对日期：2026-10-17（Asia/Shanghai）。窗口与宿主重构源自提交 `97c9818` 上的本次收敛实现；下一阶段以保存该实现的本地 Git 提交为候选基线，执行前核实 HEAD 与工作区差异。能力路线由 [整体计划](docs/spec/total.md) 维护，当前执行与门槛由 [阶段计划](docs/spec/milestone.md) 维护；版本与平台结果从 [验证索引](evidence/RESULTS.md) 查阅。

## 当前实现

App 负责启动，Workbench 装配工作区、外观、导航、授权和管理；表单状态归扩展管理。工作区通过可选 View.chrome 发布会话标题、上下文和默认详情，按视图代处理异常，导航匹配实体类型，默认详情与上下文侧栏互斥。入口与状态所有权见 [架构](docs/ARCHITECTURE.md#当前前端的状态所有权)。

默认 Agent 只执行本地文本业务。桌面未选中角色时显示原品牌、导入角色卡／安装扩展双卡片和次要添加入口；手机按已有列表／会话／零角色欢迎切换。管理页隐藏业务区时保留挂载及草稿，顶栏和详情的字号、间距、颜色继续使用 [UI 约定](docs/UI.md)。

宿主偏好、安装路径、主题、Agent／会话和组合共用串行 host.shell 快照；文本工作台使用自身命名空间。权限会话内确认，不随组合自动授予。未知写入回执锁住继续修改，坏数据保留；64 KiB上限和精确版本规则不变。

## 使用、交付与恢复

- Mac 当前入口：`release/mac/Plums M1.app`。执行 `npm run release:mac` 更新；同目录 build-info.json 和 source.patch 记录产物与源码。
- Android 当前入口：`release/android/plums-m1-0.0.4-android-arm64-debug.apk`，仍为2026-10-16的受验版本；Mac更新不代表Android当前源码通过。
- 本次历史包、原始实验和清理清单在 `.cache/archive/INDEX.json`；后续 `release:mac` 自动归档位于 `.cache/archive/releases/`，以命令输出定位。恢复说明在归档根 README.md；源码版本化证据继续在 evidence，已完成计划继续在 docs/spec/archive。
- 当前验证材料在 `.cache/current/`；运行数据留在 `.dev-data/`。Cargo、npm、Android构建缓存和正在使用的模拟器目录保留。PID、临时操作脚本及旧候选路径不作为当前工程入口。

Android复用现有工具链与受控生成工程，见 [Android工程](docs/ANDROID.md)。默认界面、非聊天工作台与独立作者接入各自消费公开契约；完整操作和验证入口见 README、SDK与子系统文档。

## 验证与未完成范围

当前交付和精简检查以 [项目收敛记录](evidence/RELEASE-2026-10-17.md) 为准。此前的 [宿主重构](evidence/SHELL-ARCHITECTURE-2026-10-17.md) 和 [欢迎页修复](evidence/WELCOME-2026-10-17.md) 保留各自源码与平台结果，不拼成其他平台结论。

当前阶段“当前版本双端验收与生产能力准备”的[计划](docs/spec/milestone.md)已复核并获执行授权，由新会话从固定候选与验证范围开始。已完成的项目收敛和Mac交付单独[归档](docs/spec/archive/M2-project-consolidation-2026-10-17.md)；宿主窗口与扩展管理的剩余验收继续留在当前计划。

M2整体、SDK稳定、原生外部上下文贡献替换、完整原生窗口操作及辅助技术仍未退出。Android真机／其他配置、iOS、Windows/Linux与正式分发继续待验；生产网络／凭据、长期后台、强隔离、事务升级、多跳迁移和崩溃一致性尚未完成。可信ESM共享WebView，不构成恶意代码沙箱。
