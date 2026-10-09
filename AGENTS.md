# AGENTS.md

plums 是 Plums（Apache-2.0）的 TypeScript 工作区，包含 core、CLI、扩展 SDK、宿主与 Electron/React 桌面端。使用 pnpm 10；core/CLI 支持 Node.js 22+，全仓桌面构建使用 Node.js 26.5.1，macOS 原生文件适配器需要 Xcode Command Line Tools。

## 入口与范围

- `packages/core/src/index.ts` 是公开 API 入口；内核负责包校验、安装状态、权限、设置、密钥引用、分享与 MCP 工具批准。
- `packages/host/src/index.ts` 提供公共库、Agent 组装、隔离运行时与真实 I/O；`packages/sdk/src/index.ts` 定义扩展接口；`packages/desktop/src/main.ts` 与 `packages/desktop/src/renderer.tsx` 提供可信管理界面。聊天、模型适配、工具流程和业务前端由外装组件提供，示例不自动安装。
- `packages/cli/src/main.ts` 只调用 `@plums/core` 公开 API；当前使用 `MemorySecretStore` 和 `RecordingEgressSink`，没有真实联网或持久化密钥。
- 契约参考 `README.md`、`docs/architecture.md`、`docs/capabilities.md`、`docs/desktop.md`、`docs/sdk-v2.md` 和 `docs/engine.md`；`docs/scenario-protocols.md` 记录测试夹具业务协议，非平台契约。确认文案见 `docs/confirm-copy.md`；核对实际代码与测试后维护规则，不把路线图写成现有能力。
- 新包默认格式为 2.0，读取 1.x/2.x；`Manifest`/`Permission` 为联合类型，先按清单格式分支，再处理 2.x 权限的 kind。`runCapability` 接受 2.x extension；宿主使用 `runDelegatedCapability` 支持调用链与 connector；旧动作/MCP 入口仍仅接受 1.x，2.x MCP 使用独立批准接口。

## 命令与验证

- 安装：`pnpm install --frozen-lockfile`；构建：`pnpm build`；全量测试：`pnpm test`（包含构建）。
- 定向测试先运行 `pnpm build`，再运行 `pnpm exec vitest run <测试文件>`；CLI 和跨进程测试会加载 `dist`。版本命令：`pnpm exec plums version`。
- 性能基准：`pnpm bench:performance`（包含构建），可用 `--out <report.json>` 保存报告，方法见 `docs/performance.md`。耗时和内存按同机同环境比较；回归测试断言查询执行次数、语句复用和缓存边界，不设 CI 毫秒门槛，SELECT 执行与 prepare 次数分别统计。
- 桌面开发：`pnpm desktop:dev`；macOS Apple Silicon 打包：`pnpm desktop:package`；平台符合性：`pnpm conformance:platform`。本仓库仅交付应用、宿主、公开 SDK 与官方底座，业务扩展和角色卡独立维护，不提交。例外：`packages/host/test/fixtures/extensions/` 下的测试扩展与自造角色卡夹具仅供 vitest 验收，在测试时打包；不进入构建产物或安装包，不作为官方扩展发布，应用不提供自动安装入口。夹具不得包含真实角色卡、真实密钥或复制自 AGPL/GPL 项目的代码。
- 常规测试用自造夹具和 Fake/Recording 适配器隔离真实外发、密钥及业务文件执行；CLI、运行时和桌面测试允许启动受测子进程。路径边界用临时元数据夹具，core 确认超时用虚拟计时器，隔离运行时超时按真实预算测试；POSIX FIFO 用例在 Windows 跳过。原生集成测试使用临时数据目录与自造凭据；系统密钥存储验收仅在显式选择时进行。
- 修复先用公开行为回归复现；并发修改覆盖同进程与跨进程，密钥修改覆盖删前/删后抛错和重启重试，数据库迁移验证安装、同意、启用、密钥引用及 MCP 数据保留。宿主变更按影响覆盖组件版本固定、Agent 隔离、组装恢复、调用链授权和界面恢复。

## 必须保持的契约

1. `payload` 不透明，内核不解释角色内容、不运行第三方代码；权限只来自 manifest 的 `permissions`。同 format major 的未知字段必须往返保留，导出保留传入的 `formatVersion`。
2. 1.x 动作依次检查已安装/启用/声明、同意、外发目标、write/egress 确认；确认返回后重新授权并检查权限档位和外发目标。1.x write 的实际执行与范围约束由调用方宿主负责。
   外发只经 `EgressSink`，不自动跟随重定向；MCP 指纹包含名称、描述、inputSchema，工具消失后撤销批准，宿主须传完整工具列表。
3. 密钥值只存 `SecretStore`，包、设置和数据库只保存引用；历史引用与更新清单在同一事务内保留，脱敏、导出检查及卸载也覆盖已移除字段的引用。
   等待全部密钥删除完成；失败不暴露底层异常。更新已提交后清理失败返回 `SECRET_NOT_FOUND`、`reason: SECRET_CLEANUP_FAILED` 和当前版本；通过后续更高版本更新或重试卸载清理，相同版本不能再次更新。
4. ZIP 路径、大小限制、大小写碰撞与文件/目录冲突在包文件写入前检查，导入/导出共用路径检查。导入先写 staging、插入安装记录，成功后才发布目录；失败方只能清自己的 staging，发布失败撤销本次安装记录。
   导入队列仅在同一进程内按 dataDir+id 排队；跨进程靠数据库唯一键保护。重复 id 返回 `IMPORT_INVALID`、`reason: ALREADY_INSTALLED`，不得覆盖已有记录或删除成功方文件。
5. 残留 settings：有 schema 时在导入写文件或更新交换目录前校验，失败导入不留包文件、更新保留旧版；无 schema 时导入拒绝且不读文件，更新不读不删。`setSettings` 校验失败使用 `SETTINGS_INVALID`，密钥引用错误仍用 `SECRET_NOT_FOUND`。
6. 2.x 权限 id 唯一；fs 操作按集合精确授权，write 不隐含 read；exec 按 cwdRoots 限定范围。跨格式更新、新操作、类别/目标变化和新增目录根须重新同意，不从未知 level 字段推断授权。数据库版本从实现取值，迁移保持权限 JSON、MCP、密钥引用及已有授权；历史 1.x 夹具固定格式，不跟随新包默认常量。
7. `runCapability` 与 `runDelegatedCapability` 在等待前复制请求，按校验→安装/启用/声明→同意→范围→确认→复核→放行审计→复核→Sink→结果审计执行。独立 core 兼容默认 read/list 不询问、write/exec/egress 每次确认；DesktopHost 每次创建 core 固定使用 `capabilityApproval: "task-or-confirm"`，未被有效范围覆盖的 read/list 也单次确认，内部重建不降低策略；可信宿主签发的有限期任务范围可复用 fs/egress 确认，任务内未选中的 read/list 也需单次确认。任务绑定当前实例、版本、声明、目录与调用链，复核时检查撤销/失效；只有布尔 true 放行单次确认；缺失/异常/非布尔/超时拒绝，默认 120 秒只作用于能力入口。跨扩展按调用链各方的权限与范围交集授权，2.x MCP 绑定 connector、permissionId 与工具指纹，并在执行前复核批准。绑定创建时复制固定，路径按真实目录边界检查；真实 FsSink 执行时防路径竞争，真实 ExecSink 隔离由调用方宿主负责。
8. 能力/确认审计按 callId 关联，不含内容、请求体、参数、输出或物理路径。首次异步路径检查前开始读取密钥，每个审计时点刷新并保留本次已读到的值用于脱敏，事件冻结后交给回调。缺少审计或执行前失败不得调用 Sink；CAPABILITY_FAILED 保留 callId、phase、executionState，不附底层异常；unknown/completed 勿自动重试。确认或异步审计期间状态、权限、路径变化须阻止执行。
9. 第三方前端使用独立沙箱 `WebContentsView`，开启上下文隔离、关闭 Node 集成、阻断直接联网与任意导航；SDK 绑定当前 Agent 和组件身份，不暴露管理接口。业务 JS 每组件独立 Node 子进程与 V8 isolate，不暴露 Node/Electron/隔离库对象，默认 64 MiB 与 5 秒同步执行预算，等待宿主不计入预算；管理、授权与恢复入口独立于包前端。
10. 桌面文件 I/O 使用目录句柄并拒绝符号链接，HTTPS 校验域名及解析地址、不跟随重定向，凭据由宿主按声明绑定注入，扩展与包前端不读取密钥明文。停用、移除、更新、组合或目录绑定变化时停止相关运行，绑定变化后重建 core；桌面受控 Node 使用固定系统 Node、宿主管理的文件/HTTPS/命令桥及 macOS supervisor；受控命令固定可信程序与读写根，不提供任意本机执行或本地 stdio MCP。可信管理窗口选择 fs/HTTPS/受控命令与策略最大范围及有效期（15 分钟/1 小时）；策略提供者固定到 `org.plums.policy` 1.0.0，每次操作严格返回 allow/deny/confirm，不能扩大声明、同意、MCP 批准或最大范围。10 秒策略超时/无效决定拒绝；等待后及执行前复核，租约到期取消对应 Agent 的任务与实例，重启租约归零。
11. 公共库仅共享按内容摘要保存的不可变组件与元信息，导入去重、不执行代码或授予权限；缺少依赖的组件可入库，加入 Agent 时必须满足依赖。同 Agent 不重复包 id，固定具体制品，更新须显式选择；被引用制品不得删除。安装记录、设置、同意、启用、密钥、MCP 批准和数据按 Agent 隔离；创建、组装与旧 Agent 迁移使用 staging/恢复记录，失败不发布半成品或覆盖原数据。允许空 Agent、无卡和多卡；SDK 仅读取当前 Agent 已启用角色卡，默认卡可替换或清空，无默认卡返回 null。组合与组件导出复用密钥检查，保留未知字段，默认排除设置值、密钥与运行数据。
12. 导入与组装面向非程序员：完整 Agent ZIP 导入后集中填写组件 schema 声明的配置（如模型、API Key、接口地址），统一查看权限、启用组件并打开界面；保留“直接使用”和“继续组装”两种选择，后者先收集公共组件再组装。角色 JSON/PNG、扩展和连接器支持独立导入与管理，无前端 Agent 显示通用资源状态页。协议需求在当前 Agent 内只有一个兼容候选且没有已有选择时，宿主自动绑定并通知用户，可随时更换；多个候选仍由用户选择，ZIP 中的绑定意图与用户选择优先，不自动重绑失效连接。自动绑定不授予权限。简化操作不得跳过声明、同意、任务范围/单次执行确认或审计；角色编辑、聊天及业务逻辑继续由扩展提供。
13. SDK v2 的 `plumsDesktop.connections` 引用本组件设置、密钥和 `service/https/request` 权限。宿主固定 origin、注入声明凭据并复核调用链；协议选择、模型、消息、路径与回复解析全部属于外装连接器，不保留宿主模型适配兜底。配置、密钥、声明与启用变化使旧绑定失效；`failResponse` 绑定当前组件当前调用的真实完成请求，不信任组件自报执行状态。旧 SDK v1 普通扩展继续运行，依赖旧模型服务的组件须显式升级。
14. 本机引擎的 SDK v2 声明与 `kind:engine` 公开权限一一对应，固定 Node 启动包内已验证快照。用户经可信窗口批准且长期授权保存成功后才启动；授权按 Agent/组件安装身份/引擎/权限声明保存，正常升级沿用，权限变化、新 Agent、新引擎及卸载重装重新批准，导出不携带授权。引擎拥有普通本机权限，不适用 isolate 的五秒预算；宿主仅提供 JSONL、受控依赖贡献回调、确认及生命周期管理，不提供模型、coding 或批准策略。前端关闭保留引擎，停用、更新与绑定变化停止运行；撤权立即阻止请求。macOS 监管器清理引擎及继承进程组的后代，TERM 三秒后 KILL，broker 断连仍清理；完整关停须等待 `DesktopHost.close()`。审计不包含业务正文、代码、密钥、物理路径或原始输出。

## 性能与缓存

- 设置项验证器按有效约束内容复用，编译前复制 enum 等可变值；LRU 最多 256 项，单个 schema JSON 超过 16 KiB 时正常校验但不缓存，编译成功或失败均清理 Ajv 内部 schema 缓存。schema 变更立即采用新约束，保持 TYPE→MINIMUM→MAXIMUM→ENUM 的单值错误优先级。
- `InstallStore` 仅复用固定 SQL 的预编译语句，每次执行读取当前数据库状态，关闭时清空；MCP 随工具数变化的 NOT IN 语句不入缓存。全局密钥脱敏用 `listSecretRefs` 一次查询当前与历史引用，不逐包查询或读取无关清单；不得用缓存绕过授权复核或密钥刷新。

## 修改边界

- 维护公开 API 与错误的 code/path/details 契约，`path` 使用 JSON Pointer；错误、日志和导出不得泄漏密钥值或被拒的设置值。公开的 `validatePackage`、`inspectPackage` 不作为内部重复删除。
- 合并或去重测试时保留双方独有的行为断言；代码组合完成后重新验证，历史提交的测试结果不能替代最终组合的结果。纯规则文档修改只需静态核对与格式检查。
- 不提交 `node_modules/`、`dist/`、`coverage/`、`release/`、`.artifacts/`、运行数据、真实角色卡或密钥；兼容实现只参考公开规范，不复制 AGPL/GPL 项目代码。

## 模型配置与本地交付

- 文本模型的基础配置只需协议、模型名称、Base URL、API Key；模型名称自由填写，授权目标随配置绑定，不要求用户修改组件清单以匹配服务商。协议由外装连接器处理，调用输入不能覆盖宿主绑定或凭据。
- 普通聊天不强制函数工具，工具模式由用户选择。协议验证覆盖文本回复、多轮历史和工具结果回传；兼容说明以已实现、已验证的协议为限，不宣称生图、TTS 或任意服务商都已支持，不默认增加分组或官网目录。
- 模型 API Key 使用 Agent 私有本地存储，保存、读取和重启不依赖系统钥匙串授权；本地文件使用私有权限与原子写入。除向已授权目标注入凭据外，不自动上传或同步；密钥引用、脱敏与导出约束保持。
- 本地验收交付目录只保留最新宿主安装包和完整 Agent ZIP；替换前核对文件和验证记录，再清理旧包及重复生成产物。验证记录存入 `.artifacts/`，清理不涉及源码、用户运行数据、个人助理依赖或正在使用的应用。
