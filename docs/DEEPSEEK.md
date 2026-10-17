# DeepSeek 协议扩展

[源码](../extensions/connectors/deepseek.js) · [凭据请求契约](CREDENTIAL-REQUEST.md) · [本地证据](../evidence/DEEPSEEK-LOCAL-2026-10-17.md)

需要为现有 Agent 替换文本处理服务时，本扩展提供 `text.transform@1`，通过连接器自己的凭据绑定提交 DeepSeek Chat Completions 载荷。协议代码和隔离测试已实现；普通 `PlatformAdapter` 尚不提供 `credential.request`，因此目前不能在应用内完成真实调用。默认目录和现有交付包不启用此扩展。

## 模块与配置

| 项目 | 值 |
| --- | --- |
| 扩展 ID / 版本 | `connector.deepseek` / `0.1.0`，SDK `apiVersion: 1` |
| 模块路径 | `/connectors/deepseek.js`；Vite 从 extensions 复制到构建产物 |
| 提供服务 | `text.transform@1` |
| 平台能力 | `credential.request`；必须由宿主另行授权 |
| 绑定归属 | owner `extension.connector.deepseek`，alias `text` |
| model | 普通字符串配置，默认 `deepseek-flash`，非空、无首尾空白，最长 80 字符；实际模型可用性由服务确认 |
| maxTokens | 普通数值配置，默认 256，仅接受 1–512 的整数 |

模型和预算通过已有声明配置编辑，不能在配置中填写 URL、认证头或密钥。停用旧 `text.transform` 提供者后才可启用新提供者，重复提供者继续拒绝；缺少平台能力或授权时保持 `waiting`。

## 单次调用与失败行为

每次调用只序列化当前输入为一条 user message，附带 model、max_tokens、`thinking: { type: "disabled" }` 和 `stream: false`。角色说明及会话历史保持本地。JSON 封装后的 UTF-8 请求不得超过 4096 字节；空白输入和超限请求在接触平台前拒绝。

连接器只向 `ctx.platform` 提交 `{ version: 1, binding: "text", body }`。平台使用批准的精确 POST 目标 `https://api.deepseek.com/chat/completions`、`Content-Type: application/json` 和原生注入的 `Authorization: Bearer …`。这些是生产绑定的要求，当前假平台不验证真实 HTTP 请求头或网络行为。

连接器仅接受 HTTP 200 的有效 JSON、唯一且 index 为 0 的 choice、assistant 文本及 `finish_reason: "stop"`，不接受非空工具调用。仅返回 message.content，保留其原有空白，不交付 reasoning_content 或原始响应元数据。HTTP 错误、截断、过滤、取消和解析失败均拒绝本次结果，不静默切换本地服务。

调用信号与连接器生命周期共同约束任务；取消或停用后迟到响应不交付。平台失败保留 `not-dispatched`、既有 Host 的 `not-committed` 或 `unknown`，原始异常和上游错误正文不透传。unknown 提示核对结果后再决定重试，连接器不自动重试。现有 Agent 消费者失败时不追加半条会话结果；草稿和实际 UI 行为仍须随真实接入验收。

## 本地验证与原生接入缺口

执行 `npm test -- tests/deepseek-connector.test.ts` 可运行协议和公开 Host/Agent 接线测试；`npm test` 为全单元回归，`npm run build` 检查类型及随包模块。测试使用 `.invalid` 目标和固定假凭据，没有真实账户、系统秘密或外部模型请求。

[通用绑定与原生凭据管理](CREDENTIAL-BINDINGS.md)已接入代码和管理入口；生产接入还需验证系统秘密实际保存/读取/删除，并完成请求授权/撤销、受限 TLS/DNS 与显式代理传输、资源限额及脱敏回执；共享工作台消费者和关于/能力来源说明也须反映实际文本外发。布局、配色、尺寸和已确认交互保持。真实调用及 Mac/Android 同源普通包验收前，本地通过不能关闭[当前阶段](spec/milestone.md)。

协议依据为 2026-10-17 查阅的 [DeepSeek 官方入门](https://api-docs.deepseek.com/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)及[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。首版选择非思考、非流式和较小输出，以验证完整的输入输出及取消路径；后续协议演进仍归扩展维护。
