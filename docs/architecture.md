本文是内核技术方案,以此为准;变更需经架构师批准

# Plums 内核技术方案（1.x 兼容与 2.x 能力调用）

## 1. 范围
纯开源内核(Apache-2.0),不含界面、服务、托管、市场。交付物是一个 TypeScript 库 `@plums/core` 加一个命令行 `plums`。
内核负责:包格式与加载、依赖解析、权限和同意检查、密钥引用、外发确认、文件/链接分享，以及 2.x 能力授权与审计。0.2.0 已提供 fs/exec/egress 统一入口与记录式执行，真实 I/O、进程隔离、联网及第三方代码由独立 `@plums/host` / Electron 桌面实现，见 [desktop.md](desktop.md)。

## 2. 技术栈(推荐)
- 语言与运行时:TypeScript,Node.js 当前 LTS,pnpm 单仓库。
- 校验:JSON Schema(Ajv)。manifest 与扩展设置项都用它。
- 测试:Vitest。
- MCP:官方 TypeScript SDK,按 2026-07-28 版规范;具体版本实现时核实。
- 密钥:优先系统钥匙串,没有时退回加密文件;具体库实现时选并验证。
- 存储:数据目录下的文件加一个 SQLite(同意记录、安装状态)。
- 命令行:无框架依赖的薄封装,只调用库的公开 API。
理由:MCP 和 Agent Skills 的官方 SDK 与示例以 TS 为主,宿主将来既可能是命令行也可能是 Electron 或网页,库形态都能用。

## 3. 包格式
一个包 = zip + 根目录 `manifest.json`。三种 kind:`character`、`extension`、`connector`。

内核只规定"信封",不规定内容。下面是仍可读取的 1.x 信封:
```jsonc
{
  "formatVersion": "1.0",
  "kind": "character | extension | connector",
  "id": "...", "name": "...", "version": "semver", "description": "...",
  "license": "SPDX,可选", "author": "可选",
  "dependencies": [ { "kind": "extension|connector", "id": "...", "range": "^1.0.0", "optional": false } ],
  "permissions": [ { "id": "...", "level": "read|write|egress", "target": "...", "reason": "给用户看的话" } ],
  "settingsSchema": { /* JSON Schema,可选,规则见 §15;标 x-secret 的字段只存引用 */ },
  "signature": { /* 可选字段,第一版内核不校验,只原样保留 */ },
  "payload": { /* 内容。内核不解释,原样保存、原样导出、原样交给宿主和扩展 */ }
}
```
- **内核不规定角色卡该写什么**:`payload` 对内核是不透明的。内核只用到信封里的依赖和权限。
- 角色卡里的文字永远不授予权限,权限只来自 `permissions`。
- `formatVersion` 同一 major 内只加可选字段,未知字段原样保留;读到更新的 major 就拒绝(`FORMAT_UNSUPPORTED`)。

新包默认 `PACKAGE_FORMAT_VERSION = "2.0"`，支持 major 从它推导，目前读取 1.x/2.x，3.x 返回 `FORMAT_UNSUPPORTED`、`/formatVersion`。导出保留输入版本，不迁移包文件。2.x 仅替换权限结构，其余信封和 payload 契约保持：

```json
[
  { "id": "files", "kind": "fs", "target": "workspace", "reason": "使用项目文件", "operations": ["read", "write", "list"] },
  { "id": "tests", "kind": "exec", "target": "test", "reason": "运行测试", "cwdRoots": ["workspace"] },
  { "id": "send", "kind": "egress", "target": "api.example.com:8443", "reason": "发送摘要" }
]
```

id 在 2.x 包中唯一。operations、cwdRoots 是非空、无重复数组；fs 操作仅支持 read/write/list。target 是宿主绑定的逻辑根、登记程序或外发域名，清单不能凭此执行文件或命令。未知字段保留；选择 schema 和权限语义只看 formatVersion，不看未知 level/kind 字段。公开 `ManifestV1`/`ManifestV2`、`PermissionV1`/`PermissionV2` 类型和 `isManifestV1`/`isManifestV2` 支持宿主分支处理。inspect 返回 formatVersion 和全部声明字段。

## 4. 扩展与宿主
- 扩展 = manifest + 设置 schema + 数据型内容(提示词片段、模板、任务配置等,放在 payload)。**不运行第三方代码**。
- 可运行扩展在自己的 payload 命名空间登记桌面 SDK 与运行/前端入口，由独立宿主隔离运行；core 保持 payload 不透明，只负责权限、确认与审计。
- 桌面不内置业务扩展、模型适配或 Agent 循环，全部通过外装 ZIP 提供。

## 5. 权限与确认
- 1.x 三档:read、write、egress。内核在每个动作执行前统一检查:有没有声明、用户有没有同意。2.x 按 fs/exec/egress 分类，fs 的 write 不授予 read；不把类别转换为旧档位。
- write 与 egress 的动作每次运行时都要确认;由宿主实现的 `confirm` 接口给出答案,没有就一律拒绝。
- 更新时比较新旧权限,新增而没有重新同意就拒绝更新(`CONSENT_REQUIRED`),旧版本保持不变。
- 同意记录保存完整权限声明和 formatVersion。2.x 更新新增权限、改变类别/目标、增加 fs 操作或 exec cwdRoots 时要求重新同意；范围收缩、reason 或未知字段变化不增权。跨 major 更新即便权限列表为空也要求重新同意（`CONSENT_REQUIRED`、`/formatVersion`、reason `FORMAT_CHANGED`）。拒绝时文件和记录不变；成功时保留启用状态，已有同意记录更新为新声明。
- `runAction` 和现有包 MCP 入口仅解释 1.x；遇到 2.x 返回 `PERMISSION_DENIED`、`/formatVersion`、reason `FORMAT_API_MISMATCH`。手动 MCP 与有效的 1.x 调用保持既有行为。2.x 使用独立的 MCP v2 批准接口和带工具指纹的 delegated capability 入口。
- MCP 连接器:每个工具的名称、描述和 inputSchema(键递归排序的稳定序列化)记哈希,哈希变化等同增权,要重新同意。服务端只改参数定义而名称描述不变,同样改变工具能力,所以要重新同意。MCP 工具从宿主给出的列表中消失后,其指纹和同意随即作废;再次出现时按新工具处理(TOOL_ADDED),需要重新同意,不再保留到卸载。手动添加的 MCP 服务标"未验证",默认只读、逐项授权。

## 6. 密钥
只存在内核管的存储里;扩展和包里只出现 `secretRef`。日志、错误、导出统一经过脱敏函数;导出包在结构上不含密钥。
安装记录保留包曾声明过的密钥引用,不保存值。更新提交 manifest 时在同一事务内保留旧引用;若随后删除失败,返回 SECRET_NOT_FOUND(details 为 `{id, version, reason: SECRET_CLEANUP_FAILED}`),version 已安装。后续更新与卸载可重试,脱敏与导出检查也仍覆盖这些值。删除过程中即使值已删除而调用抛错,底层错误也不外露。数据库格式按 2→3→4→5 自动迁移；安装、启用、MCP、已有引用及权限 JSON 保持。schema 5 增加独立 MCP v2 批准表，schema 4 在 consents 增加 format_version，旧记录按已存清单补齐，不改写包文件；旧内核拒绝升级后的目录。schema 2 不能恢复以前已丢失的历史引用。

## 7. 可替换接口(便于测试)
```ts
interface ModelProvider { complete(req): Promise<res> }
interface EgressSink    { send(req): Promise<result> }   // 唯一的对外出口,含分享链接下载
interface FsSink        { read/write/list(req): Promise<result> }
interface ExecSink      { run(req): Promise<result> }
interface Confirm       { ask(req): Promise<boolean> }
interface SecretStore   { get/set/delete(ref) }
createCore({ dataDir, model?, egress, secrets, confirm?, fs?, exec?, roots?, programs?, onAudit?, confirmTimeoutMs? })
```
内核自带 FakeModelProvider、RecordingEgressSink、RecordingFsSink、RecordingExecSink、内存版 SecretStore 与脚本化 Confirm，测试全程不联网、不开进程、不由 Sink 写文件。confirm 可省略，提供无效接口在构造时拒绝；新能力入口缺少审计不执行。

## 8. 兼容
- 角色卡 V2/V3:做成**可选的导入导出适配器**,不在核心里。导入时映射成信封加 payload,聊天专用字段放进 payload 的约定位置;导出时内核特有字段写进 extensions.plums。适配器的字段映射由使用方的内容约定决定,不由内核规定。
- Agent Skills(SKILL.md):只读导入,转成扩展包。
- 只参考公开规范,不复制 AGPL/GPL 项目的代码。

## 9. 统一错误
`PlumsError { code, message, path?, details? }`。`message` 是人话,`path` 是 JSON Pointer 格式的字段路径(带开头斜杠,如 `/permissions/0/level`、`/dependencies/0`)。
固定错误码(11 个):MANIFEST_INVALID、FORMAT_UNSUPPORTED、DEPENDENCY_MISSING、CONSENT_REQUIRED、PERMISSION_DENIED、CONFIRMATION_DENIED、SECRET_NOT_FOUND、IMPORT_INVALID、SHARE_FETCH_FAILED、SETTINGS_INVALID、CAPABILITY_FAILED。CAPABILITY_FAILED 用于能力 Sink/审计失败，details 为 callId、phase、executionState；不携带底层异常。not_started 为未调用 Sink，unknown 为已进入 Sink 但结果不确定，completed 为执行成功后结果审计失败；unknown/completed 禁止自动重试。
`SECRET_NOT_FOUND` 也用于读取密钥失败:此时只带固定码和固定文案「读取密钥失败，原来的错误已隐藏，以免带出密钥。」,不带 path、details、cause,不含底层错误内容。

## 10. 里程碑 1 验收(主线:导入角色卡 → 安装扩展并看到权限清单 → 同意并启用 → 卸载)
里程碑 1 的命令行不含 `share import`,真实 EgressSink、持久化 SecretStore 和命令行 `share import` 留到里程碑 2。
1. 导入合法包成功;坏包返回对应错误码和字段路径;导出再导入内容一致。已安装的 id 再次导入一律被拒,返回 IMPORT_INVALID,`details` 为 `{id, reason: ALREADY_INSTALLED}`,不带 `path`。同 id 并发导入只会有一个成功,其余返回该错误,跨进程落败者也不删除或覆盖成功者的目录。内存排队只在同一进程内、同一数据目录生效:另一个数据目录里的同 id 不会被这次排队挡住。为什么:导入队列的键是数据目录加 id,而且队列只活在当前进程里;跨进程冲突由文件发布和数据库唯一键处理。
2. `inspect(包)` 不安装就返回 formatVersion 与完整权限清单；1.x 每条带 level 与 reason，2.x 带 kind、operations/cwdRoots 等原始声明。
3. 没同意就启用返回 CONSENT_REQUIRED;同意后启用成功,同意记录可查。
4. 越权动作返回 PERMISSION_DENIED;没有 confirm 或被拒绝时外发被拦,且 RecordingEgressSink 没有记录。
5. 更新增权且未重新同意:更新被拒,旧版保持。
6. 假密钥在日志、报错、导出包中全文搜索找不到。
7. 卸载后数据、设置、同意记录、密钥引用全部清除,可重新安装。
8. 文件和 https 链接各走一遍分享,内容一致;链接失败返回 SHARE_FETCH_FAILED。
9. MCP 工具描述被改动后,必须重新同意。只改参数定义(inputSchema)也要重新同意。工具消失后再出现需重新同意。
10. 设置校验:

    - 10.1 清单缺 `type`/`title`/`description` 之一被拒(MANIFEST_INVALID,`path` 指该属性)。`minimum`/`maximum` 声明在非 `number`/`integer` 上同样 MANIFEST_INVALID,`path` 为 `/settingsSchema/properties/<key>/minimum` 或 `/settingsSchema/properties/<key>/maximum`。
    - 10.2 `default` 类型不符或越界、secret 带 `default` 被拒(MANIFEST_INVALID,`default` 的 `path` 为 `/settingsSchema/properties/<key>/default`)。
    - 10.3 `setSettings` 缺必填、类型错或越界被拒(SETTINGS_INVALID,`path` 为 `/settings/<key>`)。
    - 10.4 残留 settings 在 `importPackage`,以及新版有 `settingsSchema` 因而要读该文件的 `updatePackage`:缺必填、类型错、新 schema 更严失败:import 不写任何包文件,update 旧版保持不变(IMPORT_INVALID,`path` 为 `/settings/<key>`)。NOT_JSON 与 NO_SCHEMA 见 §15。
    - 10.5 `updatePackage` 遇到没有 `settingsSchema` 的新版:更新成功;启用状态与设置文件字节不变(不读不删)。之后某版再带 `settingsSchema` 时按 10.4 校验。

## 11. 拍板结果(Plums 已通过,三项均按建议)
1. 技术栈:TypeScript + Node LTS + pnpm + Ajv + Vitest。
2. 第一版不做作者签名,只在信封里留可选 `signature` 字段,不校验。
3. V2/V3 适配器排到里程碑 2。

## 12. 补充定论(v0.1.1)
- 包的安全限制:解压后总大小 ≤ 20MB、文件数 ≤ 1000、单路径 ≤ 255 字符,宿主可配置。路径越界、绝对路径、超限都返回 IMPORT_INVALID,且校验通过前不写出任何文件。大小写不敏感碰撞(含 manifest 的大小写别名,如 `MANIFEST.JSON`)和「既是文件又是文件夹」的冲突,在导入(解压与落盘)和导出前都由同一个检查拒绝,统一归 IMPORT_INVALID。大小写碰撞的 `path` 为后出现的 zip 条目名(JSON Pointer,如 `/a.txt`;别名则为该条目,如 `/MANIFEST.JSON`),不带 details;「既是文件又是文件夹」不带 `path`(导入和导出都如此)。包内目录条目在冲突检查时去掉尾部的一个斜杠(zip 用末尾 `/` 表示目录,比较的是去掉之后的名字,如 `dir/` 按 `dir`)。为什么:磁盘上的目录名不带这个斜杠,`dir/` 和 `dir` 会撞在一起。因此目录大小写碰撞的 `path` 是去掉斜杠后的条目(如 `/dir`),目录本身不写入包内文件列表。导出时 `files` 里放了精确文件名 `manifest.json`,是 IMPORT_INVALID,`path` 为 `/manifest.json`。为什么与别名同一写法:两条都是在指出那一个条目,别名已经是 `/MANIFEST.JSON`。
- 1.x 动作入口 `core.runAction({ extensionId, permissionId, request })`,检查顺序:
  1. 扩展未安装/未启用,或 permissionId 未在 manifest 声明 → PERMISSION_DENIED
  2. 已声明但无同意记录 → CONSENT_REQUIRED
  3. 档位取自 manifest 声明,调用方不能指定;write/egress 需 confirm.ask 通过,无 handler 或被拒 → CONFIRMATION_DENIED
  4. 以上全通过,egress 才调用 EgressSink.send

## 13. 外发目标限制(v0.1.2)
egress 权限的 `target` 必须约束实际目的地,里程碑 1 就要做。
- **target 写法**:主机名,可带端口,不含协议和路径。例如 `api.example.com`、`api.example.com:8443`、`*.example.com`。通配符只允许出现在开头的 `*.`,且其后至少两级域名,所以 `*.example.com` 合法,`*.com` 和 `*.co.uk` 这类过宽写法不合法。
- **匹配规则**:
  - 主机名不区分大小写,按 punycode 规范化后比较。
  - 精确匹配;`*.example.com` 匹配其任意层级子域名,不匹配 `example.com` 本身。不支持其他通配符和前缀匹配。
  - 端口:target 没写端口则只允许 443;写了端口则只允许该端口。
  - 只允许 https。IP 字面量一律拒绝;内核同时拒绝 `localhost` 和 `*.localhost`。URL 中带用户名密码的拒绝。
  - 路径和查询串不参与匹配。
  - 以 "." 结尾的主机名(如 `localhost.`、`api.example.com.`)一律拒绝,不去掉尾点再判断。三条路径:
    - runAction 外发运行时:带点主机名过不了主机名格式检查(HOST_PATTERN),返回 PERMISSION_DENIED,`path` 为 `/request/url`,`details.reason`=URL_NOT_ALLOWED。运行时没有 TRAILING_DOT 这个 reason。
    - manifest 的 permissions 里的外发 target:返回 MANIFEST_INVALID,`path` 为 `/permissions/{i}/target`,`details.reason`=TRAILING_DOT。
    - 分享链接:返回 SHARE_FETCH_FAILED,`path` 为 `/url`,`details.reason`=TRAILING_DOT,且在 LOCALHOST 判断之前先判断。
  - 分享链接下载:错误的 `details.url` 只保留协议、主机和路径,去掉 `#fragment`(发给 EgressSink 的地址不变);响应体含大于 0xFF 的字符时拒绝,返回 SHARE_FETCH_FAILED(reason NOT_A_ZIP),不截断。
- **检查位置**:`runAction` 里在"已声明、已同意"之后、`confirm.ask` 之前检查;不匹配返回 PERMISSION_DENIED,`path` 为 `/request/url`,`details` 只有 `{id, permissionId, reason: URL_NOT_ALLOWED}`,允许的 target 只出现在 message 里,不调用 confirm,也不调用 EgressSink。
- **重定向**:内核不跟随重定向,把 3xx 响应原样返回;调用方如需继续,须再次调用 `runAction`,新地址重新走完整的检查流程。
- **内网地址**:内核只做主机名层面的检查,不做 DNS 解析。真实的 EgressSink 实现必须在 DNS 解析之后拒绝回环、私有和链路本地等内网地址。
- **manifest 校验**:egress 的 target 不合法(含协议、路径、IP、空值、过宽通配符)返回 MANIFEST_INVALID,`path` 为 `/permissions/{i}/target`。
- **确认文案**:由内核统一生成,显示目的主机和 reason,不展示完整 URL。
- **分享链接下载**:是用户主动给出的链接,不受扩展 target 约束,但仍走 EgressSink 和 confirm,确认文案显示目的主机。

验收补充(接在第 10 节第 10 条之后):
11. egress 的 target 为 `api.example.com` 时:请求 `https://api.example.com/x` 通过(经 confirm);`https://evil.com`、`https://api.example.com.evil.com`、`http://api.example.com`、`https://api.example.com:8443`、`https://1.2.3.4`、`https://user@api.example.com`、`https://localhost`、`https://localhost./x`、`https://api.example.com./x` 都返回 PERMISSION_DENIED,RecordingEgressSink 无记录、confirm 未被调用。`*.example.com` 匹配 `a.b.example.com`,不匹配 `example.com`。
12. egress 的 target 带协议、路径、为 IP,或为 `*.com` 这类过宽通配符时,inspect 与安装返回 MANIFEST_INVALID,path 指向该 target。
13. 目的地返回 3xx 时,内核不跟随,响应原样返回给调用方,sink 只有一次记录。

## 14. 已知限制
- **卸载有崩溃窗口**:卸载过程中进程崩溃,可能留下已删除记录但数据目录仍在的状态,下次启动不自动修复。卸载中途崩溃也可能出现密钥已删但仍显示已安装的状态。
- **孤儿 `data/<id>/settings.json`(M1 修复项)**:卸载崩溃或手工删除可能留下该文件;导入如何拒绝、无 schema 的更新如何忽略,见 §10.4/10.5。
- **不检查反向依赖**:里程碑 1 不检查反向依赖(卸载或停用被别的包依赖的包时不做提示)。
- **`approveMcpTools` 不绑定调用方期望的指纹**:同意的是"当前列出的工具集合",调用方无法声明期望指纹,所以同意与展示之间工具变化靠 TOOL_ADDED/TOOL_CHANGED 在下次调用时拦截。

## 15. 设置项声明与校验
M1 目标行为。
- 每个属性对象必填 `type`(`string`/`number`/`integer`/`boolean`)、`title`、`description`。这与 `settingsSchema.required`(必须有值的设置项 key 列表)不是一回事,后者的校验见下面的 `setSettings`。
- 可选 `minimum`、`maximum`、`enum`、`x-secret`。`minimum`/`maximum` 仅对 `number`/`integer`;声明在其他类型上则 MANIFEST_INVALID,`path` 为 `/settingsSchema/properties/<key>/minimum` 或 `/settingsSchema/properties/<key>/maximum`。
- `default` 可选,存在时必须与 `type` 一致,还须满足该属性已声明的 `minimum`/`maximum`/`enum`。违反时 MANIFEST_INVALID,`path` 为 `/settingsSchema/properties/<key>/default`。
- `x-secret` 属性的白名单仍是 `type`/`title`/`description`/`x-secret`。`default` 只对非 secret 属性开放;secret 属性带 `default` 一律 MANIFEST_INVALID。
- `setSettings` 写入前用 Ajv 校验:先 `settingsSchema.required` 与类型,再回填 `default`,`default` 本身也要过校验。校验失败的 `path` 为 `/settings/<key>`,错误信息不得包含 secret 值;`details` 为 `{key, reason}`,不含被拒的值。`reason` 取 REQUIRED、TYPE、MINIMUM、MAXIMUM、ENUM,残留 settings 校验共用。SECRET_NOT_FOUND 覆盖 x-secret 引用。该码也用于读取密钥失败,此时只带固定码和固定文案,不带 path/details(见 §9)。schema 校验失败用 M1 新增的 SETTINGS_INVALID(见 §9)。在 settings 校验里 IMPORT_INVALID 只用于导入和更新时对残留 settings 的校验失败,且都在写盘前:import 不写任何包文件,update 旧版保持不变。残留文件整体问题的 `reason` 为 NOT_JSON(文件不是合法 JSON,或不是 JSON 对象,`path` 为 `/settings`)和 NO_SCHEMA(仅 import,新包无 schema 而文件存在,`path` 为 `/settings`);这两类没有 key,`details` 只有 `{reason}`。
- `title` 即界面标签,不新增 `label` 字段。
- `describeSettings` 接口与参考渲染器留给里程碑 2。

## 16. M2-A 能力总线（0.2.0）

公开接口及完整宿主示例见 [capabilities.md](capabilities.md)。`runCapability({ extensionId, permissionId, request })` 只接受 2.x extension，按声明精确选择 fs/exec/egress。1.x 使用旧入口，2.x MCP 使用独立批准接口与 delegated capability。

- 顺序为请求校验/复制 → 已安装/启用/声明 → 同意 → 目标/操作范围 → 必要确认 → 重新授权/范围 → 放行审计 → 再次检查 → 单次 Sink → 结果审计。异步确认和审计均不能沿用过时授权。
- roots/programs 创建时复制并固定；宿主让用户选择目录，登记程序。fs 只接受 `/` 相对路径，拒绝绝对路径、盘符、UNC、反斜杠、`..`、NUL，按 realpath 与目录边界检查，允许根内符号链接。read 要求文件，list 要求目录，write 允许创建/覆盖文件但父目录必须存在。
- exec 只接受 args 数组与 cwd 的逻辑根和相对路径；程序来自登记绑定，cwd 必须在声明 cwdRoots 内并存在。不得传 shell、程序路径、env、stdin。非零退出作为结果返回。
- 独立 core 兼容默认 read/list 不询问；write/exec/egress 逐次询问。`capabilityApproval: "task-or-confirm"` 要求所有未被有效任务覆盖的能力单次确认，包括 read/list；DesktopHost 每次构造 core 都固定选用该策略，内部重建和重启不能降回兼容默认。可信宿主可批准有限期 fs/egress 操作子集，范围内复用确认；有效任务内未选择的 read/list 也单次确认。只有布尔 true 放行，缺失/异常/非布尔/超时拒绝，迟到同意不执行。新能力默认超时 120000 ms，宿主可配置；旧入口原有确认行为保持。
- 请求字节、参数、cwd 和外发字段在第一个 await 前复制。确认后重读权限与同意；停用、卸载、权限范围/理由或真实路径变化拒绝当前调用。放行审计后也重新检查。
- 每次生成 callId；onAudit 记录确认请求/结果、放行、执行结果和执行前拒绝。只包含能力类别、操作、逻辑目标、状态与错误码，不含路径、URL、文件内容、请求体、参数值、环境变量、stdout/stderr。通过密钥引用脱敏并保留本次读到的值，审计回调收到冻结事件。缺少审计或执行前失败不执行，结果审计失败明确报告动作已完成。
- 真实 FsSink 必须在执行时保证目录边界，元数据检查不能消除 TOCTOU；真实 ExecSink 提供命令隔离。core 自带记录式实现，桌面宿主提供真实文件/HTTPS 适配及扩展互调。桌面任务范围按 Agent 实例、版本和目录固定，可停止/撤销；有任务批准与撤权审计，其他生命周期审计尚未完整交付；模型循环由外装示例扩展提供。
