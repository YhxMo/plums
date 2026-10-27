# 公开网络读取

状态：当前有效（2026-10-24 核实）；`network.read` 已在 TS 宿主与 Mac（Rust）实现（Android 的 Kotlin 适配随平台冻结移出主线（见 Git 历史），Rust 中按平台编译的注册分支保留），回归见[回归测试](#回归测试)；内置模型连接器用它读取 models.dev。打包应用的实际结果见[交付入口](../evidence/RESULTS.md)与 [HANDOFF](../HANDOFF.md#未验范围)。

扩展读取不需要密钥的公开资源（如公开的模型目录）时使用本能力。它不带任何凭据，与[凭据代用请求](CREDENTIAL-REQUEST.md)分开：需要 API Key 的请求一律走凭据请求。

## 作者接口

manifest 同时声明能力与来源，两者缺一即拒绝导入：

```js
capabilities: ["network.read"],
networkSources: ["https://models.dev"],
```

`networkSources` 为 1–8 个不重复的来源，每个都是小写、默认端口、带点的公共域名的 `https://` 来源，不带路径、端口、用户信息或尾部斜杠（`localhost` 与 IP 地址不接受）。授权弹窗显示「读取公开网络资源（models.dev，不带密钥）」。

激活后调用 `ctx.platform("network.read", { version: 1, url }, signal?)`，返回 `{ status, body }`（类型 `NetworkReadRequest`、`NetworkReadResponse` 由 SDK 导出）。`url` 必须属于声明的来源，≤ 2048 字符，不带 `#` 片段；载荷只能有这两个字段。非 2xx 状态也原样返回，由扩展判断。

## 平台政策

| 项目 | 规则 |
| --- | --- |
| 方法与内容 | 只 `GET`，不发送请求体；不带 Cookie、凭据、自定义请求头 |
| 网络路径 | 不用系统代理，不跟随重定向（3xx 记为失败），不用缓存 |
| 大小与时间 | 响应（解压后）≤ 16 MiB、须为 UTF-8；总计 60 秒 |
| 并发 | 每个扩展同时一条读取；停用或撤权时取消在途读取，撤权后完成的结果不交付 |
| 检查位置 | TS 宿主核对载荷、授权与声明来源；原生再核对 URL 形状与授权 |

失败沿用凭据请求的 `code` 与 `outcome`：载荷不符、来源未声明为 `invalid-request` / `not-dispatched`，不会调用原生；取消、超时、超限、编码错误与传输失败按是否已发出记 `not-dispatched` 或 `unknown`。浏览器预览不提供本能力。

## 信任边界

扩展是与宿主共享 WebView 的本地可信代码：来源声明与授权提示让用户看见扩展会访问哪些站点，并阻止经公开接口访问未声明的地址，但不是安全沙箱，不能阻止恶意扩展直接调用 WebView 的网络接口。

## 回归测试

`tests/network-read.test.ts`（声明校验、授权文案、原生调用参数、拒绝时零调用、需授权、按 id 取消、停用释放）、`src-tauri/src/network_tests.rs`（URL 形状、上限、同一扩展并发与提前取消）。
