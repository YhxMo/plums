# 回环传输实验

[凭据请求契约](CREDENTIAL-REQUEST.md) · [原生传输证据](../evidence/NATIVE-TRANSPORT-2026-10-15.md) · [Host 集成证据](../evidence/HOST-TRANSPORT-2026-10-15.md) · [异常回执证据](../evidence/TRANSPORT-FAULT-2026-10-15.md)

这些测试入口复用默认关闭的 Cargo 特性 `native-transport-experiment`，验证 WebView → Tauri → Rust HTTP 客户端 → 本机合成服务，以及公开 Host 生命周期与失败回执。普通 `PlatformAdapter` 的 `credential.request` 仍不可用；生产绑定、系统秘密和 TLS/DNS/代理策略见凭据请求契约。

## 原生传输

`src-tauri/src/transport_probe.rs` 只接受 `127.0.0.1:18765`，固定 POST `text/plain`，禁用代理和自动重定向。绑定名映射 echo、delay、slow、redirect、oversize、chunked、stats、report；调用方不能指定 URL、自定义头或凭据。服务仅监听回环；Android 专用模拟器使用临时 `adb reverse tcp:18765 tcp:18765`，验收后移除。

原生命令接受两个合成 owner。`probe_prepare` 校验后登记 `(owner, id)`，`probe_execute` 只能开始一次，`probe_cancel` 删除未执行预约或通知在途请求。撤权清除预约并取消已有请求；再授权保留旧请求的取消标记。最多 16 个待处理项，完成、取消或撤权释放登记。

请求上限 4096 字节，响应累计上限 8192 字节；同时检查 Content-Length、实际分块和 UTF-8。执行含正文读取的总时限为 800ms，交付前复核取消状态。发送前拒绝为 `not-dispatched`；执行后超时、取消、3xx、超限和传输失败为 `unknown`，不自动重试。取消只终止本地等待和交付，服务端已收到的请求仍可能完成；字节限额不覆盖 HTTP 客户端全部内部缓冲。

## Host 公开调用

`tests/host-transport/platform.ts` 的 `ExperimentPlatform.connect` 先探测原生命令，仅开放 `credential.request`。独立扩展 probe.alpha / probe.beta 使用公开 `ctx.platform`，请求为 `{version:1,binding:'text',body:'plum'}`；text 映射 echo，slow 映射 delay。成功返回 `{status:200,body:'echo:plum'}`。适配器只接受 Host 推导的 `extension.probe.alpha` / `extension.probe.beta`，拒绝额外请求字段。

扩展通过 `ctx.task` 跟踪工作并传递操作信号；Host 合并生命周期取消。管理使用 install/grant/start/stop/uninstall，服务通过 `ctx.use` 消费。stop 取消本代并等待任务清理，保留会话授权；卸载先成功 stop，再确认平台撤权。清理或撤权失败保留登记；同 ID 重装需重新授权。没有映射的 owner 可以执行空撤权，便于清理无平台能力的消费者；非空授权仍拒绝。

每次调用先预约、再复核取消和授权世代、最后执行。取消预约回执未知时保持 `unknown`；撤权先使本地世代失效，迟到授权回执不能恢复旧权限。桥接错误统一脱敏，不透传正文、地址或原始异常。独立样板 `author-echo-probe.mjs` 提供业务服务，观察者通过 probe.beta 读取计数和提交报告；跨 owner 反例直接调用平台入口。

这些 owner 检查约束公开调用路径；共享 WebView 可直接调用实验命令，仍属于可信代码环境。真实身份、授权界面和秘密边界由生产适配负责。

## 异常回执

未执行预约的存活期为 1000ms。后续命令在检查容量、执行或报告 pending 前回收过期项；过期项不能执行，owner 授权保留。没有新命令时，内存中最多保留 16 项。已执行请求继续由 800ms 总时限及取消/完成路径释放，运行中的同键不能重新预约。

`probe_faults` 仅接受已授权合成 owner 和以下布尔字段，拒绝未知字段。配置由下一次通过参数和容量检查的 prepare 消费并绑定该请求，授权变化清空未消费配置。取消前故障持续作用于该请求的取消尝试。

| 字段 | 原生故障位置 |
| --- | --- |
| prepare_before | 参数检查后、登记前返回 unknown |
| prepare_receipt | 登记后返回 unknown |
| cancel_before | 删除/通知前返回 unknown |
| cancel_receipt | 删除/通知后返回 unknown |
| execute_receipt | 传输结束并清理后返回 unknown，包含成功后的回执丢失 |

故障在 Rust 生效，业务请求仍经独立样板、Host 和 ExperimentPlatform；观察、容量及跨 owner 反例直接用实验命令。该夹具模拟可控失败回执，IPC 永不返回、进程崩溃和休眠仍待其他实验。

## 复现与验收

复用锁定的 reqwest 0.13.5（MIT OR Apache-2.0）、Tokio 1.53.3（MIT）和 futures-util 0.3.34（MIT OR Apache-2.0）；reqwest 禁用默认特性，来源和许可证核对范围见各自证据。HTTP 回环不能验证 TLS、公网 DNS 或代理行为。

各测试页使用独立 Vite root、es2022 和 `.cache/<实验名>/dist` 输出。服务入口为 `node tests/native-transport/server.mjs <隔离结果目录>`；启动前确认 18765 可用。两端顺序运行，用页面报告与服务路径计数核对取消前零命中、在途请求和重定向第二目标零命中。

| 实验 | Vite root / 材料目录 | Mac 标识 / 产品名 |
| --- | --- | --- |
| 原生传输 | tests/native-transport / .cache/native-transport | dev.plums.plums.transportprobe / Plums Transport Probe |
| Host 公开调用 | tests/host-transport / .cache/host-transport | dev.plums.plums.hosttransportprobe / Plums Host Transport Probe |
| 异常回执 | tests/transport-fault / .cache/transport-fault | dev.plums.plums.transportfaultprobe / Plums Transport Fault Probe |

Tauri 测试配置将 beforeBuildCommand 置空、frontendDist 指向对应输出，并使用表中的独立产品标识。Mac 执行 `tauri build --debug --bundles app --features native-transport-experiment --config <隔离配置> -- --locked --offline`，以独立 PLUMS_M1_DATA_DIR 启动。异常回执使用 `.dev-data/transport-fault-mac` 数据目录。

Android 复用既有工具链、生成工程及调试签名，仅覆盖测试前端，执行 `tauri android build --debug --target aarch64 --apk --features native-transport-experiment --config <隔离配置> -- --locked --offline`。包名为 dev.plums.plums，只安装到专用只读 AVD 克隆；异常回执受验实例使用 ADB 5058、模拟器 5594、CDP 9248。

测试包及原始材料保留在各 `.cache/` 目录；运行结果按所链接的源码与平台分别判断。生成输出可能仍是实验包，普通交付按[交付流程](DEVELOPMENT.md#本地交付目录)另行构建和验收。真实资源在对应操作前确认范围；Android 真机、其他平台及 iOS 接口稳定前实验继续由[整体计划](spec/total.md)维护。
