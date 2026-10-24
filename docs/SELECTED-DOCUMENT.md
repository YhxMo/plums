# 已选择文档的会话内只读访问

状态：实验接口。Mac 使用 NSOpenPanel，Android 保留 ACTION_GET_CONTENT 适配但冻结验收；浏览器明确不可用，iOS/Windows/Linux 未实现此原生适配。平台实际结果见 [HANDOFF](../HANDOFF.md#未验范围)。

## 用户路径与所有权

文档样板只在开发构建的目录中（`extensions/catalog.dev.json`），发布包不含；用户可自行导入同类扩展。启用文档样板并确认 `document.read` 后，在扩展管理中选择单个或多个文档。宿主在系统选择之前显示申请者、只读用途、64 KiB 上限与会话期限。扩展的“文档只读样板”界面刷新列表后读取；管理入口可撤销单个或全部。默认业务不自动读取文件。

`PlatformAdapter.initializeDocuments()` 先探测原生支持，成功后 `available("document.read")` 才为真。探测失败（IPC 异常）不等同于平台不支持：`available` 保持 false 以避免授予未证实的能力，同时宿主记录初始化错误并在启动提示与文档区域显示原因和重新加载指引；只有探测明确返回 false 才显示平台不支持。宿主的 `selectDocuments(owner,multiple,signal?)`、`documents(owner)`、`revokeDocument(owner,handle?)` 管理句柄；选择入口不在扩展 ctx 上。扩展经 `ctx.platform("document.read",{action:"list"})` 列举自己的 `{handle,name}`，以 `{handle,maxBytes}` 读取。调用需声明和授予 document.read。没有真实路径、URI、文件写入或目录能力。

原生 Broker 绑定 owner、授权代际、句柄身份和操作 ID。跨 owner、旧句柄或已撤销绑定统一 denied。每次选择产生新句柄；同一文件再次选择可有多个独立句柄。多选先准备全部来源再原子绑定；容量不足或某项准备失败时不增加部分授权，不驱逐已有授权。

Host 在 scope 失效时取消在途公开调用并释放 owner 临时资源，释放的同一 Promise 纳入清理结果；失败保持 cleanup-failed。激活失败、依赖失效、停用和卸载均经过此路径。释放不删除扩展已保存状态。重新启动扩展需重新选择文档；进程结束不保存这些授权。

## 读取与结果

`SelectedDocumentRequest = {handle,maxBytes}`，maxBytes 必须为1至65536的安全整数；最多读取上限加1字节以判断超限，超限拒绝且不静默截断。严格 UTF-8，非法编码拒绝。本阶段不做字符集识别、二进制转换或一致性版本管理。

`SelectedDocumentResponse`：read 带 text/bytes；rejected 带固定理由 unavailable、denied、invalid-request、too-large、io、encoding、resource-limit 或 busy；cancelled 和 unknown 不带文本。未知结果不泄漏原始异常或自动重试。列表/撤销管理调用失败时使用固定反馈；撤销未知会阻止继续访问，普通重授权及其他句柄撤销成功不会清除失败锁存，只有随后已确认的 owner 全撤销或重启才能恢复。

Mac 在选择后只读打开普通文件并保留 File，读取前回到起点；该描述符指向已打开文件，移动或删除路径不等于撤销描述符。Android 保留系统返回的临时 content URI，通过 ContentResolver 有界读取。两者均在工作线程执行 I/O，并在交付前复核操作取消、owner 代际和句柄身份。来源内容可改变，成功只表示此次读到的字节，不保证跨次快照一致。

## 取消、撤销与边界

取消或撤销使尚未交付的结果失效；已交给扩展的文本无法收回。逻辑取消不保证系统选择器立即关闭，也不强制中断阻塞的文件/文档提供者 I/O。旧 I/O 可在后台结束后丢弃；选择器 busy 和原生活动预算需等原操作结束才释放，不承诺超时回收。

Android 不请求存储扫描权限、写权限或 persistable URI grant，不调用 takePersistableUriPermission。Broker 撤销立刻拒绝其正常调用路径；系统临时 URI 许可仍由系统/活动生命周期管理，不宣称撤销了所有 OS 层访问。共享可信 WebView 和可替换 UI 不是防恶意扩展沙箱，原生桥接仍有既有信任限制。

资源边界：每 owner 8 个句柄、全局32；每 owner最多8个活动操作、全局32；全局一个选择器。取消先到也登记 operationId，防止迟到 IPC 重新开始；每 owner累计1024、全局4096个操作记录，最多32个文档owner，这些去重/owner记录保留至进程结束。超过返回 resource-limit；撤权不回收累计预算，重启恢复。状态专用owner不占文档预算。这些是实验上限，不是强隔离或完整平台资源政策。

原生在途取消不等于中断底层 I/O；读取完成后仍须重检撤权和取消，禁止交付已失效句柄的结果。没有目录扫描、写入或跨重启持久授权。

## 回归测试

单元反例覆盖请求形状、UTF-8/字节上限、owner/代际/句柄、取消先到、在途取消/撤权、原子容量与操作预算；前端覆盖未知回执、停用释放、交叠撤销和重授权不绕过失败锁存。测试仅使用专门创建的无隐私文件。系统选择器、Mac File 和 Android ContentResolver 不能由浏览器或合成模型替代，须用实际打包应用分别验证。
