# Plums 工程状态

核对日期：2026-10-17（Asia/Shanghai）。[整体路线](docs/spec/total.md)维护能力依赖与门槛，[当前阶段](docs/spec/milestone.md)维护正在执行的工作，[验证索引](evidence/RESULTS.md)区分当前交付、开发增量和历史结果。

## 当前实现

App 负责启动，Workbench 以具名 props 组合工作区、外观、导航、授权和管理；useExtensionManager 持有管理页选择、模态和反馈接线，表单草稿留在弹窗，extension-actions 执行安装、卸载、组合与配置流程。公开 View.chrome 提供标题、上下文侧栏和实体导航；布局、页面、主题与业务通过公开契约挂载，入口见[架构](docs/ARCHITECTURE.md)。

默认 Agent 使用本地文本服务，支持角色导入、关注和多会话。零角色显示欢迎页；桌面已有角色未选择时显示品牌占位。管理页固定页头并保留业务草稿；弹窗保留悬停反馈和键盘焦点，视觉约定见[UI](docs/UI.md)。

宿主偏好、安装路径、主题、Agent/会话和组合共用串行 host.shell 快照；文本工作台使用自身命名空间。权限会话内确认，未知写入回执锁住继续修改，坏数据保留；状态上限 64 KiB。

[DeepSeek 扩展](docs/DEEPSEEK.md)已通过公开 text.transform 接入现有 Agent 消费者的隔离测试。[通用绑定与原生凭据管理](docs/CREDENTIAL-BINDINGS.md)已接入开发版，两端原生输入/取消和非秘密网络配置有受验结果。绑定默认指向官方 API、直连，支持明确保存 HTTP(S) 代理；实际秘密读写、请求授权与受限传输待完成。当前交付包仍使用本地服务，真实调用前确认对应范围，密钥由账户所有者在原生入口录入。

## 工程基线与门禁

开发增量的完整本地基线为 `9d025b3`，分支 `refactor/hardening`；实现、测试和文档分别保存在 `bc962ac`、`9345223`、`9d025b3`。该基线包含开工前已有的凭据、连接器、UI 修复与交付脚本增量，原 UI 回退标签 `ui-baseline-2026-10-17` 继续指向 `9c05356`。

阶段 A 已完成，门禁实现提交为 `17cc97d`，收尾状态提交为 `4bf42a6`，独立审查无剩余 P1/P2；[阶段计划已归档](docs/spec/archive/A-hardening-2026-10-17.md)。

阶段 B 已完成并提交为 `0e80dcd`（34 文件），父基线为 `4bf42a6`：boot 拆为解析、保存和安装边界，226 行降到 63 行，Runtime 类型形状保持；共用校验 61 行，保留提示从 12 处到 1 处，目标 typeof 检查从 35 处到 7 处。提交前重跑 Web 门禁，43 文件／433 单元及全部检查通过，提交后工作区干净。Chrome 全量 117／117 通过；其后错误字典修复另有 6 条定向回归，正常映射未变。独立审查的两项 P2 均已修复并复核关闭，无剩余问题；[阶段已归档](docs/spec/archive/B-runtime-validation-2026-10-17.md)。实际范围与红绿证据见[阶段 B 验证](evidence/RESULTS.md#阶段-b启动保存与校验边界)。

C1 已完成并提交为 `ee4ff82`，以 `0e80dcd` 和干净工作区开工：组合文件 554 → 210 行，弹窗、模态状态、角色卡草稿和焦点各自归属，Agent 与外壳复用 useAsyncAction。新增模块导入测试先因模块级 matchMedia 失败，移入 useMediaQuery 后通过。该版 Web 门禁 44 文件／434 单元及全量 Chrome 117／117 通过；手机浅色和桌面深色的实际渲染、取消草稿、焦点返回及媒体切换通过，独立审查无 P1/P2/P3。范围与结果见 [C1 归档](docs/spec/archive/C1-agent-workspace-2026-10-17.md)及[验证证据](evidence/RESULTS.md#c1agent-工作区职责拆分)。

C2 已完成并提交为 `f5f78e1`，以 `ee4ff82` 和干净工作区开工：先核对 class 使用方和复合选择器，再将 951／680 行的两个 CSS module 拆为七个 145–332 行文件；选择器与声明保持，更新 TSX 样式引用及行数棘轮。Web 门禁 44 文件／434 单元、Chrome 全量 117／117 通过；375／1180px 双主题的 48 个状态对照中，所测计算样式和元素几何无差异。独立审查无 P1/P2/P3，实际范围见 [C2 证据](evidence/RESULTS.md#c2按使用方拆分样式)与[阶段归档](docs/spec/archive/C2-styles-2026-10-17.md)。

C3 以 `f5f78e1` 和干净工作区开工，源码、测试和本记录纳入同一次 C3 本地提交：新增 extension-actions 与 controllers 的窄 props，拆出管理页控制 Hook、列表／操作／弹窗和诊断／恢复区；ExtensionManager 从 294 降到 66 行，Workbench 对象透传从 5 处降到 0 处。新增测试先因目标模块不存在而加载失败，完成抽取后 15／15 通过；完整 Web 门禁 45 文件／449 单元及 Chrome 117／117 通过。375／1180px 双主题的 20 个管理／弹窗状态逐节点对照零差异，20 张截图一致；独立审查无 P1/P2/P3。运行范围与失败顺序见 [C3 证据](evidence/RESULTS.md#c3扩展操作与组件依赖)及[阶段归档](docs/spec/archive/C3-extension-actions-2026-10-17.md)。runtime 可变字段仍由原对象持有，原生门禁、窗口与普通包本次未重验。C3 在此停止，C4–C6 未开始。

阶段 A 新增统一入口 `npm run verify:web`（构建、单元、格式、项目/导入边界、行数、ESLint）、`npm run verify:native`（Rust 格式、Clippy、单元）及组合命令 `npm run verify`；浏览器另用 `npm run verify:e2e`。Web 门禁通过，40 文件/358 单元、ESLint 0 错误/0 警告；浏览器回归 117 项通过。最终结果与独立审查见[阶段证据](evidence/RESULTS.md#阶段-a安全网与基线)。

原生 `native:check` 与 27 个 `native:test` 用例在 macOS arm64 通过；`verify:native` 因 stable 工具链缺少 rustfmt 在格式步骤失败，格式及原生组合门禁未验证。未重新验收原生窗口、普通应用包、Android 真机或其他平台。

TypeScript 7.0.2 超出 typescript-eslint 8.71.2 的 peer 范围，未强装解析器。ESLint 当前覆盖 JS/MJS/JSX；TS/TSX 由构建类型检查和复用现有 TypeScript AST 的导入边界检查覆盖，React Hooks lint 尚未覆盖 TS/TSX。Web 门禁为 check:project 传入 --boundaries；普通项目检查仍只需 Node，AST 检查需已安装的锁定工具链。命令范围见[开发流程](docs/DEVELOPMENT.md#验证入口)，本期证据见[验证索引](evidence/RESULTS.md)。

## 交付与恢复

| 平台 | 当前入口 | 来源与范围 |
| --- | --- | --- |
| Mac arm64 | release/mac/Plums M1.app | 0.0.4 debug，临时签名；当前弹窗/启动/管理路径见验证索引 |
| Android ARM64 | release/android/plums-m1-0.0.4-android-arm64-debug.apk | 同源 0.0.4 debug，限定 Android API36 ARM64 模拟器 |

交付源码为 `9c05356`（ui-baseline-2026-10-17）加各目录 source.patch；build-info.json 和 acceptance.json 保存来源、校验与验收范围。后续开发增量已保存于上述工程基线，尚未替换 release。构建、候选验收和发布使用[交付流程](docs/DEVELOPMENT.md#本地交付目录)。

旧包与历史材料位于 `.cache/archive/`，INDEX.json 和 README.md 保存清单与恢复方法；后续自动归档的旧平台目录位于 releases。恢复前核对原包布局和证据，使用隔离数据；二进制恢复不回滚应用数据。原始材料、构建缓存和 `.dev-data/` 保持本地，具体受验路径由各证据记录提供。

## 后续范围

受限网络、实际秘密存储和真实连接器验收按当前阶段继续。M2 整体与稳定 SDK 尚未完成；Android 真机/其他配置、iOS、Windows/Linux、正式分发、长期后台、强隔离和完整事务恢复由整体路线维护。可信 ESM 与宿主共享 WebView。
