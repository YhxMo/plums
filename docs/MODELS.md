# 模型连接与 Agent 上下文

[源码](../modules/models/) · [连接页面](../src/models/ModelConnections.tsx) · [服务商表单](../src/models/ProviderForm.tsx) · [扩展自建连接](CREDENTIAL-BINDINGS.md#扩展自建连接) · [凭据请求契约](CREDENTIAL-REQUEST.md)

状态：当前有效（2026-10-19 核实）；内置模型连接器、获取模型列表与按 Agent 选模型、带上下文发送已实现并通过单元与浏览器测试；真实服务调用待在 Mac 与 Android 手测。

## 用户路径

两层结构：**服务商**持有请求地址与 API Key，**模型**是该服务商下的模型名，可从服务获取或手动填写。应用不预置任何模型名。

1. Agent 详情的「模型」区点「添加模型连接」（或应用菜单中的「模型连接」），点「添加服务商」。
2. 基本信息：预设服务商（DeepSeek、OpenAI、Anthropic、Kimi、通义千问、智谱 GLM、OpenRouter 或「自定义」）、名称、备注（可选）、官网链接（可选）。
3. 连接：请求地址填服务商文档里的 Base URL（预设已填好，可改；粘贴完整的 `…/chat/completions` 或 `…/v1/messages` 也会自动还原），下方显示对话请求实际发往的地址；「自定义」另选 API 格式（OpenAI Chat Completions / Anthropic Messages）。API Key 只在系统面板录入，表单显示录入状态与预设服务商创建密钥的地址。
4. 模型：点「获取模型列表」，勾选服务列出的模型后「添加所选」；也可手动填写。新服务商或改了地址时，获取前会先保存并打开系统面板录入密钥；第一次读取同样需要在原生面板确认发送。
5. 高级选项：最大输出 token 与上下文轮数。保存后增删模型、改名称、备注或预算不需要再录入；改地址、API 格式或点「重新录入密钥」会再次打开面板。面板确认了新地址而记录保存失败时，服务商显示「地址未确认」，不发送请求，再次保存即在同一连接上重新确认。
6. 每个 Agent 在详情里选自己的模型（按服务商分组），不同 Agent 可用不同服务商或模型；新建 Agent 默认选第一个可用模型。列表中每个模型旁的「测试」发一条极短消息检查连通。

浏览器预览不能保存密钥，连接器保持等待；开发构建另有不联网的 `chat.echo`（回显模型）用于检查按 Agent 选模型与上下文。

## 组成

| 层                                 | 归属                        | 说明                                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 密钥、目标确认、发送确认、限额     | 应用层                      | `credential.connect` 按协议模板建连接；扩展拿不到密钥，不能静默改地址；请求 ≤ 64 KiB、响应 ≤ 2 MiB；可 GET 同一站点的路径读取模型列表                                                                                                                                             |
| 协议、预设、服务商记录、上下文裁剪 | 内置扩展 `connector.models` | 记录存在扩展自己的 `state.*`（`{ version: 3, providers }`；每个服务商：名称、备注、官网、预设、协议、Base URL、模型名列表（≤ 32）、最大输出 1–8192、上下文轮数 0–50；最多 16 个服务商，每个对应一条凭据连接，连接目标是由 Base URL 推出的对话地址）；提供 `chat@1`，模型 id 为 `<服务商 id>/<模型名>` |
| 会话历史、角色说明、模型选择       | Agent 扩展 `agents.local`   | 发送时取当前会话已保存的消息作为历史、角色说明作为指令，交给所选 `chat@1` 提供者                                                                                                                                                                |

## 协议

| 协议                 | 请求                                                                                     | 认证                                              |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `openai-chat`        | Chat Completions：`model`、`max_tokens`、`stream: false`，角色说明作为首条 `system` 消息 | `Authorization: Bearer`                           |
| `anthropic-messages` | Messages：`model`、`max_tokens`，角色说明放在 `system` 字段                              | `x-api-key`，固定 `anthropic-version: 2023-06-01` |

对话地址：OpenAI 兼容为 `<Base URL>/chat/completions`；Anthropic 为 `<Base URL>/v1/messages`（Base URL 已以 `/vN` 结尾时为 `/messages`）。

模型列表按 API 格式依次尝试：Base URL 以 `/vN` 结尾时取 `…/models`，否则 OpenAI 兼容取 `…/models` 再 `…/v1/models`、Anthropic 取 `…/v1/models`；带 `/anthropic`、`/api/coding` 等兼容子路径时再去掉子路径重试。读取 `data[].id` 或 `models[].slug|id`，去重排序；401/403 提示核对密钥，全部找不到时提示手动填写。

DeepSeek 预设额外附带 `thinking: { type: "disabled" }`，其他服务不加非标准字段。历史按「轮」（以用户消息开头）截取最近 N 轮，丢弃开头的孤立回复；整体超过 64 KiB 时从最早的整轮开始丢弃，只剩说明与当前输入仍超限则不发送（`not-dispatched`）。

只接受 HTTP 200 的完整文本：OpenAI 兼容要求唯一 choice、`finish_reason: "stop"`、无工具调用；Anthropic 要求 `end_turn` 或 `stop_sequence`、无 `tool_use`，跳过思考块。截断提示调大最大输出；401/403 提示检查密钥与模型权限；其他状态码不透传上游正文。平台失败保留 `not-dispatched` / `not-committed` / `unknown`，unknown 提示可能已计费，不自动重试。

## `chat@1`

契约在 [`extensions/contracts.d.ts`](../extensions/contracts.d.ts)：`models()` 列出可选模型（`id`、`label`、`description`，可选 `group` 作为选择器中的分组标题，缺省为提供者名称；`id` 至多 256 个字符，更长的不提供给 Agent），`subscribe` 通知列表变化，`reply({ model, instructions?, history, input }, signal)` 返回回复文本，失败带 `outcome`。第三方扩展可以提供自己的 `chat@1`，Agent 详情会一并列出。Agent 仍可开启 `text.transform` 扩展，对模型回复做后处理。

## 迁移与限制

替代旧 `connector.deepseek`：旧扩展及其凭据绑定不再加载，原密钥需要在新页面重新录入一次（旧绑定可在扩展管理「卸载后保留的凭据」或对应条目删除）。`connector.models` 是默认扩展，更新后首次启动自动开启。版本 2 的记录（保存完整地址、两个「自定义」预设）读取时换算为 Base URL 与单个「自定义」，下次保存写成版本 3。不支持流式、工具调用与图片；长期记忆（跨会话事实）是后续的 `memory@1`，见[整体计划](spec/total.md)。

## 验证

`tests/model-protocols.test.ts`（两种协议组装、裁剪、响应校验）、`tests/model-addresses.test.ts`（Base URL 还原、对话地址、模型列表候选路径与解析）、`tests/model-connector.test.ts`（录入面板、服务商与模型列表、只改模型不重新录入、取消、删除、请求路由、单个模型测试、获取模型列表、版本 2 换算、损坏数据保留）、`tests/agent-models.test.ts`（按 Agent 选模型、只取当前会话、指令、停用提示、持久化）、`tests/credential-connect.test.ts`（模板组装与 owner 隔离）；浏览器测试 `tests/web/extension-usage.spec.ts` 用回显模型检查两个 Agent 选不同模型且第二问带上第一问，`tests/web/credentials.spec.ts` 用假原生桥在 375 与 1180 宽度检查添加自定义服务商、粘贴完整地址、获取并勾选模型、按模板组装连接，且无横向溢出。

## 设计参考

服务商配置与模型发现的设计参考 CC Switch。
