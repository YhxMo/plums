# Plums 共同契约 1.0

共同契约 1.0 面向桌面平台和独立扩展作者。SDK 提供类型、结构解析、功能协商和回复顺序检查；宿主提供资源存储、共同运行桥、后台任务、受控 Node/命令、策略接入及独立界面。第三方行为与实际执行边界须分别验证，范围见[兼容矩阵](common-contract-compatibility.md)。项目档位仍不可用。

## 1. 作者接入与版本

平台工具、必需黑盒用例和作者适配器说明见[符合性工具](common-contract-conformance.md)，运行路径与第三方证据分别记录于[兼容矩阵](common-contract-compatibility.md)。工具通过不授予权限，也不自动提升绑定的 declared 证据。

第三方负责记忆、模型协议、对话、工具、业务界面与策略算法。平台只检查共同结构、身份、版本、授权、生命周期及声明的输入输出 schema，不解释业务正文。业务协议采用作者控制的反向域名，例如 `org.example.records`，不要把某个包 id 当作协议名。

四个版本彼此独立：包格式 `formatVersion`、桌面 SDK `sdkVersion`、共同运输信封 `commonVersion`、业务协议 SemVer。包版本也不是协议版本。共同契约 1.0 是 SDK v2 的增量；旧普通 SDK v1/v2 继续使用原桥。已将 `CommonPlatformSdk` 注入声明共同契约的受支持运行路径。

已有 `payload.plumsDesktop.protocols` 中的 `provides`/`requires` 是共同发现的基础，继续使用 `ProtocolProvider`、`ProtocolRequirement`、`checkProtocolCompatibility`。提供者声明 `id/protocol/version/contribution/features`；消费者声明自己命名的需求槽 `id/protocol/range/features/optional`。提供者的精确稳定 SemVer 满足消费者范围，且包含全部必需功能，才形成候选。`optional` 只允许未绑定，不允许不兼容绑定。未知同 major 字段往返保留，不参与授权。相同声明只证明元数据兼容。

新增共同平台声明 `CommonDeclaration` 包含 `commonVersion/features/runtime`，可包含资源需求、后台驻留声明 `background` 和策略提供槽。 `parseCommonDeclaration` 独立校验它；已把它接入 `payload.plumsDesktop.common` 的桌面声明校验，并要求资源需求引用公开资源权限；共同运行类型、功能协商与完整桥已接入。仅有 `common` 字段不证明运行已受控。`resources[].permissionId` 必须对应清单公开权限，桌面导入时已检查；共同声明只收窄需求，不能授予权限。资源权限的 core 联合类型和同意文案已由补齐。

共同信封接受 `1.N`（N 为非负十进制整数），未知字段保留，未知消息 kind 拒绝；必需新功能必须明确协商，不能靠 minor 猜测支持。1.x 只增加可选字段/功能，不改变已有字段含义、错误状态或安全规则；破坏性变更使用新 major。业务协议分别遵循 SemVer，新必需操作、行为或不兼容数据格式提高业务 major。数据格式兼容不由协议名字推导；适配/业务数据迁移由作者提供，平台不得默默改写正文。

当前版本功能名固定为 `resources-cas`、`events`、`task-attach`、`controlled-node`、`controlled-exec`、`policy-v1`、`ui-attach`。这些是可用实现的能力报告，不是授权。`negotiateCommonContract` 只比较必需功能；宿主仅在对应实现已验证时报告功能。

## 2. 发现、绑定及不可变身份

`discover(requirementId)` 返回当前 Agent 已安装、启用、依赖满足的候选。UI 区分声明匹配、内部符合性验证及真实第三方符合性证据，证据包含平台/制品摘要/测试版本，不把内部夹具标为第三方证据。新建、完整 ZIP 导入及加入组件时，没有已有选择且只有一个兼容候选的协议需求自动绑定并通知用户；多候选仍须选择，绑定意图与用户选择优先，失效连接不自动重绑。自动绑定不能授予权限。

绑定固定消费者安装身份、需求、提供者安装身份、制品 SHA-256、协议版本、功能、贡献入口与当前 generation。导入/导出的 `ProtocolBindingIntent` 只是便携选择，恢复时重新检查；不包含运行 handle、同意、资源资格或执行授权。`CommonBinding.handle` 是宿主生成、当前运行上下文限定的不透明句柄。包名出现在可信发现结果中，消费者代码只调用自己的槽和句柄。

`CommonActor` 的 Agent、组件、installId、制品摘要、instanceId 和 generation 全由宿主设置。每 Agent/组件拥有独立实例；相同制品并发使用不共享运行授权或私有设置。消息中的未知 `actor/agentId/namespace` 等字段只是数据，宿主不得用它们决定调用者。跨组件调用逐层追加真实 actor，拒绝循环、深度超过 16 或链中任何失效方；兄弟通信也通过各自声明需求，不提供任意地址消息总线。

停用、移除、更新、资源/目录/连接/策略绑定变化立即使受影响 generation 失效，取消对应调用并停止受管进程；旧句柄返回 `STALE_BINDING`。必须只影响本 Agent/安装实例的运行，不停止另一个有效消费者。异步确认、策略、审计、路径检查之后以及执行前，复核整条链、当前声明、资源资格、模式、绑定和任务期限。

## 3. 信封、业务 schema 与错误

SDK 根入口导出 `CommonEnvelope`、解析器及 Draft-07 schema。独立 schema 位于 [schemas](schemas/common-envelope-1.json)；离线使用，不访问 schema 的 `$id` URL。`parseCommonEnvelope` 复制 JSON 数据，拒绝函数、undefined、非有限数、BigInt、特殊对象、访问器、稀疏数组、循环和超过 32 层的数据；总编码最多 1 MiB。同 major 未知 JSON 字段保留。独立 JSON Schema 只做结构检查；资源需求按 id 唯一还必须执行 `parseCommonDeclaration` 的语义检查（Draft-07 的 uniqueItems 不等于按字段唯一）。结构校验不证明句柄/身份/授权有效。

| kind       | 必需内容                                 | 方向及语义                                       |
| ---------- | ---------------------------------------- | ------------------------------------------------ |
| `invoke`   | `callId/binding/operation/input`         | 消费者请求；不携带可选择的可信身份               |
| `cancel`   | `callId/reason`                          | 本调用者请求取消；幂等，不代表回滚成功           |
| `accepted` | `callId/sequence=0/taskId`               | 宿主接收后的句柄；接受不代表已执行               |
| `event`    | `callId/sequence/channel/data`           | 宿主重封装提供者事件，身份及序号不可由提供者伪造 |
| `result`   | `callId/sequence/executionState/outcome` | 一个终态；成功结果只能为 completed               |

以上消息都含 `commonVersion`。每个调用的序号连续增长；可以直接以 `result(sequence=0)` 拒绝未接收请求，否则先 accepted，再事件，再唯一 result。recognized 字段不可放入另一种消息中伪装控制语义。`CommonReplyTracker` 拒绝错 callId、序号跳跃/重复、后续 accepted 和终态后消息。宿主检查请求 callId 的活动唯一性；重发 callId 不自动执行或返回其他调用者结果。

业务 `input/value/data` 为 JSON，仍受作者声明的贡献 `inputSchema/outputSchema` 校验；不同作者可以使用现有支持的本地 Draft-07 子集，通过 `validateContributionValue` 验证。现有贡献校验器不接受 `$async`、`pattern`、`patternProperties`、`format` 或远程 `$ref`，schema 最多 64 KiB/32 层；这些限制同样适用于共同业务契约。共同平台不提供助理、私教、模型、工具编排的硬编码消息格式。

`outcome` 为 `{ok:true,value}` 或 `{ok:false,error:{code,path?}}`。错误码见 SDK `CommonErrorCode`；错误 path 是 JSON Pointer，不是磁盘路径。不得传底层异常、stdout/stderr、请求体、凭据或被拒设置值。平台内部错误的现有 code/path/details 契约继续保留；桥将其映射成共同错误，并保留同一 callId 与执行状态。

| executionState | 调用者应该怎样处理                                                 |
| -------------- | ------------------------------------------------------------------ |
| `not_started`  | 宿主确定尚未进入 Sink/程序；可在解决原因后发起新调用               |
| `unknown`      | 已开始、失联、取消或结果不确定；检查任务/资源状态，禁止自动重试    |
| `completed`    | 已执行，即使结果 schema 错误、结果审计失败或业务失败；禁止自动重试 |

deadline 使用宿主单调时钟预算，消费者 `timeoutMs` 只能缩短；默认调用预算 120 秒，上限 1 小时。等待权限确认默认 120 秒，超时拒绝。后台驻留进程可长期运行，但每个调用/权限租约仍有期限；驻留不能扩大授权。取消立即阻止新工作，取消等待可信 supervisor 的清理与结果收敛；副作用已经发生时不返回 not_started，也不自动回滚文件或命令。

## 4. 流、回放及生命周期

`tasks.create({lifetime:"frontend"|"agent",timeoutMs?})` 创建宿主拥有的 taskId，不授予 I/O，也不能选择另一个 Agent/组件作为 owner。Agent 后台归属需要组件 `background:true` 声明以及可信管理窗口明确启用该组件后台；默认随前端关闭取消。owner 是宿主绑定的当前组件运行身份，前端容器身份另行限定桥，不能伪造。每 task 最多一个 root invoke（`options.taskId`），再次 root 调用拒绝；嵌套调用有独立 callId，由宿主关联父任务。未指定 taskId 的 invoke 自动创建前端归属任务。任务期限与权限租约分别复核，后台驻留不保证期限后仍可执行。

提供者成功或失败结算时复核单调时钟期限；计时器回调尚未运行但期限已过，也中止任务范围并返回 `DEADLINE_EXCEEDED`。迟到内容不交付，取消状态与执行状态分别保留。

`tasks.status(taskId)` 返回当前 `CommonTaskSnapshot`：status 包含状态、根 callId（接受前缺省）、executionState、lastSequence（接受前 -1），以及可用时独立保留的终态 result。查询/attach 都限定同 Agent、当前组件或经可信管理明确允许接管的兼容 UI，整条执行链和新消费者资格重新核验；仅有 taskId 不足以访问。终态正文仅内存保留 5 分钟，不进入持久日志；重启只恢复状态元数据，没有 result 正文。`REPLAY_GAP` 不使当前 status/result 失效，也不重新执行。

事件每条最多 256 KiB，活动调用缓冲最多 8 MiB/256 条（先达到者生效）。SDK 异步迭代消费；宿主对慢消费者施加背压，无法收敛时停止生产并返回 `LIMIT_EXCEEDED`，不能无限内存积累。终态独立保存，不因事件缓冲溢出丢失。业务正文只在运行内存中短暂缓存，不进入审计或默认持久日志。

`attach(taskId, afterSequence)` 只附着到现存、同 Agent 且链中允许接管的任务，不重执行。宿主保留最多 5 分钟、上述大小内的尾部事件；落后于可用尾部返回 `REPLAY_GAP`，另可取得当前任务状态/终态。重启后没有业务事件回放；记录中断任务的 unknown 状态，禁止假定 completed 或自动重试。事件传输的交付语义是活动连接内有序、回放可重复；业务作者自行去重 seq，不宣称跨崩溃 exactly-once。

前端关闭只取消前端拥有的调用；明确创建为 Agent 后台的任务继续由可信宿主管理，组件运行实例保持活动，前端容器桥关闭后拒绝其旧消息；重开前端按 taskId 接管，不转移组件权限。停止、崩溃、停用、撤权和更新分别进入 `cancelling/stopped/crashed`，清理完成才报告停止。程序突然退出时在途调用 unknown，未交付执行的排队调用 not_started。宿主关闭必须等待所有受管进程退出；broker 断连由独立 supervisor 清理。

## 5. 共用与独立资源

同一个 `resources` 入口访问 shared 和 agent 范围。资源是宿主托管、正文不透明的 JSON 键值空间；资源 id、归属、内容契约/版本及资格是元数据。每 Agent 默认有一个独立空间，可同时绑定多个用户选择的共用资源组，例如个人背景与另一个项目。共用制品与共用数据分别选择。

逻辑绑定列表只列当前调用者可用资源，返回 `scope/ownerAgentId/operations/generation`，当前桌面还提供可选的本地槽名 `requirementId`。key 是不含 NUL 的 UTF-8 字符串，最多 256 字节，不作为文件路径；每值最多 1 MiB。namespace 可由作者组织正文，不能跨越资源边界。密钥、设置、安装记录、管理数据库、MCP 批准、策略租约和引擎授权永不成为可绑定业务资源。

普通模式中每次操作取以下交集：Agent 对资源的资格、组件对资源的资格、该组件公开 manifest 的资源操作集合、共同需求操作集合、整条调用链的有效范围、当前任务及策略范围。读/写/删分别选择，write 不隐含 read 或 delete。独立资源归属也不自动给予本 Agent 全部组件权限。绑定由管理 UI 创建，不接受包自报 owner 或共享组资格。

完全访问可在用户于可信窗口选择后跨 Agent 访问独立业务资源，允许 read/write/delete，归属保持。用户看到并选择操作集合、资源范围、参与组件与期限；全范围仅可覆盖业务资源。此明确例外可取代被访问资源的普通 Agent/组件资格，但仍须满足参与组件/调用链的 manifest 和共同需求声明、有效用户最大范围及策略决定。不能借该模式复制其他 Agent 的设置、秘密、执行授权或管理资格。删除资源容器、调整共享成员/资格等管理操作只在可信窗口完成；SDK delete 仅删除正文记录。

`read` 返回存在标志、revision 和存在时的正文；缺失初始 revision 为 `"0"`。write/delete 必须传 expectedRevision；宿主在一个 SQLite 事务中原子比较与提交，成功产生新的不透明 revision。删除保留带新 revision 的 tombstone，防止 ABA 和旧调用覆盖重建数据。竞争只有一个提交，其余返回 `RESOURCE_CONFLICT`，不附冲突正文；业务作者可读取后自行合并，不自动丢写或隐式重试。

已使用宿主私有资源数据库、WAL、跨进程事务及提交记录；进程中断前未提交事务回滚，提交后重启可见。响应失联时 unknown，有读取资格者通过 revision 检查；只有 write 资格者需先由有读取资格者核实或取得读取批准，不能直接重试未知完成的写入。资源组有独立引用关系，被有效绑定的组不能直接移除；解绑一个 Agent 不删除另一消费者资源。提供者换版不自动迁移正文格式；需要不兼容格式时新资源或由用户选择作者迁移，旧数据保留至明确移除。资源绑定/资格变化使 generation 失效。

## 6. 策略与权限模式

策略是普通兼容提供者，使用 `org.plums.policy` 业务协议 1.0.0、贡献 `tools` 的 evaluate 操作；算法完全由第三方提供。只有可信管理窗口可以为 Agent 选择/切换一个策略绑定和最大授权范围，不从普通前端或业务 SDK 接收模式修改。当前版本采用一个活动策略；复合算法可作为单个策略扩展，宿主不隐式合并不同策略的 allow。

宿主构造 `CommonOperationContext`：真实调用链、callId/taskId、类别/操作、本次逻辑 target/permissionId、无凭据的意图、用户最大范围、期限、modeGeneration、唯一 assessmentId 及规范化操作 SHA-256 指纹。策略可查看本次审批所需参数，但不能读取宿主密钥、原始凭据/输出、管理数据库或其他执行授权。策略计算过程不得再次发起被评估的能力或递归触发自身；补充契约新增宿主记录的 tier 与 requiresConfirmation；本地 intent 只提供脱敏命令摘要。超过 10 秒、异常、非规范返回、fingerprint 不符或提供者失效时，本需单次确认的操作回退可信确认窗口，无确认环节拒绝为 `POLICY_UNAVAILABLE`，从不失败到放行。tier 从宿主授权记录读取，requiresConfirmation 由 core 或资源宿主在授权后计算；扩展输入不能覆盖。回退不恢复已失效租约，可信窗口只批准本次操作；范围撤销、调用方变更和审计失败仍阻止执行。

`CommonPolicyDecision` 仅有 `assessmentId/operationFingerprint/decision`，decision 为 allow/deny/confirm。allow 只是用户最大范围内本次请求的决定；宿主经办能力的 confirm 必须显示宿主生成的真实上下文并由可信窗口返回布尔 true；本地入口的 confirm 可由有效执行项满足；deny 优先且不可被任何授权覆盖。自动 allow 只在最大范围内替代单次确认，审计记录 providerId、artifactDigest、mode、operationFingerprint、assessmentId、callId、调用链、tier 与结果；审计失败不执行。策略不能增加路径、资源、网络目标、操作或期限。结果再次校验当前绑定/资格/期限/完整链并审计后才执行；等待中切换/撤权使旧决定失效。

本地入口以 `category: "local"` 接入同一协议；target 为 engineId，operation 为 start 或 method，意图不含请求参数。本地最大范围来自本组件已确认的执行项，不使用短期租约。策略评估器、普通 common 运行/任务、资源范围与短期能力范围可与已确认本地入口共存；宿主经办请求仍需其自身有效授权。

模式偏好与策略绑定可以按 Agent 保存；有效授权租约只存在内存，默认任务 15 分钟、可明确选 1 小时。会话只承载展示及任务归属，不是隐藏权限范围。默认安全模式继续使用现有 read/list 也 task-or-confirm、未覆盖请求单次确认的桌面规则。完全访问/自动审查/高危人工及自定义模式都需要可信窗口选择活动范围，重启只恢复偏好，租约归零并重新批准；不得自动恢复全访问。新的组件、声明、策略制品或绑定变更撤销相关租约。

符合性测试使用三种固定输出策略和第四种自定义策略，证明接入机制可扩展；它们不是风险算法或 Coding 产品。策略决定不能取消 manifest 同意、MCP 工具指纹批准、目标及密钥注入、审计等现有契约。

## 7. macOS 执行边界

当前验证范围为 macOS 27.0.1 arm64、Node 26.5.1；最低验证系统为 27.0.1，不声称更早 macOS、Intel、Windows/Linux 已通过。原型结果仅证明已验证范围内的可行性；完整桌面与打包版须分别验证。

选定三种受限路径：无 Node 对象的 V8 isolate、受控 Node 后台、宿主受控命令。后两者在默认拒绝的 macOS Seatbelt 中运行，只有固定只读系统/运行时/制品内容、每实例临时 scratch 及明确授予的命令读/写目录；环境清空，不继承额外文件描述符。平台的数据库/密钥/设置/授权/真实 Agent 数据目录不能暴露给后台或命令。业务资源经统一桥读写。

Node 后台不直接获得持久目录/网络权限；文件/HTTPS/命令请求都交给宿主。受控命令是一次经过范围和策略批准的程序运行，其允许目录内的副作用属于该次操作，不宣称逐系统调用由 AI 决策，也不承诺文件事务回滚。命令默认无直接网络；网络通过宿主 HTTPS 接口。允许任意包内已验证的本机单进程程序或用户明确选择的可执行文件，但其依赖必须只读固定，不能解释成 unrestricted shell。

直接 fork、posix_spawn、任意 exec、detached 后代、Mach/Unix 网络与对其他进程发信号默认拒绝。当前选定程序不能自行创建非受管进程树；所需子命令须使用宿主入口，宿主为每个子命令建立相同受控范围、可信调用链和独立 supervisor。需要不受管子进程树的传统程序不属于此受限运行类型，不能自动降级为普通权限运行。这里选择可落实的 Node 后台与命令模型，不把所有传统 shell 工具都宣称兼容。

每个启动程序以新 session/group leader 运行并禁止 fork，防止通过 setsid 脱离监管；外部 supervisor 对取消、撤权、超时和 broker 断连执行 TERM，生产实现 3 秒后 KILL，等待退出再确认清理。授权根或模式变化不能修改已运行进程的旧沙箱：立即停止对应实例并重建，旧请求不自动重发。未来子命令组成的树由宿主跟踪全部单进程实例，而不是相信扩展提交的 pid。

Seatbelt 的 sandbox-exec 与 sandbox.h 是已弃用的平台设施，不能视为苹果对长期 API 的承诺；本机头文件标注 “No longer supported”。Apple 的 [App Sandbox 文档](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)及[继承规则](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)描述了另一种签名/App Sandbox 路径；它的静态容器/权限不直接提供本方案每调用的动态目录边界。当前实现使用已实测的 Seatbelt，启动时及打包验证必须先探测文件/网络/进程拒绝，设施缺失或边界失败时返回 `RUNTIME_UNAVAILABLE`，禁止回退到普通权限。XPC/App Sandbox helper 和虚拟机作为未来替代；当前实现不要求安装 VM 或额外服务。

现有 `engines` 按已确认的组件执行项运行，整机入口仍有普通本机权限，直接文件/网络/子进程操作不受宿主策略逐次约束。策略评估器可与本地入口共存，启动和请求经过 local 判定。普通 common 运行/任务、资源与短期能力范围可与整机入口同时活动。本地回调中的 common 子任务保留原链与本地运行上下文，并绑定实际父请求的取消和更早期限；资源按各方资格与有效范围交集授权，非 local 策略仍需租约。组件与租约变更已按受影响组件及其消费者清理；项目沙箱继续实施；不能把普通权限引擎改名后当作受控运行。

## 8. 独立 UI、恢复与兼容

每个 Agent 可选择一个默认完整前端并组合多个独立面板；备用完整前端可切换，也可单独打开。它们只通过共同桥消费绑定后端，不共享 renderer globals 或继承管理 IPC。Electron WebContentsView 保持 contextIsolation、无 Node 集成、直接网络和导航阻断；身份由可信 preload/host 绑定到 Agent、组件及实例。

平台保存面板/前端的稳定声明 id、制品选择、位置/尺寸和可见性。任务服务另外保存无正文状态元数据；布局不保存 taskId、接管批准或执行授权。重启恢复布局与选项，重新创建实例/句柄；租约和接管批准归零，须可信管理重新批准。缺失组件显示兼容诊断及可信重新选择入口，不自动连接另一个提供者。扩展自己的界面状态经它有资格的资源保存；宿主不持久保存聊天/业务正文。权限状态由可信只读接口展示，业务 UI 不能修改它。

本稳定线承诺普通 SDK v1/v2 组件在共同契约 1.x 中继续使用旧路径，移除需下一个 major、迁移说明及至少一个稳定版本的提前通知，不承诺日历日期。旧依赖宿主模型服务的组件仍须显式升级；不重新提供模型协议兜底。旧普通权限引擎不升级成受限程序，旧授权不能导入新模式。未知字段、秘密引用及安装同意的既有契约不变；导出排除秘密、运行数据和执行授权。

## 9. 开发与符合性入口

从 `@plumsjs/sdk` 导入 `CommonPlatformSdk/parseCommonEnvelope/parseCommonDeclaration/parseCommonPolicyDecision/CommonReplyTracker`；从提供者和需求的独立命名槽开始设计，不使用包名调用。例如消费者获取 `sdk.binding("records")` 后执行 `sdk.invoke(binding.handle,"find",{query:"fixture"})`，通过 `call.events` 消费事件、`call.result` 获取终态、`call.cancel()` 请求取消。资源修改先 read，再携带 revision 执行 write/delete；业务 null 与不存在通过 exists 区分。

当前版本可运行的入口：先 `pnpm build`，再 `pnpm exec vitest run packages/sdk/test/common-contract.test.ts`；`node scripts/common-contract-schema.mjs --check` 核对独立 schema；`node scripts/common-contract-execution-probe.mjs --out <report.json>` 在 macOS arm64 自造临时数据上验证直接边界和停止行为。它不会使用真实业务数据、凭据或外部服务器。原型成功不代表所有桌面运行路径已经集成。

公开黑盒工具必须分别报告结构声明、host 行为、真实执行边界、内部夹具及第三方证据，覆盖同制品双 Agent 并发、提供者替换、共享/独立资源、CAS/恢复、取消/回放、四种策略及两个 UI。没有第三方作者实际接入记录时标明“未验证第三方实现”，不能把相同名字当作行为兼容。

### 当前桌面资源接入

普通 isolate SDK 和可信绑定前端均提供 `plums.resources`（`CommonResourcesSdk`）。公开资源权限使用 `{kind:"resource",id:"records",target:"business",operations:["read","write","delete"],reason:"保存用户选择的业务记录"}`；`target` 也可收窄为 `agent` 或 `shared`。它不指定实际资源 UUID、归属或资格。`plumsDesktop.common.resources` 使用 `{id:"records",permissionId:"records",operations:["read","write","delete"]}` 引用权限；完整 common 声明还需 `commonVersion:"1.0"/features:["resources-cas"]/runtime:"isolate"`。

用户在管理页分别选择资格和槽绑定，再选择有限期普通或完全访问业务资源范围。作者按 `requirementId` 找自己的句柄，调用 read/write/delete；只有公开声明、真实整链与当前范围交集可执行。没有活动范围时，具备普通资格的单次访问仍需可信确认。活动最大范围内未选中的操作拒绝。可用资源描述中的 operations 同时反映当前调用链和最大范围。

资源错误在既有 SDK 桥中使用 `CAPABILITY_FAILED`，details 为 `reason/callId/phase/executionState`，不附正文或底层异常。资源服务每个请求只执行一次；`RESOURCE_CONFLICT` 无正文，unknown/completed 禁止自动重试。共同 invoke 返回独立终态信封。

### 当前统一运行接入

`plums.common` 已注入 ordinary isolate、可信绑定沙箱前端和受控 Node，沿用用户选择的 protocols 连接；提供者贡献处理器接收 `{operation,input}`。可用功能为 resources-cas/events/task-attach/controlled-node/controlled-exec/policy-v1/ui-attach。以两个内部界面验证同后端及兼容后端替换；当前证据不代表真实第三方或稳定安装包符合性。

任务状态与执行状态由宿主生成。每任务只有一个根调用，嵌套任务继承真实链及取消，不以作者输入重建身份。Agent 后台需声明和管理页开关，重开自己的前端可以附着；不同组件的接管由可信管理批准，并保守要求新消费者拥有原所有者全部权限结构、资源绑定操作资格与当前最大范围。未通过的组件不显示为候选。接管允许查询/附着/停止，不给予新的 I/O 或改变任务所有者；授权不持久，宿主重启后归零。

受控 Node/命令每次启动先用生产沙箱实测文件、网络、进程、环境与描述符边界；Node 固定 26.5.1，命令固定已选制品摘要及只读系统依赖。逻辑目录须是显式外部目录；平台 dataDir、其祖先/后代和 agent-data 不能作为命令范围。启动前检查目录实体、当前同意/权限/链和期限，程序得到只读快照、临时 scratch、显式读写根及空环境。单进程程序不能自行 fork/执行其他程序/联网。只读不由 write 推导。

默认安全模式的命令启动经过 exec 单次可信确认；已选策略模式由有效策略决定 allow/deny/confirm；已有 fs/HTTPS 任务最大范围同样约束命令读写根，不选中的操作拒绝。所有实际文件/HTTPS/资源仍经宿主现有 Sink 与 CAS 路由。HTTPS 在 DNS/凭据等待后再次复核。按组件确认的整机入口可与 common 运行、任务及资源/能力范围同时活动，各自的声明、范围、策略与取消仍分别复核；前端引擎桥只管理自己的组件。

停止等待真实子进程退出及快照清理，独立 supervisor 在 broker 断连后 TERM，三秒后 KILL。历史任务只保存无正文状态；中断且已分发的任务恢复 unknown，不重执行。允许审计失败为 not_started，执行完成后的审计/输出失败为 completed。撤权和绑定变化清除已有业务回放，保留管理状态。

当前验证用内部平台夹具与真实 Electron main/preload/broker/host 路由，未验证真实第三方扩展或稳定安装包。

固定程序可在同一 PID 中 self-exec 自己的不可变制品；仍继承原沙箱、目录、受管进程组、RSS 监管和任务期限。禁止 fork、执行其他程序或脱离监管，不能从 self-exec 获得新权限。初始环境为空，SDK 不接受 env；作者不能继承宿主凭据。绑定解释器也只有同一受控范围，不提供宿主拼接 shell 的入口。

### 独立界面接入

组件可只声明自己的 frontend、common 和 protocols.requires，不必同时提供业务后端或面板贡献。用户在可信“工作界面组合”中选择主界面和并排界面；备用主界面可单独打开，其默认 startup 选择保持。界面直接用本组件的 `plums.common.binding/invoke`，不经过另一前端的全局变量或贡献入口。每界面使用不同 Electron session 与 handle；同一组合的 `PanelContext.sessionId` 相同，表示组合会话，不能作为身份或授权。

`tasks.list()` 只返回当前组件仍有效的任务及可信批准接管的同 Agent 任务。`tasks.subscribe(taskId, callback, onError?)` 每 250ms 读取授权快照，首次和状态变化时通知，终态停止；可能跳过短暂中间状态，不是完整事件日志。取消订阅抑制在途回复且不取消原任务。需要业务事件时使用 call.events/attach 的连续 sequence 及有界回放；旧 handle、资格和接管批准失效时订阅停止并可调用 onError。

可信工作栏显示“部分界面未恢复”；管理组合页列出缺失、停用、摘要变化、损坏布局或面板连接不兼容。用户重新选择或显式保存来移除失效选择。布局在 Agent/主组件名下单独原子保存，关闭侧界面保留不可见状态；Agent 导出不携带布局、会话或接管批准。关闭兼作后端的界面只取消该容器的任务，保留其他有效消费者；最终会话关闭且无已批准后台任务时清理普通运行实例。取消主界面按原组件及相同加载文件摘要续接，不能让旧界面代码获得另一组件或新版代码的身份。

Electron 桥在消费者世界建立事件迭代器，preload 只代理固定身份的 RPC。直接网络、新窗口、外部导航及同包其他 HTML 导航均阻断。

共同界面的 legacy `plums.onEvent` 只接收本组件事件；跨组件业务事件经已绑定共同调用及任务资格传递。未声明 common 的旧默认 startup 前端保留同 Agent legacy 总线兼容；可信宿主按声明与当前容器决定，备用及侧界面不继承该广播资格。`panels.closed/session` 等可信生命周期通知继续送达相关容器。

桌面、宿主与 SDK 0.1.0 预览版的版本关系、旧桥保留承诺、恢复及打包验证入口见[桌面兼容与恢复](desktop-recovery.md)。
