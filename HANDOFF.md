# Plums 工程状态

核对日期：2026-10-18（Asia/Shanghai）。[整体路线](docs/spec/total.md)维护能力依赖与门槛，[当前阶段](docs/spec/milestone.md)维护正在执行的工作，[验证索引](evidence/RESULTS.md)区分当前交付、开发增量和历史结果。

## 当前实现

App 负责启动，Workbench 以具名 props 组合工作区、外观、导航、授权和管理；useExtensionManager 持有管理页选择、模态和反馈接线，useExtensionState 持有扩展状态并串行动作，表单草稿留在弹窗，extension-actions 执行安装、卸载、组合与配置流程。Runtime 提供稳定服务和只读启动初值。公开 View.chrome 提供标题、上下文侧栏和实体导航；布局、页面、主题与业务通过公开契约挂载，入口见[架构](docs/ARCHITECTURE.md)。

默认 Agent 使用本地文本服务，支持角色导入、关注和多会话。零角色显示欢迎页；桌面已有角色未选择时显示品牌占位。管理页固定页头并保留业务草稿；弹窗保留悬停反馈和键盘焦点，视觉约定见[UI](docs/UI.md)。

宿主偏好、安装路径、主题、Agent/会话和组合共用串行 host.shell 快照；文本工作台使用自身命名空间。权限会话内确认，未知写入回执锁住继续修改，坏数据保留；状态上限 64 KiB。

[DeepSeek 扩展](docs/DEEPSEEK.md)已通过公开 text.transform 接入现有 Agent 消费者的隔离测试。[通用绑定与原生凭据管理](docs/CREDENTIAL-BINDINGS.md)已接入开发版，两端原生输入/取消和非秘密网络配置有受验结果。绑定默认指向官方 API、直连，支持明确保存 HTTP(S) 代理；用于传输的秘密读取/注入、发送授权、受限传输和真实调用未完成。当前交付包仍使用本地服务，真实调用前确认对应范围，密钥由账户所有者在原生入口录入。

防御性编程收敛（开发分支增量，未替换交付包）：文档/凭据初始化失败与“平台不支持”分开并在启动提示与管理区域显示原因；桌面窗口外观失败回传前端；Android 录入对话框的 AlertDialog 创建/显示失败按 `unavailable` 恢复旧记录并记录 logcat 类名（EditText 构建与窗口标志仍在捕获范围外）；凭据管理 `unavailable` 与 `unknown` 分档；视图失败不再写入空布局；诊断吞错与扩展启用 waiting 可观察；激活超时区分可重试；页面回滚保留原始错误；E2E 默认隔离服务、边界空集合失败、固定等待替换。证据与未验项见[验证索引](evidence/RESULTS.md)。

阶段 E 状态所有权与门禁收敛（2026-10-17，提交 `c1624d5`，未替换交付包）：主题动作只写主题字段，布局动作只写 layout，组合保存只写 composition 与 layout，修复保存排队时旧主题回写导致界面与持久化分叉；Rust 状态写入每次使用唯一临时文件，崩溃残留不再阻塞写入，也不会提交其他写入者的文件；平台状态拒绝文案映射为中文；Tauri 命令清单合并为一份；边界检查按层覆盖 SDK、宿主、外壳与扩展并禁止引用业务模块。证据与未验项见[阶段 E 证据](evidence/OWNERSHIP-GATES-2026-10-17.md)。

## 工程基线与门禁

当前开发分支为 `refactor/hardening`，阶段 E 提交 `c1624d5`（父提交 `1cb3b61`，源码快照 `e7ad6570…`、310 文件）；计划文档随后单独提交，基线标签尚未建立。`main` 停在 `9c05356`（`ui-baseline-2026-10-17`）。`release/mac` 与 `release/android` 两包仍绑定 `9c05356` 加 source.patch，未包含 hardening、凭据与阶段 E 增量，因此当前源码与交付包不同源。已完成维护阶段与结果入口见[阶段归档索引](docs/spec/archive/README.md)。

统一门禁为 `npm run verify:web`（构建、单元、格式、项目/导入边界、行数、ESLint）与 `npm run verify:native`（Rust 格式、Clippy、单元）；浏览器回归另用 `npm run verify:e2e`。阶段 E 工作区结果为 517 单元、121 浏览器用例、默认 30 与实验特性 36 个 Rust 单元通过，Web 门禁、两种特性 Clippy 与 nightly rustfmt 通过；stable `native:fmt` 因工具链缺 rustfmt 未执行，Android 未编译，Mac 原生窗口未复启，TS/TSX Hooks lint 仍未覆盖。不能写成当前源码已通过 `verify:native` 或两端原生验收。

下一步按[当前阶段](docs/spec/milestone.md)先做 M2.0 重新基线：分别提交阶段 E 与计划文档、打基线标签、在标签上重跑 Web/E2E/Rust、构建并实际启动 Mac/Android 候选、更新证据。随后执行[工程前置](docs/spec/milestone.md#m20-后的工程前置)：边界允许名单与 Agent 业务移出外壳先于 M2.1，IPC 契约单一来源先于 M2.3 新增原生命令；未排期事项见[整体计划](docs/spec/total.md#计划决策与风险)。

## 交付与恢复

| 平台 | 当前入口 | 来源与范围 |
| --- | --- | --- |
| Mac arm64 | release/mac/Plums M1.app | 0.0.4 debug，临时签名；绑定 `9c05356` 加 source.patch；当前弹窗/启动/管理路径见验证索引 |
| Android ARM64 | release/android/plums-m1-0.0.4-android-arm64-debug.apk | 同源 0.0.4 debug，限定 Android API36 ARM64 模拟器；绑定 `9c05356` 加 source.patch |

交付源码为 `9c05356`（ui-baseline-2026-10-17）加各目录 source.patch；build-info.json 和 acceptance.json 保存来源、校验与验收范围。后续开发增量在 `9d025b3` 及之后的 hardening 提交中，尚未替换 release。恢复 release 前核对原包布局和证据，使用隔离数据；二进制恢复不回滚应用数据。

旧包与历史材料位于 `.cache/archive/`，INDEX.json 和 README.md 保存清单与恢复方法；后续自动归档的旧平台目录位于 releases。原始材料、构建缓存和 `.dev-data/` 保持本地，具体受验路径由各证据记录提供。

## 后续范围

先完成 M2.0 重新基线与工程前置，再按 M2.3 平台能力切片（TLS/秘密/授权/受限传输/真实连接器）推进；M2.1 契约闭合与 M2.2 作者/UI 开放并行反馈。M2.4 完成 iOS 最小实验、Android 真机和稳定 SDK 后才退出 M2。Android 真机/其他配置、iOS 真机、Windows/Linux、正式分发、长期后台、强隔离和完整事务恢复由整体路线维护。可信 ESM 与宿主共享 WebView，权限 UI 不构成安全沙箱。
