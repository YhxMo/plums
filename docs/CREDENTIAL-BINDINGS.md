# 配置模型连接与原生凭据

[凭据请求契约](CREDENTIAL-REQUEST.md) · [模型连接](MODELS.md) · [当前阶段](spec/milestone.md)

状态：当前有效（2026-10-24 核实）；绑定、应用内填写密钥、原生存储与注入、扩展自建连接已实现；代理实际传输待接通。

安装声明连接需求的扩展后，在扩展管理中选中它，右侧会显示“连接与凭据”：核对目标地址，在密码框中粘贴 API Key 后点“保存 API Key”。保存不会调用模型；填写时目标就在旁边，保存即同意向它发送，之后不再弹出确认。模型连接器等自建连接的扩展在自己的表单中填写，规则相同。

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

绑定记录归宿主管理，按 `(extension owner, alias)` 定位，保存来源、扩展版本、批准政策、独立路由、修订和状态。普通扩展配置和组合不携带密钥或授权。来源、版本或政策变化须重新填写密钥，持久绑定不会恢复进程授权。扩展更新后声明了新地址时，管理页显示新地址并注明已保存连接的旧地址；保存密钥绑定的是显示的新地址。

### 发送授权

通用能力授权确认 `credential.request`；每个绑定修订另有发送确认。用户在显示目标的表单中填写并保存密钥即为该修订的确认，随绑定记录保存；改网络配置会提升修订，下次发送前由原生面板再确认一次。安装、启用、恢复组合、重启和保存密钥都不会自动发送请求。确认的内容、保存与失效条件以[凭据请求契约](CREDENTIAL-REQUEST.md)为准。

授权约束本应用的公开 `ctx.platform` 路径。扩展与宿主共享 WebView，同环境代码仍可能直接触达原生桥接，不能把授权提示称为恶意扩展隔离；该边界须在界面和文档中如实呈现。详细失败边界与传输政策见[凭据请求契约](CREDENTIAL-REQUEST.md)。

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
| `{ action: "save", alias?, protocol, label, target, key }` | 宿主用"模板 + 用户填写的 target"组装声明，连同用户在扩展表单中填写的 `key` 交给原生保存；`key` 只写不读，任何回执与列表都不含它。省略 alias 时新建 `c-` 开头的别名，回执 `{ alias, status, reason? }`，格式不符为 `rejected: invalid-key` |
| `{ action: "remove", alias }` | 走原有撤销并删除凭据路径，原生面板再次确认 |

target 须为规范化 HTTPS 地址（无端口、查询、fragment 或账号）；每个扩展最多 16 条自建连接，总数仍受 32 条上限约束；自建连接的别名形如 `c-` 加 8 位小写字母或数字，清单声明不能使用这种形式。删除自建连接在秘密确认删除后移除整条记录、释放名额（清单声明的绑定仍保留为禁用以便重新录入）。已保存的密钥不能读回；修改 target 必须同时填写密钥，修订号随之增加。扩展管理的"连接与凭据"列出这些连接，可在那里设置代理或删除；更换密钥在扩展自己的页面完成。

## 填写与存储

用户在应用内的密码框（不自动填充、不拼写检查）填写密钥，右侧眼睛按钮可显示或隐藏当前输入；清空、保存或禁用输入后恢复隐藏，已保存的密钥不回读到表单。`credential_configure` 连同非秘密政策和预期修订把它交给原生一次；回执仅为 saved、rejected 或 unknown，没有返回密钥的 WebView API。只接受 1–4096 字节的可见 ASCII 令牌（表单去掉首尾空白），宿主与原生各校验一次。传输时由原生读取并注入认证头，读取后尽力清理原始缓冲；HTTP/JVM 内部副本不承诺完全归零。

| 平台 | 当前适配实现 |
| --- | --- |
| Mac | 数据根内独立的 `credential-secrets.json` 明文文件，schema 1，以既有原生引用索引密钥；文件权限 0600，不使用 Keychain |
| Android | 每个原生 UUID 使用 Android Keystore AES-256-GCM 密钥，随机 IV，绑定 UUID 的 AAD；令牌密文由 AtomicFile 写入 noBackupFilesDir |

Mac 沿用现有 JSON 格式和密钥引用，不迁移或重新录入已有文件中的有效密钥。写入使用独立的 `credential-secrets.lock` 与 Rust 标准文件锁，在锁内重读后更新；锁文件保持原位，进程退出时系统释放锁。复用原子持久化：0600 独有临时文件、文件同步、rename 和目录同步。读者只会看到完整的旧或新快照；损坏、格式不符、超过 1 MiB 或权限不是 0600 的文件保持原样并拒绝使用，不清空、不自动放宽权限。没有 Keychain 迁移或签名身份前提；更换本地包不会触发密钥读取授权。

0600 限制其他普通本机账户读取，不防同一用户运行的程序、管理员、恶意扩展或备份泄漏，也不是文件加密。应用数据与备份应按秘密保管；需要系统加密隔离时，这一文件方案不满足该要求。Android 没有硬件保护保证，仍需独立验证。

非秘密元数据保存在实验数据根的 `credential-bindings.json`，最多 32 条、64 KiB；不保存密钥。IPC 列表不返回原生秘密引用。临时写入使用独有文件、文件同步、rename 和目录同步；损坏原件保留，失败不会清空记录。

## 回执决定下一步

| 状态 | 管理入口与恢复 |
| --- | --- |
| 尚无绑定 | 填写密钥后保存 |
| pending | 写入结果待核对；只在明确核对成功后转 ready，不自动重试保存 |
| ready | 已收到保存回执；可更换密钥、配置网络或撤销 |
| disabled | 连接禁用；保留的秘密引用仍可明确删除，不能静默恢复 |
| delete-pending | 已先持久禁用，秘密删除未确认；保持禁用并允许幂等继续删除 |

开始保存先写 pending 元数据，再写秘密。写入前拒绝（格式不符、存储拒绝访问或凭据文件不可用）会恢复旧记录；已开始写入后失败按 unknown 保留新引用和旧引用，重启后可核对。最多保留八个引用，达到上限要求先清理。更换密钥确认保存后，立即以独占票据尽力删除旧引用对应的秘密，只把确认删除（含本就不存在）的引用移出记录；绑定忙或删除失败时保留，下次重录或撤销时重试。秘密保存成功但元数据提交回执未知时也不报成功，重启后按 pending 核对。

撤销先持久化禁用状态，再删除该绑定持有的秘密；删除和最终元数据提交都确认后才显示完成。秘密缺失按幂等删除处理；部分删除保留禁用与待核对状态。元数据提交失败锁住当前管理状态，重启重新读取，不拿旧内存状态覆盖磁盘。

管理命令在平台不支持或凭据存储不可用时显式返回 `rejected: unavailable`，表示未尝试、未执行；`unknown` 只表示回执未确认、可能已发生副作用，二者不合并。宿主初始化探测或首次 inventory 失败会记录并显示原因，不写成平台不支持。Android 写入线程内的失败按 unknown 保留待核对。

移除 alias 或连接声明后，已有记录继续显示，保留核对/删除入口。卸载前禁用该扩展的绑定，已保存秘密随“保留数据”操作保留；宿主的“卸载后保留的凭据”入口允许之后删除。删除完全部秘密引用的卸载记录不再占用界面，非秘密禁用记录仍保留。无需凭据的既有扩展不增加凭据前置条件。

## 实现入口与回归测试

本地隔离测试覆盖声明拒绝、来源/修订冲突、未知回执、坏元数据、重启、保留秘密清理与保存密钥即确认发送。`credential_secrets_tests.rs` 使用假密钥和临时目录，覆盖既有格式与引用、0600 权限、坏数据保留、独立写者并发、等待文件锁后重读及幂等删除。

浏览器测试模拟原生回执，覆盖两处输入框的显隐、无意提交防护、清空/保存复位及不回读旧密钥；InfoTip 的标准 Popover 覆盖点击、取消按压、键盘与嵌套弹窗焦点。打包应用与平台结果见 [HANDOFF](../HANDOFF.md#未验范围)。

实现入口为 [SDK 声明](../modules/sdk/credential-bindings.ts)、[原生绑定状态](../src-tauri/src/credential_bindings.rs)、[原生管理命令](../src-tauri/src/credentials.rs)、[原生秘密适配](../src-tauri/src/credentials_native.rs)、[Android 秘密适配](../native/android/CredentialsPlugin.kt)和[宿主管理组件](../src/features/extensions/CredentialBindings.tsx)。底座不包含模型协议或业务循环。

管理命令属于宿主管理面，不是扩展的公开 ctx 平台能力。当前可信 ESM 与宿主共享 WebView，原生桥接不构成恶意扩展隔离；正常扩展调用仍经 owner/alias 契约处理。
