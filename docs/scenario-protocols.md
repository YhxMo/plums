# 场景测试业务协议 1.0.0

这些协议仅供 `packages/host/test/fixtures/extensions/` 中的测试组件使用。名称、操作和正文语义均不构成平台契约；宿主与 core 不解释模型消息、角色字段、工具名称或世界书。平台只校验贡献 schema、固定协议连接和授权。协议版本均为 `1.0.0`，包格式 `2.0`、桌面 SDK `2` 与业务版本彼此独立。

当前已实现两种角色卡解析器、Fake 模型、循环、私有记忆、酒馆和远程 MCP 桥接夹具，覆盖 S-A、S-C、S-D 及两个消费者的解析器替换。两个整机探针已接入 S-F；编码、项目进程及其余组合场景仍待接入，不能据此宣称 S-A～S-H 全部通过。`org.plums.character-card` 是**草案，未冻结**；下一阶段可不兼容地调整。

## 通用调用与错误

消费者调用自己的协议槽：`sdk.protocols.invoke(slot, {operation, input})`。每个贡献提供本地 Draft-07 `inputSchema` 和 `outputSchema`，不加载远程 schema。输入错误由宿主在 handler 前拒绝；输出错误表示 handler 已完成，不能自动重试。安装、同意、启用、调用链或范围错误继续使用平台错误，不包装成业务成功。

业务拒绝返回 `{error:{code}}`，不附原始输入或底层异常。工具执行失败使用下述工具结果中的 `ok:false`。这些业务结果与平台 `executionState` 无关，不能用于签发授权、重放或判断宿主请求状态。

## org.plums.chat-model

提供项 feature：`complete`。消费者槽：`model`。

`complete` 输入：

```json
{
  "operation": "complete",
  "input": {
    "messages": [{ "role": "user", "content": "Synthetic question" }],
    "tools": [
      {
        "name": "memory_search",
        "description": "Search test memory",
        "inputSchema": { "type": "object" }
      }
    ]
  }
}
```

`messages` 是有序数组，`role` 为 `system/user/assistant/tool`，`content` 为字符串；工具结果消息另带字符串 `toolCallId`，历史中的 assistant 消息可带 `toolCalls` 以保留调用关联。`tools` 可省略，包含工具名、描述及 JSON 对象 schema。输出 `{message:{role:"assistant",content,toolCalls?}}`；每个工具调用为 `{id:string,name:string,arguments:object}`。连接器保持扩展侧协议适配，测试 Sink 返回有限 Fake 回复。HTTP 失败或非 JSON 回复通过实际完成的请求回执报告，输出形状由贡献 schema 校验；循环不自动重试。

`fixture.agent-loop` 贡献 `commands/chat`（输入 `{text:非空字符串}`）和 `commands/history`（输入 `{}`，输出消息数组）。每轮对话先读取本 Agent 私有资源，再收集上下文和记忆，最后调用模型和工具；至多八次模型调用，超出返回 `{error:{code:"LOOP_LIMIT_EXCEEDED"}}`。结束或达到轮数上限时，循环用原 revision 一次 CAS 保存 user/assistant/tool 消息；动态 system 注入不写入历史。平台拒绝和模型失败直接传播，不保存虚构回复。组件内调用串行，CAS 冲突不重放模型或工具。

循环按 `context.system` → `before_char` 条目 → 自我介绍 → `after_char` 条目 → 记忆的顺序生成 system 消息；自我介绍按 description、personality、scenario、systemPrompt 拼接，跳过空字段。没有绑定的可选槽不调用；卡业务错误使本轮在模型请求前停止。工具从固定的 `tools-coding/tools-mcp` 槽取得；两个槽选中同一提供项时只列一次，不同提供项重名时拒绝路由。工具结果保留 id，以 tool 消息回传下一轮模型；工具清单为空时不发送 tools 字段。

## org.plums.agent-tools

提供项 features：`list/call`。消费者槽：`tools-coding/tools-mcp`，记忆工具也可通过同一协议绑定。

- `list` 输入 `{}`，输出 `[{name:string,description:string,inputSchema:object}]`。
- `call` 输入 `{name:string,arguments:object}`，输出 `{ok:boolean,content:string}`。
- 未知工具返回 `{ok:false,content:"TOOL_UNKNOWN"}`；工具自身的业务失败返回有限固定说明。平台拒绝仍抛平台错误，不能改报成功。

记忆工具为 `memory_save/memory_search`；项目工具为 `read_file/write_file/list_dir/run`。本地工具由自己的已确认执行项和 Agent 上限授权，编排者不因此获得本地执行。宿主经办资源、HTTPS 和 MCP 仍按实际调用链交集检查。MCP 工具来自桥接扩展报告的完整列表，协议不包含 HTTP 或 stdio 专属批准字段。

记忆工具分别接受 `{id:string,text:string}` 和 `{query:string}`，`content` 为 memory 协议结果的 JSON 字符串。参数不匹配时返回 `{ok:false,content:"TOOL_INPUT_INVALID"}`。平台授权错误保持抛出，不包装成这个业务结果。

## org.plums.agent-context

提供项 feature：`context`。消费者槽：`context`。

`context` 输入 `{messages:[{role,content,toolCallId?,toolCalls?}]}`，消息结构同模型协议。输出 `{system:[string],injections:[{position:"before_char"|"after_char",content:string}],unsupported?:[string]}`；卡解析失败时原样返回 `{error:{code:"CARD_UNRECOGNIZED"}}`。酒馆夹具消费卡解析器的世界书，按启用、常驻、关键词、二级关键词与顺序生成注入。

酒馆忽略 disabled 条目；constant 条目始终注入。其余条目仅扫描最近 `scanDepth` 条输入消息，缺省四条，零表示不扫描。keys 做子串匹配，缺省不区分大小写；selective 还须命中一个 secondaryKeys。条目按 insertionOrder 升序排列，同序保留卡内顺序；position 缺省 before_char。

`unsupported` 只报告未实现的业务行为：`regex/recursive-scanning/decorators/token-budget`。解析器传递标准字段的元信息；酒馆不执行正则、递归、装饰器或 token 截断，忽略内容中以 `@@` 开头的装饰器行，不把注入正文再次用于匹配。测试扩展标记可放在世界书或条目的 extensions 内。这些标记不改变平台权限或声称兼容完整酒馆软件。

## org.plums.memory

提供项 features：`search/upsert`，与 [extension-protocols](extension-protocols.md) 的发现示例一致。消费者槽：`memory`。

- `upsert` 输入 `{id:string,text:string}`，输出 `{id:string}`。
- `search` 输入 `{query:string}`，输出 `[{id:string,text:string}]`。

记忆只使用本 Agent 的普通资源资格和 `resources-cas`；不使用共享组或完全访问。资源的 namespace、revision、调用链与失败状态由平台负责，文本内容和查询语义由记忆夹具负责。同一个制品在两个 Agent 中使用时不共享业务数据。

`fixture.memory` 使用自己的 private 资源槽，保存 `{id,text}` 数组；upsert 按 id 替换，search 按 text 做不区分大小写的子串查找，空 query 返回所有记录。循环使用独立的 history 键。测试经可信宿主绑定当前 Agent 的空间、指定 read/write 资格与有限任务范围；绑定和范围不来自扩展，也不随重启自动恢复。记录通过宿主资源存储跨重启保留。

## org.plums.character-card（草案，未冻结）

提供项 features：`parse/list`。消费者槽：`card`。两个提供者均贡献 `tools/card`，消费者不依赖具体包 id。

- `list` 输入 `{}`，输出当前 Agent 已启用卡的 `[{id,name,version}]`，与 `sdk.characters()` 一致。
- `parse` 输入 `{characterId?:string}`，id 非空且不超过 128 个字符。省略 id 时调用 `sdk.character()` 读取默认卡；明确 id 时只能访问当前 Agent 已启用卡。
- 成功输出下表的规范结构；没有默认卡、非卡 JSON 或卡结构无效时返回 `{error:{code:"CARD_UNRECOGNIZED"}}`。外部 Agent 或未启用卡由平台拒绝，解析器不隐藏该拒绝。

| 输出                                    | 类型与映射                                                             |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `source`                                | `v1/v2/v3`，由卡封装识别                                               |
| `name/description/personality/scenario` | 字符串，保持对应卡字段                                                 |
| `firstMessage/exampleMessages`          | 字符串，对应 `first_mes/mes_example`                                   |
| `systemPrompt/postHistoryInstructions`  | 字符串，对应卡的提示字段；V1 为 `""`                                   |
| `alternateGreetings/tags`               | 字符串数组；V1 为 `[]`                                                 |
| `creator/characterVersion/creatorNotes` | 字符串；V1 为 `""`                                                     |
| `extensions`                            | 原样保留卡数据的扩展对象；缺省 `{}`                                    |
| `characterBook?`                        | `{name?:string,scanDepth?:非负整数,entries:[Entry],extensions:object}` |

`Entry` 包含 `keys/secondaryKeys` 字符串数组、`content` 字符串、`enabled` 布尔值、`insertionOrder` 数字，以及 `caseSensitive/constant/selective` 布尔值（缺省 false）、`position`（缺省 `before_char`）和原样的 `extensions`（缺省 `{}`）。次级关键词也接受 V3 规范正文描述的逗号分隔字符串，转换为去空白的数组。解析不匹配关键词，不排序、不执行世界书行为。世界书可额外传递 `tokenBudget:number/recursiveScanning:boolean`，条目可传递 `useRegex:boolean`；这些字段仅供消费者报告未支持行为，缺省不新增字段。

V1 验证六个基础字符串。V2 使用 `chara_card_v2/2.0` 封装；V3 使用 `chara_card_v3/3.N` 封装及 V3 的组问候数组。两个解析器独立实现同一规范结构，保留卡、世界书和条目的任意嵌套扩展字段。未映射的 V3 元数据仍由平台原样保存在 payload 中，不解释宏、资源 URI 或远程图片。

字段依据 [Character Card V2 公开规范](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md) 和 [Character Card V3 公开规范](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)。这里只实现测试协议需要的字段映射，不宣称完整编辑器或业务兼容性；没有参考 AGPL/GPL 业务项目代码。JSON 与测试时生成的 PNG 都经过现有 opaque 导入路径，平台的 `rawCharacter` 行为保持不变。

## MCP 传输边界

远程 MCP 客户端属于 `fixture.mcp-bridge` 测试连接器，平台不实现 MCP 协议。开发时官方最新规范为 **2026-07-28**。该版本使用逐请求元信息与 `server/discover`，不使用初始化握手或协议会话。夹具同时兼容 **2025-11-25** 的 `initialize`、`notifications/initialized` 与 `MCP-Session-Id`，保留 R11 的握手验收。依据：[当前版本与兼容规则](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)、[当前 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[旧版生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)和[旧版传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

夹具的最小子集：

- 新版本发送 `_meta` 中的版本、客户端身份和能力，并镜像版本、方法、工具名及有效 `x-mcp-header` primitive 字段；后者按官方 UTF-8 Base64 sentinel 规则编码。无效 header 注解的工具不暴露。
- 先以新版本探测。仅不含新版本已定义错误的 400 回复选择旧版握手；版本不匹配或新版本错误失败关闭。旧版保存可见 ASCII 会话头，后续请求携带协商版本和会话。会话失效后本次失败，下次显式调用才重新初始化，不重放原工具调用。
- 支持 `tools/list` 与 `tools/call`、JSON 和已完整收取的有限 SSE；文本结果映射为 `{ok,content}`，`isError` 映射为 `ok:false`。MRTR、非文本内容、订阅、无限流、断线续传和 OAuth 不在夹具子集内。
- 现代结果须明确包含 `resultType:"complete"`；只有旧协议缺失字段时按 complete 兼容。显式 null 或不支持的分类均用真实完成收据拒绝，不重放工具或保存虚构历史。依据：[现代 Result](https://modelcontextprotocol.io/specification/2026-07-28/schema#result)。
- 请求头名称支持 [RFC 9110 token](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2)；特殊合法键按自有属性保持，受保护头、非字符串及 CR/LF/NUL 仍在外发前拒绝，声明凭据按大小写覆盖输入值。
- 每个响应至多 256 KiB UTF-8、512 个 SSE 事件；分页至多 16 页及 1000 个工具。全部页通过校验后一次 `sdk.mcpCheck` 上报完整列表，每次 call 都刷新列表。错误 id、重复终结回复、未结束 SSE、循环 cursor 和越限拒绝。

`HttpMcpTransport.exchange(message, tool?, headers?)` 与 `fail(reply, fixedReason)` 是内部传输接口，本期只有 HTTP 实现。所有网络均经本组件的 connection 与 `service/https/request`。每次 `tools/call` 向 `sdk.capability` 传入当前工具描述，宿主复核调用链交集和独立 MCP 批准。用户通过可信 `host.approveMcp` 批准后才能调用；工具描述或 schema 改变、消失或返回后均须重新批准。批准身份保持连接器包 id 与 permissionId，指纹只包含名称、描述和 inputSchema，批准接口和记录不带 HTTP 字段。

已完成的 HTTP 失败使用当前调用的 `failResponse` 收据：`HTTP_REJECTED` 或 `RESPONSE_INVALID`，保留真实 `executionState: completed`。不向宿主报告远端错误正文，不自动重试业务或平台拒绝。`scenarios/mcp.test.ts` 在两版本的 JSON/SSE 路径运行模型 → 循环 → MCP 桥接 S-D，全程使用 Fake Sink，不联网。

本地 stdio 是下一阶段方向，将由声明本地执行的扩展在项目/整机进程中承载，届时需修改 AGENTS #10。本期不提供该传输。

## 整机探针（测试贡献）

`machine-probe` 和 `machine-probe-b` 都省略 engine 权限的 tier，用缺省整机声明验证按组件执行与旧信任迁移。`commands/probe` 接受 `{method,input}`：pid/context 的 input 为 `{}`；write 为 `{path,content}`；environment 为 `{credential}`，只返回是否出现该自造哨兵。前者另有 model 操作，输入只含自造 user 消息，经绑定的 model 槽回调 Fake 连接器。第二个探针没有模型槽或 HTTPS 声明，也没有 model 操作。schema 在启动前拒绝不完整输入。

每次贡献先幂等启动自身已确认的 local 入口，再提交 JSONL 请求。临时文件写入、PID 和 initialize 上下文只由测试断言读取，审计不记录它们。`memory` 另有测试专用 localProbe 贡献，尝试 SDK start/request；它没有 engine 权限，在整机 Agent 中同样拒绝，也不能控制其他组件入口。该负向功能已列入底座 sdk.engine 需求。

`scenarios/machine.test.ts` 使用真实固定 Node 与官方隔离底座，Fake 模型和自造临时文件验证 S-F。schema-6 数据夹具只给第一个入口旧信任，迁移后第二个入口仍待确认；不生成项目目录或 fs/exec 确认覆盖。整机进程没有系统沙箱，此测试不替代 R17 的项目逃逸验收。
