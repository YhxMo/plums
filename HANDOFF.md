# Plums 工程状态

核对日期：2026-10-18（Asia/Shanghai）。[整体路线](docs/spec/total.md)维护能力依赖与门槛，[当前阶段](docs/spec/milestone.md)维护正在执行的工作，[验证索引](evidence/RESULTS.md)区分当前交付、开发增量和历史结果。

## 当前实现

App 负责启动，Workbench 以具名 props 组合工作区、外观、导航、授权和管理；useExtensionManager 持有管理页选择、模态和反馈接线，useExtensionState 持有扩展状态并串行动作，表单草稿留在弹窗，extension-actions 执行安装、卸载、组合与配置流程。Runtime 提供稳定服务和只读启动初值。公开 View.chrome 提供标题、上下文侧栏和实体导航；布局、页面、主题与业务通过公开契约挂载，入口见[架构](docs/ARCHITECTURE.md)。

默认 Agent 使用本地文本服务，支持角色导入、关注和多会话。零角色显示欢迎页；桌面已有角色未选择时显示品牌占位。管理页固定页头并保留业务草稿；弹窗保留悬停反馈和键盘焦点，视觉约定见[UI](docs/UI.md)。

宿主偏好、安装路径、主题、Agent/会话和组合共用串行 host.shell 快照；文本工作台使用自身命名空间。权限会话内确认，未知写入回执锁住继续修改，坏数据保留；状态上限 64 KiB。

[DeepSeek 扩展](docs/DEEPSEEK.md)已通过公开 text.transform 接入现有 Agent 消费者的隔离测试。[通用绑定与原生凭据管理](docs/CREDENTIAL-BINDINGS.md)已接入开发版，两端原生输入/取消和非秘密网络配置有受验结果。绑定默认指向官方 API、直连，支持明确保存 HTTP(S) 代理；用于传输的秘密读取/注入、发送授权、受限传输和真实调用未完成。当前交付包仍使用本地服务，真实调用前确认对应范围，密钥由账户所有者在原生入口录入。

防御性编程收敛（现已纳入 M2.0 基线交付）：文档/凭据初始化失败与“平台不支持”分开并在启动提示与管理区域显示原因；桌面窗口外观失败回传前端；Android 录入对话框的 AlertDialog 创建/显示失败按 `unavailable` 恢复旧记录并记录 logcat 类名（EditText 构建与窗口标志仍在捕获范围外）；凭据管理 `unavailable` 与 `unknown` 分档；视图失败不再写入空布局；诊断吞错与扩展启用 waiting 可观察；激活超时区分可重试；页面回滚保留原始错误；E2E 默认隔离服务、边界空集合失败、固定等待替换。证据与未验项见[验证索引](evidence/RESULTS.md)。

阶段 E 状态所有权与门禁收敛（2026-10-17，提交 `c1624d5`，现已纳入 M2.0 基线交付）：主题动作只写主题字段，布局动作只写 layout，组合保存只写 composition 与 layout，修复保存排队时旧主题回写导致界面与持久化分叉；Rust 状态写入每次使用唯一临时文件，崩溃残留不再阻塞写入，也不会提交其他写入者的文件；平台状态拒绝文案映射为中文；Tauri 命令清单合并为一份；边界检查按层覆盖 SDK、宿主、外壳与扩展并禁止引用业务模块。证据与未验项见[阶段 E 证据](evidence/OWNERSHIP-GATES-2026-10-17.md)。

## 工程基线与门禁

当前基线为 `m2-baseline-2026-10-18`（`015ac2d`），包含阶段 E `c1624d5`。M2.0 限定验收及交付完成；应用源码未改，收尾只更新证据与计划。308 文件清单和旧包恢复入口见[重新基线证据](evidence/BASELINE-2026-10-18.md)。

本次 `verify:web` 517 单元、`verify:e2e` 121 项、安装 stable rustfmt 后的 `verify:native`（格式、Clippy、30 单元）通过。两端普通包实际检查了主题保存/重启、管理与 Agent 恢复、原生凭据取消；Mac 真实拒写保留主题和原状态，Android IME 伸缩与 Back 收键盘通过。Android 管理页系统 Back 退出 Activity（EXIT_SELF）仍是已知缺口，排 P7；TS/TSX Hooks lint、中文 IME 组合输入、真机与其他平台未验。

下一步按[当前阶段](docs/spec/milestone.md)执行 P6 → P1，P2 在新增原生命令前完成，P7 在 M2.2 导航验收前完成；M2 整体仍未退出。

## 交付与恢复

| 平台 | 当前入口 | 来源与范围 |
| --- | --- | --- |
| Mac arm64 | release/mac/Plums M1.app | 0.0.4 debug、ad-hoc 签名；绑定 015ac2d，source.patch 为空 |
| Android ARM64 | release/android/plums-m1-0.0.4-android-arm64-debug.apk | 同源 debug；API36 ARM64 模拟器限定验收 |

build-info.json 与 acceptance.json 保存来源和验收范围。旧包保留于 `.cache/archive/releases/mac-Eyjl1K/mac` 与 `.cache/archive/releases/android-TcFWvt/android`；恢复不自动回滚应用数据。完整摘要和限制见[基线证据](evidence/BASELINE-2026-10-18.md)。

## 后续范围

M2.0 已限定完成，先推进工程前置，再按 M2.3 平台能力切片（TLS/秘密/授权/受限传输/真实连接器）推进；M2.1 契约闭合与 M2.2 作者/UI 开放并行反馈。M2.4 完成 iOS 最小实验、Android 真机和稳定 SDK 后才退出 M2。Android 真机/其他配置、iOS 真机、Windows/Linux、正式分发、长期后台、强隔离和完整事务恢复由整体路线维护。可信 ESM 与宿主共享 WebView，权限 UI 不构成安全沙箱。
