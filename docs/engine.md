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

当前阶段的每 Agent 执行服务管理该 Agent 的授权检查和独立入口进程。启动与每次请求都检查当前安装身份、完整入口声明、组件声明档位、上限和已确认执行项。上限不足返回 `TIER_REQUIRED`，缺少匹配执行项返回 `LOCAL_CONFIRM_REQUIRED`，不打开逐引擎首次信任窗口。项目入口在取得授权后执行独立的项目沙箱自检，仍返回 `TIER_UNAVAILABLE`；同组件的整机入口按自身档位检查，不将项目入口提升为整机。项目运行入口尚未接入。SDK 委托已接入完整请求调用链与取消；项目执行与管理界面按 [requirements-v1](requirements/requirements-v1.md) 继续实施。

### 项目配置自检与当前边界

宿主内部的 `projectProfile` 与受控命令配置分开，使用默认拒绝的 Seatbelt 配置，允许真实 Node、shell 与工具派生，固定项目、入口私有目录、只读工具链和快照范围。私有数据与原主目录配置拒绝规则覆盖额外只读根；网络默认拒绝，代理规则只接受一个可信宿主指定的 IPv4 回环 TCP 端口。这些规则尚未构成可用的项目运行时。

`ProjectSandbox` 只在自造临时目录中检查固定 Node、原生文件/网络/进程边界以及启动后的 inode 别名变化，不读取用户项目、配置或密钥。相同执行服务共享一次诊断；Agent 关停等待诊断与临时资源清理，自检清理失败也会继续停止已有整机入口。自检结果只保留检查名、状态与摘要，不携带物理路径或原始错误。非 macOS arm64 记录跳过。

项目授权计划、目录绑定复核及启动授权现已运行原生目录句柄扫描：不跟随符号链接，对普通文件的设备号、inode 与 nlink 计数，全部别名必须出现在同一项目根内；缺少别名、目录身份变化、遍历失败或超过预算均返回 `TIER_UNAVAILABLE`。Seatbelt 配置允许项目内 link/linkat，拒绝项目外源及项目根与其祖先目录的 unlink/rename。新增真实测试验证这些创建行为，不重复运行历史 46 项诊断。

上述扫描不是内核级 inode 防线。配置生成后由非后代进程新增别名及校验与使用之间的竞争仍可能越界；历史诊断对裸配置的既有/运行期硬链接与脱组进程结论不因此撤销。全后代容器与项目运行入口尚未完成，`assertAvailable` 始终返回 `TIER_UNAVAILABLE`，没有整机或无沙箱回退。原 `controlledProfile` 与其禁止派生的自检保持独立，未通过的 R17 检查未改为跳过或放宽。

Darwin arm64 的自造实验确认，同沙箱广播能清理五种脱组后代并保留另一独立入口，但后代也能杀死单收割者并留下孤儿。另一个实验按收割者程序路径限定信号权限，普通子进程被拒绝；重执行该未防注入的程序时，DYLD 注入代码却能取得该权限。因此两个候选均未接入生产。程序路径条件本身不构成可信代码身份，进程表和信号 0 也未形成零残留证明。

构建后可运行 `pnpm exec node scripts/platform-conformance.mjs --runtime project --node <固定 Node 路径> --out <报告路径>`。项目报告与 common/SDK 证据分开，当前返回失败与非零退出状态；其他平台报告 `skipped`，同样不能作为项目可用证据。测试验证的是正确拒绝与诊断结论，不是 R17 已验收。

Agent 私有数据库版本为 8。`agent_tier` 保存档位上限与目录、组件确认范围，`agent_local_grants` 保存按安装身份、入口与完整声明固定的本地执行项。新数据库的读取默认上限为沙箱、无授权。上限本身不能使任何引擎获准执行；旧信任迁移只生成对应入口的执行项，不生成 fs/exec 确认覆盖。版本 8 增加本地凭据预留引用；旧版本 6/7 拒绝新库。可信手动凭据批准、撤销与引用回滚已接入；项目运行时注入、启动配置重建及按批/本机配置来源批准尚未接入。

6→7 迁移只复制安装身份与当前完整声明一致的旧整机信任。存在匹配项时，上限为整机以容纳这些入口；没有匹配项时保持沙箱。不复制目录、主机、凭据或组件确认覆盖，不授予其他引擎。旧 `engine_trust` 记录作为只读历史保留；原有限 Grant 及其授权版本、安装、同意、启用、密钥引用和 MCP 记录均保留。

迁移项在首次读取授权状态、引擎授权或有限 Grant 接口时等待元信息审计及其持久确认；缺少审计、审计失败或保存失败时不生效，重启可重试。审计只有 Agent 身份、迁移和未迁移计数；重试复用 callId，故写入后但确认标记保存失败时可能重复记录同一 callId。撤权、权限变化与卸载只修改新的执行项，不会从旧表恢复授权。core 的 `engineTrustSnapshot`、`grantEngineTrust`、`revokeEngineTrust` 签名保留并标为弃用，兼容视图仅读取有效整机执行项，不能批准项目档位。

### 可信宿主汇总授权接口

`DesktopHost.tierPlan(agentId, selection?)` 返回当前授权、各组件完整 permissions、本地声明档位、待确认状态和 fingerprint。`TierSelection` 指定上限、已绑定根中的项目目录与只读目录、此次审阅的组件及各入口获准的候选主机。每个入口分别采用自身 engine 权限的声明档位。项目目录保存真实路径和 dev/ino；授权记录不进入导出。

`confirmTier(agentId, fingerprint, selection)` 在可信确认入口一次列出所选组件和范围。涉及整机时包含“该扩展可读取和修改本机所有文件（包括 Plums 自身数据和其他 Agent 的密钥）、运行任意程序、访问网络。停止或撤销该入口后，它启动且已脱离其进程组的子进程可能继续运行。”。只有布尔 true 才继续；拒绝、取消、超时和异常均不写授权。确认等待期间管理操作仍可执行；回答后和审计后复核 fingerprint、目录身份、授权版本及完整组装，迟到确认不能恢复被撤销的授权。数据库在写锁内原子提交上限与各执行项，失败不留下半份授权。拒绝和成功确认都记录元信息审计。

`lowerTier(agentId, ceiling)`、`removeTierDirectory(agentId, root, readOnly?)`、`revokeLocal(agentId, packageId?)` 不询问，按变更停止受影响组件的进程并等待清理后保存。清理失败仍保存撤权并返回安全错误；确认范围变更的清理失败不能新增授权。移除一个目录后保留剩余项目范围；根解绑、重绑或身份变化则撤销依赖该范围的项目执行项，整机执行项保持。`tierStatus` 与 `tierPlan` 读取时也检测目录身份变化。所有事件只含档位、逻辑根名、组件 id 和主机数，不含物理路径、正文或凭据值。这些管理方法没有绑定到 SDK、包前端或本地入口，`host.confirm` 和 `host.grant` 不能签发此授权。

当前接口确认上限、目录、组件声明和主机；项目入口计划还包含工具链探测结果及注入的配置读取器返回的允许字段，变化时标为待确认。每个入口采用自身声明档位，混合项目/整机声明不再提升整个组件。管理权限区显示这些结果和真实缓存占用/清空。fs/受控 exec 的确认覆盖已接入；原生安全配置读取/原子落盘模块与可信手动凭据管理已接入；项目原生容器、启动和运行时注入仍未交付。项目执行项保存不代表项目进程可启动。

组装变化使等待中的旧确认失效；自动连接新提供者时停止受影响消费者。组件停止同时关闭相关界面句柄和资源租约，保留无关本地入口；Agent 级任务撤销关闭全部界面，显式资源撤销在审计失败时也先使旧范围失效。

有限 Grant 绑定所属整机入口的当前执行项，包括授权身份；其他组件或同组件其他入口的本地确认、撤权不会使它失效。所属入口撤权再批准、档位降到整机以下、安装身份、完整清单、同意、设置或服务绑定变化仍使 Grant 失效。正常升级可沿用本地执行项，有限 Grant 因完整清单变化仍需重新批准。加入组件且现有组件、连接未变化时保留已有进程和有限 Grant；新增自动连接仍按 R10 撤销 Agent 已存 Grant。更新、移除、绑定与撤权按受影响组件停止；项目范围扩展仍需重新确认，完整项目 S-H 受项目入口不可用阻塞。

数据库首次采用此规则时，`authority_grant_legacy` 为已有 Grant 保存原授权版本与对应执行项的兼容锚点。原 `authority_grants` 记录、指纹、有效期和撤销状态不改写，锚点不重新授予权限，也不恢复迁移前已失效的 Grant。6→7 迁移和已有 7 版数据库均支持；重启不重建锚点。旧 Grant 继续校验当前服务及完整清单，并要求所属执行项仍与锚点一致，撤权再批准不能恢复旧 Grant。

导入、填写配置和启用组件不会自动启动本地入口。必须先通过可信宿主汇总确认或有效旧信任迁移取得执行项。SDK、业务前端、`host.confirm` 和 `host.grant` 不能签发本地执行授权。`revokeEngine(agentId, componentId, engineId)` 保留签名，撤销该组件全部本地执行项，等待受影响进程清理后保存；清理失败仍保存撤权。

未变化的执行项在追加其他组件的汇总确认时保留原授权身份。新确认项使用独立随机身份；请求在等待审计期间撤销再重新确认也不能恢复旧请求。

### 本地执行策略

Agent 选择 `org.plums.policy` 1.0.0 后，每次启动和每次本地请求都评估策略。输入沿用 `CommonOperationContext`，使用 `category: "local"`、`target: engineId`、`operation: "start" | method`；意图只有本地类别、入口和方法摘要，不含请求参数；tier 取当前执行项实际档位，requiresConfirmation 为 false，扩展自报无效。宿主生成的指纹绑定复制后的请求及当前执行授权，策略回显 assessmentId 和 operationFingerprint。

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

公开取消只匹配当前已发送的请求，未知标签不保留到未来请求；测试须等待真实执行标记，不能用固定 100ms 等待假定请求已登记。common 任务在提供者成功或失败结算时重新检查单调时钟期限，即使计时器回调延迟也返回 `DEADLINE_EXCEEDED` 并中止子范围，不返回迟到内容。

引擎通知 `engine.event`，参数为 `{topic, data}`。宿主绑定组件身份后转发给该 Agent 的业务前端。事件和结果按宿主已知密钥脱敏；原始 stderr 不进入业务事件或审计。

引擎可发起受控回调：

回调在 JSONL 顶层携带 `parentRequestId`，对应收到的本地请求 `id`。宿主从活动请求恢复可信调用链、检查点和取消信号，不读取参数中的自报调用者。同时活动的请求若有不同调用链、Grant 或任务范围，回调拒绝；不能选择其中较宽的权限。委托请求必须关联；缺失、已完成、已取消或无效的关联拒绝。旧入口未携带该字段时，仅在唯一活动的本组件直接请求中兼容；空闲、握手期间及并发有歧义的回调拒绝。

- `host.invoke`：参数 `{packageId, kind, name, input}`，只允许当前组件声明依赖的当前 Agent 贡献。普通能力调用仍复核调用链权限、连接授权、任务范围与单次确认。不会传递管理接口或 SecretStore 值。
- `host.confirm`：参数 `{message}`，展示真实宿主安全窗口，返回布尔值。具体批准策略由引擎或外装扩展决定。

宿主不提供模型、coding、自动审查或完全访问业务策略。公共模型连接器可选；引擎可以自带协议、选择其他连接器或不使用模型。

## 生命周期和清理

管理权限区提供档位与范围汇总、凭据批准/撤销、缓存清空和真实项目自检；各入口独立显示启动、停止与崩溃状态。关闭业务前端或渲染进程崩溃只停止普通扩展运行与短期范围，保留独立引擎供管理页接管；重新打开界面可查询并重新连接。停用、更新、组合、配置或目录绑定变化会停止相关运行。

组件 worker 可能因停止、撤权、重新启用或租约到期被重启；组件不得依赖 activation 内存状态跨重启保留。调用方保存的 opaque 句柄在重启后仍须由宿主按当前绑定复核，失效时以 `STALE_BINDING` 拒绝，缺失或无效输入以 `INVALID_REQUEST` 拒绝，不自动恢复旧授权。

2026-10-10 的九文件四 worker 定向剖面（239/239）在 `resources-metadata::never revives a saved cross-process handle or resource range after disable and re-enable` 捕获预期重启：另一宿主停用再启用组件后，调用方的 `AuthorizedFoundationSession.check` 检出身份失效并停止旧实例，worker 在启动 309ms 后被停止、正常 `exit:0`，78ms 后重建；loadavg 为 4.8623/3.7871/3.6001。这次重启未见五秒执行预算、异常退出或策略租约到期触发。未插桩的历史全量无法还原准确先后顺序，本次证据支持预期生命周期路径，不证明所有负载超时均已归因。原始事件与静态入口清单见 `.artifacts/concurrency/profile-summary.json`、`restart-load-1.jsonl`、`worker-entrypoints.json`；显式重启后仍保存调用方句柄的既有回归继续覆盖该行为。

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

## 路线 A 的补充契约

项目档位保留绑定项目目录的直接读写。硬链接防护采用创建阶段拦截与目录句柄启动前校验，不是内核级 inode 防线；运行期间非后代进程新增别名及校验与使用之间的竞争是已知风险，仅适用于受信任项目。建议将项目纳入版本控制并保持提交干净；宿主不提供回滚，也不以 VCS 为授权前提。B 隔离副本与 C Endpoint Security 属于下一期。

进程容器必须终止全部后代（含脱组者），不通过整体禁止 posix_spawn 替代。此实现尚未完成，项目启动继续失败关闭。生命周期审计取运行入口的实际档位；授权提交失败或 CAS 冲突会追加同 callId 的 LOCAL_AUTHORIZATION_NOT_APPLIED 对账事件，此前 allowed 授权事件不表示记录已生效。

组件停用、设置、升级、卸载与本地撤权停止该组件及依赖它的消费者，保留无关入口；策略租约到期只停止租约所选组件及其消费者。新增普通任务范围不停止本地入口。目录变更重建 core 的固定绑定，保留无关本地服务和进程；Agent 删除、整体关停和 Agent 级范围变更仍等待全部清理。

资源与策略的单次确认共用 `confirm-once.ts`：显示前按当前会话刷新密钥值并脱敏，读取失败返回 false 并按确认拒绝处理，不显示窗口；只接受布尔 true，取消、拒绝、异常或 120 秒超时均返回 false；取消后的迟到 true 不生效。取消不会主动关闭已显示的确认窗口，窗口返回的结果会被丢弃。

## 本地请求的重复身份读取

本地请求保留放行前、审计后、发送前及完成后的每次复核。同一请求内以安装记录（含启用时间）、本地授权 revision、固定组件 pin.digest 与安装目录文件的 ino/size/mtimeMs 元数据为令牌，合并未变化的包身份/授权读取与底座兼容、不可变制品校验；同一次非完整复核内的令牌计算按会话合并，跨复核及完整复核均重读；请求开始、放行审计后和完成后三次复核总走完整路径，失败不缓存，不跨请求复用。元数据不读取正文、不跟随符号链接，也不能证明正文完整性；完整复核仍校验库归档摘要、安装字节及内置底座归档。Store 没有统一写事务入口，因此采用现有公开状态摘要，不新增 Core 状态接口；既有同步运行身份 checkpoint 的 SQLite data_version 继续检测其他连接的停用/再启用，授权最终读取仍检测撤权。

密钥引用每次枚举，失败即拒绝；非首末/放行后的复核不读取密钥值，密钥值在审计时点与完整复核时读取。审计及结果脱敏仍刷新密钥值。同意、恢复事务文件、策略、确认、项目目录别名检查与最终授权不缓存。请求复用 active 返回的授权指纹，避免同一复核内再做一次完全相同的 authorize。

安装身份令牌只异步读取元数据，不读正文、不跟随符号链接；每组件最多遍历 4096 项，超限记录 overflow 并禁用记忆复用。元数据只是变化提示，首次、放行审计后与完成后三次完整复核仍校验制品与安装内容，密钥与授权检查保持。

## 可移植的项目配套与确认覆盖

工具链探测先解析真实可执行文件，再取最小安装根：Node 取具体版本前缀，Git 支持 CommandLineTools、Homebrew 的具体版本及 usr 前缀，Rust 使用 rustup 指出的具体 toolchain（另检查 cargo），Python 取解释器前缀，Go 使用 GOROOT。主目录本身、其祖先、包含或位于始终排除位置的根均拒绝；不授权整个 .cargo、.rustup 或版本管理器。宿主 PATH 仅用于查找工具，不执行用户登录 shell 或启动文件；探测器可注入以隔离真实主目录。启动前重新探测及 PATH 注入依赖未交付的项目入口。

`collectConfiguration`/`renderConfiguration` 只接受 Git 的 user.name/user.email/init.defaultBranch/core.autocrlf/core.eol/pull.rebase，npm 的 registry/@scope:registry，cargo 的 registries.<名称>.index 与 source.<名称>.replace-with/registry，以及 pip 的 global.index-url/global.extra-index-url/global.trusted-host。认证、include、alias、hooks、SSH 命令与 URL 重写字段拒绝；URL 内嵌用户名密码或 token/auth/key/secret/password 查询键时丢弃整项，拒绝控制字符。`HostOptions.configurationReader` 可提供宿主读取器；默认不读取原配置。管理页显式“读取配置允许字段”使用目录句柄读取常规文件（128 KiB），拒绝符号链接、硬链接与 FIFO，不执行 include、helper 或环境插值。生成模块以 0600 权限原子替换 Git/npm/cargo/pip 配置，并返回隔离配置环境；变化须重新汇总确认。项目 launcher 的只读配置与环境注入尚未接入。

缓存位于每 Agent 的 cache/<组件 id 的 SHA-256>，创建权限 0700；变量映射覆盖 npm、pnpm、Yarn、Cargo、pip、Go、XDG 与临时目录。cacheStatus/clearCache 仅由可信管理桥调用，清空先停止受影响组件，拒绝符号链接和特殊文件；删除 Agent 时随实例目录清除。项目启动时创建和重定向缓存尚未接入。

ProjectProxy 已实现独立 IPv4 回环 CONNECT 服务，仅批准主机的 443 端口可用；复用 HTTPS 公网地址规则，混合公网/内网解析也拒绝，连接固定到验证过的 IP，并在连接前等待审计。停止关闭活动连接。不解密 TLS，不放行直连；每入口代理的创建/关闭与原生 launcher 接线暂缓。

宿主在已确认组装与项目目录内覆盖 fs/受控 exec 的单次确认：检查所有调用者的安装身份及完整权限，复核项目目录 dev/ino，exec 还检查固定程序及全部读写根。core 的 localCoverage 回调不授予声明外操作，确认、放行审计与 Sink 前重复复核；撤权、重确认、降级或目录变化阻止未开始调用。放行/结果审计包含 tier 与 localAuthorizationId，不含物理路径；HTTPS、资源、MCP 不覆盖，策略 deny 仍优先。

真实历史 schema 7（69c01b7）回归验证升级到 8 保留当时已确认入口与上限；第二个未确认入口不获授权，新 Agent 仍默认沙箱。这与将已有整机确认强制重置为沙箱不同；迁移不凭附件示例扩大或删去现有授权。

## 清理保证等级

整机档位与受控命令当前采用进程组清理，既有实验已证明可能遗留 double-fork 或 POSIX_SPAWN_SETPGROUP 脱组后代；停止或撤销不保证零残留。项目档位必须采用可终止全部后代的可靠容器；容器尚未实现，项目继续 TIER_UNAVAILABLE。该限制已在整机入口首次汇总确认中披露，逐次请求不重复展示。

## macOS 容器实验与可信凭据管理

2026-10-10 的旧独立标记实验在 Codex shell 内取得 GO：V1 已存在文件与 V2 mach global-name 对测试 profile 满足成员/控制校准。复审后的环境门测得 self=0、已知沙箱 self=1，但 no-network 探针被 SIGKILL，因此当前结论为 INCONCLUSIVE。第三方沙箱负控制、真实 projectProfile 与常量校对已补入测试，环境门阻止其执行；需普通终端复核，旧 GO 不能作为生产接线依据。

旧不存在路径的随机标记候选未通过本机校准：`sandbox_check` 对不存在的 `/usr/lib/.plums-*` 成员路径、控制路径及未沙箱 helper 均返回 1；同一调用检查已存在的 `/usr/lib` 则均返回 0，系统导出的 `SANDBOX_CHECK_NO_REPORT` 为 `0x40000000`。不能把不存在路径的拒绝当作成员证明；旧不存在路径候选的 11 个回收用例已移到 `project-members.experiments.test.ts`，仅通过 `pnpm test:experiments` 显式运行；默认套件显式验证项目入口失败关闭，不把该断言算作回收验收；11 项回收阻塞记录在 handoff。新变体未取得可采信的 GO，未接入生产或 launcher，项目继续 `TIER_UNAVAILABLE`。用户已决定有界实验 GO 后才实现，NO_GO 则停止 A1/A2/C2，不尝试第三种机制；当前 INCONCLUSIVE 等待普通终端证据。

真实实验验证：同沙箱信号广播可终止 setsid、setpgid、double-fork、POSIX_SPAWN_SETPGROUP 与普通 posix_spawn 后代，另一独立沙箱及外部哨兵不受影响。先使用非破坏的 SIGCONT 确认信号范围，再测试终止。该结果仍不足以采用单收割者：同沙箱后代可以杀死收割者并留下孤儿；本机 kill(pid,0) 与 proc_pidinfo 不能作为可靠的沙箱成员判定。现有生产监管仍仅进程组，不采用有丢失孤儿窗口的树轮询，项目启动继续失败关闭。

项目诊断另列 knownRisks：运行期由非后代加入的硬链接别名读写及外部 inode 变化。当前诊断仍保留原始失败检查，既有别名、容器和 launcher 未完成时不得放行；这些观察不是内核级 inode 防线。

DesktopHost.provideCredential(agentId, fingerprint, packageId, engineId, credentialId, value, username?) 仅由可信管理桥调用。当前入口及主机须已确认，凭据声明须匹配；可信窗口说明令牌的可读性，回答后复核 fingerprint。值不进入 TierSelection/计划/审计/导出。Core 先预留独立元数据、原值、用户名和转义值引用，再由宿主写该 Agent 的 SecretStore；提交失败只回滚未提交值，提交已生效时不误删。批准/撤销审计与授权变更使用同一通道，撤销先停止受影响组件再删值，失败保留历史引用供卸载重试。当前支持手动粘贴，按批和配置来源选择、真实项目注入及带凭据启动审计仍未完成。

ProjectStatus 返回真实平台诊断。界面显示通过数与失败状态，项目入口保持禁用；清空缓存先停止相关组件。可信宿主规范化 macOS 数据根（如 /var 的真实路径）后计算缓存位置，缓存内部符号链接与特殊文件仍拒绝。


## 项目容器与原生验收

PR #36 的macos-15诊断显示重签系统arm64e副本被preview ABI拒绝（原始程序成功，副本签名校验成功但直接SIGSEGV、Seatbelt SIGKILL）；受控系统命令的4个默认用例按OS主版本显式门控，并由ci/expected-skips.json双向核验，macOS27必须运行。其余公开平台case、一般失败关闭测试及macos-15已通过的项目沙箱/组清理/创建边界测试继续运行。最低系统仍为27.0.1。

项目档位原生容器与校准实验为“仅 macOS 27 验收”。11项成员实验的原因固定 `macOS 27 acceptance only`，条件为major<27且显式开启experiments；27上不能凭OS跳过，环境与机制阻塞仍须真实记录。project-members-variants保持记录型，不加跳过，macos-15的verdict用于证据，不能宣称项目档位可用。当前生产仍没有可靠全后代容器/项目launcher，项目入口继续返回TIER_UNAVAILABLE；发版前人工清单见release-evidence.md。
