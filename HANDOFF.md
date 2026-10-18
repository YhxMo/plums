# Plums 工程状态

核对日期：2026-10-19（Asia/Singapore）。[整体路线](docs/spec/total.md)维护能力依赖与门槛，[当前阶段](docs/spec/milestone.md)维护正在执行的工作，[验证索引](evidence/RESULTS.md)区分当前交付、开发增量和历史结果。

## 当前实现

App 从 application 装配默认业务组合，通用 bootShell 接收组合定义；Agent 恢复、保存接线和诊断归业务提供者与应用 feature。Workbench 组合工作区、外观、导航、授权和管理，Runtime 提供稳定服务和只读启动初值。公开 View.chrome 提供标题、上下文侧栏、实体导航及可选工作区返回；布局、页面、主题与业务通过公开契约挂载，入口见[架构](docs/ARCHITECTURE.md)。

默认 Agent 使用本地文本服务，支持角色导入、关注和多会话。零角色显示欢迎页；桌面已有角色未选择时显示品牌占位。管理页固定页头并保留业务草稿；弹窗保留悬停反馈和键盘焦点，视觉约定见[UI](docs/UI.md)。Agent 详情以气泡列出所用扩展并可跳转选中；扩展经 `ctx.shell.publishUsers` 公布使用者，管理页沿依赖链显示，宿主不理解业务含义。

宿主偏好、安装路径、主题和组合沿用串行 host.shell 快照，通用外壳保留不透明业务字段；Agent/会话与文本工作台各用自身命名空间，旧 `host.shell.agents` 首启迁移一次。Agent 数据损坏只使 `agents.local` 失败，不阻断启动。不提供 Agent 的组合也可启动、管理、保存和恢复。权限会话内确认，未知写入回执锁住继续修改，坏数据保留；状态可按 `key` 分片，每片上限 64 KiB，Agent 会话各占一片。

[DeepSeek 扩展](docs/DEEPSEEK.md)已通过公开 text.transform 接入现有 Agent 消费者的隔离测试。[通用绑定与原生凭据管理](docs/CREDENTIAL-BINDINGS.md)已接入开发版，两端原生输入/取消和非秘密网络配置有受验结果。绑定默认指向官方 API、直连；代理配置可保存但当前不用于发送。R4 最小安全集（原生注入、首次发送确认、受限传输、取消）已在源码实现并接入生产适配器，DeepSeek 进入目录但默认不启动；Mac debug 包已完成一次真实调用，Android 待执行。当前交付包仍是 R4 之前的版本，真实调用前确认范围，密钥由账户所有者在原生入口录入。

开发候选已实现 Android Back 层级：IME、顶层菜单/弹窗、管理页、工作区、系统根层。管理与列表往返保留草稿，嵌套关闭和列表返回恢复焦点。P6 允许名单覆盖未知模块、父目录入口及间接 SDK 依赖；P1/P6/P7 的失败反例、审查与验证见[工程前置证据](evidence/ENGINEERING-PREREQUISITES-2026-10-18.md)。P2 已将 Rust 实际命令/DTO 与生成的 TS 契约绑定，生产调用使用类型入口，状态拒绝按稳定错误码呈现；默认与实验桥接分别登记。

已纳入交付的防御性编程与状态所有权改动分别见[阶段 H](docs/spec/archive/H-defensive-hardening-2026-10-17.md)和[阶段 E](docs/spec/archive/E-ownership-gates-2026-10-17.md)，不在当前交接重复执行历史。

M2.3.1 的独立 Mac/Android TLS 候选及 Android JNI 假字节实验已限定通过，继续首选 Rust 路线；正式 Android 验证器不读取应用测试根，受控正例改用上游官方测试 companion。OS 证书吊销/根获取的独立联网边界成为 M2.3.4 前置门槛，证据与未验范围见[TLS/JNI 实验](evidence/TLS-JNI-FEASIBILITY-2026-10-18.md)。默认应用源码、真实秘密路径和 release 未因此更新。

## 工程基线与门禁

当前交付基线为 `m2-baseline-2026-10-18`（`015ac2d`），M2.0 限定验收完成。开发源码为 `a307648` 上的工程前置增量，与 release 分开记录；源码清单和旧包恢复入口见[重新基线证据](evidence/BASELINE-2026-10-18.md)。

基线交付的 Web 517 单元、浏览器 121 项与 Rust 格式/Clippy/30 单元通过；两端原生范围见基线证据。集成开发增量最终通过 584 单元、129 浏览器、Rust 默认 33 单元与格式/Clippy/契约漂移检查；实验特性另有 39 单元通过。Android 普通候选实测状态 IPC、稳定拒绝/冲突保留及完整返回/焦点路径。首次失败与定向复验单列于工程前置证据。中文 IME 组合输入、真机与其他平台仍有未验范围。TS/TSX 与 React Hooks lint 已随 TypeScript 6.0.3 恢复。

应用构建的闲置 Rust/Gradle 中间产物已清理；TLS/JNI 实验使用独立 `.cache/m2-3-1/`，首次应用原生编译仍会重新生成缓存；目录保留与清理边界见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

正在执行的负责人、验收和后续顺序见[当前阶段](docs/spec/milestone.md)；M2 整体仍未退出。

## 交付与恢复

| 平台 | 当前入口 | 来源与范围 |
| --- | --- | --- |
| Mac arm64 | release/mac/Plums M1.app | 0.0.4 debug、ad-hoc 签名；绑定 015ac2d，source.patch 为空 |
| Android ARM64 | release/android/plums-m1-0.0.4-android-arm64-debug.apk | 同源 debug；API36 ARM64 模拟器限定验收 |

build-info.json 与 acceptance.json 保存来源和验收范围。旧包保留于 `.cache/archive/releases/mac-Eyjl1K/mac` 与 `.cache/archive/releases/android-TcFWvt/android`；恢复不自动回滚应用数据。完整摘要和限制见[基线证据](evidence/BASELINE-2026-10-18.md)。

## 后续范围

2026-10-18 全项目审阅后转为**真实路径优先**：先恢复 TS/TSX lint、修复默认 Agent 绕过公开契约与边界门禁漏洞、按会话分片存储并限制单实例，再以最小安全集接通真实模型调用，最后清理生产包中的诊断与示例。R1–R3 已完成；R4 已在 Mac 与 Android 模拟器完成真实调用；R5 已让发布包只含内置文本工作台、大写服务与 DeepSeek 连接，诊断与故障注入只在开发构建出现，传输实验已删除。第 7 步（外部作者写扩展）进行中：打包应用已可导入单文件扩展，作者入门见 [AUTHOR-QUICKSTART](docs/AUTHOR-QUICKSTART.md)。工作包见[当前阶段](docs/spec/milestone.md)；日常流程见 [AGENTS](AGENTS.md)，证据只在交付候选与阶段退出时记录。

M2.4 完成 iOS 最小实验、Android 真机和稳定 SDK 后才退出 M2。开放扩展市场前须先完成按扩展隔离与来源签名，见[整体计划](docs/spec/total.md#支持范围与未决项)。可信 ESM 与宿主共享 WebView，权限 UI 不构成安全沙箱。
