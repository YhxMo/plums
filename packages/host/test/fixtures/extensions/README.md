# 场景测试夹具

此目录只供 vitest 使用。扩展源码、清单和自造卡均按 Apache-2.0 维护，不作为官方扩展发布，应用没有自动安装入口。`pack.ts` 在测试运行时调用 `createArchive`，不向仓库写 ZIP。PNG 由辅助函数生成一个像素，并嵌入自造 JSON。

测试组件按实际使用声明底座 SDK 功能，包括失败路径的 failResponse 与 MCP 的 mcpCheck。不支持的底座在启动前拒绝组装，不分析业务源码推断需求，也不自动切换到官方实现。SDK 矩阵、报告格式及底座选择入口见[平台符合性工具](../../../../../docs/common-contract-conformance.md)。

已实现 `card-parser` 和 `card-parser-alt` 两种独立解析方式：前者直接映射字段，后者按字段表映射。两者只消费 SDK 提供的当前 Agent 卡 payload。它们不请求文件、网络、资源或本地执行权限。

业务协议和错误见 [scenario-protocols](../../../../../docs/scenario-protocols.md)。解析映射依据公开 Character Card V2/V3 规范，源码没有使用 SillyTavern 或其他 AGPL/GPL 项目的实现。卡中的名字、描述、对话和世界书内容全部为测试编写。

运行：先 `pnpm build`，再 `pnpm exec vitest run packages/host/test/scenarios/cards.test.ts --maxWorkers=1`。本测试覆盖原始 payload 保留、V1/V2/V3/PNG、嵌套扩展字段、固定业务错误、Agent 隔离、默认卡、协议替换和输入 schema。

`model-fake` 经 HTTPS service 权限和本组件连接调用注入的 Fake Sink；凭据只由宿主绑定注入。`agent-loop` 提供 chat/history 与简易前端，循环和记忆均使用当前 Agent 的私有资源 CAS。`tavern` 只实现有限世界书匹配并报告未支持行为，业务代码均在真实 isolate 中运行。循环不声明 engine/fs/exec 权限；记忆不使用共享资源组或完全访问。

`scenarios/chat.test.ts` 覆盖 S-A、工具结果回传、八轮限制、历史与记忆重启、错误不重试、凭据边界和真实 frontendInvoke 桥。`scenarios/tavern.test.ts` 覆盖 S-C 的 V2/V3、扫描深度、大小写、二级关键词、未支持行为及 R4/R6 两个消费者的解析器替换。`desktop/test/scenario-chat-ui.test.ts` 在独立 Electron 窗口中检查界面渲染和状态，用仅供测试的业务回复适配器；它与真实宿主桥的场景测试共同验证界面，不替代端到端安装验收。截图只写入 `.artifacts/`。

`mcp-bridge` 通过 HTTPS service 实现 MCP 2026-07-28 的有限工具子集，以及 2025-11-25 的初始化和会话兼容；传输封装在 `HttpMcpTransport`，没有本地 stdio 或直接网络 API。每次工具调用先取得完整分页列表，再由宿主批准与复核指纹。`scenarios/mcp.test.ts` 在 JSON/SSE 两种回复及两个版本中覆盖 S-D、调用链交集、分页、元信息头、会话失效与完成失败不重放。实现仅参照官方 MCP 规范，未使用第三方业务项目源码。

运行这部分：先 `pnpm build`，再 `pnpm exec vitest run packages/host/test/scenarios packages/desktop/test/scenario-chat-ui.test.ts --maxWorkers=1`。两个整机夹具已覆盖 S-F，编码/项目工具与 S-B/S-E/S-G/S-H 尚未完整实现，这些场景通过不代表完整需求完成。

两个 `machine-probe` 夹具在临时目录中运行真实独立本地进程，不读真实主目录，不联网。第一个回调 Fake 模型，第二个用于证明旧信任不扩大。记忆的 localProbe 是缺少本地执行权限的负向检查。`scenarios/machine.test.ts` 还覆盖普通 common/资源/任务范围和策略租约同时活动；本地回调的 common/资源接入、选择性生命周期与项目沙箱继续实施。

本轮新增 coding-tools、crash-probe、policy-fake。前两者默认声明项目档位；策略夹具只返回固定决定，不做风险审查。remaining.test.ts 的整机 crash 变体仅验证可用的生命周期，不作为 S-G 项目成功路径。S-E 在全新目录直接导入后上限为沙箱、无本地授权；导入制品固定到导出 ZIP 字节的摘要。S-B 的候选功能声明已修复，成功路径仍受原生项目入口阻塞；项目入口仍不可用，不将拒绝行为当成功场景。


coding-tools 的 run 测试协议使用 `{program:string,args:string[],cwd?:string}`，不接受 command 字符串；cwd 与文件路径必须落在 initialize 指定的项目目录内。结果为 `{exitCode,stdout,stderr,truncated?:true}`，每路输出最多 64 KiB，并按 UTF-8 边界截断；list/call 输出分别是工具定义数组和 `{ok,content}`。夹具的路径检查仅提供稳定错误，不能代替系统沙箱。独立 Node 协议测试不代表真实项目档位已可运行。
