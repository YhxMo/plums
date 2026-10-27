# 模型连接与 Agent 上下文

[源码](../modules/models/) · [连接页面](../src/models/ModelConnections.tsx) · [服务商表单](../src/models/ProviderForm.tsx) · [扩展自建连接](CREDENTIAL-BINDINGS.md#扩展自建连接) · [凭据请求契约](CREDENTIAL-REQUEST.md)

状态：当前有效（2026-10-27 核实）；内置模型连接器 `connector.models`、获取模型列表（按 models.dev 填写上下文窗口）、按 Agent 选模型与带上下文发送。打包应用的结果见 [HANDOFF](../HANDOFF.md#未验范围)。服务商配置与模型发现参考 CC Switch，逐模型思考方式与附件交互参考 OpenCode。

## 用户路径

两层结构：**服务商**持有请求地址与 API Key，**模型**是服务商下的模型名，可从服务获取或手动填写；应用不预置模型名。

1. 入口：添加 Agent 第二步的「添加模型连接」或「管理模型连接」、输入区模型菜单的「连接模型」，或扩展管理中模型连接的详情「打开」；点「添加服务商」。
2. 基本信息：预设（DeepSeek、OpenAI、Anthropic、Kimi、通义千问、智谱 GLM、OpenRouter 或「自定义」）与名称；备注、官网链接与最大输出 token（默认留空，由服务决定）在「高级选项」。
3. 连接：请求地址填 Base URL（预设已填；粘贴完整的 `…/chat/completions` 或 `…/v1/messages` 会自动还原），下方显示实际发往的地址；「自定义」另选 API 格式（OpenAI Chat Completions／Anthropic Messages）。API Key 在密码框粘贴（首尾空白去掉），只存本机、之后不再显示，没有系统面板或 Mac 密码提示。
4. 模型：「获取模型列表」后勾选并「添加所选」，或手动填写；每个服务商最多 32 个模型。列表同时显示 models.dev 的上下文窗口，添加时一并填入，可逐个修改或选「默认」跟随服务商。新服务商或改了地址时，获取前先用填写的 Key 保存服务商。
5. 默认上下文窗口：没有自己窗口的模型使用它（预设已填：Anthropic 1M，DeepSeek、OpenAI 等 128K，Kimi 256K；可选 32K–2M）。保存后增删模型、改名称或备注时 Key 留空即不变；改地址或 API 格式须重新填写 Key。
6. 每个 Agent 在输入区选自己的模型（按服务商分组）；新建 Agent 默认选第一个可用模型。

连接页面每个服务商一个细边框块：名称与状态（缺少 Key 时为橙色“需要 API Key”）、Base URL 与备注、「编辑」（缺 Key 时为「填写 Key」），下方逐行列出模型、上下文窗口与「测试」（发一条极短消息检查连通）。删除服务商在编辑表单底部。测试与获取列表最多等 60 秒；关闭窗口取消该窗口的请求，已提交的记录保留。

**写入不确定时**：配置已保存但状态刷新失败时显示「配置已保存，连接状态待核对」；新地址的密钥已保存而记录确认未提交时，服务商显示「地址未确认」、不发送请求。保存回执不确定时暂停新增、编辑、删除与模型请求，显示「重新读取连接」，成功重读后才恢复，读取失败继续锁定；只有确认未被引用的凭据才复用。

浏览器预览不能保存密钥；开发构建另有不联网的回显模型 `chat.echo`。

## 组成

| 层 | 归属 | 说明 |
| --- | --- | --- |
| 密钥、目标确认、发送确认、限额 | 应用层 | `credential.connect` 按协议模板建连接；密钥只写不读；请求 ≤ 8 MiB、总计 10 分钟、响应 ≤ 2 MiB；可 GET 同站点的路径读取模型列表 |
| 协议、预设、服务商记录、上下文裁剪 | `connector.models` | 记录存于扩展自己的状态（`{ version: 7, providers }`）：名称、备注、官网、预设、协议、Base URL、模型名（≤ 32）、逐模型窗口 `windows` 与思考方式 `thinking`、最大输出（`null` 或 1–128,000 且小于每个窗口）、默认窗口（16K–2M）；最多 16 个服务商，每个对应一条凭据连接。读取旧版本记录时换算，下次保存写成版本 7。提供 `chat@1`，模型 id 为 `<服务商 id>/<模型名>` |
| 会话历史、设定、模型选择 | `agents.local` | 取当前会话已保存的消息作为历史，系统提示词交给所选 `chat@1` 提供者 |

## 协议

| 协议 | 请求 | 认证 |
| --- | --- | --- |
| `openai-chat` | Chat Completions：`model`、`stream: false`，设了最大输出才带 `max_tokens`，指令为首条 `system` 消息 | `Authorization: Bearer` |
| `anthropic-messages` | Messages：`model`、`max_tokens`（必填：未设时取窗口的 1/4，至多 32K），指令放在 `system` | `x-api-key`，固定 `anthropic-version: 2023-06-01` |

- **地址**：OpenAI 兼容为 `<Base URL>/chat/completions`；Anthropic 为 `<Base URL>/v1/messages`（Base URL 以 `/vN` 结尾时为 `/messages`）。DeepSeek 预设额外带 `thinking: { type: "disabled" }`，其他服务不加非标准字段。
- **模型列表**：Base URL 以 `/vN` 结尾时取 `…/models`，否则 OpenAI 兼容依次试 `…/models` 与 `…/v1/models`、Anthropic 试 `…/v1/models`；带兼容子路径（如 `/anthropic`）时去掉再试。读取 `data[].id` 或 `models[].slug|id`，去重排序；401/403 提示核对密钥。
- **上下文窗口**：取自 [models.dev](https://models.dev)（服务商的列表接口一般不返回窗口）。连接器声明 `network.read` 与来源 `https://models.dev`，与模型列表同时读 `api.json`（不带密钥，见[公开网络读取](NETWORK-READ.md)），在内存中保留 1 小时；列表返回后最多再等 5 秒，未读完先显示不带窗口的列表。先找地址相同的服务（比较 host 与去掉版本段和接口段后的路径），按模型名精确、忽略大小写、去掉 `厂商/` 前缀与 `:变体`、`[1m]` 后匹配；找不到时取 `canonical_model_id` 指向的厂商条目，GPT 系列至多 272K。结果超出 16K–2M 的不用。
- **回复校验**：只接受 HTTP 200 的完整文本。OpenAI 兼容要求唯一 choice、`finish_reason: "stop"`、无工具调用；Anthropic 要求 `end_turn` 或 `stop_sequence`、无 `tool_use`，跳过思考块。截断时提示调大或清空最大输出；其他状态码不透传上游正文。平台失败保留 `not-dispatched`／`not-committed`／`unknown`，unknown 提示可能已计费，不自动重试。

### 上下文与缓存

- 每次发送当前会话的完整历史（以用户消息开头的整轮），不设轮数上限。OpenAI 兼容服务自动缓存前缀；Anthropic 在指令与最后一条用户消息上加 `cache_control: { type: "ephemeral" }`。
- 预算为模型窗口减去留给回复的 token（设了最大输出用它，否则取窗口的 1/4、至多 32K），并受 8 MiB 请求上限约束。历史超过预算的 90% 时一次丢弃最早的若干整轮、降到 60% 以下，丢弃点只由此前的历史决定，前缀稳定、缓存继续命中。token 按偏高估算（ASCII 每 2.5 字符 1 个，其他每字 1 个）。只剩指令与当前输入仍超限时不发送（`not-dispatched`），提示缩短或调大窗口。总结早期对话将由扩展提供，取代直接丢弃。

### 思考强度

Agent 可按模型选择思考强度；连接器在 `ChatModel.reasoning` 里列出每个模型可用的档位，没列出的不显示控件、不发送。默认按服务商、协议与模型名判断（`modules/models/reasoning.ts`）：

| 服务与模型 | 可选档位 | 请求字段 |
| --- | --- | --- |
| Anthropic，Claude 4.6 及以后 | 低、中、高、最大 | `thinking: { type: "adaptive" }` 加 `output_config: { effort }`；总在思考，不提供「关闭」 |
| Anthropic，Claude 4.5 及更早、3.7 Sonnet | 关闭、低、中、高、最大 | `thinking: { type: "enabled", budget_tokens }`，预算 2K／8K／16K／24K，且不超过 `max_tokens` 减 4096，余量不足 1024 不发送 |
| DeepSeek 预设 | 关闭、低、高、最大 | 关闭为 `thinking: { type: "disabled" }`，其余为 `{ type: "enabled" }` 加 `reasoning_effort`（`low`／`high`／`max`） |
| OpenAI 预设，`o*`、`gpt-5*`（非 chat 变体） | 低、中、高 | `reasoning_effort` |
| 其他服务与自定义地址 | 无 | 未核对文档，不显示 |

服务商表单的每个模型行可改写：「自动」（按上表）、「不显示」，或按 API 格式列出的方式（OpenAI 兼容：`reasoning_effort` 式、DeepSeek 式；Anthropic：自适应、思考预算），存为 `thinking`（`adaptive`／`budget`／`deepseek`／`openai`／`none`），不属于该格式的方式保存时被拒绝。未选择强度时请求不变。强度是 Agent 的设置，换到不支持的模型后保留但不发送。同一会话中途改强度会让 Anthropic 的缓存未命中一次。思考内容不展示。

### 附件与图片

- **文本文件**（`modules/agents/attachments.ts`）：UTF-8、无 NUL、≤ 200K 字符（读取前另限 800 KB）；发送时以 `文件「名」：` 加围栏（反引号数比内容最长的多一个）放在正文之前，同一条消息每次得到相同前缀。
- **图片**：界面端缩放到长边 ≤ 1568 px，WebP（不支持则 JPEG）编码、base64 ≤ 400K 字符；一条消息最多 5 个附件，其中图片 ≤ 4 张；每个会话的图片合计 ≤ 8M 个 base64 字符，超出时提示新建会话。
- **读图**：只有 `ChatModel.vision` 为真的模型收到图片；`modules/models/vision.ts` 按协议与模型名判断（Anthropic 的 `claude-*`；OpenAI 兼容的 GPT-4o／4.1／4.5／4-turbo／5、o1／o3／o4、Gemini、Claude、Grok 4、Qwen-VL、QVQ、GLM-*V、Pixtral、LLaVA 与名称含 vision 者），未识别的按只读文本处理。不读图的模型照常能添加图片，发送时每张换成 `ERROR: Cannot read "文件名" (this model does not support image input). Inform the user.`。读图的模型只随请求发送最近 3 条带图的用户消息，更早的换成 `[图片：文件名]`。OpenAI 兼容用 `image_url` 的 data URL 块，Anthropic 用 `image` 的 base64 源，图片在文字之前；只有图片时不带空文字块。每张图片按 1600 token 计入预算。

## `chat@1`

契约在 [`extensions/contracts.d.ts`](../extensions/contracts.d.ts)：

- `models()` 列出可选模型（`id` 至多 256 字符、`label`、`description`，可选 `group` 作为选择器分组标题，可选 `reasoning` 与 `vision`）；`subscribe` 通知列表变化。
- 可选 `manage` 是提供者自己的 `dialog` 视图 id，Agent 界面需要连接模型时打开它（内置为 `model-connections`，界面不写死任何连接器）。
- `reply({ model, instructions?, history, input, images?, effort? }, signal)` 返回回复文本。内置 Agent 核心发送的 `history` 以用户轮次开头、交替，附件以文字写进 `text`；不带会话 id（第 2 级加入）。
- 失败抛出 Error：界面原样显示 `message`，所以写成给用户看的中文；`outcome` 只有能证明请求没发出时用 `not-dispatched`，其余（含服务返回 4xx/5xx）用 `unknown`。平台每个扩展同时只发一个凭据请求，提供者须自己为并发的 `reply` 排队（[请求契约](CREDENTIAL-REQUEST.md#作者接口)）。
- 第三方扩展可提供自己的 `chat@1`，模型选择器一并列出。回复整条送达、不流式，不支持工具调用，图片只作输入。

## 回归测试

单元：`model-protocols`（协议组装、裁剪、响应校验）、`model-addresses`（地址还原与模型列表路径）、`model-catalog`（models.dev 匹配）、`model-connector`（密钥只交给原生、服务商与模型、旧版本换算、写入失败）、`model-windows`（窗口填入与缓存）、`model-write-recovery`（不确定回执的锁定与重读）、`agent-models`（按 Agent 选模型与上下文）、`credential-connect`（模板组装与只写密钥）。浏览器：`extension-usage.spec.ts`（两个 Agent 选不同模型）、`credentials.spec.ts`（添加服务商、填写 Key、获取并勾选模型，375 与 1180 宽度）、`model-connection-recovery.spec.ts`（关闭窗口取消请求、去重与容量）、`model-pages.spec.ts`（按连接器的 `manage` 打开页面）。
