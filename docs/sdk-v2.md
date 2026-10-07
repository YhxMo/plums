# SDK v2

共同平台作者可运行[符合性工具与黑盒用例](common-contract-conformance.md)，并按[兼容证据矩阵](common-contract-compatibility.md)选择已验证路径。声明匹配和内部夹具通过不证明真实第三方行为。

SDK v2 保留 SDK v1 普通扩展的贡献、设置、角色、事件、能力和依赖调用接口。旧普通扩展无需修改；包格式仍为 2.x，未知字段原样保留。依赖旧内置 `service/model/complete` 的模型组件需要显式升级，宿主不提供协议适配兜底。

可选 `plumsDesktop.protocols` 声明版本化协议提供项与需求，SDK 提供声明校验和元数据兼容判断。贡献可附带 `inputSchema/outputSchema` 元信息。可信管理窗口发现并选择当前 Agent 的提供者；`sdk.protocols.status(requirementId)` 查询连接状态，`sdk.protocols.invoke(requirementId, input)` 调用固定提供者。声明和连接不授予权限，具体依赖调用继续保持原检查。接口、限制与记忆/白板示范契约见 [扩展协议](extension-protocols.md)，后续范围见 组合计划（内部验证记录）。

## 隔离面板与消息

SDK v2 扩展可在 `plumsDesktop.panels` 声明与协议提供项关联的 HTML 面板。用户先在管理窗口固定组件连接，工作界面再用 `window.plums.panels.open(requirementId, panelId)` 打开该提供者的面板。每个面板独立使用沙箱、Electron 会话和组件身份；外装界面通过 `panels.layout` 提交工作区布局。

`@plums/sdk` 导出 `PanelDeclaration`、`PanelContext`、`PanelLayout`、`PanelPost`、`PanelMessage`、`FrontendPanelsSdk` 和 `PlumsFrontendSdk`。`panels.post/onMessage` 只连接主界面与有效绑定的面板；`panels.respond` 用收到的消息凭证调用本组件贡献，保留发送者的授权交集和会话复核。关闭、重建、更新与更换连接使旧句柄失效；消息正文不进入能力审计。声明、示例、消息限制和生命周期见[扩展协议](extension-protocols.md#隔离面板与限定消息)。

## 通用连接

`payload.plumsDesktop.connections` 由 connector 声明。权限来自 manifest 的 `permissions`；连接元信息不单独授予访问权。

```json
{
  "permissions": [
    {
      "id": "api",
      "kind": "service",
      "target": "https",
      "operations": ["request"],
      "reason": "查询远程数据"
    }
  ],
  "settingsSchema": {
    "type": "object",
    "properties": {
      "endpoint": {
        "type": "string",
        "title": "Base URL",
        "description": "公共 HTTPS 地址"
      },
      "apiKey": {
        "type": "string",
        "title": "API Key",
        "description": "连接凭据",
        "x-secret": true
      }
    }
  },
  "payload": {
    "plumsDesktop": {
      "sdkVersion": "2",
      "connections": [
        {
          "id": "api",
          "permissionId": "api",
          "baseURLSetting": "endpoint",
          "credentials": [
            {
              "setting": "apiKey",
              "header": "Authorization",
              "prefix": "Bearer "
            }
          ]
        }
      ]
    }
  }
}
```

地址、可选 `labelSetting` 及 `selectorSetting` 必须引用本组件的非密钥字符串设置；密钥头必须引用本组件的 x-secret 设置。`selectorSetting` 的枚举可对应 `credentialProfiles`，所有枚举值必须有声明配置。选择值由已保存设置决定，宿主不解释它的协议或服务含义。`credentials` 和 `credentialProfiles` 不能同时声明。

`await sdk.connection("api")` 返回 `{binding, baseURL, origin, basePath, fingerprint, ready}`。不包含密钥值。指纹覆盖声明、已保存配置、启用状态及设置/密钥修改版本；设置、密钥、声明和启用状态变化后，旧连接授权失效。`sdk.context()` 返回当前 Agent、组件及此次实际调用的标识。

```js
const connection = await sdk.connection("api");
const response = await sdk.capability("api", {
  kind: "service",
  operation: "request",
  binding: connection.binding,
  sources: [],
  input: {
    path: "/v1/resource",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  },
});
const { status, headers, body } = response.result;
```

路径须以 `/` 开头且解析后属于固定的 HTTPS origin。宿主拒绝 origin 变更、URL 中凭据、私有地址、重定向、无效头、超限及过期授权；复用 DNS/TLS、取消、脱敏和执行前复核。请求头不能覆盖声明绑定的凭据。请求正文、业务消息、请求路径和回复解析由外装组件构造。

其他 2.x `service` 权限继续采用自己的 read/write/egress 效果；外部写入仍逐次确认。HTTPS 外发使用通用 egress 效果，需短期任务范围或单次确认，并复核调用链各方的绑定批准。

## 响应失败

外装解析器可调用 `sdk.failResponse(response.callId, "RESPONSE_INVALID")`，或在非 2xx 状态时调用 `"HTTP_REJECTED"`。宿主只接受当前组件、当前调用实际完成的请求凭据，返回真实 callId、HTTP 状态和 `executionState: completed`；不能自报执行状态、冒用另一组件的请求或复用前次调用凭据。

失败审计不保存响应正文。审计失败仍返回真实执行状态；已完成或未确定的请求不得自动重试。

## 可信引擎

`plumsDesktop.engines` 声明引擎 id、标题、包内入口、固定 Node runtime、支持平台和 `jsonrpc-jsonl-v1`。每个引擎须对应唯一 `kind: engine`、`target: 引擎 id` 的公开权限。

SDK `engine.start/request/cancel/stop/status` 只能控制当前组件声明的引擎。业务前端也有绑定当前组件的 `window.plums.engine`，可独立取消正在执行的长任务。用户长期信任、真实确认、JSONL 协议、受控回调及进程监管详见 [可信引擎](engine.md)。SDK 不提供写入长期授权、管理 Agent、读取密钥明文或指定任意可执行路径的接口。

### 本机引擎数据上下文与 Grant

公开类型 `EngineRuntimeContext` 固定 Agent、组件、引擎和私有持久目录。可选 `EngineDeclaration.grantResources` 声明读取和保存资源，每侧最多 32 个唯一 id，用户可见 title 最多 128 字符。引擎经 JSONL `host.grant` 提出授权请求，由可信宿主决定目标及签发；前端仅经 `engine.request` 通信。详见 `docs/engine.md` 和 `docs/capabilities.md`，业务引擎必须在读取、模型调用及结果提交期间复核授权。

## 共同契约 1.0

运行时 `sdk.common` 与沙箱前端 `window.plums.common` 使用相同的 `CommonPlatformSdk`。启用该桥需要 `payload.plumsDesktop.common` 声明：

```json
{
  "commonVersion": "1.0",
  "features": ["events", "task-attach"],
  "runtime": "isolate",
  "background": true
}
```

当前支持 `resources-cas/events/task-attach/controlled-node/controlled-exec/policy-v1/ui-attach`；声明所需的未知功能会在作者代码启动前拒绝。独立 UI 桥已由阶段 5 接入。仅有 SDK 类型或 common 字段不能证明第三方行为兼容。

`protocols.requires/provides` 继续声明自定义业务协议和贡献槽，由用户在可信窗口选择具体提供者。共同桥不要求包名依赖，也不允许作者自行改选候选。提供者按既有贡献入口注册处理器，收到的输入固定为 `{operation,input}`；这两个字段属于业务请求，宿主不解释 operation。提供者自己的 inputSchema 必须接受该包装。

```js
// 提供者：声明 tools / records 贡献槽及对应 protocols.provides。
export function activate(sdk) {
  sdk.register("tools", "records", async ({ operation, input }) => {
    if (operation !== "find") throw Error("Unsupported operation");
    await sdk.emit("progress", { phase: "search" });
    return { entries: [] }; // 业务协议自行定义回复内容。
  });
}

// 消费者：本组件声明 protocols.requires / records，用户已选择提供者。
const binding = await plums.common.binding("records");
if (!binding) throw Error("Choose a compatible provider in management");
const call = await plums.common.invoke(binding.handle, "find", {
  query: "fixture",
});
for await (const event of call.events) console.log(event.sequence, event.data);
const result = await call.result;
if (!result.outcome.ok)
  console.log(result.outcome.error.code, result.executionState);
```

`discover(requirementId)` 返回当前候选的声明匹配证据；只有用户选中的绑定可调用。`binding` 句柄固定 Agent、组件、容器/运行实例、安装与制品；不能转交其他前端实例。宿主建立真实调用链，嵌套调用继续取整链权限和资源范围交集。

`tasks.create({lifetime:"agent",timeoutMs:60000})` 只创建宿主任务，不授予 I/O。Agent 后台需要 `background:true` 加可信管理页逐组件启用；把所得 taskId 传入 invoke 的 options，每 task 只允许一个根调用。默认 lifetime 为自动创建的 frontend 任务；界面关闭时取消。Agent 任务在界面关闭后继续，仍受调用期限和每次权限复核约束。`timeoutMs` 默认 120 秒、最大 1 小时，只能缩短已创建任务的剩余预算。

`tasks.status(taskId)` 查询可信状态；`attach(taskId,afterSequence)` 重新消费已有任务，不能重执行。当前组件重开前端可接管自己的任务；另一兼容组件需可信管理授权，且全部公开权限须覆盖原所有者的权限结构，所绑定资源的每项操作也须满足新消费者的资格、需求和最大范围。授权只允许查看/附着/停止任务，不转移执行权限。撤销接管或原调用链失效后旧访问拒绝。

事件采用宿主连续 sequence；生产者/消费者缓冲各限 256 项、8 MiB。生产者超限取消任务；慢消费者超限取消订阅对应任务。已确认事件仅保留有界尾部，缺口返回 `REPLAY_GAP`；另查 status 获取可用终态。终态正文及事件最多保留 5 分钟，仅在内存中。权限、绑定变化与停止 Agent 会清除旧业务回复。重启只恢复状态元数据：执行过的中断任务为 unknown，没有业务正文或自动重放。unknown/completed 不自动重试。

`common.resources` 与现有 `sdk.resources/window.plums.resources` 是同一 CAS 服务。受控 Node 的文件、HTTPS、资源和命令继续通过 capability/resources 请求宿主；作者不获得宿主密钥、管理 IPC 或任意进程权限。`runtime:"controlled-node"` 使用固定 Node 26.5.1、只读验证快照和临时 scratch；普通 isolate 继续使用 64 MiB/五秒同步预算。Node 的任务期限、RSS 256 MiB 与心跳监管独立生效，不把五秒同步预算用于长任务。

命令仍用 `sdk.capability(permissionId,{kind:"exec",args,cwd:{root,path}})`。作者清单声明 exec target/cwdRoots 与精确 fs read/write 权限；用户在可信页为逻辑 target 选择固定程序、读根、写根。程序摘要、目录实体和整链权限在执行前重新核验。命令单独传参，无宿主 shell、环境或任意程序路径输入。默认安全模式的命令启动经单次可信确认；阶段 4 策略模式通过有效策略决定是否确认，目录操作不得越过有效任务最大范围。依赖只允许系统只读库；直接绑定脚本、外部 dylib 与需要 fork 的程序不作为已支持路径。

首轮实际验证为 macOS 27.0.1 arm64；Seatbelt 或边界探测失败时拒绝启动，无普通权限回退。旧普通权限 engines 与 common 运行/任务、资源范围和短期能力范围互斥；旧长期信任不转换成受控授权。完整语义、错误和未验收内容见[共同契约](common-contract.md)、阶段 3 记录（内部验证记录）。

### 第三方策略接入（阶段 4）

策略是本 Agent 已安装、启用且同意的普通提供者。声明 `common.policy.provideId`，并将该槽映射到 `org.plums.policy` 1.0.0 的 tools 贡献；贡献入口名称由作者命名，操作固定为 `evaluate`。例如：

```json
{
  "common": {
    "commonVersion": "1.0",
    "features": ["policy-v1"],
    "runtime": "isolate",
    "policy": { "provideId": "decision" }
  },
  "protocols": {
    "provides": [
      {
        "id": "decision",
        "protocol": "org.plums.policy",
        "version": "1.0.0",
        "contribution": { "kind": "tools", "name": "assess" }
      }
    ]
  },
  "contributes": {
    "tools": [{ "name": "assess", "title": "Evaluate operation" }]
  }
}
```

声明置于 `payload.plumsDesktop`，同时填写 `sdkVersion:"2"/runtime` 和普通包字段。宿主向贡献传 `{operation:"evaluate",input:CommonOperationContext}`。作者只返回当前 `assessmentId/operationFingerprint/decision`：

```js
export function activate(sdk) {
  sdk.register("tools", "assess", async ({ operation, input }) => {
    if (operation !== "evaluate") throw Error("Unsupported operation");
    return {
      assessmentId: input.assessmentId,
      operationFingerprint: input.operationFingerprint,
      decision: "confirm",
    };
  });
}
```

该固定决定仅演示协议，不是风险分类算法。业务消费者无需声明策略包依赖或修改源码：用户在可信管理页为整个 Agent 选择固定策略和模式名称，再逐项批准参与组件、类别、操作、逻辑目标及 15 分钟或 1 小时期限。模式名称只保存偏好，不能替代实际策略决定或扩大权限。无策略时保留安全确认；选择策略但没有有效租约时返回 `POLICY_UNAVAILABLE`，重启不恢复租约。

`maximum.selection` 是完整逻辑最大范围；资源项还须匹配阶段 2 的唯一活动业务资源范围，完全访问例外只由该资源范围选择。文件/HTTPS 仍受现有短期能力范围约束；命令还需选择固定程序全部读写目录的对应操作，write 不包含 read。工具分发和 MCP 远程工具评估仍保留真实调用链、声明/同意及 MCP 指纹批准。最大范围各项按调用链逐组件取交集；未选项直接拒绝，confirm 不能补授权。

上下文包含宿主身份、真实链、callId/taskId、无凭据意图、可信逻辑目标 `target`、能力/资源的公开 `permissionId`、最大范围、当前期限 `deadline`、modeGeneration、唯一 assessmentId 和操作 SHA-256。键排序规范化的指纹绑定真实复制请求，作者回显原指纹，不自行计算或将自己的 actor 当作身份。普通单次能力的 taskId 使用该宿主调用的 callId；共同调用使用真实宿主任务 id。请求头只列名称，已知密钥和凭据字段不进入意图；正文不进入审计。策略运行使用独立隔离实例，计算期只有自身非密钥 settings/context，禁止能力、资源、调用、事件、引擎与管理请求，违规使评估失败，即使作者捕获错误也不能放行。

只接受 allow/deny/confirm，额外结果字段、错 assessmentId/指纹、异常、递归请求或超过 10 秒均 `POLICY_UNAVAILABLE`，没有人工兜底。confirm 展示宿主真实 Agent/链/操作/逻辑目标/意图/期限，120 秒内仅布尔 true 放行。策略等待、确认、审计以及实际执行前复核整链、绑定、范围与期限。撤权、切换、组件/声明/目录/资源/配置变化终止相关运行；到期也取消已授权任务和受管进程。unknown/completed 不自动重试。

作者界面用 `await plums.common.policy.status()` 读取选定模式、策略组件和活动范围；没有选择、批准或撤销的业务 SDK。管理操作仅存在于可信窗口。当前证据为内部四种确定性策略、真实宿主及 macOS 受控程序/Electron 路由；不代表可靠自动审查算法、真实第三方符合性或稳定安装包验收。

策略上下文的 `deadline` 是实际单调执行预算对应的时间戳，取调用、策略租约与相关最大范围的最短期限；普通单次调用最多 120 秒。策略计算、确认等待和执行前复核共用该期限，不在策略返回后重新延长。

### 独立主界面与组合

声明 `frontend:"index.html"` 和所需 common/protocols 即可提供独立界面。可信管理页选择备用主界面和并排界面，每个界面使用本组件已选的需求槽；界面不必声明 provides 或硬编码后端包名。多个界面共享组合 sessionId，但拥有独立 Electron session、组件身份和容器 handle；共同调用句柄不能转交另一个容器。

```js
const tasks = await plums.common.tasks.list();
const unsubscribe = plums.common.tasks.subscribe(
  tasks[0].taskId,
  (snapshot) => renderState(snapshot.status),
  () => showReconnect(),
);
// 不再显示此状态时调用；原任务继续按其归属运行。
unsubscribe();
```

状态订阅每 250ms 读取当前授权快照，可能略过短暂中间状态；业务事件仍用 `call.events/attach`。取消订阅抑制在途回复。任务列表和订阅限自身任务或可信批准的兼容接管，不提供跨 Agent 的任意任务发现。后台任务重开按 taskId 附着，不能自动重新执行；重启只有无正文状态，布局不保存 taskId 或接管批准，权限租约归零。

可信组合页保存组件摘要、稳定 viewId、面板需求槽、矩形及可见性。恢复重新核验声明/连接并创建新句柄；失效选择在可信工作栏及管理页诊断，由用户重选或保存移除。业务界面可以安排现有面板布局，不能通过布局选择新组件、切换后端或批准接管。侧界面关闭只取消该容器任务；兼作后端的组件继续服务有效消费者。主界面 cancel 按原组件及相同文件快照续接，旧调用句柄仍失效。完整语义见[共同契约](common-contract.md#独立界面接入阶段-5)。

共同界面的 legacy `plums.onEvent` 只接收本组件事件；跨组件业务事件经已绑定共同调用及任务资格传递。未声明 common 的旧默认 startup 前端保留同 Agent legacy 总线兼容；可信宿主按声明与当前容器决定，备用及侧界面不继承该广播资格。`panels.closed/session` 等可信生命周期通知继续送达相关容器。

桌面、宿主与 SDK 1.0.0 稳定线的版本关系、旧桥保留承诺、恢复及打包验收入口见[桌面兼容与恢复](desktop-recovery.md)。本轮为本地审阅，实际验证状态见阶段 7（内部验证记录）。
