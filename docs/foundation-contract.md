# 底座公开契约 1.0

底座是扩展代码的执行提供者。可信宿主保留 Agent/安装身份、权限、配置和密钥、审计与生命周期。替代底座自己加载扩展、实现所声明的 SDK；不能通过包装官方运行实例宣称独立实现。

本文件包含公开协议、可信注册与官方适配、公共库第三方接入、Agent 固定与切换，以及阶段 5 的官方制品和桌面管理。`DesktopHost` 已通过同一公共会话工厂运行官方或库内第三方组件会话；每 Agent 精确固定、需求检查和事务恢复见 [选择与切换](foundation-agent-selection.md)。官方离线 ZIP、旧版本执行、可信桌面入口和便携流程见 [桌面底座管理](foundation-desktop.md)。完整符合性另待后续阶段。独立 JSONL 原型仍可由公开 `@plums/host.startFoundationSession` 启动；其执行证据只覆盖最小 SDK 子集。可信库接入和作者接口见 [作者指南](foundation-author-guide.md)，官方工厂说明见 [阶段 2 决策](decisions/foundation-2.md)。

## 分开的版本与字段

| 对象          | 字段                                      | 当前值和含义                                                    |
| ------------- | ----------------------------------------- | --------------------------------------------------------------- |
| 包            | `formatVersion`                           | 2.x extension；core 仍只解释包和权限，payload 不透明            |
| 提供者声明    | `declarationVersion`                      | 1.x 声明记录；与包版本独立                                      |
| 接入传输      | `foundationVersion`                       | 当前协商 1.0；JSONL 会话协议                                    |
| SDK           | `sdk.id` / `version` / `range`            | 官方 API 线为 `org.plums.sdk` 1.0.0 或 2.0.0；不是 npm 制品版本 |
| 提供者制品    | 清单 `version`、选择 `digest`             | 精确 SemVer 和 ZIP SHA-256；同版本也不能替换摘要                |
| 需求 / 选择   | `requirementVersion` / `selectionVersion` | 各自 1.x；未来 major 拒绝，不猜测迁移                           |
| 共同/业务协议 | `commonVersion`、protocol version         | 保留原语义，与底座接入和 SDK 分开                               |

`common.runtime` 仍是执行方式 `isolate` / `controlled-node`，`plumsDesktop.runtime` 仍是包内业务 JS 入口。两者均不解释成底座 id。没有新增 core 包类别或权限。普通权限 engine 保持原入口和授权；原型拒绝同时承载 engine 声明。

## 提供者包

2.x extension 包在 `payload.plumsFoundation` 声明提供者。id 必须是带命名空间的小写标识，并等于包 id。提供者包的 permissions 必须为空，也不能同时声明 `plumsDesktop`。提供者是受控执行代理，不获得消费者权限的合集。平台声明不会降低宿主执行边界。

```json
{
  "declarationVersion": "1.0",
  "id": "org.example.independent",
  "foundationVersion": "1.0",
  "entry": "provider.mjs",
  "execution": "controlled-node",
  "platforms": ["darwin-arm64"],
  "features": ["session.invoke", "session.callback", "session.cancel"],
  "hostFeatures": [],
  "sdks": [
    {
      "id": "org.plums.sdk",
      "range": "^2.0.0",
      "features": [
        "sdk.register",
        "sdk.settings",
        "sdk.context",
        "sdk.capability"
      ]
    }
  ]
}
```

入口必须是存在的安全相对包路径；拒绝绝对路径、反斜线、NUL、空段、`.`、`..` 和驱动器路径。只有经过包检查并与固定 ZIP 摘要匹配的入口可以启动。首轮承载仅支持 macOS arm64 的固定 Node 26.5.1；其他平台明确拒绝，不退到无沙箱启动。

`features` 描述会话功能，当前必需 invoke/callback/cancel。SDK features 按 SDK 分组，不跨 SDK 合并。声明 1.1 支持可选 `sdks[].featureRanges: [{range, features}]`，仅对满足该 range 的 SDK 版本添加功能。`hostFeatures` 描述提供者需要的公共宿主功能，未知且未提供的功能导致不兼容。声明和版本范围只提供离线候选诊断，不自动产生行为认证。可信官方声明另有 `execution: builtin-adapter`。第三方提供者解析拒绝此执行方式；只有应用认可签名或固定迁移摘要的官方归档可进入独立可信官方加载器，见 [官方制品格式](foundation-desktop.md#官方离线制品与构建)。

## 需求、兼容报告与固定选择

组件在 `payload.plumsDesktop.foundation` 声明 `FoundationRequirement`。Agent ZIP 的 `agent.json.foundation` 是 `FoundationAgent`，可包含 requirement 和/或 selection；空对象拒绝。完整选择机制要求组件和 Agent 的全部必需功能都满足；阶段 4 已在创建、导入、组合变更和运行前检查 Agent 及全部可运行组件。当前 ZIP 的显式需求与选择约束宿主选择，缺少显式选择时拒绝自动运行。直接 archive 原型将调用者需求与组件需求取并集，不允许弱化组件声明。

```json
{
  "requirement": {
    "requirementVersion": "1.0",
    "protocolRange": "^1.0.0",
    "sdk": { "id": "org.plums.sdk", "version": "2.0.0" },
    "features": ["sdk.register", "sdk.settings"],
    "optionalFeatures": ["sdk.events"]
  },
  "selection": {
    "selectionVersion": "1.0",
    "source": "library",
    "id": "org.example.independent",
    "version": "1.0.0",
    "digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

可选 `providerId` 限定提供者身份。选择来源只接受 builtin/library，必须固定具体版本和 ZIP 摘要，不接受 latest、版本范围、远程 URL 或运行句柄。缺失、不兼容或已失效选择不得静默回退。被 Agent 引用的制品必须保留；阶段 4 已保存选择并保护被引用制品。

`checkFoundationCompatibility` 返回 compatible、diagnostics、missingOptionalFeatures 和 `evidence: "declared"`。诊断分别记录 PROTOCOL / SDK / FEATURE / HOST_FEATURE / PLATFORM / PROVIDER。未知可选功能可以缺失；未知必需功能不能被忽略。自定义 SDK 的离线声明和诊断可用，当前执行原型只实现官方 SDK 2.0.0 的下述子集，自定义 SDK 执行暂未实现。

旧组件和旧 Agent 没有 foundation 字段时继续读取；由可信宿主固定当前默认选择，已有固定记录不随应用默认变化。官方 ZIP 包含独立适配和运行依赖字节；已被引用的受信任旧归档按固定摘要继续执行。当前应用完整性另外核验。显式不兼容的新需求不能按“旧记录”兜底。底座选择不包含秘密、配置值、租约、批准、任务正文、物理路径或实例句柄；导出仍复用既有秘密检查。

## 离线解析

公开类型和函数位于 `@plums/sdk`：`FoundationProvider`、`FoundationRequirement`、`FoundationSelection`、`FoundationAgent`、`FoundationCompatibility`、`FoundationActor`、`FoundationSession<Context>`、两个方向的消息类型，以及 parseFoundationProvider / Requirement / Selection / Agent / Message、foundationProvider 和 checkFoundationCompatibility。

Draft-07 schema 在 [schemas](schemas/foundation-provider-1.json)：provider、requirement、selection、agent、message 五份。生成命令 `node scripts/foundation-schema.mjs`，核验命令 `node scripts/foundation-schema.mjs --check`；先执行 `pnpm build`。message schema 只校验提供者→宿主的 ready/activated/callback/result/fatal 消息；宿主→提供者的 prepare/activate/invoke/reply/cancel/stop/event 帧使用独立的宿主消息类型，不属于该 schema 的校验范围。schema 校验结构，公开解析器还检查安全入口、重复 SDK id、SemVer/range、必需会话功能和需求功能重叠。`foundationProvider(manifest, files)` 再检查包类别、权限、身份、声明互斥和入口存在。

同 major 未知字段在 JSON 解析副本中保留，不被解释成授权；原输入的后续修改不改变解析结果。schema/解析器拒绝未来 major。错误只给通用说明和 JSON Pointer，不带被拒值、代码、输出或物理路径。包读写继续保留原 formatVersion 和未知 payload。在线消息须使用本会话协商的准确版本，当前为 1.0。

## 公开启动入口和信任边界

`startFoundationSession(options)` 接收固定 Node 路径、提供者 archive+selection、消费者 archive+可信 agentId/installationId、需求，以及两个可信函数：bridge 和 assertActive。制品字节、选择、需求和身份在首次 await 前复制。宿主验证 ZIP、提供者 id/version/digest、消费者 SDK 与需求后创建独立端点和随机 instanceId。

`assertActive` 必须绑定真实安装、制品、选择与生命周期，每次等待前后检查其有效性。bridge 是可信宿主闭包，依照当前消费者、调用链和权限执行正常授权、确认、秘密注入和审计。提供者不能注册管理 IPC。阶段 1 测试直接连接真实 core 和原生 SecureFsSink；阶段 2 的官方适配和阶段 3 的第三方库适配均连接 DesktopHost 的同一桥。库适配使用公共工厂固定的 actor/instanceId，不重新签发另一套身份。

bridge 收到 method、args、宿主固定的 InvocationContext 和只读 FoundationActor。actor 包含 agentId、componentId、installationId、componentVersion、componentDigest、instanceId；调用 context 的 invocationId/resourceInstanceId 由宿主生成。调用链和 frontend/grant 范围在排队前复制。业务 input 中的同名字段没有身份效力。顶层消息和 args 中冒用身份、调用链或 context 会被拒绝。

提供者进程只能读取固定 Node、运行所需系统库及自己的只读制品快照；没有可写目录、业务目录、网络、进程派生、任意 exec 或继承凭据环境。扩展源码经 JSONL 传入，提供者自行加载。原型自身还在独立 VM realm 中创建 SDK 和调用扩展，不向扩展暴露 Node 对象。宿主不依赖这一 VM 来保护业务 I/O，恶意提供者直接调用 Node I/O 也受 OS 沙箱限制。

## 会话与消息顺序

所有消息是一行 UTF-8 JSON，包含 `foundationVersion: "1.0"`、宿主随机 `sessionId` 和 type。禁止输出非协议内容到 stdout。stderr 不能形成业务结果或错误。

1. 宿主发送 prepare：固定 binding、provider selection、sdk、协商 features、extension 的 entry/files/contributes，以及 limits。
2. 提供者只验证准备材料，返回 ready：相同 sdk 与 features。不得加载业务入口、执行贡献或发出任何业务回调。宿主未激活时 invoke 被拒绝。
3. 宿主在可信事务已提交且当前身份有效时调用 activate，并发送 activate；提供者加载业务入口并运行 `activate(plums)` 注册贡献，返回 activated。第三方 JSONL 载体在加载和注册期间禁止所有宿主回调，不能进行业务 I/O。官方适配仅允许受控元信息读取，见 [Agent 切换准备边界](foundation-agent-selection.md#事务与恢复)。阶段 1 的显式 activate 是测试激活门；持久切换事务在阶段 4 实现。
4. 激活复核成功后宿主串行发送 invoke：随机 callId、kind/name/input。贡献必须已声明；输入/输出 schema 在宿主验证。
5. 提供者发 callback：当前 callId、每次唯一 callbackId、method、args。宿主发 reply：对应两个 id、ok、value。reply 的错误只含通用 HOST_DENIED 和宿主 failureId，底层异常不进入提供者。
6. 提供者发 result：当前 callId、ok、value。每次只能一个终态，不得在未完成回调时提前结果。传播宿主错误时 value 传回 failureId；宿主保留该真实错误。普通提供者失败使用通用 PROVIDER_FAILED。
7. cancel/stop 使整个组件会话失效；宿主主动终止受控进程，协作消息不能延迟清理。close 等待真实进程退出和快照删除。回调 signal 被中止；可信桥应尊重 signal，迟到的完成被丢弃。不会重试、重放或自动改用官方路径。

ready/activated 重复、错版本/SDK/features、跨 session/call 的回调、未知方法、重复 callbackId、终态后的消息和提供者自报 executionState 都导致会话关闭。第三方 JSONL 载体在准备/就绪/注册阶段没有可执行回调上下文。

公开 FoundationSession 包含 ready/activate/invoke/deliverEvent/cancel/stop/close、instanceId 和 alive。event 使用独立宿主 callId 的 event/topic/event 帧及 result；必须协商 `sdk.events`。当前独立原型未实现 events，明确拒绝。业务流的 sequence、taskId、取消、回放与背压继续通过共同契约处理；底座传输不产生第二套业务事件顺序。

## 回调功能和预算

| SDK feature                                    | 回调                                        | 阶段 1 独立原型                       |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| sdk.register                                   | 提供者本地贡献注册                          | 已验证                                |
| sdk.settings / sdk.context                     | settings / context                          | 已验证，真实 core 设置与固定身份      |
| sdk.capability                                 | capability(permissionId, request, mcpTool?) | 已验证，真实 core 授权与原生文件 list |
| sdk.connection / sdk.protocols / sdk.resources | connection / protocol._ / resource._        | 类型和消息方法冻结；执行未验证        |
| sdk.common / sdk.events / sdk.invoke 等        | common.\* / emit / invoke 等                | 保留接入槽；独立原型未声称支持        |

未知方法不能交给 bridge。已知但未协商对应 SDK 功能的方法也拒绝。普通 engine 的方法不在原型能力桥中；不会继承 engine 的普通本机权限。

默认握手/激活各 10 秒，单次调用总期限 120 秒；可信测试可缩短，总期限上限 120 秒。OS supervisor 采样 CPU/RSS：准备和每次激活/调用窗口最多约 5 秒 CPU，250ms 采样有少量精度余量，等待宿主不消耗 CPU；超出关闭。提供者 Node old-space 64 MiB，进程 RSS 上限 256 MiB；它们与官方 isolate 的内存预算分别管理。原型 VM 同步脚本还设 5 秒 timeout。

单帧最大 1 MiB，单次最多 32 个同时回调、1024 个总回调；stdout 分段由宿主增量解码和限额，stdin 有界。原型通过 prepare 传输源码，只支持总 prepare 帧小于 1 MiB 的最小扩展；大型/二进制制品快照和完整 SDK 由后续阶段验收。取消、期限、断连、协议破坏后的执行状态：未发送 invoke 是 not_started，已发送后无法确认副作用是 unknown，收到终态是 completed；真实能力错误保留 core 的 callId/phase/executionState。提供者无权修改宿主执行凭据。

## 实际原型与验收入口

独立加载器在 `packages/host/test/fixtures/independent-foundation.mjs`，仅导入 Node 公开 API，实现自己的模块链接、SDK Promise/RPC、注册和调用，不导入 ExtensionRuntime、controlled-worker、sdk-bootstrap，也不包装官方实例。同一个 ZIP 的 main.js 由官方 ExtensionRuntime 和独立加载器执行，测试比较业务结果，同时保留各自新生成的调用身份。

执行 `pnpm build` 后运行 `pnpm exec vitest run packages/sdk/test/foundation-contract.test.ts packages/host/test/foundation-session.test.ts packages/host/test/controlled-execution.test.ts`。阶段证据在 `.artifacts/foundation-platform/stage-1/`，包括正常、故意恶意提供者、真实直接文件读写/网络/进程拒绝及无沙箱正控制。全部使用自造临时数据和无真实凭据。该独立提供者仅此明确子集具备内部执行证据。阶段 2 官方适配已有既有 SDK 回归；阶段 3 已验证第三方公共库导入、注册、公共工厂、DesktopHost 的最小真实桥与生命周期。阶段 4 的持久选择/切换与恢复已有内部回归；作者黑盒符合性和实际外部作者证据尚未完成。

## 子集作者实现规格

这一节给出阶段 1 最小子集的可实现细节。`foundationVersion` 的声明写 `1.n`，同 major 必须兼容 1.0 基线；用于 SemVer 范围比较时补 patch 0。当前宿主实际只协商 1.0，对应比较值 **1.0.0**。例如 `^1.0.0` 满足，`^1.1.0` 不满足，即使提供者声明 1.1 也不能把该消费者降到 1.0。兼容报告中的 foundationVersion 记录实际协商值。线上每一帧使用准确的 `"1.0"`。

合并同一组件会话的多份需求时，SDK id/version 必须相同且与组件 sdkVersion 的官方 API 线一致；features 取必需并集。不同组件分别检查，可以使用不同 SDK 主线，不跨组件合并功能。每份 protocolRange、providerId 都分别检查，相互冲突就拒绝。可选功能只添加提供者实际支持的项；其他需求已经要求某项功能时，该项成为必需。单份声明的必需/可选列表不能重叠。Agent foundation 没有 selection 时允许离线解析和 ZIP 检查，表示“待选择”；新声明不能自动启动或回退，可信管理入口须形成精确选择。阶段 1 的工厂必须显式传入 selection，尚未负责持久保存或桌面选择。

### 业务入口与 SDK 对象

最小扩展是 UTF-8 ESM，具名导出 `activate(plums)`。独立原型支持包内 `./` / `../` 的非循环相对模块图，拒绝 Node、远程和包外模块，不提供动态 import、fetch、process 或 require。activate 可以同步返回任意值，或返回 Promise；宿主只等完成，不采用返回值。注册期间不得调用宿主 API。调用 register 的 kind/name 应与清单 contributes 一致；未声明贡献宿主不会调用。原型对同 kind/name 再次 register 使用最后的 handler，未注册但被声明的贡献调用会失败；这两项不是“完整 SDK 已认证”的保证。

```js
export function activate(plums) {
  plums.register("commands", "check", async (input) => {
    const settings = await plums.settings();
    const context = await plums.context();
    const files = await plums.capability("files", {
      kind: "fs",
      operation: "list",
      path: ".",
    });
    return { settings, context, files, value: input.value };
  });
}
```

| 方法                                          | 返回值 / 对应 callback args                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `register(kind, name, handler)`               | void；kind 为 commands/tools/connectors；handler(input) 返回 JSON 值或 Promise；不产生宿主回调                                    |
| `settings()`                                  | Promise<Record<string, JSON>>；method=settings，args={}；仅当前组件设置值与密钥引用，不读取密钥明文                               |
| `context()`                                   | Promise<{agentId, componentId, invocationId, frontend?}>；method=context，args={}；宿主固定身份，frontend 是既有公开 PanelContext |
| `capability(permissionId, request, mcpTool?)` | Promise<JSON>；method=capability，args={permissionId, request, mcpTool?}；宿主依当前安装、调用链、权限、范围、确认和审计执行      |

本阶段 capability 的实际原生验收是 fs/list。request 是 `{kind:"fs", operation:"list", path:"."}`，path 为绑定目录内相对路径。value 是 `{callId, kind:"fs", operation:"list", entries:[{name,type}]}`；type 是 file/directory，callId 为 core 生成的能力调用 id，与会话的贡献 callId 分开。其他能力请求沿用公开 CapabilityRequest，但本原型尚未验证二进制 read/write 传输、HTTPS、exec 或 MCP，不能据此声明这些兼容。

所有子集 SDK Promise 拒绝都构造扩展 realm 内的通用 Error，并保存宿主 reply 的 failureId。如果该错误传播到贡献失败终态，value 必须为 `{failureId}`；宿主据此还原本次记录的真实错误，不接纳作者自报 code/phase/executionState。扩展可以自行捕获拒绝并返回正常业务结果，这不改变真实宿主审计和执行凭据。贡献返回 undefined 编码为 null；其他正常结果必须可 JSON 序列化，不能包含 BigInt、循环引用或跨进程对象。

### 完整的一次 JSONL 往返

下例的 I/P/C/R 分别是示例 sessionId、贡献 callId、callbackId 和能力 callId。生产值由宿主生成或限定。示例为便于阅读可能展开或并列多帧；每个 JSON 对象实际压成一行发送。binding 中的 identity 只能由宿主提供。

宿主先发 prepare（files 可包含同制品的其他包内模块）：

```json
{
  "foundationVersion": "1.0",
  "sessionId": "I",
  "type": "prepare",
  "binding": {
    "agentId": "agent-a",
    "componentId": "consumer",
    "installationId": "install-a",
    "componentVersion": "1.0.0",
    "componentDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "instanceId": "I"
  },
  "provider": {
    "selectionVersion": "1.0",
    "source": "library",
    "id": "org.example.independent",
    "version": "1.0.0",
    "digest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "sdk": { "id": "org.plums.sdk", "version": "2.0.0" },
  "features": ["sdk.register", "sdk.settings", "sdk.context", "sdk.capability"],
  "extension": {
    "entry": "main.js",
    "files": {
      "main.js": "export function activate(p){p.register('commands','check',()=>p.capability('files',{kind:'fs',operation:'list',path:'.'}));}"
    },
    "contributes": { "commands": [{ "name": "check", "title": "Check" }] }
  },
  "limits": {
    "maxFrameBytes": 1048576,
    "maxCallbacks": 32,
    "synchronousMs": 5000,
    "memoryMiB": 64
  }
}
```

提供者准确回传 sdk 和协商 features，然后宿主激活、提供者确认：

```json
{"foundationVersion":"1.0","sessionId":"I","type":"ready","sdk":{"id":"org.plums.sdk","version":"2.0.0"},"features":["sdk.register","sdk.settings","sdk.context","sdk.capability"]}
{"foundationVersion":"1.0","sessionId":"I","type":"activate"}
{"foundationVersion":"1.0","sessionId":"I","type":"activated"}
```

宿主调用已声明贡献；提供者为该调用请求一次实际文件 list；宿主 reply；提供者结束：

```json
{"foundationVersion":"1.0","sessionId":"I","type":"invoke","callId":"P","kind":"commands","name":"check","input":{"value":7}}
{"foundationVersion":"1.0","sessionId":"I","type":"callback","callId":"P","callbackId":"C","method":"capability","args":{"permissionId":"files","request":{"kind":"fs","operation":"list","path":"."}}}
{"foundationVersion":"1.0","sessionId":"I","type":"reply","callId":"P","callbackId":"C","ok":true,"value":{"callId":"R","kind":"fs","operation":"list","entries":[{"name":"business.txt","type":"file"}]}}
{"foundationVersion":"1.0","sessionId":"I","type":"result","callId":"P","ok":true,"value":{"callId":"R","kind":"fs","operation":"list","entries":[{"name":"business.txt","type":"file"}]}}
```

settings/context 使用同样帧和 args={}，reply.value 分别是设置 object、上述固定身份 object。宿主拒绝 callback 后的可传播失败：

```json
{"foundationVersion":"1.0","sessionId":"I","type":"reply","callId":"P","callbackId":"C","ok":false,"value":{"code":"HOST_DENIED","failureId":"F"}}
{"foundationVersion":"1.0","sessionId":"I","type":"result","callId":"P","ok":false,"value":{"failureId":"F"}}
```

提供者自己的失败用 `result`、`ok:false`、`value:null`；宿主报告 PROVIDER_FAILED/completed。无法继续协议时可发 `{"foundationVersion":"1.0","sessionId":"I","type":"fatal"}`，宿主关闭并按本次是否已派发确定 not_started/unknown。控制 stop/cancel 是仅含版本、sessionId、type 的帧，不含 callId；当前宿主取消直接终止进程，不等作者答复。事件帧（本原型不支持）为 `{foundationVersion,sessionId,type:"event",callId,topic,event}`，以普通 result 完成，仍不得自行指定业务 sequence。

当前接纳方法完整列表：settings、context、capability、connection、invoke、character、characters、emit、mcpCheck、failResponse、resource.list/read/write/delete、protocol.status/invoke、common.describe/bindings/invoke、common.tasks.create/status/list/cancel、common.policy.status。resource._ 映射 sdk.resources，protocol._ 映射 sdk.protocols，common.\* 映射 sdk.common，emit 映射 sdk.events；其余映射 `sdk.`+method。阶段 1 最小加载器只声明并实现 register/settings/context/capability，其余槽没有独立执行证据。每帧公共字段必需；上述各类型示例出现的其余字段均必需，mcpTool/前端/贡献 schema 和附加模块按声明可选。未知同 major 附加字段保留，但提供者消息的 reserved 身份/context/executionState 字段和 args 中的身份/context 冒用字段禁止，不能借附加字段创建权限。此限制不禁止可信宿主的 prepare.binding 或 context 的正常 reply.value。

### 可信宿主启动与清理责任

以下片段表示原型接入点，`providerZip`/`consumerZip` 是已准备的字节，`providerSelection` 含精确 ZIP 摘要；`verifyCurrentInstallation` 与 `dispatchAuthorizedSdk` 是可信宿主已有检查/桥闭包，不由包提供。阶段 3 的库适配已把此独立受控提供者接入 DesktopHost 的同一可信桥；直接 archive 原型接口继续保留。公共库作者接入示例见 [作者指南](foundation-author-guide.md)。

```ts
import { startFoundationSession } from "@plums/host";
const session = await startFoundationSession({
  nodePath: fixedNode26Path,
  provider: { archive: providerZip, selection: providerSelection },
  component: {
    archive: consumerZip,
    agentId: "agent-a",
    installationId: "install-a",
  },
  requirement: {
    requirementVersion: "1.0",
    protocolRange: "^1.0.0",
    sdk: { id: "org.plums.sdk", version: "2.0.0" },
    features: ["sdk.register", "sdk.settings", "sdk.context", "sdk.capability"],
  },
  assertActive: verifyCurrentInstallation,
  bridge: dispatchAuthorizedSdk,
});
try {
  await session.ready();
  await session.activate();
  const result = await session.invoke(
    "commands",
    "check",
    { value: 7 },
    {
      callers: [],
      ancestry: ["consumer"],
      signal: ownerAbortController.signal,
    },
  );
} finally {
  await session.close();
}
```

FoundationSession 的 instanceId/alive 是只读属性；生命周期与调用成员是方法：ready()/activate()/cancel()/close() 返回 Promise<void>，invoke()/deliverEvent() 返回 Promise<unknown>，stop() 返回 void。启动工厂在返回对象前失败时自身负责清理；返回成功后会话资源归可信调用方，即使 ready/activate/invoke 拒绝也必须 finally await close。失败与超时会立即自动发起 stop；reject 表示调用失败，不表示清理已结束。close 等待 supervisor 的 TERM 三秒、必要的 KILL、真实退出和快照删除，不等待作者确认。宿主整体退出应中止 owner 信号并 await 所有已拥有会话的 close；broker 断连仍由独立 supervisor 清理。

可信 bridge 的 signal 失效后不得新派发 I/O，并在异步授权/确认/审计后复核；迟到 Promise 完成不能回复已关闭会话。close 等待进程与快照，不等待一个忽略取消且永不返回的宿主 Promise；宿主桥负责自己所拥有的 I/O 清理。已经发生或状态未知的副作用保持原记录，不因取消重做。删除临时快照失败必须作为清理失败保留，不能把失败 close 标成阶段通过。选择事务和故障恢复见 [Agent 选择](foundation-agent-selection.md)；恢复不自动续跑业务，停止后的同一会话不能复活。
