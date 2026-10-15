# 原生异常回执与预约恢复实验

限定结果见 [验收证据](../evidence/TRANSPORT-FAULT-2026-10-15.md)。本阶段只修改默认关闭的 native-transport-experiment 与测试页，不开放生产网络或凭据。普通 PlatformAdapter、Host、SDK 业务调用及默认前端保持原样。

## 最小恢复机制

原生 prepare 登记后若回执未知且 cancel 未执行，旧实现会永久保留预约，累计 16 项后拒绝新请求。现在未执行预约有 1000ms 存活期，后续原生操作在检查容量、开始执行或报告 pending 前回收过期项。过期预约不能执行；回收无需撤销 owner 授权。没有后台清理线程：无新命令时内存项可能保留，最多 16 项；恢复活动后触发回收。不能将此结果表述为应用暂停时仍准时清理。

已经开始的请求不受预约租期回收，继续由原有 800ms 总时限、取消及完成路径释放。运行中的同键不能重新预约，防止旧完成路径删除新请求。清理本地登记不撤销远端副作用；未知回执不自动重试，也不转换成成功。

## 隔离故障入口

probe_faults 仅在显式实验特性中注册，接受已授权合成 owner 与固定布尔字段，未知字段拒绝。配置随下一次通过参数/容量检查的 prepare 消费，绑定该请求；授权变化清空未消费配置。取消前失败会持续作用于该请求的取消尝试，用于证明恢复不依赖重试成功。共享 WebView 可伪造实验 owner，此入口不是生产授权机制。

| 字段 | 原生故障位置 |
| --- | --- |
| prepare_before | 参数检查后、登记前返回 unknown |
| prepare_receipt | 登记后返回 unknown |
| cancel_before | 删除/通知取消前返回 unknown |
| cancel_receipt | 删除/通知取消后返回 unknown |
| execute_receipt | 传输结束并清理后返回 unknown，包括真实成功后的回执丢失 |

故障在 Rust 中生效，测试适配器不伪造回执；这是可控拒绝回执，不模拟 IPC 永远不返回、进程崩溃或系统休眠。业务成功/失败仍经独立样板 ctx.task/ctx.platform、公开 Host 和测试 ExperimentPlatform；观察、容量及跨 owner 反例直接使用实验命令。

## 复现

沿用 [原生实验](NATIVE-TRANSPORT-EXPERIMENT.md)工具链与固定回环服务。Vite root 为 tests/transport-fault，输出 `.cache/transport-fault/dist`，target es2022。Mac 标识 dev.plums.plums.transportfaultprobe，显示名称 Plums Transport Fault Probe，数据目录 `.dev-data/transport-fault-mac`。Android 仅覆盖测试前端，装入独立只读 AVD 克隆，使用专用 ADB 5058、模拟器 5594、CDP 9248。服务 18765 仅监听回环，临时 reverse 验收后删除。

Mac 与 Android 顺序运行，页面报告与服务命中计数共同核对副作用；实际窗口与 WebView 分别留证。原始日志和产物在 `.cache/transport-fault/`，不提交。生成构建输出可能为实验包，普通 release 不替换。模拟器不代表真机、触控或其他平台；iOS 正式接口稳定前门槛不变。
