# 扩展协议声明与示范契约

SDK v2 已实现声明校验、元数据兼容判断，当前 Agent 内发现、用户选择、固定绑定、按需求调用，以及隔离面板与限定消息。已提供独立参考记忆/白板、私教闭环、SDK v2 schema 执行校验与符合性工具，见 组合计划（内部验证记录）。协议声明和绑定不授予能力权限；旧具体依赖调用保留原声明门禁。

## 通用声明

`payload.plumsDesktop.protocols` 是可选字段，仅用于 SDK v2；无此字段的 SDK v1 普通扩展和 v2 组件保持原调用路径。旧内置模型服务组件仍须按 [SDK v2](sdk-v2.md) 升级。

```json
{
  "sdkVersion": "2",
  "runtime": "runtime/main.js",
  "contributes": {
    "tools": [{ "name": "memory", "title": "学习记忆" }]
  },
  "protocols": {
    "provides": [
      {
        "id": "store",
        "protocol": "org.plums.examples.memory",
        "version": "1.0.0",
        "features": ["search", "upsert"],
        "contribution": { "kind": "tools", "name": "memory" }
      }
    ],
    "requires": [
      {
        "id": "learning-memory",
        "protocol": "org.plums.examples.memory",
        "range": "^1.0.0",
        "features": ["search", "upsert"],
        "optional": false
      }
    ]
  }
}
```

示例展示两种声明结构，一个组件不必同时提供和需要记忆。编排组件通常只声明需求，记忆组件只声明提供。

| 字段                   | 规则                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `provides`、`requires` | 可省略；各最多 100 项；各自的 id 不重复                                                                               |
| `id`                   | 组件内提供项或需求槽标识，1–64 个 ASCII 字母/数字/`_.-`，首字符字母或数字；不是全局包 id                              |
| `protocol`             | 1–256 字符，至少两段，以点分隔；每段小写字母开头，后接小写字母/数字/连字符，例如 `org.example.memory`                 |
| 提供项 `version`       | 完整、规范的稳定 SemVer，如 `1.2.3`；首版拒绝 `v1.2.3`、预发布和 build 元信息                                         |
| 需求 `range`           | 非空 SemVer 范围，最多 256 字符；使用已依赖的 semver 默认规则，常用 `^1.0.0`；`^0.x` 采用 SemVer 对 0.x 的限制        |
| `features`             | 可省略（空集合）；最多 64 个不重复标识，格式同局部 id；同协议的公开规范定义含义                                       |
| `contribution`         | 提供者自己的已声明入口 `{kind, name}`，类别为 `commands/tools/connectors`；必须有 runtime，传入包文件时也验证入口存在 |
| `optional`             | 仅需求使用，省略为必需；必须为布尔值；可选只允许不绑定，绑定后仍要匹配版本与功能                                      |

包版本、SDK 版本、协议版本彼此独立。同一组件可用多个提供项声明不同协议版本；宿主不能用包版本推断接口版本。字段未知内容不删除、不解释，包格式与未知字段继续往返保留。

声明无效时，`desktopContribution()` 抛 `PlumsError`，code 为 `IMPORT_INVALID`，path 为指向字段的 JSON Pointer，details.reason 为 `PROTOCOL_DECLARATION_INVALID`。错误不回显被拒值。

## 兼容判断与安全边界

```ts
import { checkProtocolCompatibility } from "@plums/sdk";

const result = checkProtocolCompatibility(requirement, provider);
// { compatible: true }
// { compatible: false, reason: "PROTOCOL_MISMATCH" }
// { compatible: false, reason: "VERSION_MISMATCH" }
// { compatible: false, reason: "FEATURES_MISSING", missingFeatures: ["upsert"] }
```

此 helper 供开发者与宿主使用，并未添加到隔离运行时的 `sdk` 对象。它验证传入元数据后，按协议 id、版本、功能子集依次判断；无效参数仍抛公开导入错误，path 分别从 `/requirement`、`/provider` 开始。它不选择候选、不检查包依赖或组件启用、不保存绑定、不运行代码、不授予权限，也不证明 schema 或行为一致。所有兼容候选均由可信管理界面交给用户明确选择，只有一个候选时也不自动连接。

`Contribution` 的可选 `inputSchema/outputSchema` 在 SDK v2 由宿主执行校验。输入在进入业务 handler 前校验，输出在 handler 实际完成后校验；SDK v1 保留原元信息行为。协议作者仍须发布行为规范，并运行符合性工具；schema 只检查结构，不能证明持久性、幂等或隔离。`features` 只声明协议功能，不能代替 manifest 的 fs/HTTPS/engine 权限。

新增权限仍须同意与范围/单次确认。相同协议只证明声明匹配；自报协议不会使 `sdk.invoke` 跳过具体依赖门禁，跨 Agent 的组件不可成为绑定候选。业务对象不进入能力审计。

## Agent 内发现与固定连接

管理窗口的“组件连接”展示每个需求的候选、协议版本与功能缺口；新建组合、导入后的集中配置与 Agent 管理均有选择入口。候选仅来自当前 Agent 所选制品，不跨 Agent 或自动从公共库加入提供者。无候选提示导入并加入组件，多候选要求选择；版本不兼容和缺少功能分别显示原因。停用的兼容提供者可以被选择，但启用后才能调用。

宿主在 Agent 的 `record.json` 保存本地连接：消费者需求、双方制品摘要、双方安装时间、Agent 身份、声明指纹、提供项 id、协议版本及具体贡献入口。重启重新读取并核验这些字段；无连接的旧记录默认空连接。相同包名、包版本或协议名不能代替这些固定字段。

```js
const status = await sdk.protocols.status("learning-memory");
// available: {state, requirementId, providerId, provideId, protocolVersion}
// unbound / stale / disabled: {state, requirementId, optional}
if (status.state === "available") {
  const result = await sdk.protocols.invoke("learning-memory", {
    operation: "search",
    namespace: "study",
    query: "fixture",
    limit: 10,
  });
}
```

`window.plums.protocols.status/invoke` 为当前工作界面提供同样的需求接口，身份由宿主桥固定，输入不能覆盖 Agent 或消费者身份。SDK v1 不使用新协议接口。可选需求无连接时返回 `unbound`，调用拒绝为 `PERMISSION_DENIED`、`details.reason: PROTOCOL_UNBOUND`；宿主不会临时挑选提供者。旧 `sdk.invoke(packageId, kind, name, input)` 仍需要原 manifest 的具体依赖，新连接不会改写该数组。

创建新组合必须处理所有必需连接；单组件加入或完整 ZIP 导入可以先安装为待配置状态，在启用前完成选择。公共库仍允许收集缺依赖或缺协议提供者的组件。统一启用按具体必需依赖和所选协议边排序；单独启用消费者要求所有已选提供者先启用。具体必需依赖与已选协议边不能形成循环；运行中继续限制循环及最多 16 个组件的调用链。

提供者或消费者更新、移出、声明变化、卸载后重装使固定连接 `stale`，需要重新选择，不自动换为同名组件。停用为 `disabled`，重新启用同一安装后可核验恢复。配置、密钥、目录、角色/界面偏好及组合变化停止相关运行，丢弃旧调用上下文并按原选择重建；配置本身不改变用户选择。更换连接撤销当前 Agent 的已存 Grant。更换数据实现不承诺旧业务数据可读，数据适配仍由外装组件负责。

协议边与具体依赖边共用受控调用路径。输入在等待前复制；校验双方当前安装/启用、制品、声明、设置版本及调用链，并在运行时排队后、确认后和异步审计后复核。能力继续使用调用链各方的权限交集、目录/HTTPS 范围、任务或单次确认、MCP 批准和脱敏审计；不存在协议带来的额外权限。委托中的 isolate 不能转为独立引擎执行，避免丢失调用链；组件自己的顶层引擎请求仍可使用原接口。核心只接受可信宿主提供的调用边复核回调，不解释协议 payload。

## 引擎回调与导入/导出

已批准的本机引擎可以经 JSONL 请求 `host.protocolStatus`（`{requirementId}`）及 `host.invokeProtocol`（`{requirementId,input,grantId?,grantScope?}`）。引擎身份固定为拥有此引擎的组件，新回调解析相同的本地固定连接，保留取消、独立引擎运行上下文、权限交集及审计。`host.invoke` 继续检查原具体依赖。`host.grant` 的 request 可用 `requirementId` 与 `connectionId` 指定已绑定的 HTTPS 提供者；组合中可改用 `requirementPath:["dialogue","model"]`，逐跳解析从引擎所属组件出发的已保存需求连接（1–15 跳），不能与 `packageId/requirementId` 混用。最终组件须有真实配置连接；Grant 固定整条调用链各方的 HTTPS 权限和同一目标，执行时 core 继续要求实际主体集合完全相同；拒绝绕过中间组件或添加未批准主体。每条连接在批准后和保存后复核；更换中间连接撤销 Grant。宿主解析真实目标，可信窗口选择范围与时限，不接受未连接或不兼容的自报提供者。Grant 到期、撤销、配置变化及引擎撤权均复核，前端关闭仍按原引擎生命周期处理。

Agent ZIP 的 `agent.json.protocolBindings` 仅携带非敏感选择意图：`consumerId/consumerDigest/requirementId/providerId/providerDigest/provideId/protocolVersion/contribution`。导出根据实际导出组件字节重算摘要，只包含仍匹配的连接；失效连接省略，导入后重新选择。无本地安装身份、Agent 实例、Grant、任务范围、信任或运行句柄。导入核对摘要、需求、版本、功能和入口，再生成新的本地安装绑定；所有组件仍须在新 Agent 中配置、同意与启用。包中的声明和未知字段继续保留。

阶段 2 验证使用自造组件与 Recording Sink，通过真实 isolate 和 Node 引擎回调验证发现、重启、固定选择、导出/导入与拒绝边界。阶段 4 已执行 SDK v2 已声明的 inputSchema/outputSchema 校验，并提供真实记忆/白板与公开符合性工具。声明兼容本身不证明实现行为。

## 隔离面板与限定消息

SDK v2 的 2.x extension 可用 `payload.plumsDesktop.panels` 声明面板；每组件最多 8 个。它不增加权限，`provideId` 必须引用本组件有效协议提供项，提供项仍须有已声明的 runtime 贡献。面板 id 唯一，格式同提供项局部 id；标题为 1–256 字符，入口须为包内已有 HTML。未知声明字段继续往返保留。

```json
{
  "panels": [
    {
      "id": "board",
      "title": "练习白板",
      "entry": "ui/board.html",
      "provideId": "whiteboard",
      "messageVersion": "1.0",
      "topics": ["present", "answer"]
    }
  ]
}
```

此片段须放在包含对应 `protocols.provides` 和贡献声明的 `plumsDesktop` 内。`messageVersion` 固定为 `1.0`，与包和业务协议的 SemVer 独立。topics 为 1–32 个不重复的精确主题，不支持通配符；每个主题为 1–128 个 ASCII 字母/数字/`_.-`，首字符字母或数字。声明错误使用 `IMPORT_INVALID` 和 `/payload/plumsDesktop/panels/...` JSON Pointer，不回显输入。

主界面可以打开管理窗口已经选择的提供者，不接受临时 packageId 或自报制品。每次工作界面打开产生新的 `sessionId` 和主句柄；每个子面板也有独立句柄、组件身份和 `parentHandle`。每会话最多 8 个子面板；仅主界面能打开面板和提交布局，子面板只能关闭自己。相同需求和面板再次打开复用仍有效的面板，关闭后重开产生新句柄。

```js
const board = await window.plums.panels.open("whiteboard", "board");
await window.plums.panels.layout({
  root: { x: 0, y: 0, width: 0.5, height: 1 },
  panels: [{ handle: board.handle, x: 0.5, y: 0, width: 0.5, height: 1 }],
});
const unsubscribe = window.plums.panels.onMessage(async (message) => {
  if (message.topic === "answer") {
    await window.plums.panels.respond(
      message.messageId,
      "commands",
      "submit-answer",
      message.data,
    );
  }
});
// 注销后，已经在异步身份核验中的回调也不会继续调用订阅者。
unsubscribe();
```

坐标是顶部可信宿主栏以下工作区的 0–1 比例，须有限、宽高大于零且完全在工作区内，主界面和所列面板不得重叠。省略的面板隐藏但保留会话；窗口缩放时宿主按比例重算。断点、面板布局和业务 DOM 由外装界面决定。`context().viewport` 给出整个工作区尺寸；`context()` 还包含真实 `agentId/componentId/sessionId/handle/panelId?/parentHandle?`，这些字段只用于读取，不接受调用输入覆盖。

子面板向主界面提交 JSON：

```js
const context = await window.plums.context();
await window.plums.panels.post({
  version: "1.0",
  to: context.parentHandle,
  topic: "answer",
  data: { boardId: "exercise-1", answer: "fixture" },
});
```

`post` 只接受 `version/to/topic/data`，正文允许有限深度的 JSON 值，不接受非有限数、undefined、循环、函数或特殊对象。整个 post JSON 的 UTF-8 上限为 64 KiB，嵌套最多 32 层，最多 16384 个值节点。每会话最多 32 个在途投递，每秒最多 128 次进入投递；超限以 `PERMISSION_DENIED`、`PANEL_BACKPRESSURE` 拒绝，无自动重试。主题和版本必须与绑定面板声明相符。

消息只在主界面与其有效绑定子面板之间双向路由，拒绝兄弟面板、其他 Agent、旧会话、过期句柄、冒用来源及未声明主题。宿主在等待前复制输入，在读取脱敏密钥等异步等待后重新核对绑定、安装、制品、声明、设置及端点。投递增加宿主固定的 `from`、`sessionId`、`messageId`，冻结后交给适配器；preload 在回调前再次核验接收句柄。正文不进入能力审计，不广播到旧事件总线。`post` 完成表示已交给目标传输，不能证明业务提交；投递适配器异常返回 `PANEL_DELIVERY_FAILED`、`executionState: unknown`，不能自动重试。

`respond(messageId, kind, name, input)` 只允许实际接收者用仍有效的消息凭证调用本组件已声明贡献，发送者加入调用链，之后的跨组件调用、权限交集、取消、任务/单次确认和异步审计后复核全部保留。消息凭证只保留最近 128 项的来源/接收者元信息，不保存正文；任一端关闭或会话失效后不可用。它不批准引擎、MCP、fs 或 HTTPS。独立的 `invoke` 仍按当前组件权限执行，不应拿消息正文当授权。isolate 的 `sdk.context().frontend` 携带宿主固定的来源面板上下文，当前执行组件仍由顶层 `componentId` 指明。

`panels.close(handle)` 注销端点并取消关联等待；主界面关闭取消普通运行和任务范围，已获批运行的引擎保留，等待批准的引擎启动则取消。返回管理只是隐藏视图；主界面 `cancel()` 使子面板和旧会话失效，但主视图可取得新上下文后继续操作。子面板崩溃可重开，主界面崩溃返回管理。设置、密钥、目录、组合、更新、启停和更换绑定均撤下相关旧运行；重开不恢复旧句柄。句柄、会话、消息凭证及布局均不持久化或导出。宿主通过旧前端 `onEvent` 发出 `panels.closed`（子句柄）及 `panels.session`（取消后的新会话）生命周期通知；普通 `sdk.emit` 不可使用 `panels.*` 主题。

当前实现只提供前端端点和受控贡献响应，不自动向 isolate/engine 广播面板消息，也不提供嵌套面板、兄弟面板通信、布局持久化或业务消息确认/重放。阶段 4 已提供真实记忆/白板的数据、schema 执行校验、幂等和符合性工具；关闭子面板会停止其普通 isolate 并清除临时状态，独立引擎保留既有生命周期。

## SDK v2 schema 执行边界

schema 使用同步、本地 Draft-07 子集：最多 64 KiB、32 层，支持对象/数组/数值/枚举、组合、`#/` 本地引用和约束；拒绝远程引用、`$async`、`pattern/patternProperties`、`format` 与未知关键字。不加载远程资源，不强制类型转换或插入默认值；正文中的同名属性可正常使用。编译按 schema 内容复用，LRU 最多 256 项，变更内容立即采用新约束，清理 Ajv 内部缓存。

| 时点                  | code / path                          | details                                                                   | 业务执行           |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------- | ------------------ |
| 导入声明 schema 无效  | `IMPORT_INVALID` / 清单 JSON Pointer | `CONTRIBUTION_SCHEMA_INVALID`                                             | 未运行             |
| 输入不符合 schema     | `CAPABILITY_FAILED` / `/input`       | `CONTRIBUTION_INPUT_INVALID`, `phase:input`, `executionState:not_started` | 未进入 handler     |
| 完成输出不符合 schema | `CAPABILITY_FAILED` / `/output`      | `CONTRIBUTION_OUTPUT_INVALID`, `phase:output`, `executionState:completed` | 已完成，不自动重试 |

错误不回显字段值、schema 诊断、业务输入或输出。普通、协议、面板响应及引擎→isolate 路径都进入相同运行时边界，确认、权限与审计继续执行。未声明 schema 的贡献保留现有行为；不能由此宣称任意组件具有行为兼容性。
