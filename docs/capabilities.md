# 2.x 能力调用与宿主执行接口

`@plums/core` 0.2.0 提供 `core.runCapability({ extensionId, permissionId, request })`，只接受已安装、已同意并启用的 2.x extension。清单中的 `payload` 不参与授权。1.x 继续使用 `runAction` 和原 MCP 入口；2.x MCP 映射后续开发。

## 创建与绑定

```ts
import {
  createCore, FakeModelProvider, MemorySecretStore,
  RecordingEgressSink, RecordingFsSink, RecordingExecSink,
  ScriptedConfirm, type AuditEvent,
} from "@plums/core";

const audit: AuditEvent[] = [];
const core = createCore({
  dataDir: "/host/plums-data",
  model: new FakeModelProvider(),
  secrets: new MemorySecretStore(),
  egress: new RecordingEgressSink(),
  fs: new RecordingFsSink({ data: new Uint8Array([104, 105]) }),
  exec: new RecordingExecSink({ exitCode: 0, stdout: "ok" }),
  roots: { workspace: "/host/user-selected-project" },
  programs: { test: "/host/bin/test-runner" },
  confirm: new ScriptedConfirm([true, true, true]),
  confirmTimeoutMs: 120_000,
  onAudit: (event) => { audit.push({ ...event }); },
});
```

目录由宿主让用户选择，逻辑名称与实际路径在创建时复制，目录路径转为绝对路径；程序标识绑定到宿主选定的执行程序。内核没有运行期间重绑定接口。目录必须存在，示例 Sink 只返回预设结果，不实际读取文件内容、写文件、启动程序或联网；内核会读取路径元数据以检查范围。

`fs`、`exec`、`roots`、`programs`、`confirm`、`onAudit` 可省略。缺少所需绑定或 Sink 返回 `PERMISSION_DENIED`；缺少审计返回 `CAPABILITY_FAILED`，不会调用 Sink；没有 confirm 的写入、命令、外发请求返回 `CONFIRMATION_DENIED`。显式传入无效接口、绑定或计时值在构造阶段抛出 `TypeError`。`model`、`egress`、`secrets` 仍必需。

## 声明与请求

下列清单权限分别使用三个绑定：

```json
[
  { "id": "files", "kind": "fs", "target": "workspace", "operations": ["read", "write", "list"], "reason": "处理项目文件" },
  { "id": "tests", "kind": "exec", "target": "test", "cwdRoots": ["workspace"], "reason": "运行项目测试" },
  { "id": "send", "kind": "egress", "target": "api.example.com", "reason": "发送摘要" }
]
```

导入、`grantConsent(id)`、`enable(id)` 后调用：

```ts
await core.runCapability({ extensionId: "demo", permissionId: "files",
  request: { kind: "fs", operation: "read", path: "README.md" } });
await core.runCapability({ extensionId: "demo", permissionId: "files",
  request: { kind: "fs", operation: "write", path: "notes.txt", data: new TextEncoder().encode("notes") } });
await core.runCapability({ extensionId: "demo", permissionId: "files",
  request: { kind: "fs", operation: "list", path: "." } });
await core.runCapability({ extensionId: "demo", permissionId: "tests",
  request: { kind: "exec", args: ["--report", "report file.txt"], cwd: { root: "workspace", path: "." } } });
await core.runCapability({ extensionId: "demo", permissionId: "send",
  request: { kind: "egress", url: "https://api.example.com/summary", method: "POST", body: "summary" } });
```

fs 的根来自权限 target。请求路径只用 `/` 分隔，拒绝绝对路径、盘符、UNC、反斜杠、`..` 路径段和 NUL；按真实路径及目录边界检查，允许根内符号链接，拒绝逃逸。读取要求普通文件，列目录和 exec cwd 要求目录。写入可创建或覆盖普通文件，父目录必须存在；不创建目录。write 不隐含 read 或 list。

exec 的程序来自权限 target，cwd.root 必须在 cwdRoots 中且有绑定。请求只接受 args 数组及 cwd，不接受程序路径、shell、env 或 stdin。内核单独传递每个参数，不拼接或解释命令。egress 复用 EgressRequest 的 url/method/body，沿用 HTTPS、域名、端口限制；传给 Sink 的 URL 规范化，不跟随重定向，返回的 redirectTo 需要新调用重新授权、确认和审计。多余请求字段与字段类型错误返回固定文案的 `TypeError`。

## 返回值与 Sink

每个结果含独立 `callId`，按 kind 和 operation 分支：

| 请求 | 结果 |
| --- | --- |
| fs read | `{ callId, kind: "fs", operation: "read", data: Uint8Array }` |
| fs write | `{ callId, kind: "fs", operation: "write", completed: true }` |
| fs list | `{ callId, kind: "fs", operation: "list", entries: [{ name, type }] }`，type 为 file/directory/symlink/other |
| exec | `{ callId, kind: "exec", result: { exitCode, stdout, stderr } }`，非零退出也是正常结果 |
| egress | `{ callId, kind: "egress", result: { status, body, redirectTo? } }` |

FsSink.read/list 接受 `{ rootPath, path }`，write 额外接受复制的 data；路径均为检查后的绝对真实路径。ExecSink.run 接受 `{ program, args, cwd, rootPath }`。返回结果复制后才进行结果审计。

真实 FsSink 必须在实际 I/O 时维护目录边界，防止元数据检查与执行之间的路径竞争。真实 ExecSink 由宿主提供命令隔离，参数单独传入，不使用 shell；EgressSink 在 DNS 后拒绝回环、私网、链路本地地址，并限制大小与时间。记录式实现只验证调用契约，不提供这些真实执行能力。

## 确认与审计

顺序：校验并复制请求 → 已安装/启用/声明 → 同意 → 目标与操作范围 → 必要确认 → 重新授权和范围检查 → 放行审计 → 再次检查 → Sink → 结果审计。

read/list 不询问，write/exec/egress 每次询问。只有布尔 true 放行，缺失、false、异常、非布尔或超时均拒绝。能力确认默认超时 `DEFAULT_CONFIRM_TIMEOUT_MS = 120000`，`confirmTimeoutMs` 可设置为 1 至 2147483647 的整数毫秒。迟到同意或异常不会执行。本超时选项只作用于新能力入口，1.x/MCP/分享的既有确认行为保持。

在第一个 await 前复制路径、字节、args、cwd 和外发请求字段。确认期间或异步审计期间停用、卸载、同意丢失、权限范围/理由变化或真实路径变化，本次调用被拒；重新发起后才按当前状态授权。

`onAudit` 接收冻结事件，含 callId、时间、扩展/权限 id、能力类别、操作、逻辑目标、phase、outcome、executionState；拒绝事件可带 code。phase 为 confirmation/allow/result/denied。确认会记录 requested 和 allowed/denied/timeout/error/missing/invalid；结果记录 completed/failed。未知或非法请求无法安全识别的字段不记录。

事件不包含物理路径、完整 URL、文件内容、请求体、参数值、环境变量、stdout/stderr 或底层异常。已知密钥通过既有引用读取并脱敏，在首次异步路径检查前开始读取，本次调用读到的值保留至调用结束；随后卸载移除引用也不会让这些值重新出现在审计或错误中。审计回调不得将未审计的内容另行写入这些事件。

Sink 或审计失败使用 `CAPABILITY_FAILED`，details 为 `{ callId, phase, executionState }`。phase 为 sink 或 audit_confirmation/audit_allow/audit_denied/audit_result（内部授权故障为 authorization）。声明、同意与确认错误保留现有错误码；确认拒绝 reason 为 MISSING/DENIED/TIMEOUT/ERROR/INVALID。

| executionState | 含义与处理 |
| --- | --- |
| not_started | 没有调用 Sink；缺少或执行前审计失败会阻止执行 |
| unknown | 已进入 Sink，但抛错或返回值不符合接口；可能已有副作用，核对宿主记录，勿自动重试 |
| completed | Sink 已返回，结果审计失败；动作已完成，勿自动重试 |

本入口每次只调用一次 Sink，不自动重试。审计实现与存储可靠性由宿主负责，生命周期审计、范围预授权和 2.x MCP 留到后续。
