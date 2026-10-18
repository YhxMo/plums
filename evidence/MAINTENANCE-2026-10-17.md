# 2026-10-17 工程维护验证记录

状态：历史证据。原记录从当前验证索引移出；下文的当前状态、源码路径与未完成项均指各节受验时点，结论及范围保持不变。当前交付见 [RESULTS](RESULTS.md)，其他历史见 [HISTORY](HISTORY.md)。

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

## C2：按使用方拆分样式

2026-10-17，macOS arm64、Node.js 26.5.1、TypeScript 7.0.2，配置的 Chrome 浏览器。以 `refactor/hardening` 的 `ee4ff82` 和干净工作区开工；以下结果覆盖该提交上的样式、引用、棘轮及文档增量，与本节纳入同一次 C2 本地提交。先通过 rg 列出两个旧模块的全部 import，再逐项核对每个 class 的 TSX 使用位置及分组／复合选择器，确定归属后移动规则。

| 原文件 | 新文件与物理行数 | 主要使用方 |
| --- | --- | --- |
| Workspace.module.css，951 行 | [AgentList](../src/components/AgentList.module.css) 332、[ChatView](../src/components/ChatView.module.css) 204、[DetailPanel](../src/components/DetailPanel.module.css) 208、[Onboarding](../src/components/Onboarding.module.css) 217 | 列表／共享 Avatar、会话、详情、EmptyState／AgentDialogs／RoleCardSettings；AgentWorkspace 使用列表与详情模块 |
| App.module.css，680 行 | [layout](../src/shell/layout.module.css) 212、[ExtensionManager](../src/features/extensions/ExtensionManager.module.css) 327、[dialogs](../src/shell/dialogs.module.css) 145 | 顶栏／外壳布局、扩展管理／诊断／引导／权限说明、授权弹窗／反馈／详情卡片 |

复合选择器保持原文：Avatar 由 TSX 同时绑定列表的基础 avatar、会话头和详情排除条件的局部 avatar；手机顶栏与管理返回按钮的分组规则保留在 layout，管理页头／返回按钮显式绑定其局部 class。CSS module 间没有 import 或 composes，公共原子样式仍在 styles.css；没有新增规则、改变值或改动业务逻辑。两个旧模块已删除，src／tests／scripts 无旧路径引用；行数棘轮删除两项旧上限，其余上限保持。原 hardening 上限回归改用仍存在的 documents.rs 906 行豁免，不改 Rust 源码。

使用已安装 PostCSS 对照 `ee4ff82` 的原文件与七个新文件：Workspace 的 175 条、App 的 128 条规则，其媒体条件、完整选择器、声明顺序／值／important 的多重集合完全一致；各目标模块保留其规则在原文件中的相对顺序。七个文件均满足各自 350／220／330／150 行目标，无新增豁免。

`npm run verify:web` 全部通过：build／类型、44 文件／434 单元、Prettier、项目／导入边界、行数和 ESLint。`npm run test:web -- --workers=4` 全量 117／117 通过（3.4 分钟），包含 375／1180px 的欢迎／导航、管理页头滚动、浅深主题与凭据管理，以及焦点、授权、组合、配置、卸载和断点切换。既有 tests/web 文件未修改，单元数量保持 434。

拆分前后各以独立浏览器上下文执行 375／1180px × light／dark × 12 状态：欢迎、导入、创建、会话、详情、嵌套删除、列表菜单、角色卡设置、关于、管理、诊断、授权。逐节点对照所测布局／字体／颜色／边框等计算属性、矩形及伪元素 content，48 个状态零差异；横向溢出为 false，pageerror 为 0。34 张截图逐字节相同，另 14 张每张相差 5–72 像素（最多占 0.015%）；已检查局部像素差异并查看欢迎、弹窗、管理、详情与授权的实际截图，未见布局或内容变化。截图和原始对照数据留在临时目录，不提交。

归组与预设类名前缀有三处调整：extensionSidebar 属于外壳 WorkspaceArea，与 fallback 布局一起放入 layout；boundAgentList／boundAgentRow 仅用于详情卡片，随 detailCard 放入 dialogs。这样保留真实消费关系与行数目标，不改选择器或值。Workbench 仅更新 CSS import，依赖透传和 runtime 状态所有权保持，C3–C6 未实施。

独立只读审查以 `ee4ff82` 对照候选，另行核对全部 175／128 条规则和各模块内部顺序，并检查 Avatar／工作区手机切换／返回按钮的局部 class 绑定、其他消费方引用及行数夹具；未发现 P1/P2/P3。精确暂存内容经逐项阅读和隐私检查，使用已核验的 GitHub noreply 身份本地提交，不推送。

原生组合门禁、原生窗口、普通包、Android 模拟器／真机和其他浏览器未重验，release 未替换；TS/TSX Hooks lint 的既有解析器缺口保留。C2 验收完成并停止，负责人、退出结果及范围见[阶段归档](../docs/spec/archive/C2-styles-2026-10-17.md)。

## C3：扩展操作与组件依赖

2026-10-17，macOS arm64、Node.js 26.5.1、TypeScript 7.0.2，配置的 Chrome 浏览器。先确认 C2 提交 `f5f78e1` 和干净工作区；以下结果绑定该父基线上的 C3 源码、测试及文档增量，与本节纳入同一次本地提交。未替换交付包。

[extension-actions.ts](../modules/shell/extension-actions.ts) 抽出安装、重试、移除失效路径、卸载、组合保存和配置写入，接收 Host 的 Pick 与窄状态接口，不依赖 React。安装保留加载后检查重复 ID、确认保存后更新 imports、安装成功后发布 catalog 的顺序；卸载保留停用、撤权、凭据准备、同次保存 imports／组合、最终卸载和目录发布的顺序。最终卸载失败保留实时 imports／catalog，同时保留已经确认的组合裁剪；配置保存失败仍保留旧配置和停用状态。仅收窄三个既有内部助手的 Host 参数类型，既有调用者继续有效。

新增 [controllers.ts](../src/shell/controllers.ts) 用 Pick 限制组件消费的 Hook 字段；[useExtensionManager](../src/features/extensions/useExtensionManager.ts) 生成页头、列表、详情和弹窗的消费接口。ExtensionManager 从 294 降到 66 行，只组合渲染；另拆出列表、卡片操作、弹窗组合、诊断动作和恢复引导。Workbench 从 96 到 110 行，对象透传从 5 处降到 0 处，全部改为具名 props。本次涉及的组件顶层 props 均不超过六个，没有接收完整 Hook 返回类型或新增 Context。旧 UI operations.ts 的卸载保存助手迁入动作模块后删除。

失败证据：先新增 [extension-actions.test.ts](../tests/extension-actions.test.ts)，执行 `npm test -- tests/extension-actions.test.ts`；新模块尚不存在，结果为 1 个套件加载失败、0 个已执行用例，报找不到目标模块。该记录不表示 15 个行为断言已执行失败。完成抽取后修正测试夹具中无关的无效凭据声明，15／15 通过，覆盖安装保存失败／重试、加载失败／跨源／重复 ID、已保存后安装失败、重试路径与配置、卸载保留数据、卸载保存与最终撤权失败、移除准备失败、组合冲突／保存失败和配置保存失败。与原有配置、卸载单元共同约束执行顺序及部分成功结果。

`npm run verify:web` 全绿：构建／类型、45 文件／449 单元、Prettier、项目／导入边界、行数和 ESLint；ESLint 0 错误／0 警告。`npm run test:web -- --workers=4` 全量 117／117 通过（57.6 秒），既有浏览器测试文件未改，包括安装／导入恢复、配置取消／失败、组合冲突／卸载裁剪、凭据管理、焦点与视图生命周期。

以 `f5f78e1` 原实现和候选分别执行 375／1180px × light／dark × 五状态：管理页、安装弹窗、配置弹窗、组合保存通知、卸载弹窗。使用同一隔离扩展配置，逐节点核对标签、属性、文本、矩形与所测计算样式，20 个状态零差异；20 张截图逐字节相同。实际查看手机深色配置弹窗和桌面浅色管理页，横向溢出为 false，pageerror 为 0；截图和原始比较材料不提交。

独立只读审查以 `git show f5f78e1:<path>` 对照候选，核对安装／重试、卸载各失败点、失效路径移除、组合／配置顺序、安装草稿常驻、关闭／卸载焦点及诊断组件生命周期，未发现 P1/P2/P3。CSS、公开 SDK、Runtime 声明、Rust、依赖与既有浏览器测试均未改；Runtime 的 imports／configurations／composition 可变所有权保持，C4 未实施。提交前精确暂存内容经过逐项阅读与隐私检查。

原生组合门禁、原生窗口、普通包、Android 模拟器／真机及其他浏览器本次未重验；TS/TSX Hooks lint 的阶段 A 解析器兼容缺口保留。不增加系统秘密或真实连接器的通过结论。C3 验收完成并停止，范围与退出条件见[阶段归档](../docs/spec/archive/C3-extension-actions-2026-10-17.md)；C4–C6 未实施。

## C4：扩展状态所有权

2026-10-17，macOS arm64、Node.js 26.5.1、TypeScript 7.0.2，配置的 Chrome 浏览器。先核对 C3 提交 `942b70b` 和干净工作区。本节结果绑定该父基线上的 C4 源码、测试及文档增量，与本节纳入同一次本地提交；未替换交付包。

[useExtensionState.ts](../src/shell/useExtensionState.ts) 以 React state 持有 imports／configurations／composition，[extension-state.ts](../src/shell/extension-state.ts) 串行执行读取最新确认快照、动作、保存及发布。每个动作只修改局部 draft，结束时向 React 发布改变的已确认字段；写入失败不发布未确认值，队列失败后仍可执行下一项，未知回执继续由原 persistence 锁存。最终卸载失败仍发布已确认的组合裁剪并保留实时 imports；保存成功后安装失败仍保留已确认路径。

Runtime 改为只读内部接口，提供 host／adapter／catalog／events／save 和只作启动初值的 initial；不再暴露三个活动字段。外观、工作区、实验入口、初始诊断及管理 Hook 的读取点已迁移。C3 的六条管理动作改为使用局部 draft，不再将 Runtime 当作可变状态接口；`grep -rn 'runtime\.[a-z]* =' src` 无匹配，旧活动字段读取也无残留。catalog 仍是稳定目录引用，公开 SDK、状态格式、Host 和保存回执契约不变。

失败证据：先增加 [extension-state.test.ts](../tests/extension-state.test.ts)，在生产实现未改时，以真实 Host、原 createPersistence 和 C3 动作直接执行；修正夹具后有效七项得到 3 失败／4 通过。三项失败分别是第二次保存的 imports 缺失第一路径、第二次配置合并缺失第一扩展值、第一写入完成前已执行第二动作。它们发生在实际行为断言，非模块缺失或类型错误。接入新队列后保留这些断言，另加组合保存失败、保存后安装失败发布、与非扩展保存共用 revision 三项，总计新增十项全部通过；覆盖失败保留旧值／重试、并发合并、未知回执锁存和卸载部分成功。

`npm run verify:web` 全绿：构建／类型、46 文件／459 单元、Prettier、项目／导入边界、行数及 ESLint；ESLint 0 错误／0 警告。`npm run test:web -- --workers=4` 全量 117／117 通过（1.1 分钟），包括组合保存失败／卸载裁剪、配置取消／保存失败／恢复、卸载失败重试、导入及角色／视图恢复；既有浏览器测试文件未改。新增状态队列 44 行、Hook 16 行，管理控制 Hook 194 → 208 行，ExtensionManager 保持 66 行、Workbench 对象透传保持零。

以 `942b70b` 和候选分别执行 375／1180px × light／dark × 五状态：管理页、安装弹窗、配置弹窗、组合保存通知、卸载弹窗。20 个状态逐节点核对标签、属性、文本、矩形与所测计算样式，零差异，无横向溢出／pageerror。19 张截图逐字节相同；另 1 张桌面深色卸载弹窗截图在背景模糊区域有 21 个像素差异。已查看该状态前后实图和手机浅色配置弹窗，未见布局或内容变化；临时截图与原始材料不提交。

独立只读审查对照 `942b70b`，核对 React 消费链、初值隔离、队列等待关系、异常传播、六条动作接线与失败／部分成功发布，未发现 P1/P2/P3。审查者另行执行 extension-state、extension-actions、persistence、persisted-state 四个定向测试文件，68／68 通过；StrictMode 初始化安全性来自静态检查，未单独挂载 Hook 作运行实测。精确暂存内容经过逐项阅读与隐私检查，使用已核验的 GitHub noreply 身份本地提交，不推送。

原生组合门禁、原生窗口、普通包、Android 模拟器／真机及其他浏览器本次未重验；阶段 A 的 TS/TSX Hooks lint 兼容缺口保留。未操作实际秘密或真实连接器。C4 验收完成并停止，负责人、范围与退出结果见[阶段归档](../docs/spec/archive/C4-extension-state-2026-10-17.md)；C5–C6 未实施。

## 此前源码维护验证

2026-10-17 项目精简覆盖启动/Host/SDK、平台管理、扩展样板、构建脚本、测试入口与当前文档。删除仅供自测调用的 JS 代理校验及其 8 项测试；实际配置保留 Rust 校验。Host 安装按有效配置直接解析，失败仍保留默认配置与错误；Android 插件模板共用检查流程，未知代码保护及已知前版兼容保留，拒绝测试覆盖三种插件。回环传输说明合并为[单一入口](../docs/spec/archive/M2-native-transport-experiment-2026-10-15.md)，当前文档统一使用现有实现与验收状态。

受验源码基于 `9c05356` 加 `.cache/simplify-2026-10-17/source/` 中的工作区差异和未跟踪原件；本次前态保存在同材料根的 before/。`npm test` 322 项、`npm run test:web -- --workers=4` 117 项、`npm run build` 和 `npm run format:check` 通过；实际 `npm run android:prepare` 通过，MainActivity 与三个插件的生成结果均与受控源码一致。日志分别为 unit.log、browser.log、build.log、format.log 和 android-prepare.log，生成核对见 android-generated.json。独立审查未发现 P1/P2。Rust/Kotlin、UI 源码和样式未改，未重建或替换原生交付包；原生与真实连接器的剩余范围按各自记录继续维护。
