# plums

Plums 内核（Apache-2.0）。pnpm 单仓库，包含：

- `@plums/core`：TypeScript 内核库
- `plums`：只调用库公开 API 的命令行。core、CLI 与运行时版本为 0.2.0

## 环境

Node.js 22 或更新的 LTS，以及 pnpm 10。

## 命令

```sh
pnpm install
pnpm build
pnpm test
pnpm exec plums --help
```

`pnpm test` 会先构建，再跑 Vitest。不带参数的 `plums` 打印 `@plums/core` 的版本号。

里程碑 1 的命令行有 `import`、`inspect`、`enable`、`uninstall`、`export`。密钥只在内存里，没有真实外发。`share import`、真实的 `EgressSink` 和持久化 `SecretStore` 留到里程碑 2。

数据目录默认是用户目录下的 `.plums`。`--home <目录>` 或环境变量 `PLUMS_HOME` 可以改掉。

新建清单可使用 `@plums/core` 导出的 `PACKAGE_FORMAT_VERSION` 作为 `formatVersion` 默认值（当前为 `"2.0"`）；`SUPPORTED_FORMAT_MAJOR` 从它推导。内核读取 1.x 与 2.x，导出保留传入的版本，例如 `1.7` 或 `2.7`。

2.x 权限使用 `kind: fs | exec | egress`，每条有唯一 `id`、`target` 和 `reason`。fs 的 `operations` 显式列出 read/write/list，write 不隐含 read；exec 的 `cwdRoots` 列出逻辑工作目录根；egress 沿用 HTTPS 域名和端口规则。`inspect` 返回 formatVersion 和完整声明，CLI 的 inspect、enable 输出也保留全部字段。跨格式更新，或新增操作、改变类别/目标、增加 exec 目录范围，都需重新同意。

公开类型 `Manifest`、`Permission` 包含 1.x/2.x 联合类型。宿主可通过 `isManifestV1`、`isManifestV2` 区分已验证清单，再按 2.x 权限的 kind 分支；也可使用明确的 `ManifestV1`/`ManifestV2`、`PermissionV1`/`PermissionV2` 类型。未知字段继续保留，不用于推断权限。2.x 包不能通过 `runAction` 或现有 MCP 入口调用，返回 `PERMISSION_DENIED`、`/formatVersion`、reason `FORMAT_API_MISMATCH`。

2.x extension 使用 `core.runCapability({ extensionId, permissionId, request })`。宿主创建时绑定逻辑目录与登记程序，注入 `FsSink`、`ExecSink`、`onAudit`；内核检查权限与真实路径，经逐次确认和审计后调用 Sink。自带 `RecordingFsSink`、`RecordingExecSink` 只记录调用并返回预设结果。读取、写入、列目录、命令和外发的完整类型、示例与失败状态见 [能力调用接口](docs/capabilities.md)。CLI 保留现有命令。

## 已知限制

- 数据库格式现为 4，首次打开旧数据目录会从格式 2 经 3 自动升级，或从 3 升为 4，保留安装、同意、启用、MCP 和已有密钥引用。权限 JSON 不改写，同意记录另存清单格式版本；包文件不自动升级。旧内核拒绝打开升级后的目录。
- 更新删除旧密钥失败时，新版本已经安装，返回 `SECRET_NOT_FOUND`，`details` 为 `{ id, version, reason: SECRET_CLEANUP_FAILED }`。包记录保留曾声明的密钥引用，后续更新或卸载会再次清理；底层删除错误不会外露。升级前已失去记录的孤儿引用无法自动找回。

命令行：

- 密钥只在内存里，没有持久化的 SecretStore。进程结束密钥就没了，也没有读写密钥的子命令。
- 没有真实的联网外发。内核要外发时用的是 `RecordingEgressSink`，不打开网络。
- `enable` 必须带 `--yes`。这会同意 manifest 声明的全部权限，成功时输出列出这些权限。命令行读不到已安装包的权限清单，不能在这里交互同意。先 `inspect` 看 zip 里的权限，再 `enable --yes`。
- `uninstall` 删掉的内容见下面内核那条。没有 `--yes` 时在标准错误上确认，拒绝则不卸载。管道里的 `y` 算同意，不要求 TTY。

内核：

- 更新一个包时，不检查别的包是否依赖它的旧版本（不检查反向依赖）。
- 卸载一个包时，不检查别的包是否依赖它。依赖它的包会在下次启用时返回 `DEPENDENCY_MISSING`。
- 内核不做 DNS 解析。真实的 `EgressSink` 必须在解析后拒绝回环、内网和链路本地地址。
- 通配符只数域名标签，`*.co.uk` 和 `*.github.io` 仍可通过；公共后缀由宿主限制，因为内核不维护一份会过期的公共后缀清单。
- 内核不跟随重定向。`EgressSink` 返回 `redirectTo` 时，内核原样交还给调用方；要继续，调用方用新地址再调一次对应格式的动作/能力入口。
- 以点结尾的主机名一律拒绝（reason 为 `TRAILING_DOT`）。
- `uninstall` 删掉哪些内容，以及 `manual:<名>` 为什么只清工具批准，见 `Core.uninstall` 的注释（`packages/core/src/create-core.ts`）。
- 卸载若中途崩溃，会停在两处之一：密钥已删但包仍显示已安装，或记录已删、文件还在。为什么：密钥先删，安装记录（含同意和 MCP 批准）后删，文件和数据最后删，这三步不是同一次写入。残留 settings 在导入和更新时的处理见下面「残留设置」。
- `approveMcpTools` 不核对宿主期望的指纹，记下的是这次传入列表算出来的指纹。为什么：内核看不到用户刚才同意的那一版；工具若在同意和这次调用之间变了，新指纹会被当成已同意。

## 残留设置

导入时，如果 `data/<id>/settings.json` 已经在，按新包的 `settingsSchema` 校验。缺必填、类型不对、或比原值更严，是 `IMPORT_INVALID`，path 为 `/settings/<key>`，不写安装记录，包文件也不会留下。残留文件不是合法 JSON，或新包没有 `settingsSchema`，同样拒绝，path 为 `/settings`（没有设置项时不读取文件内容），文件原样留下。想导入一个没有 `settingsSchema` 的包，要先删掉 `data/<id>/settings.json`。

更新到有 `settingsSchema` 的新版时，残留文件按同样的规则检查，不通过则已安装的旧版保持不变。更新到没有 `settingsSchema` 的新版时，这份文件不读不删，更新继续。

`setSettings` 在写入前检查必填、类型、范围和 enum。失败是 `SETTINGS_INVALID`，path 为 `/settings/<key>`，文件不改，错误信息不含被拒的值。`x-secret` 引用不合法或密钥不存在仍是 `SECRET_NOT_FOUND`。错误码共十一个；能力 Sink/审计失败使用 `CAPABILITY_FAILED`，报告 callId、失败阶段与执行状态。

## 宿主契约

- 1.x 宿主在每次 write 前调用 `core.runAction`，通过后才写；target 的实际范围由宿主解释并约束。2.x 写入通过 `runCapability` 和注入 FsSink 执行，内核检查逻辑根与真实路径边界，真实 Sink 还须在 I/O 时维护边界以防路径竞争。
- 2.x exec 的程序由宿主登记，参数数组独立传递，不接受任意程序路径、shell、env 或 stdin；真实 ExecSink 的隔离由宿主负责。
- `confirm` 可省略，缺少时拒绝需要确认的动作。新能力的写入、外发、命令每次询问，默认 120 秒超时；`confirmTimeoutMs` 仅作用于新入口。只有布尔 true 放行，等待前复制请求，确认后和放行审计后重新检查状态及路径。
- 新入口必须有可靠的 `onAudit`；事件不含内容、参数或输出并经过密钥脱敏。执行前审计失败不调用 Sink，执行后审计失败报告已完成；执行状态 unknown/completed 不得自动重试。
- 宿主实现的 `confirm.ask` 按 [docs/confirm-copy.md](docs/confirm-copy.md) 展示确认框。
- 宿主必须把每个 MCP 工具的 `inputSchema` 传给内核。为什么：内核不连接服务器，无法自己核对参数定义；没传到的和 `null` 是同一个指纹。参数定义变了必须重新同意。
- 宿主必须把完整工具列表交给 `checkMcpTools`。不在列表里的工具会失去指纹和同意（有删除副作用）。为什么：留下旧行会让那个同意在同名工具回来时复活，它再出现必须重新同意。拉取失败或只拿到第一页时不要传 `[]` 或子集，否则其余工具的指纹和同意会被清掉。
