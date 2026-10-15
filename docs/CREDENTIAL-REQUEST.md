# 凭据代用请求契约实验

状态：实验类型与测试专用参考适配器；生产 `PlatformAdapter` 不提供 `credential.request`，未实现真实网络、凭据库或授权 UI。不意味着 Mac/Android 原生支持；接口正式稳定前仍须 iOS 最小验证。

需求：连接器提交文本并取得响应，凭据和精确目标由平台侧管理，扩展只引用自己的非秘密绑定名。模型协议与响应解析留在扩展。本阶段选择固定 POST、有限文本响应，不实现流式、工具调用或重试；这是验证作用域所需的最小用例。

## 作者接口

扩展 manifest 声明 `capabilities: ['credential.request']`。激活后调用 `ctx.platform('credential.request', { version: 1, binding: 'text', body: 'hello' }, signal?)`。类型 `CredentialRequest`、`CredentialResponse`、`CredentialFailureOutcome` 由 SDK 导出；`platform` 仍返回 unknown，作者按契约校验响应。

请求只接受 version/binding/body；body UTF-8 不超过 4096 字节。不得传 owner、URL、头、方法或原始凭据。调用者身份由 Host 转为 `extension.<id>`，绑定在这个平台 owner 内解析；同名绑定不代表跨扩展授权。绑定配置与普通业务配置分开，别名不是秘密或授权证明。

成功响应为 `{ status, body }`，状态 200–599 且排除 3xx，正文 UTF-8 不超过 8192 字节；HTTP 4xx/5xx 保留给扩展解释，不自动重试。适配器不返回头或凭据；这不能保证远端正文绝不回显秘密，真实适配仍须评估数据泄漏与可信目标。

## 拒绝与取消

Host 先执行声明、授权和生命周期检查。测试适配器再检查能力、授权、owner 绑定、请求结构及大小；发送前失败为 `outcome: 'not-dispatched'`。既有 Host 在进入适配器前的拒绝仍沿用 `not-committed`，作者不能假定所有拒绝只有一种结构。

发送之后的传输失败、取消、撤权、重定向或坏响应为 `outcome: 'unknown'`；统一错误文字，不透传上游错误、请求正文、地址或凭据。unknown 表示远端副作用可能已经发生，不能自动重试；撤权/取消不承诺撤销已发送请求。撤权使当前授权世代失效，重新授权不能恢复旧请求。模拟传输若忽略 abort，等其完成后拒绝迟到响应；未承诺立即终止或超时保证。

真实适配必须禁止自动重定向，不能先跟随后拒绝。当前参考传输只返回合成状态，没有网络，因此 3xx 用例仅验证不向作者交付、不再次分发，不证明任何 HTTP 栈配置。

## 隔离参考适配器

`tests/fixtures/credential-platform.ts` 导出 FakeCredentialPlatform，仅测试引用。构造参数为绑定列表 `{ owner, id, target }` 与合成传输回调；target 必须为 HTTPS 的 `.invalid` 域、无端口/用户信息/查询/fragment。绑定被复制，凭据由适配器生成固定 `fake-only` 字符串，不接受真实凭据输入；没有 fetch、持久化或原生桥接。

回调接收 `{ target, method: 'POST', authorization, body, signal }`，返回合成 `{ status, body }`。适配器是可执行参考模型，回调由测试维护者控制，不是扩展 API、原生实现或强安全沙箱。共享 WebView 依然不能隔离恶意扩展。

后续真实适配门槛：明确用户确认流程、每 owner 绑定创建/撤销、OS 秘密存储、精确目标及 DNS/代理/重定向策略、传输超时/流式限额、脱敏诊断，并分别在 Mac/Android 留证。任何真实凭据、OAuth 或资源授权必须另获逐次确认；本阶段不触发这些操作。
