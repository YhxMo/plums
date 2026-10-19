# 模型连接与 Agent 上下文

[源码](../modules/models/) · [连接页面](../src/models/ModelConnections.tsx) · [扩展自建连接](CREDENTIAL-BINDINGS.md#扩展自建连接) · [凭据请求契约](CREDENTIAL-REQUEST.md)

状态：当前有效（2026-10-19 核实）；内置模型连接器与按 Agent 选模型、带上下文发送已实现并通过单元与浏览器测试；真实服务调用待在 Mac 与 Android 手测。

## 用户路径

1. Agent 详情的「模型」区点「添加模型连接」（或应用菜单中的「模型连接」）。
2. 选服务商：DeepSeek、OpenAI、Anthropic、Kimi、通义千问、智谱 GLM、OpenRouter，或自定义的 OpenAI / Anthropic 兼容接口。预设填好地址与建议模型名，可改模型名；自定义接口自己填地址。
3. 保存时系统面板显示扩展、服务地址与认证头，用户核对后录入 API Key。之后只改名称、模型名、最大输出或上下文轮数不需要再录入；改地址或点「重新录入密钥」会再次打开面板。
4. 每个 Agent 在详情里选自己的模型，不同 Agent 可用不同连接；新建 Agent 默认选第一个可用模型。「测试」发一条极短消息检查连通。

浏览器预览不能保存密钥，连接器保持等待；开发构建另有不联网的 `chat.echo`（回显模型）用于检查按 Agent 选模型与上下文。

## 组成

| 层 | 归属 | 说明 |
| --- | --- | --- |
| 密钥、目标确认、发送确认、限额 | 应用层 | `credential.connect` 按协议模板建连接；扩展拿不到密钥，不能静默改地址；请求 ≤ 64 KiB、响应 ≤ 8 KiB |
| 协议、预设、连接记录、上下文裁剪 | 内置扩展 `connector.models` | 记录存在扩展自己的 `state.*`（每条：名称、服务商、协议、地址、模型名、最大输出 1–8192、上下文轮数 0–50，最多 16 条）；提供 `chat@1` |
| 会话历史、角色说明、模型选择 | Agent 扩展 `agents.local` | 发送时取当前会话已保存的消息作为历史、角色说明作为指令，交给所选 `chat@1` 提供者 |

## 协议

| 协议 | 请求 | 认证 |
| --- | --- | --- |
| `openai-chat` | Chat Completions：`model`、`max_tokens`、`stream: false`，角色说明作为首条 `system` 消息 | `Authorization: Bearer` |
| `anthropic-messages` | Messages：`model`、`max_tokens`，角色说明放在 `system` 字段 | `x-api-key`，固定 `anthropic-version: 2023-06-01` |

DeepSeek 预设额外附带 `thinking: { type: "disabled" }`，其他服务不加非标准字段。历史按「轮」（以用户消息开头）截取最近 N 轮，丢弃开头的孤立回复；整体超过 64 KiB 时从最早的整轮开始丢弃，只剩说明与当前输入仍超限则不发送（`not-dispatched`）。

只接受 HTTP 200 的完整文本：OpenAI 兼容要求唯一 choice、`finish_reason: "stop"`、无工具调用；Anthropic 要求 `end_turn` 或 `stop_sequence`、无 `tool_use`，跳过思考块。截断提示调大最大输出；401/403 提示检查密钥与模型权限；其他状态码不透传上游正文。平台失败保留 `not-dispatched` / `not-committed` / `unknown`，unknown 提示可能已计费，不自动重试。

## `chat@1`

契约在 [`extensions/contracts.d.ts`](../extensions/contracts.d.ts)：`models()` 列出可选模型（`id`、`label`、`description`），`subscribe` 通知列表变化，`reply({ model, instructions?, history, input }, signal)` 返回回复文本，失败带 `outcome`。第三方扩展可以提供自己的 `chat@1`，Agent 详情会一并列出。Agent 仍可开启 `text.transform` 扩展，对模型回复做后处理。

## 迁移与限制

替代旧 `connector.deepseek`：旧扩展及其凭据绑定不再加载，原密钥需要在新页面重新录入一次（旧绑定可在扩展管理「卸载后保留的凭据」或对应条目删除）。已保存组合不含 `connector.models` 的用户需在扩展管理中启用一次。响应仍限 8 KiB，长回复须调小最大输出。不支持流式、工具调用与图片；长期记忆（跨会话事实）是后续的 `memory@1`，见[整体计划](spec/total.md)。

## 验证

`tests/model-protocols.test.ts`（两种协议组装、裁剪、响应校验）、`tests/model-connector.test.ts`（录入面板、记录、取消、删除、请求路由、损坏数据保留）、`tests/agent-models.test.ts`（按 Agent 选模型、只取当前会话、指令、停用提示、持久化）、`tests/credential-connect.test.ts`（模板组装与 owner 隔离）；浏览器测试 `tests/web/extension-usage.spec.ts` 用回显模型检查两个 Agent 选不同模型且第二问带上第一问。
