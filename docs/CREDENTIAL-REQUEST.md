# 凭据代用请求契约

状态：当前有效（2026-10-18 核实）；R4 最小安全集已在 Mac（Rust）与 Android（Kotlin）实现并通过单元测试与两端编译，生产 `PlatformAdapter` 在原生应用中提供 `credential.request`。真实账户调用、普通包内的密钥读取与 WebView 存储/日志无密钥检查尚未执行，见[当前阶段](spec/milestone.md)。

本契约是凭据请求、授权、失败边界的唯一详细来源；路线与当前任务见[整体计划](spec/total.md)与[当前阶段](spec/milestone.md)。绑定记录与密钥录入见[通用绑定与原生凭据管理](CREDENTIAL-BINDINGS.md)。

连接器提交序列化载荷并取得响应，只引用自己的非秘密绑定名。平台管理凭据、精确目标和请求政策；扩展构造 JSON 等载荷并解析业务响应。

## 作者接口

扩展 manifest 声明 `capabilities: ['credential.request']`，并由宿主授权。激活后调用 `ctx.platform('credential.request', { version: 1, binding: 'text', body }, signal?)`。类型 `CredentialRequest`、`CredentialResponse`、`CredentialFailureOutcome` 由 SDK 导出；`platform` 返回 unknown，作者按契约校验响应。

- 请求只接受 version/binding/body 三个字段；body UTF-8 不超过 4096 字节。不得传 owner、URL、头、方法或原始凭据。调用者身份由 Host 转为 `extension.<id>`，绑定只在该 owner 内解析。
- 成功响应为 `{ status, body }`：状态 200–599 且排除 3xx，正文为合法 UTF-8 且不超过 8192 字节。HTTP 4xx/5xx 交给扩展解释，不自动重试。不返回响应头或凭据；远端正文仍可能回显秘密，目标须可信。
- 失败为带 `code` 与 `outcome` 的 Error，`outcome` 为 `not-dispatched`（可证明未开始网络 I/O）或 `unknown`（可能已到达远端）。浏览器预览不提供此能力，扩展保持 `waiting`。

## 已实现的最小安全集

| 项目 | 实现 |
| --- | --- |
| 秘密 | 只在原生层读取并注入一个请求头：Mac 从 Keychain 读取后构造头并清零缓冲；Android 在凭据插件内用 Keystore 解密。秘密不返回 WebView、不写日志或状态；HTTP 栈与 JVM 内部副本不承诺归零 |
| 传输 | Mac：`reqwest =0.13.5` + rustls，证书由 `rustls-platform-verifier` 交给系统校验，仅 HTTPS。Android：`HttpsURLConnection`，系统默认信任 |
| 目标 | 仅绑定保存的精确 HTTPS URL，方法 POST；扩展不能改写目标、头或认证 |
| 网络 | 不跟随重定向（3xx 报 unknown `redirect`）；不用系统/环境代理；不发 cookie；不隐式解压（Android 显式 `Accept-Encoding: identity`）。保存了代理路由的绑定拒绝发送（`proxy-unsupported`） |
| 时限与限额 | 连接 10 秒、总计 30 秒；请求 4096 字节、响应 8192 字节（声明长度或累计读取超限即停止）；每个 owner 同时 1 个请求，否则 `busy` |
| 首次发送确认 | 每个绑定修订第一次发送前，原生面板展示扩展、来源、目标、POST、内容类型与认证头名，用户确认后本进程内同一修订不再询问。取消即 `not-confirmed`。授权变更、扩展停用、撤销或重新绑定使确认失效；重启后须重新确认 |
| 取消与撤销 | WebView 取消通过请求 ID 通知原生中断连接；授权变更、停用（`release`）、删除或卸载前的禁用会取消在途请求。发送前与交付前都重新检查授权和绑定修订，变化则不交付（`stale`） |

原生命令为 `credential_request`、`credential_abort`、`credential_release`；Android 由 `CredentialsPlugin` 的 `request`/`cancel` 执行同一政策。

## 失败边界

| 层 | 结果 | 可证明的事实 |
| --- | --- | --- |
| Host 进入平台适配器前（声明、能力、生命周期） | 既有 Host 拒绝 | 未进入平台适配器 |
| 适配器与原生分发前（载荷格式、授权、绑定未就绪、忙、未确认、代理路由、密钥不可读、已取消） | `not-dispatched` | 未开始网络 I/O |
| 网络 I/O 开始后（连接/TLS 失败、超时、取消、3xx、响应超限或非 UTF-8、交付前授权或绑定已变化、桥接失败） | `unknown` | 远端可能已处理；不自动重试 |
| 已验证的完整响应 | `{ status, body }` | 4xx/5xx 保留给扩展 |

适配器为常见代码提供中文说明（如 `not-ready` 提示录入 API Key）。unknown 提示用户先核对，再决定是否重试。

## 验证

- `src-tauri/src/credential_transport_tests.rs`：用回环 HTTP 服务验证注入头、4xx 透传、3xx 不访问跳转目标、声明/流式超限、静默服务超时、生产客户端拒绝明文 HTTP、UTF-8/状态校验。
- `src-tauri/src/credential_request_tests.rs`：每 owner 单请求、按 ID 取消（含先于注册到达的取消）、确认按修订生效、`release` 清除确认并取消在途。`credential_bindings_tests.rs` 覆盖只解析就绪绑定、管理操作进行中为 busy。
- `tests/native-credential-request.test.ts`：适配器可用性、载荷校验零原生调用、outcome 保留、取消转发与停用释放。
- `tests/fixtures/credential-platform.ts` 的 FakeCredentialPlatform 仍是连接器协议测试用的参考模型，不是原生实现。

未验证：真实系统证书链与 DeepSeek 官方 API 的实际调用；普通包中 Keychain/Keystore 读取；Android 传输的单元测试（Kotlin 仅编译通过）；WebView 存储与日志的无密钥检查。真实调用由账户所有者在原生面板录入密钥，每端一次、`max_tokens` ≤ 256、不自动重试。

## 后续加固

DNS 公网地址固定与私网拒绝、OS 证书吊销的联网边界、显式代理传输、全局并发上限、授权世代持久语义、受控 CA 夹具、诊断环形记录与响应中原始令牌的拒绝交付，见[整体计划的后续加固](spec/total.md#后续加固)。开放扩展市场前还须按扩展隔离（共享 WebView 中的代码仍可直接触达原生桥接，首次发送确认不是恶意扩展隔离）。
