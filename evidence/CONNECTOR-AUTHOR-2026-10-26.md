# 作者检验：只凭公开文档写凭据连接器（2026-10-26）

状态：第 1 级退出条件中“作者凭公开文档写连接器并完成真实调用”一项的验收记录；所有者按链路打通验收，未取得成功回复。

## 做法

一个没读过实现的空白会话（AI 作者）只读 `README.md`、`docs/`、`extensions/`、`modules/sdk/index.ts` 与服务商公开文档，写出一个 `chat@1` 连接器，用凭据绑定接 OpenCode Go 的 Chat Completions 接口（`https://opencode.ai/inference/go/openai/v1/chat/completions`，bearer，固定 `User-Agent`）。目标起初是 Gemini 原生接口，因所有者只有 OpenCode Go 密钥中途改换。这是 AI 作者对文档的检验，不是独立人类作者验收。

交付物在 [connector-author-2026-10-26/](connector-author-2026-10-26/)：`manifest.json`、`main.js`，以及用假 `ctx` 驱动的 `run.mjs`（`node run.mjs <main.js 绝对路径>` 全部通过）。审查后改了两处：服务返回 4xx 时的 `outcome` 由作者猜的 `not-committed` 改为 `unknown`（`chat@1` 只有 `not-dispatched` 与 `unknown`）；加 `max_tokens: 1024` 作为输出上限。另外把类型注释的相对路径改成适合本目录的位置，测试里的假密钥改为运行时拼出、补上 `process` 导入，以通过项目检查与 lint。连接器不作为仓库样板：OpenCode Go 写明为编程 Agent 设计，不引导用户拿它聊天。

## 文档缺口与处理

作者需要猜、事后对照实现确认的点，已在 `eb9a0d9` 写进文档：两端 `body` 都是字符串及类型位置；宿主不排队、第二个请求 `busy`，提供者自己排队；平台错误的 `message` 是可直接展示的中文；目标是精确地址、路径允许 `:`、路径含模型名的服务每个模型一个别名；`User-Agent` 原样发送，固定头不能按会话变化；`chat@1` 的 `history` 形状、无会话 id、`message` 原样显示与 `outcome` 取值。作者猜对的：`User-Agent` 可声明、bearer 认证、两端字符串。

未处理：作者无法在本地测试真实凭据路径（只能写假 `ctx`）；部分作者文档链接到实现源码；`CREDENTIAL-REQUEST.md` 主要写给实现者。

## 实测

候选 `release/.mac-aUL9Cb`（源码 `6830c27`，release 档位，ad-hoc），所有者以隔离 `HOME` 启动，导入上述文件夹、在扩展详情填写密钥、新建 Agent 选 GLM-5.3 发送一条消息。结果为服务端拒绝：

> OpenCode Go 拒绝了这次请求。（HTTP 400，Request is missing x-opencode-session and cannot be routed efficiently. …）

这说明 release 包能启动和导入扩展、宿主注入了密钥、请求到达服务端、错误原样展示且不含密钥。没有得到模型回复：OpenCode Go 要求每个对话一个稳定的 `x-opencode-session` 头，而凭据绑定的固定头不能按对话变化，`chat@1` 也不传会话 id。内置模型连接同样发不出这个头，第二次调用（内置连接器的兼容调用）因此没有进行。

所有者决定：链路打通即视为本项通过，不再换服务商补一次成功调用。

## 未验

- 该连接器与本候选上的成功生成回复；release 包中右键“检查元素”。
- 按对话传会话 id 记为[第 2 级前置决定](../docs/spec/total.md#2-群聊)；编程类订阅不在支持范围内（[已知限制](../docs/INSTALL.md#已知限制)）。
