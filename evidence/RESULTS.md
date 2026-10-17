# 当前验证与交付

本页维护当前交付与必要的证据入口。结果绑定各自源码、命令和平台；历史记录从 [历史验收索引](HISTORY.md) 查阅。

## 当前交付

[2026-10-17 弹窗初始焦点修复](DIALOG-FOCUS-2026-10-17.md)记录当前受验源码：关闭按钮默认无框，悬停保留反馈，Tab仍显示焦点环。112 浏览器通过；Mac 普通包与 Android API36 ARM64 模拟器的浅深主题、默认状态、Tab、表单聚焦和关闭返回均已实际验收并经独立审查。同源受验原包进入 release，旧完整目录保留，本小阶段已归档；M2 整体尚未退出。

| 平台 | 当前入口与证据范围 |
| --- | --- |
| Mac arm64 | `release/mac/Plums M1.app`，0.0.4 debug 临时签名；本期弹窗初始/键盘状态、表单与关闭返回限定验收 |
| Android ARM64 | `release/android/plums-m1-0.0.4-android-arm64-debug.apk`，0.0.4 debug；Android 16/API36 ARM64 模拟器、WebView 133.0.6943.137，本期弹窗受影响路径、44px关闭目标 |

两端目录的 build-info.json 与 source.patch 保存来源和交付校验，acceptance.json链接本期范围。[此前启动与管理修复](UI-STARTUP-2026-10-17.md)的274单元/110浏览器及冷恢复结果继续绑定其源码；本期完整浏览器包含这三项回归，未重跑未变的单元/Rust路径。[此前双端完整限定验收](M2-CURRENT-2026-10-17.md)继续绑定其源码和路径，未改 Rust/平台适配的专项证据按各自输入复用。

## 当前本地增量

[DeepSeek 协议扩展](DEEPSEEK-LOCAL-2026-10-17.md)已通过隔离平台的现有 Agent 服务接线、取消、解析失败和切回本地测试；298 项全单元及构建通过，源码经独立审查。该结果对应工作区本地增量，未改 UI 或替换交付包，不代表真实 API、秘密存储或两端原生接入完成。[生产设计](../docs/CREDENTIAL-REQUEST.md#生产接入)和[当前阶段](../docs/spec/milestone.md)继续维护生产适配及真实验收缺口，普通包不开放该能力。

[通用绑定与原生凭据管理](CREDENTIAL-BINDINGS-2026-10-17.md)记录后续工作区增量：329单元、27 Rust单元、117浏览器通过；Mac隔离配置测试包与Android API36 ARM64模拟器完成原生安全输入、取消返回和非秘密代理配置限定验证。系统秘密实际读写、请求授权/受限传输及真实模型调用继续待验，release保持当前UI交付。

## 阶段 A：安全网与基线

2026-10-17，macOS arm64、Node.js 26.5.1、TypeScript 7.0.2。完整开发基线 `9d025b3`，由 `bc962ac`（已有实现，32 文件）、`9345223`（测试，7 文件）和 `9d025b3`（文档与阶段范围，29 文件）依次保存。门禁受验源码为 `17cc97d`，即基线上的工程维护增量：package.json/锁文件、eslint.config.js、check-boundaries/check-size/check-project/project-files、发布脚本未使用导入清理和 hardening 回归；其余应用源码保持基线。后续收尾仅更新本节及状态文档。

新增开发依赖精确固定 eslint 10.13.0、@eslint/js 10.0.1、eslint-plugin-react-hooks 7.1.1，既有锁定包版本未改变。注册表元数据中的 typescript-eslint 8.71.2 要求 TypeScript >=4.8.4 <6.1.0，故保留 TS7，使用 JS ESLint 与独立 TS/TSX/JS/MJS 导入检查。后者复用已锁定 TypeScript 7 的 unstable AST API，以单个内存项目解析真实节点，解析失败拒绝，API 在 finally 关闭；不写入配置、源码或构建产物，不新增解析器依赖。Web 门禁传入 --boundaries，普通项目检查仍保持只需 Node。TS/TSX Hooks lint 暂未覆盖。初次 ESLint 的 4 项问题已通过删除一个未使用导入、补充 Node 定时器全局解决，无大范围禁用。

原生 `npm run native:check` 与 `npm run native:test` 分别通过 Clippy 零警告和 27 个 Rust 单元。`npm run verify:native` 返回失败：stable-aarch64-apple-darwin 缺少 cargo-fmt，格式未验证；其后的检查未由组合命令继续执行，上述两项为独立执行结果。

`npm run test:web -- --workers=4` 在配置的 Chrome 浏览器通过 117 项，使用独立浏览器测试上下文；后续修改仅涉及静态边界检查脚本及其单元。原生窗口、普通包、Android 真机及其他平台未重验，release 未替换，系统秘密与真实连接器未增加验收结论。

`npm run verify:web` 最终通过：构建与 TypeScript 零错误，40 文件/358 单元通过，Prettier、项目/导入边界、行数和 ESLint 全部通过。新增 36 个门禁单元覆盖 400/401 行、旧上限、生成输出排除、私有导入拒绝、公开依赖通过、模板插值、正则文本、TSX、解析失败与 Hooks 规则；边界与行数失败样本在隔离数据中拒绝。ESLint 实际检查 43 个 JS/MJS 文件，0 错误/0 警告，JSX 规则另以内存输入验证。

原有 9 项行数清单之外，还发现 src/styles.css 445、tests/abort-reentrancy.test.ts 441、tests/documents/probe.ts 648、tests/navigation/probe.ts 424、tests/web/agent-flow.spec.ts 696 行；以各自开工行数加入固定清单，不为门禁拆改这些文件。14 项均无超额，剩余额度为 0。

生产与工程源码以项目清单中 tests 之外的 ts/tsx/js/mjs/rs/kt/css/html 物理行计数，原基线为 122 文件/17,586 行，阶段 A 后为 125 文件/17,861 行；测试由 106 文件/15,672 行增至 107 文件/15,838 行，其中 Vitest 40 文件、Playwright 20 文件。其余为平台实验、夹具与测试页面。计数不含生成输出、依赖、JSON、文档和运行数据。

独立审查通过，无剩余 P1/P2；另经实际 --boundaries CLI 的隔离反例及内存批量检查确认类型导入、import = require、重导出、无插值模板路径和多文件解析失败均按预期拒绝，公开 SDK 与普通正则/JSX 文本通过。提交前核对精确暂存内容，未纳入秘密、私人路径或运行产物。阶段 A 退出，阶段 B 未开始。

阶段范围与退出条件见[阶段记录](../docs/spec/archive/A-hardening-2026-10-17.md)，默认命令及 TS/TSX lint 缺口见[开发流程](../docs/DEVELOPMENT.md#验证入口)。

## 阶段 B：启动、保存与校验边界

2026-10-17，macOS arm64、Node.js 26.5.1、TypeScript 7.0.2。开工基线为 `refactor/hardening` 的 `4bf42a6`，工作区干净，先执行 `npm run verify:web`，40 文件／358 用例与全部门禁通过。以下结果覆盖以该提交为父基线的阶段 B 实现、测试和证据，统一纳入本地阶段提交；交付包未替换。

新增 `src/shell/persisted-state.ts`、`persistence.ts`、`extensions.ts` 分别拥有旧偏好解析、串行保存／页面队列和目录安装；`runtime.ts` 只编排。按含函数声明和括号的物理行计数，boot 从 226 降到 63 行；Runtime 类型声明与基线逐字相同。偏好保留 composition、未知字段、旧 layoutIntent 和缺省 pages 的原表示，目录碰撞检查在任何模块安装前执行；坏组合仍携带原快照进入 CompositionRecovery。

新增 `modules/sdk/errors.ts`、61 行零依赖 `validation.ts`；配置、凭据、迁移、组合、主题及恢复校验复用错误码和字段路径。`modules/extension-host/definition.ts` 承接声明校验和加载，原 host 导出路径保留；Host 通过第三个可选回调在配置、激活和清理错误转字符串前映射。等待原因的原英文前缀供诊断助手继续解析，扩展卡片显示时映射为中文。SDK 校验可选保留英文开发诊断；应用原中文提示及标点由 messages.ts 统一生成。Agent／工作台恢复及两个现有显示入口的改动仅用于校验或提示复用；未改 AgentWorkspace、Workbench、CSS、Rust 或公开 SDK index。

失败证据：先新增 `persisted-state.test.ts`、`persistence.test.ts` 并实际运行，36 用例为 22 失败／14 通过。22 项拒绝路径已执行到原 Error，但缺少要求的 code；旧布局、主题和保存语义通过。拆分后的 `npm run verify:web` 为 42 文件／394 用例通过，再实施统一校验。最终共新增 75 个用例，覆盖坏版本／页面／配置／导入、布局与主题兼容、原快照恢复、串行 revision、提交前／后取消、已知未提交重试、未知回执锁存、偏好成功后发布、页面队列、七个错误码、字段路径、诊断兼容及未知错误回退。

最终 `npm run verify:web` 通过：构建／类型、43 文件／433 单元、Prettier、项目／导入边界、文件行数与 ESLint 全绿，ESLint 0 错误／0 警告。`rg -n '原数据已保留' src modules` 从 12 处降到 1 处（messages.ts）；`rg -n 'typeof .* !== "(string|object|number)"' src modules` 从 35 处降到 7 处，其中包含共用校验本身的 2 处，未靠改写比较语法降低计数。Host 从 735 降到 678 行，上限人工降为 678。

浏览器首轮 116／117，唯一失败为旧英文配置诊断定位器；更新中文断言后配置专项 3／3 通过。修复默认诊断及其消费路径后，以 `npm run test:web -- --workers=4` 重跑全量，Chrome 117／117 通过（44.7 秒），包括启动恢复、原数据保留、导入、配置取消／修复、浅深主题与窄屏路径。其后仅为错误字典增加自有属性检查，并新增 6 条定向用例；已核对该单行修复不改变上述正常映射，不重复浏览器全量，修复后的完整 Web 门禁为上述 433 用例。

独立审查共发现两项 P2，均已修复并复核关闭：默认 Host 的缺失 values／布尔值诊断退化为裸错误码，已补齐配置及同类凭据校验的英文 label 和默认 Host 精确回归；错误字典误命中继承属性会返回对象／函数，新增 6 个错误名称用例先得到 6 红／25 绿，再改为只读字典自有属性，最终全部通过。当前无剩余 P1/P2/P3。原生组合门禁、原生窗口、普通包、模拟器／真机及其他平台本阶段未重验；阶段 A 的 cargo-fmt 缺失与 TS/TSX Hooks lint 缺口仍按其原记录保留，不增加通过结论。未触碰实际秘密或外部请求。范围、负责人和退出结果见[阶段归档](../docs/spec/archive/B-runtime-validation-2026-10-17.md)。

## C1：Agent 工作区职责拆分

2026-10-17，macOS arm64、Node.js 26.5.1、TypeScript 7.0.2，使用配置的 Chrome 浏览器。先复核阶段 B 的独立审查和精确暂存内容，以可核验的 GitHub noreply 身份本地提交 `0e80dcd`（34 文件）；提交前重跑 `npm run verify:web`，43 文件／433 单元和全部检查通过，提交后工作区干净。本节结果覆盖 `0e80dcd` 上的 C1 源码、测试和文档增量，与本节纳入同一次 C1 提交；未推送或替换交付包。

[AgentWorkspace](../src/features/agents/AgentWorkspace.tsx) 从原位置的 554 行降到 210 行，只组合 Agent 列表、会话、详情、草稿及 chrome。新增 AgentDialogs 315 行、useAgentModals 64 行、useRoleCardDraft 51 行、focus 15 行；通用 useAsyncAction 37 行、useMediaQuery 14 行。agent-ui 更新挂载入口，useOperations 复用反馈 Hook，行数棘轮移除已删除工作区文件的旧上限。CSS、Workbench、公开 SDK 契约及 Rust 未修改。

失败证据：[agent-ui-import.test.ts](../tests/agent-ui-import.test.ts) 在不存在全局 matchMedia 的单元环境加载 Agent 扩展模块，拆分前为 1 失败，报 `ReferenceError: matchMedia is not defined`，定位旧 AgentWorkspace 第 24 行。媒体查询改为 Hook 内创建和订阅后，同一测试 1／1 通过；最终完整单元为 44 文件／434 用例，比 B 新增 1 项。

`npm run verify:web` 通过：构建／类型、44 文件／434 单元、Prettier、项目／导入边界、文件行数及 ESLint 全绿。`npm run test:web -- --workers=4` 全量 117／117 通过，包含 [agent-flow.spec.ts](../tests/web/agent-flow.spec.ts) 原文未改的 24 个展开用例、链接读取中止／迟到结果、保存失败／重试、浅深主题、焦点与视图订阅释放。当前测试文件实际展开数为 24，沿用仓库测试而非按旧计数删减。

另用独立浏览器上下文检查 375px 浅色、1180px 深色的创建弹窗和详情，实际截图已人工阅图；创建取消后名称按原规则清空，说明／多会话选择保留；会话草稿保留、关闭焦点返回、375 → 1180 → 375 的详情模态／侧栏切换通过，横向溢出为 false，pageerror 为 0。临时截图不纳入源码。

独立只读审查以 `0e80dcd` 原实现对照当前候选，未发现 P1/P2/P3：确认弹窗组件常驻、草稿重置范围、发起控件、异步闭包、文件限额、链接取消和媒体订阅释放保持原语义，抽出弹窗未新增 DOM 包裹节点。提交前逐项阅读精确暂存 diff 并检查隐私与产物边界，使用已核验的 GitHub noreply 身份本地提交。

原生组合门禁、原生窗口、普通包、Android 模拟器／真机及其他平台本阶段未重验；TS/TSX Hooks lint 仍受阶段 A 的解析器兼容缺口限制。C1 验收完成并停止，范围与退出结果见[阶段归档](../docs/spec/archive/C1-agent-workspace-2026-10-17.md)；C2–C6 未实施。

## 此前源码维护验证

2026-10-17 项目精简覆盖启动/Host/SDK、平台管理、扩展样板、构建脚本、测试入口与当前文档。删除仅供自测调用的 JS 代理校验及其 8 项测试；实际配置保留 Rust 校验。Host 安装按有效配置直接解析，失败仍保留默认配置与错误；Android 插件模板共用检查流程，未知代码保护及已知前版兼容保留，拒绝测试覆盖三种插件。回环传输说明合并为[单一入口](../docs/NATIVE-TRANSPORT-EXPERIMENT.md)，当前文档统一使用现有实现与验收状态。

受验源码基于 `9c05356` 加 `.cache/simplify-2026-10-17/source/` 中的工作区差异和未跟踪原件；本次前态保存在同材料根的 before/。`npm test` 322 项、`npm run test:web -- --workers=4` 117 项、`npm run build` 和 `npm run format:check` 通过；实际 `npm run android:prepare` 通过，MainActivity 与三个插件的生成结果均与受控源码一致。日志分别为 unit.log、browser.log、build.log、format.log 和 android-prepare.log，生成核对见 android-generated.json。独立审查未发现 P1/P2。Rust/Kotlin、UI 源码和样式未改，未重建或替换原生交付包；原生与真实连接器的剩余范围按各自记录继续维护。

## 相关基线

| 验证对象 | 对应记录 |
| --- | --- |
| 此前项目精简、Mac基线与历史整理 | [项目收敛与交付](RELEASE-2026-10-17.md) |
| 双卡片欢迎页与手机列表条件 | [欢迎页修复](WELCOME-2026-10-17.md) |
| 宿主状态所有权与工作区chrome边界 | [宿主前端重构](SHELL-ARCHITECTURE-2026-10-17.md) |
| 原生红绿灯位置专项 | [Mac窗口核对](MAC-TITLEBAR-2026-10-17.md) |
| 此前两端普通包与独立页面接入 | [2026-10-16交付](M2-NATIVE-DELIVERY-2026-10-16.md) |

## 契约与历史范围

状态、授权、生命周期、文档与扩展样板的历史受验版本保存在 [历史索引](HISTORY.md)。源码清单、第三方许可证和平台依赖核对原件继续保留；它们只证明各自版本及范围。

当前验收目标见 [ACCEPTANCE](../docs/ACCEPTANCE.md)，M2未完成项见 [退出清单](../docs/spec/M2-EXIT-CHECKLIST.md)。浏览器、构建、原生开发进程、打包应用、模拟器及真机分别留证；Android真机、iOS、Windows/Linux、完整辅助技术和正式签名分发未因此通过。
