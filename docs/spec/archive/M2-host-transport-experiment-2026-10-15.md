# Host 公开生命周期与隔离传输实验

状态：限定实验完成，见 [验收证据](../../../evidence/HOST-TRANSPORT-2026-10-15.md)。仅测试入口使用 `tests/host-transport/platform.ts` 的 ExperimentPlatform；普通 PlatformAdapter、Host 和默认前端不修改。原生仍需显式 native-transport-experiment 特性。没有真实凭据或外部连接，普通 release 不更新。

## 作者接口

测试扩展使用 ID probe.alpha 或 probe.beta，声明 `credential.request`。只经公开 `ctx.platform('credential.request', { version: 1, binding: 'text', body: 'plum' }, signal?)` 调用。text 返回 `{status:200,body:'echo:plum'}`；slow 是固定延迟的合成测试别名。扩展不得传 owner、URL、头或方法。请求 4096 字节、响应 8192 字节；类型和未知结果边界沿用 [凭据请求契约](../../CREDENTIAL-REQUEST.md)，本实验不提供凭据。

作者可提供自己的服务，通过 `ctx.task` 跟踪在途任务，调用方可传操作 AbortSignal。Host 自动组合扩展生命周期 signal；任务注册使 stop 等待取消完成。服务解析和输出属于扩展，适配器不识别业务协议。停用后不能继续使用保留的旧服务对象；同 ID 卸载重装必须重新授权。

管理测试通过公开 Host.install/grant/start/stop/uninstall/use 服务完成。Host.uninstall 仍要求先成功 stop，不自动绕过清理失败。stop 取消当前作用域，但不撤销管理者保存的能力授权；卸载调用平台撤权后才移除登记。撤权失败不可伪报卸载成功。

## 实验适配边界

connect 先探测原生实验命令，不存在则拒绝创建。授权能力只允许 credential.request，owner 只接受 Host 推导的 extension.probe.alpha / extension.probe.beta，映射到原生 probe.alpha / probe.beta；请求中的任何额外字段均拒绝。别名固定映射到 echo/delay，不开放观察/报告路径给业务扩展。

每个请求先登记原生预约，再检查取消/授权世代，最后执行。预约回执后已取消时请求取消预约且不执行；取消回执未知时保守报 unknown。桥接异常不透传原文、正文或地址；发出执行后取消/撤权不能声称远端无副作用。撤权先使本地授权失效，原生回执失败也不恢复旧权限。原生等待仍受总时限约束。

Host 自动注入 owner 仅保障公开调用路径；共享 WebView 可直接调用实验命令，不能称恶意扩展隔离或生产身份绑定。测试平台不进入默认前端打包路径，真实凭据、授权 UI 和生产身份机制仍待独立阶段。iOS 接口正式稳定前验证门槛不变。

无映射 owner 的空撤权为无副作用操作，用于清理没有平台能力的服务消费者；非空授权仍拒绝。授权回执仅能确认当前管理操作，延迟旧回执不能恢复已撤销权限。预约回执未知且取消也失败时，不保证原生预约清零；本阶段仅在单元测试注入这种失败，不将正常两端结果外推到故障场景。

## 原生验证入口

独立作者的 `author-echo-probe.mjs` 提供 probe.alpha.echo 服务，消费者通过 ctx.use 获取。生命周期控制全部使用 Host 管理方法；测试观察者另用 probe.beta 读取计数/提交报告，不参与业务请求。载荷 owner 拒绝用例直接调用 Platform 入口以检测边界，业务成功和在途生命周期均经独立扩展公开接口。

复用 [原生实验构建流程](M2-native-transport-experiment-2026-10-15.md)，测试前端 root 改为 tests/host-transport、输出为 `.cache/host-transport/dist`；Mac 测试标识 dev.plums.plums.hosttransportprobe，名称 Plums Host Transport Probe。最终两端顺序运行，避免服务计数相互干扰。实验产物在 `.cache/host-transport/artifacts/`；普通 release 未变，生成工程输出仍可能是实验包，不能作为普通更新。

后续 [原生异常回执实验](M2-transport-fault-experiment-2026-10-15.md)已覆盖上述未知回执与取消失败，并加入未执行预约租期。此前阶段结论保留其原版本范围；新的回收保证仅为后续原生命令触发，不是后台准时释放。
