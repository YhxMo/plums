# 可信本机引擎

普通扩展继续在独立 Node 子进程和 V8 isolate 中运行。整机本地入口由用户在 Agent 汇总确认中按组件批准，拥有当前操作系统用户的文件、子进程和网络权限。两者共享 Agent 组装与管理界面，但采用不同运行机制。

## 声明与启动

组件使用 SDK v2，并在 `permissions` 声明引擎权限。宿主不从 payload、名称、角色内容或导入行为推导执行授权。

```json
{
  "permissions": [
    {
      "id": "local-engine",
      "kind": "engine",
      "target": "local",
      "reason": "执行本机任务"
    }
  ],
  "payload": {
    "plumsDesktop": {
      "sdkVersion": "2",
      "engines": [
        {
          "id": "local",
          "title": "本机助手",
          "entry": "engine/main.mjs",
          "runtime": "node",
          "platforms": ["darwin-arm64"],
          "protocol": "jsonrpc-jsonl-v1"
        }
      ]
    }
  }
}
```

引擎与 engine 权限一一对应，不能保留指向未声明引擎的权限。首版仅支持包内 `.js`、`.mjs` 或 `.cjs` 入口，由宿主固定的 Node.js 程序及参数数组启动。组件前端无法指定可执行程序路径。支持平台必须包含当前 `platform-arch`。

### 档位声明与版本 8 存储

`kind: engine` 可声明 `tier: "project" | "machine"`；省略时按整机声明处理，清单不会被补写。项目声明可带 `network: {hosts: [...]}`、`toolchains`（node、git、rust、python、go）和 `credentials: [{id, kind, host, reason?}]`。这些字段只用于项目档位；主机候选沿用外发主机规则且仅允许 HTTPS 443，凭据必须指定候选范围内的具体主机。凭据 kind 为 npm-token、cargo-token、pip-index-auth 或 git-https，id 不得重复。字段只是请求声明，不授予执行、网络或凭据；未知字段继续保留，完整 engine 声明变化须重新同意。

当前阶段的每 Agent 执行服务管理该 Agent 的授权检查和独立入口进程。启动与每次请求都检查当前安装身份、完整入口声明、组件声明档位、上限和已确认执行项。上限不足返回 `TIER_REQUIRED`，缺少匹配执行项返回 `LOCAL_CONFIRM_REQUIRED`，不打开逐引擎首次信任窗口。含项目声明的组件在取得授权后执行独立的项目沙箱自检，仍返回 `TIER_UNAVAILABLE`；项目运行入口尚未接入。SDK 委托已接入完整请求调用链与取消；项目执行与管理界面按 [requirements-v1](requirements/requirements-v1.md) 继续实施。

### 项目配置自检与当前边界

宿主内部的 `projectProfile` 与受控命令配置分开，使用默认拒绝的 Seatbelt 配置，允许真实 Node、shell 与工具派生，固定项目、入口私有目录、只读工具链和快照范围。私有数据与原主目录配置拒绝规则覆盖额外只读根；网络默认拒绝，代理规则只接受一个可信宿主指定的 IPv4 回环 TCP 端口。这些规则尚未构成可用的项目运行时。

`ProjectSandbox` 只在自造临时目录中检查固定 Node、原生文件/网络/进程边界以及启动后的 inode 别名变化，不读取用户项目、配置或密钥。相同执行服务共享一次诊断；Agent 关停等待诊断与临时资源清理，自检清理失败也会继续停止已有整机入口。自检结果只保留检查名、状态与摘要，不携带物理路径或原始错误。非 macOS arm64 记录跳过。

目前正式检查仍发现：项目内已有或运行期间加入的硬链接能访问目录外 inode，`POSIX_SPAWN_SETPGROUP` 能脱离初始进程组。项目启动门始终拒绝；诊断通过也不能启用尚未安装的项目运行入口。原 `controlledProfile` 与其禁止派生的自检保持独立。完整 R17 的逃逸阻止、无副作用和脱组后代关停尚未通过。

构建后可运行 `pnpm exec node scripts/platform-conformance.mjs --runtime project --node <固定 Node 路径> --out <报告路径>`。项目报告与 common/SDK 证据分开，当前返回失败与非零退出状态；其他平台报告 `skipped`，同样不能作为项目可用证据。测试验证的是正确拒绝与诊断结论，不是 R17 已验收。

Agent 私有数据库版本为 8。`agent_tier` 保存档位上限与目录、组件确认范围，`agent_local_grants` 保存按安装身份、入口与完整声明固定的本地执行项。新数据库的读取默认上限为沙箱、无授权。上限本身不能使任何引擎获准执行；旧信任迁移只生成对应入口的执行项，不生成 fs/exec 确认覆盖。版本 8 增加本地凭据预留引用；旧版本 6/7 拒绝新库。凭据选择、注入与配置重建尚未接入。

6→7 迁移只复制安装身份与当前完整声明一致的旧整机信任。存在匹配项时，上限为整机以容纳这些入口；没有匹配项时保持沙箱。不复制目录、主机、凭据或组件确认覆盖，不授予其他引擎。旧 `engine_trust` 记录作为只读历史保留；原有限 Grant 及其授权版本、安装、同意、启用、密钥引用和 MCP 记录均保留。

迁移项在首次读取授权状态、引擎授权或有限 Grant 接口时等待元信息审计及其持久确认；缺少审计、审计失败或保存失败时不生效，重启可重试。审计只有 Agent 身份、迁移和未迁移计数；重试复用 callId，故写入后但确认标记保存失败时可能重复记录同一 callId。撤权、权限变化与卸载只修改新的执行项，不会从旧表恢复授权。core 的 `engineTrustSnapshot`、`grantEngineTrust`、`revokeEngineTrust` 签名保留并标为弃用，兼容视图仅读取有效整机执行项，不能批准项目档位。

### 可信宿主汇总授权接口

`DesktopHost.tierPlan(agentId, selection?)` 返回当前授权、各组件完整 permissions、本地声明档位、待确认状态和 fingerprint。`TierSelection` 指定上限、已绑定根中的项目目录与只读目录、此次审阅的组件及各入口获准的候选主机。组件声明档位取该组件全部 engine 权限的最高档位。项目目录保存真实路径和 dev/ino；授权记录不进入导出。

`confirmTier(agentId, fingerprint, selection)` 在可信确认入口一次列出所选组件和范围。涉及整机时包含“该扩展可读取和修改本机所有文件（包括 Plums 自身数据和其他 Agent 的密钥）、运行任意程序、访问网络”。只有布尔 true 才继续；拒绝、取消、超时和异常均不写授权。确认等待期间管理操作仍可执行；回答后和审计后复核 fingerprint、目录身份、授权版本及完整组装，迟到确认不能恢复被撤销的授权。数据库在写锁内原子提交上限与各执行项，失败不留下半份授权。拒绝和成功确认都记录元信息审计。

`lowerTier(agentId, ceiling)`、`removeTierDirectory(agentId, root, readOnly?)`、`revokeLocal(agentId, packageId?)` 不询问，按变更停止受影响组件的进程并等待清理后保存。清理失败仍保存撤权并返回安全错误；确认范围变更的清理失败不能新增授权。移除一个目录后保留剩余项目范围；根解绑、重绑或身份变化则撤销依赖该范围的项目执行项，整机执行项保持。`tierStatus` 与 `tierPlan` 读取时也检测目录身份变化。所有事件只含档位、逻辑根名、组件 id 和主机数，不含物理路径、正文或凭据值。这些管理方法没有绑定到 SDK、包前端或本地入口，`host.confirm` 和 `host.grant` 不能签发此授权。

当前接口只确认上限、目录、组件声明和主机。工具链探测、隔离配置、凭据批准、项目沙箱、fs/exec 免单次确认和管理 UI 仍未交付。项目执行项保存不代表项目进程可启动。

有限 Grant 绑定所属整机入口的当前执行项，包括授权身份；其他组件或同组件其他入口的本地确认、撤权不会使它失效。所属入口撤权再批准、档位降到整机以下、安装身份、完整清单、同意、设置或服务绑定变化仍使 Grant 失效。正常升级可沿用本地执行项，有限 Grant 因完整清单变化仍需重新批准。加入组件且现有组件、连接未变化时保留已有进程和有限 Grant；新增自动连接仍按 R10 撤销 Agent 已存 Grant。更新、移除与既有连接变更的选择性生命周期仍未完成，不代表完整 S-H 已实现。

数据库首次采用此规则时，`authority_grant_legacy` 为已有 Grant 保存原授权版本与对应执行项的兼容锚点。原 `authority_grants` 记录、指纹、有效期和撤销状态不改写，锚点不重新授予权限，也不恢复迁移前已失效的 Grant。6→7 迁移和已有 7 版数据库均支持；重启不重建锚点。旧 Grant 继续校验当前服务及完整清单，并要求所属执行项仍与锚点一致，撤权再批准不能恢复旧 Grant。

导入、填写配置和启用组件不会自动启动本地入口。必须先通过可信宿主汇总确认或有效旧信任迁移取得执行项。SDK、业务前端、`host.confirm` 和 `host.grant` 不能签发本地执行授权。`revokeEngine(agentId, componentId, engineId)` 保留签名，撤销该组件全部本地执行项，等待受影响进程清理后保存；清理失败仍保存撤权。

未变化的执行项在追加其他组件的汇总确认时保留原授权身份。新确认项使用独立随机身份；请求在等待审计期间撤销再重新确认也不能恢复旧请求。

### 本地执行策略

Agent 选择 `org.plums.policy` 1.0.0 后，每次启动和每次本地请求都评估策略。输入沿用 `CommonOperationContext`，使用 `category: "local"`、`target: engineId`、`operation: "start" | method`；意图只有本地类别、入口和方法，不含请求参数。宿主生成的指纹绑定复制后的请求及当前执行授权，策略回显 assessmentId 和 operationFingerprint。

本地最大范围来自该组件已有的执行项和 Agent 上限，不需要再签发短期策略租约。deny 拒绝；allow 和 confirm 都只在已有授权仍有效时执行，confirm 不再弹窗。策略不能签发本地授权。输入中的 maximum.selection 仅列该组件本次入口与方法；maximum.expiresAt 与 deadline 是本次操作预算，不改变持久授权的有效性。

策略最多计算十秒。异常、无效决定、错误指纹、递归调用或审计失败均拒绝，不回落人工确认。等待后、放行审计后及实际发送请求前复核策略绑定、当前执行项、组件状态和取消信号；撤销再批准也不能恢复等待中的旧请求。策略审计和本地请求审计共享 callId，只记录逻辑元信息，不附请求参数、输出或底层异常。未更新到 local 输入的旧策略返回无效决定时同样拒绝。

策略评估使用独立 isolate，可与本地入口共存。普通 common 运行/任务、资源范围和短期能力范围可与已确认本地入口同时活动；本地入口回调宿主经办能力时仍需原有声明、同意、链交集和有效策略租约。项目档位仍失败关闭。

## 按组件持久授权

本地执行项位于当前 Agent 私有 SQLite 数据库的 `agent_local_grants`，绑定 Agent 实例、组件安装身份、入口和完整 engine 权限声明，包含授权时间与授权身份。它与短期任务范围分开保存；`engine_trust` 只作为旧版迁移历史保留。

- 重启、停止、停用或普通版本升级保留授权，并停止旧进程。升级中的引擎入口、协议或代码更新不代表来源可信，也不单独触发重新信任。
- engine 权限声明变化、新增引擎、卸载重装或新 Agent 必须重新授权。撤销信任立即阻止新请求并停止引擎。
- 组件移除、卸载或 Agent 删除清除授权；组合导出不携带信任记录。

制品摘要用于检查安装完整性。启动比较安装内容与公共库中固定的制品，再运行独立的已验证文件快照。它不是发布者、签名、官方身份或可信来源判断。本轮没有发布者验证、来源审核或市场机制。

## SDK 和通信

业务扩展 SDK 与业务前端 `window.plums.engine` 提供相同的 `start(engineId)`、`request(engineId, method, input, requestId?)`、`cancel(engineId, requestId)`、`stop(engineId)`、`status(engineId)`。前端接口绑定当前组件，不能控制其他组件的引擎。前端可直接取消长任务，无须等待普通扩展串行运行器。SDK 委托链中的组件可请求自己的已确认入口，上游不会因此获得本地执行。启动与请求的 local 策略和审计使用完整调用链；宿主经办回调继续检查各方权限交集。

```js
await window.plums.engine.start("local");
const task = window.plums.engine.request("local", "run", input, "task-1");
// 独立按钮可同时调用：
await window.plums.engine.cancel("local", "task-1");
```

通信为 JSON-RPC 2.0 JSONL，一行一个 UTF-8 JSON 对象：

```json
{"jsonrpc":"2.0","id":"initialization-id","method":"initialize","params":{"protocol":"jsonrpc-jsonl-v1"}}
{"jsonrpc":"2.0","id":"initialization-id","result":{"protocol":"jsonrpc-jsonl-v1"}}
```

握手限时 30 秒；每条消息最多 1 MiB；每会话最多 32 个未完成请求、8 MiB 缓冲及待完成请求正文。业务请求不使用 isolate 的五秒执行预算；不属于 common 任务的单次请求最长 120 秒，附属于任务时使用父任务期限，已有上游期限与策略只能缩短期限。公开 requestId 只作宿主取消标签；JSONL 请求 id 每次由宿主重新生成。取消或原调用者信号中止时，宿主先关闭该请求的回调范围，再发送 `$/cancelRequest`；五秒内未完成则终止整个引擎，未确定任务返回 `CAPABILITY_FAILED`，`executionState: unknown`。崩溃和断连不自动重放任务。

引擎通知 `engine.event`，参数为 `{topic, data}`。宿主绑定组件身份后转发给该 Agent 的业务前端。事件和结果按宿主已知密钥脱敏；原始 stderr 不进入业务事件或审计。

引擎可发起受控回调：

回调在 JSONL 顶层携带 `parentRequestId`，对应收到的本地请求 `id`。宿主从活动请求恢复可信调用链、检查点和取消信号，不读取参数中的自报调用者。同时活动的请求若有不同调用链、Grant 或任务范围，回调拒绝；不能选择其中较宽的权限。委托请求必须关联；缺失、已完成、已取消或无效的关联拒绝。旧入口未携带该字段时，仅在唯一活动的本组件直接请求中兼容；空闲、握手期间及并发有歧义的回调拒绝。

- `host.invoke`：参数 `{packageId, kind, name, input}`，只允许当前组件声明依赖的当前 Agent 贡献。普通能力调用仍复核调用链权限、连接授权、任务范围与单次确认。不会传递管理接口或 SecretStore 值。
- `host.confirm`：参数 `{message}`，展示真实宿主安全窗口，返回布尔值。具体批准策略由引擎或外装扩展决定。

宿主不提供模型、coding、自动审查或完全访问业务策略。公共模型连接器可选；引擎可以自带协议、选择其他连接器或不使用模型。

## 生命周期和清理

当前管理页提供状态、启动、停止和旧“撤销信任”入口，权限区替换仍待实施。关闭业务前端或渲染进程崩溃只停止普通扩展运行与短期范围，保留独立引擎供管理页接管；重新打开界面可查询并重新连接。停用、更新、组合、配置或目录绑定变化会停止相关运行。

`addLibraryComponent` 和 `importComponent` 加入组件时，若原有组件与连接保持不变，保留当前会话与本地进程。新组件只完成安装，仍需同意、启用和自身本地执行确认；既有执行项不转授新组件。新消费者的单候选自动连接可以在此路径发布，已有消费者新增自动连接则继续走完整重建。等待中的调用只复核自身调用边的组件和连接，同时保留原链、目录、默认卡、设置及授权检查。

此路径只允许既有组件穿过当前宿主正在发布的准确加入日志。陌生日志、被修改的日志及其他事务日志继续阻断；发布失败关闭会话并保留恢复记录。它不改变更新、移除、目录或手动连接的生命周期，相关范围可以与本地入口共存，范围变更仍按既有清理路径执行。

macOS 上每个引擎由独立监管器创建进程组，后代默认继承此组。停止先 TERM，三秒后仍存在则 KILL。监管器在 broker 通信断开时执行相同清理，因此 broker 被强制杀死仍能清理该组。应用退出会触发 broker 的停止流程与审计，broker 等待清理后退出。`DesktopHost.close()` 返回 Promise，调用方应等待清理完成。

这是进程组监管，不是系统沙箱；获得普通本机权限的程序可以自行脱离进程组。Windows 首版仅支持直接进程终止，完整后代清理验收以 macOS 为准。

审计记录授权、撤销、启动、停止、崩溃以及每次本地请求的放行与结果。请求两条事件按 callId 关联，包含组件、入口、方法、调用链组件 id、声明档位和 executionState。事件按实际生成来源保留宿主生成的关联、时间、阶段、结果、状态和档位，冻结后交给审计回调；组件、入口、方法及调用链中的声明文字继续用完整密钥集合脱敏。`host.grant(action: "audit")` 的 callId、phase 和 executionState 来自入口自报，值继续脱敏，不视为宿主生成控制。事件不包含正文、代码、参数、密钥、物理路径或原始输出。放行审计失败不得执行；结果审计失败报告 completed，不自动重试。宿主不记录本地程序直接进行的文件、网络或子进程操作。

## 宿主上下文和处理授权回调

`initialize` 附带宿主固定的 `context: {agentId, componentId, engineId, dataDir, tier, projects}`。dataDir 位于当前 Agent 的 engine-data 下，以组件安装身份和引擎隔离，独立于每次执行的临时快照；普通停启与升级使用同一安装数据目录，新 Agent / 卸载重装使用新的目录。当前可运行整机入口的 tier 为 machine、projects 为空。扩展不能从前端请求中覆盖上下文。

SDK v2 引擎可声明 `grantResources: {reads: [{id,title}], outputs: [{id,title}]}`。`host.grant` 支持 action 为 list、check、request、revoke，以及固定 read/write/run 分类的 allow/result 审计。request 只打开宿主窗口，不接受组件自报身份、目标地址或权限；宿主从已声明依赖与实际模型 connection 解析调用链与目标，用户选择范围及 15 分钟 / 1 小时。撤权、到期、配置与清单变化后 list/check 不返回有效授权。

引擎调用 `host.invoke` 时可传 `grantId` 和 `grantScope`，宿主检查引擎身份并把授权传到连接器实际的 SDK capability 调用。委托中申请 Grant 时，原调用链各方也必须有对应 HTTPS 权限，并被写入固定服务主体集合；执行时不能改为省略上游的直接调用。引擎的 `$/cancelRequest` 通知会中止对应宿主回调；原本地请求完成或取消也关闭其全部回调范围，迟到确认不能继续执行。普通模型连接器、逐次确认和本机信任契约保持。JSONL 单条上限仍为 1 MiB，业务分页应留出协议空间。

引擎贡献回调使用按引擎隔离的连接器运行时集合，前端关闭或恢复不会中止覆盖有效 Grant 的模型请求；本机引擎停止、撤权、配置或绑定变化时清理对应运行时。普通前端调用继续使用原先的取消与任务范围策略。

本地回调中的 common 调用保留原调用链和本地运行上下文。它创建的子任务绑定真实父请求的取消与期限，即使父请求没有 common taskId；声明后台驻留也不能延长这个父请求。资源句柄绑定实际普通或本地运行实例，不能跨实例复用；读写仍按调用链各方的声明、同意、资格与资源最大范围交集授权。没有可复用资源范围时沿用单次确认。本地执行项不授予资源权限，也不替代宿主经办操作的有效策略租约；策略等待、确认与放行审计后继续复核。

## 协议需求回调

SDK v2 引擎可用 `host.protocolStatus` 查询自身需求，或用 `host.invokeProtocol` 提交 `{requirementId, input, grantId?, grantScope?}`。宿主在当前 Agent 内解析用户保存的具体提供者，复用 isolate 的调用边复核、完整权限交集、取消与审计。`host.grant` request 可以用 `requirementId` 替代具体 `packageId`，目标仍由宿主根据固定连接与 `connectionId` 解析。更换连接撤销 Agent 中已存 Grant，重新连接不会恢复旧 Grant。原 `host.invoke` 仍需要具体依赖；协议连接不伪造 dependencies。声明和完整生命周期见 [扩展协议](extension-protocols.md)。

## 与共同受控运行并存

本地入口按组件已确认的执行项与 Agent 上限授权，可与普通 common 运行/任务、资源范围、短期 fs/HTTPS 范围及策略租约同时活动。原互斥用于避免普通本机权限进程与受限运行混用；现在整机范围由用户按组件明确接受，本地权限不传给其他组件。项目系统沙箱尚未接入，继续返回 TIER_UNAVAILABLE。前端只管理本组件入口，宿主经办操作仍检查各方声明、同意、资格、范围、策略、取消与审计。

新 `plumsDesktop.common.runtime:"controlled-node"` 使用固定 Node、默认拒绝系统沙箱和临时 scratch，业务文件/网络/资源/命令经宿主桥。此路径不使用 engines 长期信任或普通本机 dataDir；后台任务单独声明、用户开关和每调用期限，详见[SDK v2](sdk-v2.md#共同契约-10)。本地入口生命周期及已有 Grant 继续独立检查，不能扩大资源或策略授权。范围变更仍走现有清理路径；完整选择性清理继续实施。
