# 架构与状态所有权

[文档导航](README.md) · [扩展契约](EXTENSION-CONTRACTS.md) · [验收计划](ACCEPTANCE.md)

状态：当前有效（2026-10-23 核实）；记录当前模块边界、状态所有权与平台信任模型，后续决策归入整体路线。

当前为 debug 原型，只收口 macOS 应用本体。当前开发状态见 [HANDOFF](../HANDOFF.md)，已交付包及其验证范围见[交付入口](../evidence/RESULTS.md)。SDK 仍为实验接口。

## 目标与边界

目标：本体应支持由扩展组合产生未知的服务、UI、业务和新扩展点。内核只承载通用机制，不理解特定 Agent 的业务循环、模型消息协议、角色卡格式或某个示例产品的状态机。公开 SDK 应足以支持贡献者扩展，无需访问私有注册表或修改内核源码。

## 职责划分

| 责任域 | 职责与所有权 | 边界与失败行为 |
| --- | --- | --- |
| 小内核 | 加载与生命周期、注册所有权、依赖与组合、持久化及迁移契约、取消与资源管理、可观测性 | 不识别业务对象；激活失败撤回本次部分注册，失败可定位到扩展 |
| 平台适配层 | 平台能力探测、原生调用、前后台事件、文件、权限与凭据作用域 | 明确支持、拒绝、暂不可用或需授权；不把调用失败伪装成功 |
| 扩展宿主与 SDK | 加载兼容检查、扩展上下文、公开扩展点及诊断入口 | 长期运行时和进程模型尚未选定；宿主保证与可信代码自律边界须分别列明 |
| 通用应用外壳 | 承载可替换的主题、布局、导航、页面、交互及扩展管理入口 | 默认 UI 尽量走公开契约；不得要求所有扩展有聊天窗口或正在打开的视图 |
| 扩展及其组合 | 提供服务、UI、业务、模型协议、格式解析与新的扩展点 | 拥有自身业务状态；按公共契约声明依赖与清理资源 |

这是一张责任地图，不要求立即拆成五个包或进程。实际模块划分随风险实验调整。通用状态契约约束所有权、持久化与恢复语义；内核不据此保存业务专用数据结构。

## 应用 UI 的扩展边界

目标明确 UI 可通过扩展更改，包含整体布局、导航、页面和交互方式，不限主题或固定插槽。建议默认 UI 与社区扩展共用公开机制，并允许扩展继续提供新的界面扩展点。内核不固定聊天应用布局。

布局选择及持久化、受控替换和宿主恢复通过公开契约实现。可选页面路由助手复用确定性导航冲突选择与视图树循环检查，支持动态贡献、焦点返回和页面偏好保存，见[页面契约](PAGES.md)。当前打包默认只安装 Agent 核心、模型连接和 Agent 界面；非聊天组合与样板保留在开发环境。

应用外壳拥有扩展管理、应用内授权、布局与外观偏好、恢复入口；默认 Agent 界面、工作台、画布及各自导航通过公开 `ctx.view` 和 `ctx.use` 挂载，不读取宿主私有业务状态。扩展管理使用独立全幅页面，隐藏业务区时保留工作区挂载和草稿；布局扩展按自身容器宽度重排。外壳的通用控件与扩展样式共享两套语义颜色变量，布局和导航仍由扩展替换，详见 [默认界面](UI.md)。

`agents.local` 是扩展层业务提供者，以 `agents@1` 公开快照、订阅、角色与会话操作；`ui.agents`（`src/agents/`）通过 `ctx.use` 消费，再用 `ctx.view` 注册默认界面；服务契约在 `modules/agents/contract.ts`。角色卡解析与模型协议位于扩展模块。`src/application.ts` 组合默认应用：调用业务模块的恢复函数，接线内置扩展与默认启用集合，并保留旧布局的兼容规则；`src/shell/runtime.ts` 的 `bootShell(application)` 编排通用配置解析、安装和组合恢复，`persistence.ts` 串行保存不透明快照字段。通用 Host、ExtensionContext、外壳、扩展管理与 Rust 桥接不读取 Agent 数据格式，也不展示 Agent 关联。公开提供者说明用于呈现实际来源、版本与执行范围，外部提供者无需模仿内置实现。

默认组合带内置模型连接器 `connector.models`，经 `chat@1` 为每个 Agent 提供用户自选的模型，Agent 发送当前会话历史与角色说明（[模型连接](MODELS.md)）；MCP 客户端与长期记忆待实现。外部视图启用后优先选中，工作台、画布和默认 Agent 界面可独立替换；最小启用集合、精确版本与配置快照已实现；已保存组合用 `offered` 记录已提供过的默认扩展，更新新增的默认扩展在首次启动时自动开启，用户关掉的默认扩展不会被再次开启。复杂多提供者政策与组合升级事务待实现。`agents.local` 通过自身 `ctx.platform` 存于 `extension.agents.local`，用[批量写与记录](SDK-AUTHORING.md#状态取消与演进)：主文档是索引（`{ version: 4, agents }`，会话只含元数据）；每条消息是集合 `session:<会话 ID>` 中的一条记录，值为消息本身，`parent` 为前一条消息的 ID（为分支预留），`text` 为消息正文；每个 Agent 的头像是集合 `avatars` 中以 Agent ID 为 ID 的记录（`{ version: 1, image }`）。每条消息最多 1,000,000 个 UTF-16 代码单元（不等同于 token 数），连同附件须在单条记录上限内，超出时不保存并提示。每次保存把索引与有变化的消息、头像放进一次 `state.batch`：只写新增或改动的记录，删除会话清空其集合，整批提交或整批拒绝。确定未提交时原状态不变、可重试；只有回执未知时锁住后续修改直到重新加载，锁住期间发送消息在请求模型之前就被拒绝，避免重试重复计费。启动时并行分页读取各会话与头像；实际 I/O 仍受扩展激活时限（800 ms）约束，不保证任意容量都能按时恢复。头像记录损坏只让该 Agent 回到默认头像，不使启动失败。旧格式按原样读取：`version: 1` 的单文档、`version: 2` 的每会话分片（缺失按空会话）、`version: 3` 的消息页与头像文档；之后第一次保存把全部内容写为记录，放不进一批时分几批，先清空再写各集合，最后一批才写索引，中途失败时旧格式仍完整、下次保存重来；成功后尽力删除旧文档，删除失败只留下无引用的文档。不能作为记录名的旧 ID（一向由 `crypto.randomUUID` 生成，实际不会出现）在恢复时换成新 ID。缺少 Agent 列表时按损坏处理、不覆盖。由组合根预授权 `state.read`、`state.batch` 与 `records.list`；旧版 `host.shell.agents` 在首次启动时迁移一次，成功后由组合根移除该字段，移除失败下次启动重试。Agent 数据损坏只让 `agents.local` 进入失败态并在启动提示中列出，外壳、扩展管理与其他扩展照常运行，原数据不覆盖。

建议保留可信授权与安全提示边界，不允许扩展通过公开 API 隐藏必要授权或伪造授权结果。呈现层是否能防止伪装须由实际隔离与 UI 方案证明；同环境可信代码可能仿造界面，不能把这项建议写成已有安全保证。

## 当前前端的状态所有权

`src/App.tsx` 只负责启动结果和加载／恢复界面的选择；`src/shell/Workbench.tsx` 装配各责任域及共享反馈，通过具名 props 传入消费者实际使用的字段。`controllers.ts` 用 Pick 定义组件的 Hook 消费范围；管理页按页头、列表、操作、详情和弹窗组合，不新增 Context。

| 所有者 | 持有的状态与副作用 | 调用边界 |
| --- | --- | --- |
| `src/application.ts` | 默认应用组合、Agent 恢复接线和旧布局兼容 | App 调用无参数 `boot()`；业务格式由 `modules/agents/validation.ts` 校验，未安装该业务的组合可保留其不透明数据 |
| `src/shell/runtime.ts` | 通用启动编排、接收应用组合、安装与恢复 | 返回稳定服务与只读启动初值，保留 `CompositionRecovery` 入口 |
| `persisted-state.ts`、`extensions.ts` | 通用偏好解析、目录／手动扩展安装 | 业务字段不透明保留，内置 ID 冲突按注入目录检查，坏数据与导入失败保留归属 |
| `persistence.ts` | 串行快照、revision、未知写入锁存和页面保存队列 | 成功回执后发布偏好；已提交回执胜出，未知结果先重载 |
| `useWorkspace` | 视图选择、挂载释放、按代排除失败视图、恢复到可用布局 | 复用 `createViewSlot` 和公开 Host 生命周期 |
| `useAppearance` | 外观偏好、主题贡献、DOM 与原生外观同步 | 成功保存后更新偏好；贡献缺失保留选择 |
| `useShellNavigation`、授权与弹窗组件 | 管理页、宿主模态入口、发起控件和返回焦点 | 管理返回在工作区可见后恢复焦点 |
| `src/features/extensions/useExtensionManager.ts` | 管理页选中项、失败导入显示、模态入口与返回焦点；按消费者生成窄控制接口 | 组合 extension-actions、扩展状态 Hook 与外壳反馈；安装表单常驻，输入／配置草稿仍归各弹窗 |
| `src/shell/useExtensionState.ts`、`extension-state.ts` | React 持有 imports／configurations／composition，按动作串行读取最新确认值、执行与发布 | 各动作使用局部 draft，不修改 Runtime；保存拒绝保留旧值，部分成功按已确认字段发布 |
| `modules/shell/extension-actions.ts` | 安装、重试、失效路径移除、卸载、组合保存和配置写入的执行顺序 | 不依赖 React，接收 Host 的 Pick 与局部状态接口；确认保存后才改变 draft，保留已确认的部分结果 |
| `src/agents/` | AgentWorkspace 组合选中项、会话草稿和详情；AgentDialogs 持有创建表单草稿；useAgentModals 持有弹窗、反馈与发起控件；useRoleCardDraft 持有卡片输入与读取取消 | AgentDialogs 常驻以保留取消后的草稿；focus 选择仍可操作的返回控件，useMediaQuery 订阅视口变化 |
| 各工作区扩展 | 业务选中项、会话、草稿及默认详情开关 | 可选 `View.chrome` 向外壳发布标题和上下文状态 |

布局回退诊断优先使用已注册视图的 owner/label；未注册时读取目录项的可选 `views: { [viewId]: label }` 提示。默认目录和应用组合声明各自视图，通用诊断不维护业务 ID 表；缺少提示仍保留原视图 ID 和管理入口。提示用于定位来源，不授予注册或执行权限。

React视图每次挂载创建独立节点；释放先移除该节点，跨微任务卸载root并向Host返回清理Promise，避免外壳提交期间同步卸载或旧释放清空替换视图。Agent工作区节点继续填满可用高度，角色设置节点保持自然高度；长会话滚动和交叠替换/订阅释放由 `react-view-lifecycle.spec.ts` 覆盖。

`src/features/extensions/useExperiments.ts` 拥有文本工作台实验接线；该实验只在开发构建的目录中，没有安装它的组合（包括发布包）不展示恢复启动按钮，管理入口仍可用。

`src/components/useAsyncAction.ts` 共用忙碌、错误与通知状态。Agent 将 AbortError 显示为停止通知，外壳 `useOperations` 保留 `errorMessage` 错误映射；共用 Hook 不改变两者的反馈语义。

Runtime 的 initial 只作外观、布局、恢复诊断和扩展状态的启动初值；运行中不再读取它作为扩展当前快照。catalog 仍是供加载与诊断消费的稳定目录引用。扩展状态队列串行覆盖整个读／改／保存过程，避免并发动作使用同一旧数组或配置表；persistence 继续串行所有 host.shell 写入和 revision，包括页面与外观；Agent 由其扩展自行串行保存。两个队列各自持有单向依赖，扩展动作通过稳定 save 进入 persistence。

状态只发布已确认的结果，写入拒绝时无需撤回乐观值；未知回执仍由 persistence 锁住后续写入。最终卸载失败时保留实时 imports，同时发布已经确认的 composition 裁剪；路径保存成功后安装失败也保留已确认路径。生命周期、模块目录和扩展数据的原语义保持。

从文件导入的扩展包（[extension-package.ts](../modules/shell/extension-package.ts)）：`manifest.json` 加单文件 ESM `main.js`（默认导出 `{ activate }`），可来自文件夹、zip（[fflate](https://github.com/101arrowz/fflate) 只解出这两个文件，按需加载）或同时选中的两个文件；文件夹或 zip 只有一层外包文件夹时自动进入。读取包时只解析并校验 manifest，不执行代码；用户确认导入后才以 Blob URL 加载 `main.js`，其默认导出须有 `activate`，若也带 `manifest`，其 ID 须与 `manifest.json` 一致。包按 SHA-256 存为 `host.shell` 的记录（集合 `extension-package:<哈希>`，`manifest.json` 最大 64 KiB，`main.js` 最大 3 MiB），imports 记录 `package:sha256:<hex>` 代替模块路径，启动时读取、核对哈希后加载；缺失或不符时进入失败导入列表，记录保留。先写包再写 imports，imports 确定未提交时删除新包。同 ID 再次导入为替换，加载失败的导入也可这样修复：先停用、撤销授权、禁用旧代码的凭据绑定，与新 imports 同次保存时从已保存组合中移去该扩展；imports 提交后才换下宿主记录并删除旧包，替换后保持停用。禁用凭据绑定失败时不保存，旧版本保留。内置扩展 ID 不能被导入覆盖。卸载或移除失败导入后尽力清空包的集合，失败只留下无引用的包。此前导入的单文件扩展（`imported:sha256:`）不再加载，在失败导入列表中提示按新格式重新导入，其旧源码分片不再读取。原生 CSP 的 `script-src` 为此只增加 `blob:`，`check:release` 校验策略未再放宽；凭据绑定的来源即该 `package:` 标识，替换后的新代码须重新填写 API Key。

外壳订阅当前视图的 `chrome`，由视图发布标题和默认详情状态。自定义侧栏依次匹配当前实体的扩展所有者、当前工作区所有者，再使用工作区默认详情；同类贡献按 priority 和 ID 确定顺序。自定义侧栏出现时关闭默认 inline 详情；移动端默认详情可用 dialog 呈现，转为桌面后参与互斥。

SDK 的 `errors.ts` 与零依赖 `validation.ts` 提供错误码和字段路径，扩展/主题/组合 ID 规则（`identifier`）与同源判断（`sameOrigin`）只在 `validation.ts` 定义；通用中文错误由外壳 `messages.ts` 映射，业务数据损坏的具体原因由提供者通过 `ContractError.message` 传递，外壳补充数据保留提示而不解析业务字段名。Host 保持字符串诊断接口，由外壳在构造时注入错误格式化回调，在配置、生命周期和清理错误转为字符串前映射；等待原因以结构化 `inspect().wait`（`configuration`/`capability-unavailable`/`permission`/`dependency`/`cycle`）给出，诊断与界面文案只读该结构，`error` 中的英文文本仅供开发日志。已有 Host 调用者继续使用原默认开发诊断；需要英文诊断的开发调用通过校验的 label 或 `ContractError` 的可选 message 保留原因，不用裸错误码替代已对外提供的字符串诊断。Host 按职责拆分：`definition.ts` 声明校验与加载，`scope.ts` 单次激活的资源作用域，`registry.ts` 服务（同一服务可有多个提供者，按启用先后排列）、视图、主题、事件、`use` 绑定形成的依赖链、公布的使用者与按使用者开关登记，`context.ts` 构造扩展 `ctx`，`lifecycle.ts` 宿主错误、超时与等待原因，`host.ts` 只保留安装、授权、启停与协调；`host.ts` 不再转发 `loadExtension`。

`chrome` 是可选的框架无关接口。Host 只透传贡献；外壳在消费边界捕获读取、订阅和操作异常，排除失败的视图代并保留管理恢复入口。导航接收方声明实体类型，调用方必须匹配后才传递 ID，避免将 Agent ID 发送给任务等其他工作区。接口和作者示例见 [SDK 作者入口](SDK-AUTHORING.md#工作区标题与上下文侧栏)。

## 原生 IPC 契约

Rust 命令与 wire 类型是 IPC 的来源：[ipc.rs](../src-tauri/src/ipc.rs) 的声明宏同时生成实际函数／serde DTO 和类型元数据；[lib.rs](../src-tauri/src/lib.rs) 的一份清单同时用于 Tauri 注册与编译后导出。构建登记 24 条命令，没有只在测试 feature 中出现的命令。

前端通过 [invokeNative](../src/native/invoke.ts) 调用生成的[契约](../src/native/contract.generated.ts)。命令名、参数、可选字段、响应状态及原生拒绝类型随 Rust 定义导出，调用者不再通过 `invoke<T>` 自行声明响应。AppHandle／State 是原生注入参数，不进入 WebView 参数；命令参数保持 camelCase，实验 Faults 保持既有 snake_case。公共 SDK 不依赖 `src/`，相关声明与生成类型通过编译期兼容样本核对。

`platform_call` 的已确认拒绝返回 `{ code, outcome: "not-committed" }`；状态码由 Rust enum 导出，浏览器与原生适配按同一码映射提示，不匹配英文句子。收到未知错误码或丢失写入回执仍归为 `unknown`，不自动重试；成功写入回执继续胜过派发后的取消。Promise 拒绝对象不被生成入口包装成成功结果。

声明宏只覆盖当前真实 wire 形状；`serde_json::Value` 保持不透明 `unknown`，`&str` 拒绝原因仍是字符串。类型门禁约束正常调用，不替代 Rust 授权／输入校验，也不阻止同一 WebView 中的恶意代码直接调用原生桥接。增加命令与重新生成的方法见[开发流程](DEVELOPMENT.md#修改原生命令)。

## 平台适配与动态扩展

当前采用 Tauri 2、React/TypeScript/Vite 与 Rust 平台层。Tauri 原生插件随应用构建，动态扩展是 SDK/Host 加载的可信 ESM；公开 `ctx.platform` 经平台适配器桥接原生能力。新增原生能力需要重新打包，导入扩展包不需要重新构建应用。远程分发、非可信执行和其他平台的加载政策仍待验证，范围见[整体路线](spec/total.md#支持范围与未决项)。

Android 系统栏与键盘 Insets 由 [MainActivity 模板](../native/android/MainActivity.kt) 适配，[外观插件](../native/android/AppearancePlugin.kt) 同步系统栏颜色；两者不进入扩展宿主。该平台当前冻结，生成工程与恢复构建方式见 [Android 工程](ANDROID.md)。

角色卡、模型协议与具体 A2A 协作流程归扩展；通用契约只表达参与者、状态、权限、取消及资源所有权。后续跨平台、角色与合作验收按[整体路线](spec/total.md)推进，不预建业务编排内核。

## 应用数据目录

release 构建始终使用平台数据目录（Mac 为 `~/Library/Application Support/dev.plums.plums/data`）；debug 构建可由 `PLUMS_DATA_DIR` 指向隔离目录，开发用法见[开发流程](DEVELOPMENT.md#本地交付目录)。

未设该变量的桌面启动在读取数据前检查改名前的 `dev.plums.m1/m1-experiment`：新目录不存在或为空时整体复制过去（暂存后改名，保留文件权限，写入 `migrated-from.json`，拒绝链接），旧目录不改动、留作备份；复制失败时弹窗说明并退出，不写新数据，下次启动重试。迁移前应退出旧版本，两者标识不同，单实例互不感知。Android 的旧包名是另一个应用，数据不能读取，不迁移。实现见 `src-tauri/src/legacy_data.rs`。

桌面版单实例：数据目录相同或不同，第二次启动都只聚焦已运行的窗口。

扩展与外壳的状态（[状态规则](SDK-AUTHORING.md#状态取消与演进)）由原生 Broker 为每个所属者保存在数据根的 `state/<所属者>.sqlite3`（WAL、完全同步，一次 `state.write` 或 `state.batch` 是一个事务）。库结构版本 2 含 `documents`、`records` 与按 `text` 建的 FTS5 trigram 索引（随 bundled SQLite 启用；三个字符以上的查询走索引，更短的扫描文本）；版本 1 的库在打开时原地升级，未知版本拒绝读写。提交时发生 I/O 错误报 `state-sync`（结果 unknown，不可盲目重试），其他失败为 not-committed。库首次创建时在同一事务中导入该所属者此前的 `<所属者>.json` / `<所属者>+<key>.json`，原文件移入 `legacy-json/`；无法读取的旧文件（损坏、未知 schema、超过 1 MiB，超限时不读取内容）导入为同样无法读写的记录，不当作空状态。所属者只能是 `host.shell` 或 `extension.<id>`，因此无法读写同目录的凭据绑定等原生文件。多进程事务未实现。浏览器预览按同一规则与上限把文档存为 localStorage 的 `plums:<所属者>` / `plums:<所属者>+<key>`，一个所属者的记录共用 `plums:<所属者>#records`，批量写中途失败时写回原值；实现见 `src/browser-state.ts`。

## 信任与复用边界

采用可信贡献模式，短期不把恶意扩展强隔离作为前置条件。若扩展与宿主同进程、共享全局环境或得到原生调用能力，其错误和主动行为可能影响宿主和用户数据；来源、审查和权限披露不能消除这些风险。

权限 UI、依赖注入上下文或名为 `isolate` 的机制只代表其实际提供的边界，不能据名称推断安全沙箱。未来若需要运行不可信代码，必须另行验证隔离、权限强制执行及资源约束。近期可执行的信任措施见 [扩展契约](EXTENSION-CONTRACTS.md)。

第三方代码或组件的复用评估需记录具体版本、许可证与依赖义务、Node.js/文件系统/子进程等假设、移动端测试和维护成本。实际引入时须保留必要的许可证与版权声明。平台技术资料见 [Tauri 2 官方文档](https://v2.tauri.app/)，不能替代 Plums 的验证证据。
