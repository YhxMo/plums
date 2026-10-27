# 架构与状态所有权

[文档导航](README.md) · [扩展契约](EXTENSION-CONTRACTS.md) · [验收计划](ACCEPTANCE.md)

状态：当前有效（2026-10-27 核实）；模块边界、状态所有权与平台信任模型。开发状态见 [HANDOFF](../HANDOFF.md)，交付与验证范围见[交付入口](../evidence/RESULTS.md)；SDK 仍为实验接口。

## 目标与职责

本体应支持由扩展组合产生未预设的服务、界面、业务与新扩展点。内核只承载通用机制，不理解 Agent 的业务循环、模型协议、角色卡格式或某个产品的状态机；公开 SDK 应足以让贡献者写扩展，无需访问私有注册表或修改内核。

| 责任域 | 职责与所有权 | 边界与失败行为 |
| --- | --- | --- |
| 小内核 | 加载与生命周期、注册所有权、依赖与组合、持久化与迁移契约、取消与资源、可观测性 | 不识别业务对象；激活失败撤回本次部分注册，失败可定位到扩展 |
| 平台适配层 | 能力探测、原生调用、前后台事件、文件、权限与凭据作用域 | 明确支持、拒绝、暂不可用或需授权；不把失败伪装成成功 |
| 扩展宿主与 SDK | 兼容检查、扩展上下文、公开扩展点与诊断入口 | 长期进程模型未定；宿主保证与可信代码自律分别列明 |
| 通用应用外壳 | 可替换的主题、布局、导航、页面、交互与扩展管理入口 | 默认界面走公开契约；不要求扩展有聊天窗口或打开的视图 |
| 扩展及其组合 | 服务、界面、业务、模型协议、格式解析与新扩展点 | 拥有自身业务状态；按公共契约声明依赖与清理资源 |

这是责任地图，不要求拆成五个包或进程。通用状态契约约束所有权、持久化与恢复语义，内核不据此保存业务专用结构。

## 应用界面与默认组合

- 界面可整体替换（布局、导航、页面与交互），默认界面与社区扩展共用公开机制，内核不固定聊天布局。布局选择、持久化、受控替换与宿主恢复走公开契约；可选的页面路由助手见[页面契约](PAGES.md)。
- 外壳拥有扩展管理、应用内授权、布局与外观偏好、恢复入口；默认 Agent 界面、工作台与画布都经公开 `ctx.view` 与 `ctx.use` 挂载，不读宿主私有业务状态。打包默认只装 Agent 核心、记忆、模型连接与 Agent 界面；非聊天组合与样板只在开发构建中。
- `agents.local` 是业务提供者，以 `agents@1` 公开快照、订阅与角色、会话操作（契约在 `modules/agents/contract.ts`）；`ui.agents`（`src/agents/`）经 `ctx.use` 消费、经 `ctx.view` 注册界面。`AgentStore`（`store.ts`）只编排操作与串行保存：消息怎样写入会话在 `sessions.ts`，在途回复（取消、提交段，不持久化）在 `replies.ts`。
- `connector.models` 经 `chat@1` 为每个 Agent 提供用户自选的模型，Agent 发送会话历史与系统提示词（[UI](UI.md#添加与导入-agent)、[模型连接](MODELS.md)）；`memory.local` 经 `memory@1` 提供“关于我”与每个 Agent 记下的事（[记忆服务契约](EXTENSION-CONTRACTS.md#记忆服务契约)）。
- `src/application.ts` 组合默认应用：接线内置扩展、默认启用集合与内置授权，调用业务模块的恢复函数。已保存组合用 `offered` 记住提供过的默认扩展：新增的默认扩展首次启动时自动开启，用户关掉的不再被打开。`src/shell/runtime.ts` 的 `bootShell(application)` 编排配置解析、安装与组合恢复。通用 Host、外壳、扩展管理与 Rust 桥接不读取 Agent 数据格式。
- 授权与安全提示不能被扩展经公开 API 隐藏或伪造；同一 WebView 中的可信代码仍可能仿造界面，不能写成已有的安全保证。

## Agent 数据

`agents.local` 经自身 `ctx.platform` 存于 `extension.agents.local`，用[批量写与记录](SDK-AUTHORING.md#状态取消与演进)；组合根预授权 `state.read`、`state.batch` 与 `records.list`。`memory.local` 同样存于 `extension.memory.local`（主文档存设置与整理进度，每条记忆是集合 `memories` 中的一条记录）。

- **结构**：主文档是索引（`{ version: 4, agents }`，会话只含元数据）；每条消息是集合 `session:<会话 ID>` 中的记录，`parent` 为前一条消息的 ID（启动时据此还原顺序，撤销删除的消息回到原位，也为分支预留），`text` 为正文；头像是集合 `avatars` 中以 Agent ID 为 ID 的记录。单条消息最多 1,000,000 个 UTF-16 代码单元，连同附件须在单条记录上限内。
- **保存**：每次保存把索引与有变化的消息、头像放进一次 `state.batch`，整批提交或整批拒绝。确定未提交时原状态不变、可重试；回执未知时锁住后续修改直到重新加载，锁住期间发送在请求模型之前就被拒绝，避免重复计费。
- **恢复**：启动时并行分页读取，仍受扩展激活时限（800 ms）约束。头像记录损坏只让该 Agent 回到默认头像；缺少 Agent 列表或数据损坏时只让 `agents.local` 进入失败态并在启动提示中列出，原数据不覆盖，其余部分照常运行。
- **旧格式**：`version: 1`–`3` 的文档按原样读取，之后第一次保存改写为记录（放不进一批时分批，最后一批才写索引，中途失败时旧格式仍完整）；成功后尽力删除旧文档。旧版 `host.shell.agents` 首次启动时迁移一次。

## 前端的状态所有权

`src/App.tsx` 只选择启动结果与加载、恢复界面；`src/shell/Workbench.tsx` 装配各责任域与共享反馈，经具名 props 传入实际用到的字段（`controllers.ts` 用 Pick 限定范围，不新增 Context）。

| 所有者 | 持有的状态与副作用 | 调用边界 |
| --- | --- | --- |
| `src/application.ts` | 默认应用组合与 Agent 恢复接线 | 业务格式由 `modules/agents/validation.ts` 校验；未安装该业务的组合保留其不透明数据 |
| `src/shell/runtime.ts` | 通用启动编排、安装与恢复 | 返回稳定服务与只读启动初值，保留 `CompositionRecovery` 入口 |
| `persisted-state.ts`、`extensions.ts` | 偏好解析、目录与手动扩展安装 | 业务字段不透明保留；坏数据与导入失败保留归属 |
| `persistence.ts` | 串行快照、revision、未知写入锁存与页面保存队列 | 成功回执后发布偏好；已提交回执胜出，未知结果先重载 |
| `useWorkspace` | 视图选择、挂载释放、按代排除失败视图、恢复到可用布局 | 复用 `createViewSlot` 与 Host 生命周期 |
| `useAppearance` | 外观偏好、主题贡献、DOM 与原生外观同步 | 成功保存后更新；贡献缺失时保留选择 |
| `useShellNavigation`、授权与弹窗组件 | 管理页、宿主模态入口、发起控件与返回焦点 | 回到工作区后恢复焦点 |
| `src/features/extensions/useExtensionManager.ts` | 打开的扩展详情、失败导入、管理弹窗与返回焦点；按消费者生成窄接口 | 组合 extension-actions、扩展状态 Hook 与外壳反馈 |
| `src/shell/useExtensionState.ts`、`extension-state.ts` | imports、configurations 与 composition，按动作串行读取、执行与发布 | 各动作用局部 draft；保存拒绝保留旧值，部分成功按已确认字段发布 |
| `modules/shell/extension-actions.ts` | 安装、重试、移除失效路径、卸载、组合保存与配置写入的顺序 | 不依赖 React；确认保存后才改变 draft |
| `src/agents/` | 选中项、会话草稿、详情、创建表单与卡片输入、弹窗与发起控件 | 弹窗常驻以保留取消后的草稿 |
| 各工作区扩展 | 业务选中项、会话、草稿与默认详情开关 | 经可选 `View.chrome` 向外壳发布标题与上下文 |

- Runtime 的初值只用于启动；运行中不再读它作为当前快照。扩展状态队列串行覆盖整个读、改、保存过程；`persistence` 串行所有 `host.shell` 写入；Agent 由其扩展自行串行保存。状态只发布已确认的结果，写入拒绝时无需撤回乐观值。
- 布局回退诊断优先用已注册视图的 owner 与 label，未注册时读目录项的可选 `views` 提示；提示只用于定位来源，不授予权限。
- React 视图每次挂载创建独立节点；释放时先移除节点、跨微任务卸载 root 并向 Host 返回清理 Promise，避免旧释放清空替换视图（`react-view-lifecycle.spec.ts`）。
- 外壳订阅当前视图的 `chrome`：视图发布了默认详情时右侧栏按钮只开关它；否则自定义侧栏依次匹配当前实体的扩展所有者、当前工作区所有者，同类按 priority 与 ID 排序。外壳在消费边界捕获 `chrome` 的读取与操作异常；导航接收方声明实体类型，调用方匹配后才传 ID（[作者指南](SDK-AUTHORING.md#工作区标题与上下文侧栏)）。

## 导入的扩展包

[extension-package.ts](../modules/shell/extension-package.ts)：`manifest.json` 加单文件 ESM `main.js`（默认导出 `{ activate }`），可来自文件夹、zip（[fflate](https://github.com/101arrowz/fflate) 只解出这两个文件）或同时选中的两个文件，只有一层外包文件夹时自动进入。

- 读取时只校验 manifest，不执行代码；确认导入后才以 Blob URL 加载 `main.js`，其 manifest ID 须与 `manifest.json` 一致。原生 CSP 的 `script-src` 为此只增加 `blob:`，`check:release` 校验策略未再放宽。
- 包按 SHA-256 存为 `host.shell` 的记录（`manifest.json` 最大 64 KiB，`main.js` 最大 3 MiB），imports 记 `package:sha256:<hex>`，启动时核对哈希后加载，缺失或不符时进入失败导入列表。先写包再写 imports，imports 确定未提交时删除新包。
- 同 ID 再次导入为替换（加载失败的导入也可这样修复）：先停用、撤销授权并禁用旧代码的凭据绑定，imports 提交后才换下宿主记录并删除旧包，替换后保持停用、须重新填写 API Key。内置扩展 ID 不能被覆盖。卸载后尽力清空包的集合。
- 更早的单文件导入（`imported:sha256:`）不再加载，在失败导入列表中提示按新格式重新导入。

## 宿主、错误与原生 IPC

- **Host 拆分**：`definition.ts` 声明校验与加载，`scope.ts` 单次激活的资源作用域，`registry.ts` 服务（同一服务可有多个提供者，按启用先后排列）、视图、主题、事件、`use` 依赖链与公布的使用者，`context.ts` 构造 `ctx`，`lifecycle.ts` 错误、超时与等待原因，`host.ts` 只保留安装、授权、启停与协调。
- **错误**：SDK 的 `errors.ts` 与零依赖 `validation.ts` 提供错误码、字段路径、ID 规则（`identifier`）与同源判断（`sameOrigin`）。通用中文错误由外壳 `messages.ts` 映射；业务损坏的原因由提供者经 `ContractError.message` 给出。等待原因以结构化 `inspect().wait`（`configuration`、`capability-unavailable`、`permission`、`dependency`、`cycle`）给出，界面文案只读该结构，`error` 中的英文只供开发日志。
- **IPC**：Rust 命令与 wire 类型是来源——[ipc.rs](../src-tauri/src/ipc.rs) 的声明宏同时生成函数、serde DTO 与类型元数据，[lib.rs](../src-tauri/src/lib.rs) 的一份清单同时用于注册与导出。前端经 [invokeNative](../src/native/invoke.ts) 调用生成的[契约](../src/native/contract.generated.ts)，不再自行声明响应类型；AppHandle 与 State 不进入 WebView 参数。增加命令的方法见[开发流程](DEVELOPMENT.md#修改原生命令)。
- **结果语义**：`platform_call` 的已确认拒绝返回 `{ code, outcome: "not-committed" }`，状态码由 Rust enum 导出，两端按码映射提示；未知错误码或丢失的写入回执归为 `unknown`，不自动重试；成功回执胜过派发后的取消。类型门禁只约束正常调用，不替代 Rust 的授权与输入校验，也不阻止同一 WebView 中的代码直接调用原生桥接。

## 平台与数据目录

- 技术栈：Tauri 2、React/TypeScript/Vite 与 Rust 平台层。动态扩展是 SDK/Host 加载的可信 ESM，经 `ctx.platform` 桥接原生能力；新增原生能力需要重新打包，导入扩展包不需要。远程分发、非可信执行与其他平台见[整体路线](spec/total.md#支持范围与未决项)；Android 冻结。
- release 构建始终用平台数据目录（Mac 为 `~/Library/Application Support/dev.plums.plums/data`）；debug 构建可由 `PLUMS_DATA_DIR` 指向隔离目录（[开发流程](DEVELOPMENT.md#本地交付目录)）。桌面版单实例，第二次启动只聚焦已运行的窗口。
- **改名前的数据**：未设该变量的桌面启动先检查 `dev.plums.m1/m1-experiment`：新目录不存在或为空时整体复制过去（暂存后改名、保留权限、写入 `migrated-from.json`、拒绝链接），旧目录不动；复制失败时弹窗说明并退出，不写新数据，下次启动重试（`src-tauri/src/legacy_data.rs`）。
- **状态存储**：原生 Broker 为每个所属者（`host.shell` 或 `extension.<id>`，因此读不到同目录的凭据文件）保存 `state/<所属者>.sqlite3`（WAL、完全同步，一次 `state.write` 或 `state.batch` 是一个事务）。库结构版本 2 含 `documents`、`records` 与按 `text` 建的 FTS5 trigram 索引；版本 1 在打开时原地升级，未知版本拒绝读写。提交时的 I/O 错误报 `state-sync`（结果 unknown），其他失败为 not-committed。库首次创建时在同一事务中导入此前的 JSON 文件，原文件移入 `legacy-json/`；读取失败时中止整个事务、下次重试，无法读取的旧文件导入为同样无法读写的记录，不当作空状态。浏览器预览按同一规则存于 localStorage（`src/browser-state.ts`）。

## 信任与复用边界

采用可信贡献模式：扩展与宿主同进程、共享 WebView 并可调用原生桥接，其错误和主动行为可能影响宿主与用户数据，来源、审查与权限披露不能消除这些风险。权限界面、依赖注入或名为 `isolate` 的机制只代表其实际提供的边界，不是沙箱；开放市场前的隔离门槛见[整体路线](spec/total.md#支持范围与未决项)。

复用第三方代码或组件时记录版本、许可证与义务、对 Node.js、文件系统或子进程的假设与维护成本，保留必要的许可证与版权声明。
