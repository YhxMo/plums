# 配置模型连接与原生凭据

[凭据请求契约](CREDENTIAL-REQUEST.md) · [模型连接](MODELS.md) · [当前阶段](spec/milestone.md)

状态：当前有效（2026-10-19 核实）；绑定、原生录入、首次发送确认、传输注入与扩展自建连接已实现；代理实际传输待接通。

安装声明连接需求的扩展后，在扩展管理中选中它，右侧会显示“连接与凭据”。点击“录入 API Key”，核对原生面板中的扩展、来源、版本、官方目标和认证头，再输入密钥。保存连接与授权发送是两个操作，录入不会调用模型；第一次发送前原生面板会另行请你确认。

已有连接可从“网络设置”选择直连或填写 HTTP(S) 代理地址。默认直连，不自动读取系统或环境代理。代理只改变网络路径，官方目标保持；API 中转/网关作为后续独立接入方式。当前实现保存并校验代理配置，代理实际传输仍待接通。

## 声明、绑定与授权

`manifest.credentialBindings` 是可选的非秘密声明，须同时声明 `credential.request`。现有扩展不新增凭据要求。一个扩展最多声明四个别名，每个别名包含 label、规范化精确 HTTPS target、contentType、固定非秘密 headers 和 authentication：

```js
credentialBindings: {
  text: {
    label: "模型文本服务",
    target: "https://model.example/chat/completions",
    contentType: "application/json",
    headers: {},
    authentication: { type: "bearer" },
  },
}
```

也可用 `{ type: "header", name: "x-api-key" }` 声明由原生注入秘密的头名称。声明不包含秘密、代理、授权或任意请求字段；不创建绑定。扩展请求仍只包含 `version/binding/body`。

Host 在安装时验证声明，原生管理命令再次验证并拒绝未知字段。目标要求规范化 HTTPS URL，无用户信息、查询、fragment 或非默认端口。内容类型限定为媒体类型 token，固定头按大小写去重；拒绝 CR/LF、认证头冲突、Content-Type 重复和传输/逐跳/代理/cookie 头覆盖。代理配置单独验证，仅接受无账号密码、路径、查询或 fragment 的 HTTP(S) 端点，可明确指向本地代理。PAC、SOCKS 和代理认证尚未接入。

绑定记录归宿主管理，按 `(extension owner, alias)` 定位，保存来源、扩展版本、批准政策、独立路由、修订和状态。普通扩展配置和组合不携带密钥或授权。来源、版本、政策或路由变化须在后续发送授权中重新核对，持久绑定不会恢复进程授权。

### 发送授权

保存连接、录入密钥和授权发送是三件事：通用能力授权确认 `credential.request`；每个绑定修订第一次发送前由原生面板单独确认。绑定存在或密钥保存成功都不等于允许外发；安装、启用、恢复组合、重启和重新录入密钥都不会自动发送请求。确认的内容、保存与失效条件以[凭据请求契约](CREDENTIAL-REQUEST.md)为准。

授权约束本应用的公开 `ctx.platform` 路径。扩展与宿主共享 WebView，同环境代码仍可能直接触达原生桥接，不能把授权提示称为恶意插件隔离；该边界须在界面和文档中如实呈现。详细失败边界与传输政策见[凭据请求契约](CREDENTIAL-REQUEST.md)。

## 扩展自建连接

需要多条连接、目标由用户决定的扩展（例如模型连接器）不在 manifest 写死 target，而是声明协议模板并同时申请 `credential.request` 与 `credential.connect`：

```js
capabilities: ["credential.request", "credential.connect"],
credentialProtocols: {
  "openai-chat": {
    label: "OpenAI 兼容 Chat Completions",
    contentType: "application/json",
    headers: {},
    authentication: { type: "bearer" },
  },
},
```

模板除没有 `target` 外与绑定声明同规则，最多四个。扩展调用 `ctx.platform("credential.connect", payload)`：

| payload | 结果 |
| --- | --- |
| `{ action: "list" }` | 本扩展自建的连接 `{ alias, protocol?, label, target, status }`；manifest 中的静态别名不在其内 |
| `{ action: "save", alias?, protocol, label, target }` | 宿主用"模板 + 用户填写的 target"组装声明，打开原生录入面板；面板显示扩展、来源、版本、target 和认证头，由用户确认并录入密钥。省略 alias 时新建 `c-` 开头的别名，回执 `{ alias, status, reason? }` |
| `{ action: "remove", alias }` | 走原有撤销并删除凭据路径，原生面板再次确认 |

target 须为规范化 HTTPS 地址（无端口、查询、fragment 或账号）；每个扩展最多 16 条自建连接，总数仍受 32 条上限约束；自建连接的别名形如 `c-` 加 8 位小写字母或数字，清单声明不能使用这种形式。删除自建连接在秘密确认删除后移除整条记录、释放名额（清单声明的绑定仍保留为禁用以便重新录入）。扩展拿不到密钥，也不能静默改目标：修改 target 必须重新打开录入面板，修订号随之增加，已保存的发送确认失效。扩展管理的"连接与凭据"列出这些连接，可在那里设置代理或删除；重新录入在扩展自己的页面完成。

## 原生录入与存储

WebView 只提交非秘密政策和预期修订。`credential_configure` 打开原生安全输入框，回执仅为 saved、cancelled、rejected 或 unknown；没有传入或返回原始密钥的 WebView API。录入只接受 1–4096 字节的可见 ASCII 令牌，不自动修剪或更改密钥。传输时由原生读取并注入认证头，读取后尽力清理原始缓冲；HTTP/JVM 内部副本不承诺完全归零。

| 平台 | 当前适配实现 |
| --- | --- |
| Mac | AppKit `NSSecureTextField`；Keychain generic password，service 为应用标识加 `.credentials.v1`，account 为原生 UUID；明确关闭云同步 |
| Android | 原生密码 EditText，关闭表单保存/自动填充并保护录入窗口；每个原生 UUID 使用 Android Keystore AES-256-GCM 密钥，随机 IV，绑定 UUID 的 AAD；令牌密文由 AtomicFile 写入 noBackupFilesDir |

Android Keystore 保存加密密钥，令牌保存在应用私有的加密文件中。没有硬件保护保证；锁定、拒绝访问、签名变化、密钥失效和真实设备行为仍须分平台执行验证。

非秘密元数据保存在实验数据根的 `credential-bindings.json`，最多 32 条、64 KiB；不保存密钥。IPC 列表不返回原生秘密引用。临时写入使用独有文件、文件同步、rename 和目录同步；损坏原件保留，失败不会清空记录。

## 回执决定下一步

| 状态 | 管理入口与恢复 |
| --- | --- |
| 尚无绑定 | 原生录入；确认前不写系统秘密 |
| pending | 原生录入或写入结果待核对；只在明确核对成功后转 ready，不自动重试保存 |
| ready | 已收到保存回执，仍未授权发送；可重新录入、配置网络或撤销 |
| disabled | 连接禁用；保留的秘密引用仍可明确删除，不能静默恢复 |
| delete-pending | 已先持久禁用，秘密删除未确认；保持禁用并允许幂等继续删除 |

开始录入先保存 pending 元数据，再执行原生面板和秘密操作。明确取消或写入前拒绝会恢复旧记录；已开始写入后失败按 unknown 保留新引用和旧引用，重启后可核对。最多保留八个引用，达到上限要求先清理。重新录入确认保存后，立即以独占票据尽力删除旧引用对应的系统凭据，只把确认删除（含本就不存在）的引用移出记录；绑定忙或删除失败时保留，下次重录或撤销时重试。秘密保存成功但元数据提交回执未知时也不报成功，重启后按 pending 核对。

撤销先持久化禁用状态，再删除该绑定持有的秘密；删除和最终元数据提交都确认后才显示完成。秘密缺失按幂等删除处理；部分删除保留禁用与待核对状态。元数据提交失败锁住当前管理状态，重启重新读取，不拿旧内存状态覆盖磁盘。

管理命令在平台不支持或凭据存储不可用时显式返回 `rejected: unavailable`，表示未尝试、未执行；`unknown` 只表示回执未确认、可能已发生副作用，二者不合并。宿主初始化探测或首次 inventory 失败会记录并显示原因，不写成平台不支持。Android AlertDialog 创建或显示失败（尚未进入密钥写入）按 `unavailable` 返回并恢复旧记录；EditText 构建和窗口标志设置仍在异常捕获之外，仅在 logcat 记录异常类名；已进入写入线程后的失败仍按 unknown 保留待核对。

移除 alias 或连接声明后，已有记录继续显示，保留核对/删除入口。卸载前禁用该扩展的绑定，系统秘密随“保留数据”操作保留；宿主的“卸载后保留的凭据”入口允许之后删除。删除完全部秘密引用的卸载记录不再占用界面，非秘密禁用记录仍保留。无需凭据的既有扩展不增加凭据前置条件。

## 当前验证范围

本地隔离测试覆盖声明拒绝、来源/修订冲突、未知回执、坏元数据、重启、临时写入中断和保留秘密清理；浏览器测试模拟原生回执，验证当前/移除声明及卸载后的管理入口。原生测试包检查真实面板的显示、聚焦、取消和非秘密代理设置。

这些路径不执行系统秘密实际保存/读取/删除，也不发送真实请求。秘密读取/注入、传输时限与真实调用的验证见[凭据请求契约](CREDENTIAL-REQUEST.md)；扩展自建连接由 `tests/credential-connect.test.ts` 覆盖模板组装、owner 隔离与参数拒绝（原生面板沿用既有录入路径，未单独实机验证）。

实现入口为 [SDK 声明](../modules/sdk/credential-bindings.ts)、[原生绑定状态](../src-tauri/src/credential_bindings.rs)、[原生管理命令](../src-tauri/src/credentials.rs)、[原生秘密适配](../src-tauri/src/credentials_native.rs)、[Android 秘密适配](../native/android/CredentialsPlugin.kt)和[宿主管理组件](../src/features/extensions/CredentialBindings.tsx)。底座不包含模型协议或业务循环。

管理命令属于宿主管理面，不是扩展的公开 ctx 平台能力。M1 的可信 ESM 与宿主共享 WebView，原生桥接不构成恶意扩展隔离；正常扩展调用仍经 owner/alias 契约处理。实际验证与剩余范围见[限定证据](../evidence/CREDENTIAL-BINDINGS-2026-10-17.md)。
