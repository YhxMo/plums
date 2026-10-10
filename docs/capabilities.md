# 2.x 能力调用与宿主执行接口

`@plumsjs/core` 0.2.0 提供 `core.runCapability({ extensionId, permissionId, request })`，只接受已安装、已同意并启用的 2.x extension。清单中的 `payload` 不参与授权。1.x 继续使用 `runAction` 和原 MCP 入口；2.x 连接器与调用链通过新增 `runDelegatedCapability` 和 MCP v2 批准接口运行，见文末。

## 创建与绑定

```ts
import {
  createCore,
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  RecordingExecSink,
  ScriptedConfirm,
  type AuditEvent,
} from "@plumsjs/core";

const audit: AuditEvent[] = [];
const core = createCore({
  dataDir: "/host/plums-data",
  model: new FakeModelProvider(),
  secrets: new MemorySecretStore(),
  egress: new RecordingEgressSink(),
  fs: new RecordingFsSink({ data: new Uint8Array([104, 105]) }),
  exec: new RecordingExecSink({ exitCode: 0, stdout: "ok" }),
  roots: { workspace: "/host/user-selected-project" },
  programs: { test: "/host/bin/test-runner" },
  confirm: new ScriptedConfirm([true, true, true]),
  confirmTimeoutMs: 120_000,
  onAudit: (event) => {
    audit.push({ ...event });
  },
});
```

目录由宿主让用户选择，逻辑名称与实际路径在创建时复制，目录路径转为绝对路径；程序标识绑定到宿主选定的执行程序。内核没有运行期间重绑定接口。目录必须存在，示例 Sink 只返回预设结果，不实际读取文件内容、写文件、启动程序或联网；内核会读取路径元数据以检查范围。

`fs`、`exec`、`roots`、`programs`、`confirm`、`onAudit` 可省略。缺少所需绑定或 Sink 返回 `PERMISSION_DENIED`；缺少审计返回 `CAPABILITY_FAILED`，不会调用 Sink；没有 confirm 的写入、命令、外发请求返回 `CONFIRMATION_DENIED`。显式传入无效接口、绑定或计时值在构造阶段抛出 `TypeError`。`model`、`egress`、`secrets` 仍必需。

## 声明与请求

下列清单权限分别使用三个绑定：

```json
[
  {
    "id": "files",
    "kind": "fs",
    "target": "workspace",
    "operations": ["read", "write", "list"],
    "reason": "处理项目文件"
  },
  {
    "id": "tests",
    "kind": "exec",
    "target": "test",
    "cwdRoots": ["workspace"],
    "reason": "运行项目测试"
  },
  {
    "id": "send",
    "kind": "egress",
    "target": "api.example.com",
    "reason": "发送摘要"
  }
]
```

导入、`grantConsent(id)`、`enable(id)` 后调用：

```ts
await core.runCapability({
  extensionId: "demo",
  permissionId: "files",
  request: { kind: "fs", operation: "read", path: "README.md" },
});
await core.runCapability({
  extensionId: "demo",
  permissionId: "files",
  request: {
    kind: "fs",
    operation: "write",
    path: "notes.txt",
    data: new TextEncoder().encode("notes"),
  },
});
await core.runCapability({
  extensionId: "demo",
  permissionId: "files",
  request: { kind: "fs", operation: "list", path: "." },
});
await core.runCapability({
  extensionId: "demo",
  permissionId: "tests",
  request: {
    kind: "exec",
    args: ["--report", "report file.txt"],
    cwd: { root: "workspace", path: "." },
  },
});
await core.runCapability({
  extensionId: "demo",
  permissionId: "send",
  request: {
    kind: "egress",
    url: "https://api.example.com/summary",
    method: "POST",
    body: "summary",
  },
});
```

fs 的根来自权限 target。请求路径只用 `/` 分隔，拒绝绝对路径、盘符、UNC、反斜杠、`..` 路径段和 NUL；按真实路径及目录边界检查，允许根内符号链接，拒绝逃逸。读取要求普通文件，列目录和 exec cwd 要求目录。写入可创建或覆盖普通文件，父目录必须存在；不创建目录。write 不隐含 read 或 list。

exec 的程序来自权限 target，cwd.root 必须在 cwdRoots 中且有绑定。请求只接受 args 数组及 cwd，不接受程序路径、shell、env 或 stdin。内核单独传递每个参数，不拼接或解释命令。egress 复用 EgressRequest 的 url/method/body，沿用 HTTPS、域名、端口限制；传给 Sink 的 URL 规范化，不跟随重定向，返回的 redirectTo 需要新调用重新授权、确认和审计。多余请求字段与字段类型错误返回固定文案的 `TypeError`。

## 返回值与 Sink

每个结果含独立 `callId`，按 kind 和 operation 分支：

| 请求     | 结果                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| fs read  | `{ callId, kind: "fs", operation: "read", data: Uint8Array }`                                                |
| fs write | `{ callId, kind: "fs", operation: "write", completed: true }`                                                |
| fs list  | `{ callId, kind: "fs", operation: "list", entries: [{ name, type }] }`，type 为 file/directory/symlink/other |
| exec     | `{ callId, kind: "exec", result: { exitCode, stdout, stderr } }`，非零退出也是正常结果                       |
| egress   | `{ callId, kind: "egress", result: { status, body, redirectTo? } }`                                          |

FsSink.read/list 接受 `{ rootPath, path }`，write 额外接受复制的 data；路径均为检查后的绝对真实路径。ExecSink.run 接受 `{ program, args, cwd, rootPath }`。返回结果复制后才进行结果审计。

真实 FsSink 必须在实际 I/O 时维护目录边界，防止元数据检查与执行之间的路径竞争。真实 ExecSink 由宿主提供命令隔离，参数单独传入，不使用 shell；EgressSink 在 DNS 后拒绝回环、私网、链路本地地址，并限制大小与时间。记录式实现只验证调用契约，不提供这些真实执行能力。

## 确认与审计

顺序：校验并复制请求 → 已安装/启用/声明 → 同意 → 目标与操作范围 → 必要确认 → 重新授权和范围检查 → 放行审计 → 再次检查 → Sink → 结果审计。

独立 `createCore` 的兼容默认（`capabilityApproval: "legacy"`）在未进入任务模式时不询问 read/list，write/exec/egress 每次询问。可信宿主可在构造时选择 `capabilityApproval: "task-or-confirm"`，所有未被有效任务覆盖的能力（包括 read/list）都需要单次确认。DesktopHost 的每次 core 构造固定选择此策略，首次调用、停止后再次调用、配置/目录变更重建和宿主重启均保持；策略不依赖是否存在临时 grant，扩展和 SDK 不能修改。只有布尔 true 放行，缺失、false、异常、非布尔或超时均拒绝。能力确认默认超时 `DEFAULT_CONFIRM_TIMEOUT_MS = 120000`，`confirmTimeoutMs` 可设置为 1 至 2147483647 的整数毫秒。迟到同意或异常不会执行。本超时选项只作用于新能力入口，1.x/MCP/分享的既有确认行为保持。

在第一个 await 前复制路径、字节、args、cwd 和外发请求字段。确认期间或异步审计期间停用、卸载、同意丢失、权限范围/理由变化或真实路径变化，本次调用被拒；重新发起后才按当前状态授权。

`onAudit` 接收冻结事件，含 callId、时间、扩展/权限 id、能力类别、操作、逻辑目标、phase、outcome、executionState；拒绝事件可带 code。phase 为 confirmation/allow/result/denied。确认会记录 requested 和 allowed/denied/timeout/error/missing/invalid；结果记录 completed/failed。未知或非法请求无法安全识别的字段不记录。

事件不包含物理路径、完整 URL、文件内容、请求体、参数值、环境变量、stdout/stderr 或底层异常。已知密钥通过既有引用读取并脱敏，在首次异步路径检查前开始读取，本次调用读到的值保留至调用结束；随后卸载移除引用也不会让这些值重新出现在审计或错误中。审计回调不得将未审计的内容另行写入这些事件。

Sink 或审计失败使用 `CAPABILITY_FAILED`，details 为 `{ callId, phase, executionState }`。phase 为 sink 或 audit_confirmation/audit_allow/audit_denied/audit_result（内部授权故障为 authorization）。声明、同意与确认错误保留现有错误码；确认拒绝 reason 为 MISSING/DENIED/TIMEOUT/ERROR/INVALID。

| executionState | 含义与处理                                                                      |
| -------------- | ------------------------------------------------------------------------------- |
| not_started    | 没有调用 Sink；缺少或执行前审计失败会阻止执行                                   |
| unknown        | 已进入 Sink，但抛错或返回值不符合接口；可能已有副作用，核对宿主记录，勿自动重试 |
| completed      | Sink 已返回，结果审计失败；动作已完成，勿自动重试                               |

本入口每次只调用一次 Sink，不自动重试。审计实现与存储可靠性由宿主负责；任务范围的批准与显式停止/撤权有审计记录，其他生命周期操作尚无完整审计。

## 桌面宿主与调用链

`createCore` 的 `model` 为可选，原调用兼容；core 不运行模型循环。新增 `getPackage(id)`、`getPackageContents(id)`、`describeSettings(id)` 和 `getSecretReferences(id)` 供可信宿主读取。`describeSettings` 返回 schema、脱敏 values 和字段是否已配置的 secrets 布尔映射，不返回密钥值或引用；历史密钥引用仍参与脱敏、卸载和导出检查。

可信宿主用 `settingsSnapshot(id)` 读取呈现脱敏前的非秘密设置、默认值与密钥就绪布尔映射；密钥值和引用仍不返回。连接管理不要求未配置的密钥存在，允许用户进入配置后保存。此快照不绑定到 SDK 或包前端；对外界面继续使用 `describeSettings`。

```ts
await core.runDelegatedCapability({
  packageId: "connector",
  permissionId: "send",
  callers: [{ packageId: "extension", permissionId: "model-access" }],
  request: {
    kind: "egress",
    url: "https://api.example.com",
    headers: { Accept: "application/json" },
    stream: true,
  },
  mcpTool: {
    name: "lookup",
    description: "Lookup",
    inputSchema: { type: "object" },
  },
});
```

新入口接受 2.x extension/connector，最多 16 个调用者。身份链必须由可信宿主建立，每层检查安装/启用/声明/同意和相同请求范围；确认后及异步审计后再次检查。`callerIds` 仅记录包标识，审计不带调用内容。headers、stream、调用链和工具 schema 在等待前复制；结果可带响应头。

`checkMcpToolsV2(id, completeTools)` 核对完整列表并撤销消失或变化的批准；`approveMcpToolsV2(id, permissionId, tools)` 仅由宿主在用户批准后调用。`authorizeMcpToolV2` 只检查、不执行；实际工具请求使用 `runDelegatedCapability` 的 mcpTool，在确认和审计后复核同一指纹。新版批准存于数据库 5 独立表，旧 MCP 表和旧入口不变。

MCP v2 的连接器 permissionId 可对应 egress，或包含 request 操作的 `service/https` 权限；后者仍要求当前完整服务操作已获同意。HTTPS service 请求使用已绑定连接，逐调用者检查服务交集与范围，并在确认及审计后复核同一工具批准。批准结构只保存 tool、fingerprint、permissionId、approvedAt，不包含 URL、HTTP 会话或头。平台不实现 MCP wire 协议；远程客户端的测试子集见 [scenario-protocols.md](scenario-protocols.md)。

真实适配器、隔离和外装包约定见 [desktop.md](desktop.md)。core 仍不解释 payload、不运行第三方代码，不负责网络解析或真实 I/O 隔离。

## 宿主签发的任务范围

独立核心入口保持上述兼容默认，桌面固定使用 `task-or-confirm` 策略。可信宿主可通过 `taskScopePlan()` 获取当前实例预览，然后在可信窗口确认后调用 `grantTaskScope(fingerprint, durationMs, selection)`。`selection` 为 `{packageId, permissionId, operation}` 列表，操作是 `read/list/write/send`，必须是预览中的明确声明子集；省略表示选中预览全部 fs/egress 权限，不包括 exec。有效期必须大于零且最多一小时。角色卡、未启用组件、未绑定目录不进入范围。SDK 不暴露这些管理方法。

范围仅存当前 core 实例内存，绑定实例随机身份、安装/启用记录、清单与版本、同意记录、目录绑定及目录实体身份和外部数据库连接变更版本。升级、设置改变、停用、关闭、`revokeTaskScope()` 均失效；宿主另外在停止、组装与目录绑定变更时撤销并终止运行。`taskScopeState()` 返回 taskId 与到期时间。撤销不撤回已经完成的 I/O。

范围内的每次能力调用仍经过声明、同意、真实路径边界、调用链权限交集、MCP 指纹及执行前后审计。只有调用链全部主体均获批对应操作时免除重复确认。有效任务内未选中的 read/list 也需要单次确认；未覆盖的 write/egress 继续单次确认，单次同意不会扩大任务。声明外路径/域名直接拒绝。任务在确认或审计等待中撤销、到期、变更时，尚未开始的范围内调用不能执行。独立 core 曾进入任务模式后，在该 core 的任务到期/撤销后仍要求读取确认。桌面确认策略跨内部 core 重建保留，而内存任务范围仅属于当前 core 内存，销毁后不会持久化或复活；已开始的 I/O 不能被追溯撤回，宿主停止信号用于取消尚在执行的工作。

授权审计使用 `phase: task`；能力审计携带 `taskId` 关联本次任务，不包含物理路径、内容或凭据。任务范围不是 OS 沙箱。桌面已为可信选择的程序提供真实受控 exec；本地 stdio MCP 仍未提供。

## SDK v2 连接与本机引擎

通用 `service / https / request` 的效果为 egress，沿用外发任务范围或单次确认。声明绑定的 origin、保存配置、密钥版本和调用链共同决定授权；外装组件构造业务正文、解析回复。`failResponse` 只能报告当前组件当前调用的真实完成请求，保持实际 callId、HTTP 状态和 completed 执行状态。接口见 [SDK v2](sdk-v2.md)。

`kind: engine` 仅声明可由用户长期信任的本机引擎。它不能经 `runCapability` 或普通任务范围启动，不能借受控 ExecSink 启动普通权限引擎。可信策略接入对新受限路径选择固定提供者、用户最大范围及有限期租约，本地启动和请求已接入 local 策略，使用已有组件执行项作为最大范围；deny 拒绝，confirm 由该项满足。宿主经办能力继续要求有效策略租约。长期记录仅由可信管理入口写入；独立引擎进程拥有普通本机用户权限。普通扩展的 fs/HTTPS/MCP 授权仍适用于引擎主动选择的受控贡献回调。完整边界与协议见 [engine.md](engine.md)。

## 持久化引擎处理授权（Grant）

`Grant` / `GrantScope` 是 Agent 数据库中的有限期授权，与内存 `TaskScope` 分开。可信宿主先通过 `grantPlan({ownerId, engineId, scope})` 获取预览指纹，经独立授权窗口选择范围后调用 `createGrant({...plan, durationMs})`；有效期只接受 900000 或 3600000 毫秒。`listGrants(ownerId?)` 返回持久记录，`checkGrant(id, ownerId, {reads, outputs})` 检查当前有效性，`revokeGrant(id)` 先保存撤销再审计。SDK 不直接暴露签发接口。

范围中的 `reads` / `outputs` 是引擎声明的固定资源标识；`services` 列出实际调用链各组件、permissionId、operation、已配置 binding。授权绑定实例、安装身份、组件版本与完整清单、同意状态、所属整机入口的本地执行项及授权身份、设置修订和模型连接指纹。其他组件或其他入口的本地确认与撤权不会连带失效；所属入口撤权再批准不能恢复旧 Grant。重启保持有效期，不自动续期，导出只处理包制品，因此不携带 Grant。普通升级可以保留本地执行项，处理 Grant 仍需重新批准。

已有 Grant 的原始记录不改写；数据库首次接入逐入口规则时保存旧指纹所用版本及所属执行项的兼容锚点。检查仍验证当前完整清单、服务范围与执行项一致性，不恢复原本已失效的记录。签发时在数据库写锁内复核所属执行项和有限 Grant 撤销版本，跨进程撤权不能通过迟到签发恢复授权。

授权审计成功并且数据库事务保存成功后才生效；预览、授权或审计等待期间，所绑定的组件状态、服务范围或所属执行项变化拒绝签发。请求传入可选 `grantId` 与成对的 `grantScope`。范围内的模型服务调用免除重复外发确认，仍执行原声明、同意、调用链交集及执行前后复核。有效授权之外的动作回落到单次确认，单次确认不扩大 Grant；授权本身失效或调用链改变则拒绝后续调用。保留内容外发能力的既有后台 consent 不能替代处理 Grant。

授权与执行事件保留 callId、grantId、身份、固定操作分类和状态；不记录资源正文、模型参数、原始输出、密钥或物理目录。本机引擎的本地读写范围由已受信任的引擎适配层执行，Grant 不构成 OS 沙箱。

后台服务授权与有限 Grant 的 grant/revoke 审计在事件构建处保留本次生成的 `callId`、时间、类别、阶段、结果与执行状态，有限 Grant 还保留宿主生成的 `grantId`；组件与权限文字继续脱敏。内部审计失败保留 `{callId, phase, executionState}`，有限 Grant 保存失败保留原有 `{grantId, phase: "grant_save", executionState: "not_started"}`。这些控制字段只凭本次调用的私有错误来源恢复；适配器同码错误、旧错误重抛和任意业务同名字段仍完整脱敏。本次授权已读到的凭据继续参与后续错误脱敏，密钥读取失败隐藏底层异常。grant 审计失败不发布授权；revoke 先持久撤销，即使后续审计失败仍保持撤销并报告 `completed`。

## 桌面受控命令

可信管理为 exec target 绑定固定程序摘要与显式外部读/写目录，SDK 仅传 args/cwd。调用链每方必须同意该 exec 权限，且拥有全部所选目录的 fs read/write 声明；write 不隐含 read。活动短期任务范围必须覆盖这些目录操作，未选中即拒绝；exec 在未被已确认项目/组装覆盖时单次确认。执行前复核目录实体、程序摘要、整链状态与期限，再进入默认拒绝的系统沙箱；无直接网络、fork/执行其他程序、继承环境/额外 fd。

平台私有数据及 agent-data 不能作为程序读写根。程序只允许固定只读系统依赖；设施、依赖或真实边界探测失败则 RUNTIME_UNAVAILABLE。取消等待 supervisor 清理，unknown/completed 不自动重试。按组件确认的整机入口可与该受控模式、common 任务及资源范围同时活动，各自授权仍单独复核。详情见[共同契约](common-contract.md#当前统一运行接入)。

### 桌面第三方策略 gate

可信宿主可注入 `capabilityGate`；core 在完成原有声明、同意、整链和实际范围检查后调用它，并在确认、审计和 Sink 前后反复执行返回的 `assertCurrent`。只有可信宿主 gate 接受时替代本次安全模式确认；core 不加载或解释第三方策略。DesktopHost 的 gate 使用固定策略、严格决定 schema、10 秒超时与有效用户最大范围。未选择策略继续使用上述桌面安全确认；健康提供者缺租约时拒绝；core 向 gate 提供本次 requiresConfirmation，决定无效/超时或提供者失效时，仅本需要单次确认的操作回退可信窗口，其余返回 POLICY_UNAVAILABLE。回退不能恢复租约或越过 core 授权。SDK 没有 gate 配置权限。详见[SDK v2 策略接入](sdk-v2.md#第三方策略接入)。

### 本地入口策略

SDK 的 `CommonOperationContext.category` 新增 `local`。本地启动使用 `operation: "start"`，请求使用真实 method，target 为当前组件自己的 engineId。指纹绑定复制请求和当前执行项；意图不含参数。选定策略每次评估，deny 优先；confirm 由已确认执行项满足，不询问。上限不足或执行项缺失时先拒绝，不让策略代替授权。十秒超时、无效决定或审计失败同样拒绝。旧策略若不接受 local 输入须更新，否则返回 `POLICY_UNAVAILABLE`。

本地执行项不依赖短期策略租约；最大范围只列本组件入口与方法。本地请求的策略与放行/结果审计按同一 callId 关联。执行前复核绑定、授权及取消。已确认本地入口可与策略评估器、普通 common/资源/任务范围同时活动。本地回调中的 common 与资源操作保留真实父请求、原调用链及各方资格和范围交集；非 local 操作仍要求有效策略租约，不以本地授权替代。选择性生命周期与 fs/exec 档位确认覆盖已接入；原生项目启动继续失败关闭。

## 项目确认覆盖与策略边界

项目内已汇总确认组件的 fs 与受控 exec 可免单次确认；声明、同意、调用链交集、路径复核、策略 deny 与审计照旧，HTTPS、资源、MCP 不覆盖。每次请求核对所有调用者的组件确认、项目 dev/ino、受控程序及其所有读写根；等待期间授权身份变化返回 `LOCAL_COVERAGE_CHANGED`，放行/结果审计保留 tier 与 localAuthorizationId。项目授权、绑定复核与启动授权使用目录句柄别名扫描；Seatbelt 配置在创建阶段限制 link 和祖先目录操作。这些检查不是内核级 inode 防线，非后代进程运行期新增别名是已知风险，项目只适用于受信任目录。全后代容器未完成，项目启动仍返回 `TIER_UNAVAILABLE`；fs/受控 exec 的确认覆盖不代表项目入口可运行。

策略 deny 不可被授权覆盖，allow 仅在可信最大范围内替代所需单次确认。策略超时、崩溃、失效或返回无效决定时，本需单次确认的操作回退可信窗口，无确认环节的操作返回 `POLICY_UNAVAILABLE`；自动放行审计包含提供者身份与请求指纹。审计 reason 区分 POLICY_ALLOW/POLICY_DENY/POLICY_CONFIRM/POLICY_FAILED，确认事件保留回退原因；审计失败不执行。宿主不内置审查模型或自动批准开关。

连接内部配置使用已保存的原始非秘密设置及秘密就绪状态；describeSettings 只作脱敏呈现，不参与绑定解析或授权指纹。通用 HTTPS 请求头接受 HTTP token 头名（含合法标点），拒绝换行、NUL 及 Host、Content-Length、Connection、Transfer-Encoding、Proxy-Authorization、Proxy-Connection；声明凭据覆盖同名输入头。MCP v2 接受 service/https/request 权限的已同意连接器，仍复核工具指纹、完整操作同意及调用链。

项目配套模块提供真实工具链根探测、配置允许字段过滤、Agent/组件缓存管理和独立 CONNECT 代理。允许字段为 Git user.name/user.email/init.defaultBranch/core.autocrlf/core.eol/pull.rebase，npm registry/@scope:registry，cargo registries.<名称>.index/source.<名称>.replace-with/registry，pip global.index-url/global.extra-index-url/global.trusted-host。含认证的 URL 和认证、include、alias、hooks 字段不复制。可信管理入口提供配置显式安全读取与手动凭据批准/撤销，配置生成模块支持独立原子写入；配置、凭据、工具链、代理与缓存尚未接入项目运行时，详见 [engine.md](engine.md)。始终排除的位置包括 `.yarnrc`、`.config/pip`、`.pip` 和 `.cargo/config.toml`，额外只读目录不能覆盖这些拒绝项。

可信宿主可预留/释放本地凭据引用，以覆盖异步写入失败、授权 CAS 失败与卸载重试；这些 Core 管理方法不暴露给 SDK。批准绑定当前入口/主机及授权计划，值与转义值只存 SecretStore；授予/撤销审计不含值和物理路径。项目实际注入和完整容器仍未完成。

本地凭据授予与撤销审计的 `localCredential` 只包含 packageId、engineId、声明 id 和 host；不包含值、密钥引用、配置内容或物理路径，文本仍脱敏并冻结。
