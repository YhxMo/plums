# 无凭据原生传输验收

2026-10-15 UTC。负责人：SDK 与平台维护者。受验基线 `b558037` 加显式 Cargo 特性、Rust 回环实验命令和独立测试页/服务。源码绑定 [135 文件清单](source-manifest-8963c34dca83f1fbc1c87e778197349d83ad369a5390b3219d7213200a57c049.json)，集合摘要 `8963c34dca83f1fbc1c87e778197349d83ad369a5390b3219d7213200a57c049`；[元数据](native-transport-2026-10-15.json)记录测试包、安装包、服务计数及原始证据摘要。

## 结果

| 范围 | 执行结果 |
| --- | --- |
| 缺失能力反例 | 初始 Rust 测试因 Probe 未实现而编译失败；随后实现后通过 |
| `npm test` | 20 文件、161 项通过 |
| `npm run build`、`npm run format:check` | 通过 |
| `cargo test --features native-transport-experiment --locked --offline` | 9 项通过，含 3 项实验授权/登记/限额反例 |
| `cargo test --locked --offline` | 默认特性 6 项通过 |
| `cargo clippy --all-targets --features native-transport-experiment --locked --offline -- -D warnings` | 使用已安装同版本 Rust 1.98.1 的 Clippy，通过；没有安装组件 |
| rustfmt | 已安装 formatter 对修改的两个 Rust 文件检查通过 |
| Mac arm64 独立 debug 测试包 | 构建和实际 WKWebView 原生调用通过，AX 树读取显示 passed=true |
| Android 16 / API 36 / ARM64 / WebView 133.0.6943.137 | 实验 APK 构建、隔离模拟器安装、实际 WebView 调用通过；软件渲染，非真机或人工触控 |

两端分别通过 12 项检查：未授权拒绝、成功回显、目标/请求限额、跨 owner 请求表拒绝及发送前取消、延迟和缓慢分块总超时、服务端已收到后的取消与撤权、撤权后立即重新授权不恢复旧请求、3xx 不跟随、已知长度及分块响应超限、最终零待处理。取消/撤权等待小于 500ms，超时等待小于 1800ms 的容差断言通过；配置总时限为 800ms，不将运行容差当成精确实时保证。

服务端累计 `/echo` 两次、`/delay` 六次、`/slow` 两次、重定向及两种超限路径各两次；`/should-not-hit` 为零。取消后远端可能继续处理，结果只证明本地停止等待和拒绝交付，不代表副作用回滚。合成请求不包含凭据或外部私人数据。

独立源码审查未发现阻塞，建议的 16 项登记上限/释放及立即再授权反例已补入并完成最终重建、回归与两端运行。精简复核未要求新增抽象。测试设计与特性边界见 [实验说明](../docs/NATIVE-TRANSPORT-EXPERIMENT.md)。

## 身份、交付与限制

Mac 测试标识为 dev.plums.m1.transportprobe；Android 测试 APK 保留 dev.plums.m1，仅安装到专用克隆模拟器。测试产物单独保留于忽略目录，复制摘要一致；安装 APK 与构建一致，v2 调试签名核对通过。普通 release 未替换，逐文件及 APK 摘要核对仍匹配普通配置阶段。

默认 Cargo 特性不编译模块或注册 probe 命令；生产平台仍不提供 credential.request。此次测试页直接调用实验原生命令，尚未完成 Host→原生公开能力适配。owner 为可伪造的实验参数，不能称生产身份授权隔离。无 TLS/公网/DNS/真实凭据/OAuth 或系统网络安全配置变更；不新增普通包、浏览器 UI、iOS、Windows/Linux 运行证据。

临时 reverse/forward 映射已移除，专用 Mac、模拟器、ADB 和合成服务已退出；18765/5054/5586/5587/9244 无监听。核对时原应用 PID 1951 与开发服务 PID 59947 保留。原始日志、截图与测试数据只保留本地忽略目录。

SDK 继续为实验版，iOS 接口稳定前门槛未完成，M2 整体未关闭。此阶段没有触及需要逐次确认的真实凭据或资源授权。

最终独立复核确认 135 文件逐项/集合摘要、17 项原始证据和两端测试产物匹配，普通 release 未变，无阻塞。提交前对 17 个精确暂存文件完成隐私与空白检查，135 个暂存源码文件匹配清单；未纳入原始日志、截图、运行数据、测试包或本地愿景。工程检查通过（211 文件、49 文档、332 本地链接）。
