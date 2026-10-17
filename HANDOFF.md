# Plums 工程状态

核对日期：2026-10-17（Asia/Shanghai）。[整体路线](docs/spec/total.md)维护能力依赖与门槛，[当前阶段](docs/spec/milestone.md)维护正在执行的工作，[验证索引](evidence/RESULTS.md)区分当前交付、开发增量和历史结果。

## 当前实现

App 负责启动，Workbench 以具名 props 组合工作区、外观、导航、授权和管理；useExtensionManager 持有管理页选择、模态和反馈接线，useExtensionState 持有扩展状态并串行动作，表单草稿留在弹窗，extension-actions 执行安装、卸载、组合与配置流程。Runtime 提供稳定服务和只读启动初值。公开 View.chrome 提供标题、上下文侧栏和实体导航；布局、页面、主题与业务通过公开契约挂载，入口见[架构](docs/ARCHITECTURE.md)。

默认 Agent 使用本地文本服务，支持角色导入、关注和多会话。零角色显示欢迎页；桌面已有角色未选择时显示品牌占位。管理页固定页头并保留业务草稿；弹窗保留悬停反馈和键盘焦点，视觉约定见[UI](docs/UI.md)。

宿主偏好、安装路径、主题、Agent/会话和组合共用串行 host.shell 快照；文本工作台使用自身命名空间。权限会话内确认，未知写入回执锁住继续修改，坏数据保留；状态上限 64 KiB。

[DeepSeek 扩展](docs/DEEPSEEK.md)已通过公开 text.transform 接入现有 Agent 消费者的隔离测试。[通用绑定与原生凭据管理](docs/CREDENTIAL-BINDINGS.md)已接入开发版，两端原生输入/取消和非秘密网络配置有受验结果。绑定默认指向官方 API、直连，支持明确保存 HTTP(S) 代理；实际秘密读写、请求授权与受限传输待完成。当前交付包仍使用本地服务，真实调用前确认对应范围，密钥由账户所有者在原生入口录入。

## 工程基线与门禁

阶段 A、B、C1–C4 与文档整理 D 已完成，任务范围、结果与证据入口见[阶段归档索引](docs/spec/archive/README.md)。原 UI 回退标签 `ui-baseline-2026-10-17` 指向 `9c05356`。开发分支为 `refactor/hardening`，当前状态以实际提交为准。

统一门禁为 `npm run verify:web`（构建、单元、格式、项目/导入边界、行数、ESLint）与 `npm run verify:native`（Rust 格式、Clippy、单元）；浏览器回归另用 `npm run verify:e2e`。原生 `native:check` 与 27 个 `native:test` 用例在 macOS arm64 通过；`verify:native` 因 stable 工具链缺少 rustfmt 未完成组合验证。TypeScript 与 ESLint 的兼容缺口及检查覆盖见[开发流程](docs/DEVELOPMENT.md#验证入口)。

原生窗口、普通应用包、Android 模拟器/真机及其他平台未因后续开发变更重验。

## 交付与恢复

| 平台 | 当前入口 | 来源与范围 |
| --- | --- | --- |
| Mac arm64 | release/mac/Plums M1.app | 0.0.4 debug，临时签名；当前弹窗/启动/管理路径见验证索引 |
| Android ARM64 | release/android/plums-m1-0.0.4-android-arm64-debug.apk | 同源 0.0.4 debug，限定 Android API36 ARM64 模拟器 |

交付源码为 `9c05356`（ui-baseline-2026-10-17）加各目录 source.patch；build-info.json 和 acceptance.json 保存来源、校验与验收范围。后续开发增量已保存于 `9d025b3` 工程基线及后续阶段提交，尚未替换 release。构建、候选验收和发布使用[交付流程](docs/DEVELOPMENT.md#本地交付目录)。

旧包与历史材料位于 `.cache/archive/`，INDEX.json 和 README.md 保存清单与恢复方法；后续自动归档的旧平台目录位于 releases。恢复前核对原包布局和证据，使用隔离数据；二进制恢复不回滚应用数据。原始材料、构建缓存和 `.dev-data/` 保持本地，具体受验路径由各证据记录提供。

## 后续范围

受限网络、实际秘密存储和真实连接器验收按当前阶段继续。M2 整体与稳定 SDK 尚未完成；Android 真机/其他配置、iOS、Windows/Linux、正式分发、长期后台、强隔离和完整事务恢复由整体路线维护。可信 ESM 与宿主共享 WebView。
