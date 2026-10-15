# 无凭据原生传输实验

本实验验证 WebView → Tauri 命令 → Rust HTTP 客户端 → 本机合成服务的真实路径。它不是生产平台能力，也未将请求接入 Host 的公开平台适配。SDK 和凭据请求契约仍为实验版。

## 边界与所有权

`native-transport-experiment` 是默认关闭的 Cargo 特性；只在显式启用时编译 `transport_probe.rs`、注册 probe 命令并创建内存状态。生产 `PlatformAdapter.available('credential.request')` 仍为 false。测试页和服务在 `tests/native-transport/`，不进入普通前端入口。

平台只接受固定 `127.0.0.1:18765`，绑定名映射 echo、delay、slow、redirect、oversize、chunked、stats、report 路径。不接收 URL、自定义头或凭据，固定 POST text/plain，禁用代理与自动重定向。本地服务仅监听回环，不需要改系统网络安全设置。Android 专用模拟器通过临时 `adb reverse tcp:18765 tcp:18765` 使用设备回环地址，验收后移除。

probe_grant 仅接受两个合成 owner；prepare 校验后登记 `(owner, id)`，execute 只能开始一次，cancel 删除未执行预约或通知在途请求。撤权取消已有请求并清除未执行预约，再授权不清除旧请求的取消标记。最多 16 个待处理项；取消、完成或撤权释放相应登记。取消不撤销服务端已经收到的请求。

owner 是测试命令参数，可以被共享 WebView 代码伪造。跨 owner 反例只证明请求表按键隔离，不证明生产授权身份或恶意扩展隔离。生产调用身份、授权确认、凭据库、Host 生命周期接入仍未实现。

请求正文上限 4096 字节，响应累计上限 8192 字节；已知 Content-Length 与实际分块均检查，非法 UTF-8 拒绝。总等待时限为 800ms，包括分块读取；取消使用独立通知与传输竞争，完成前再次检查取消状态。发送前拒绝为 not-dispatched；执行开始后超时、取消、3xx、超限和传输失败均为 unknown，不自动重试，不声称远端无副作用。限额不等于 HTTP 客户端所有内部缓冲的硬内存预算。

## 依赖与复现

沿用锁定缓存中的 reqwest 0.13.5（MIT OR Apache-2.0）、Tokio 1.53.3（MIT）、futures-util 0.3.34（MIT OR Apache-2.0）；从 crates.io 锁文件来源、校验值及本地 crate Cargo.toml 核对。只新增可选直接依赖关系，无新 crate 版本。reqwest 禁用默认特性；本实验 HTTP 回环结果不证明 TLS、证书、DNS/代理或公网策略正确。未复制第三方代码或修改许可证。

先在忽略目录创建 Vite 配置，root 为 `tests/native-transport`，build.outDir 为 `../../.cache/native-transport/dist`，target 为 es2022。使用该配置构建测试页；服务命令为 `node tests/native-transport/server.mjs .cache/native-transport/server-results`。启动前确认 18765 未占用，不终止未知监听者。

Mac Tauri 配置覆盖 beforeBuildCommand 为空、frontendDist 指向上述测试页，identifier 为 `dev.plums.plums.transportprobe`、productName/window title 为 `Plums Transport Probe`。执行 `tauri build --debug --bundles app --features native-transport-experiment --config <隔离配置> -- --locked --offline`。使用独立 PLUMS_M1_DATA_DIR 启动构建出的测试包。

Android 使用既有工具链和生成工程，配置仅覆盖测试前端；执行 `tauri android build --debug --target aarch64 --apk --features native-transport-experiment --config <隔离配置> -- --locked --offline`，保留既有调试签名环境。只装入专用只读 AVD 克隆，包名仍是 dev.plums.plums；不能安装到用户真实设备或作为普通更新交付。

页面自动运行验证，将结果显示于实际 WebView，并经原生 report 请求写入本机服务的隔离输出目录。失败结果与通过结果都可报告，不以构建成功代替运行成功。服务保存的路径计数用于核对取消前未分发、在途请求已被收到、重定向目标未访问。

## 产物与验收

测试包保存在 `.cache/native-transport/artifacts/`；生成工程输出也可能仍是实验版本。普通 `release/` 不替换，继续绑定普通配置阶段源码，使用前应核对各自清单。实际命令、源码/测试包摘要、两端结果及未验项见 [专项证据](../evidence/NATIVE-TRANSPORT-2026-10-15.md)。

实验不使用真实凭据、OAuth、外部私人数据或持久访问。真实资源授权必须逐次确认。iOS 最小验证仍是接口正式稳定前硬门槛；Android 真机、Windows/Linux、生产绑定与完整网络策略未验收。

后续 [公开生命周期集成实验](HOST-TRANSPORT-EXPERIMENT.md)已在测试入口接通 Host/独立扩展，未改变本原生命令或生产能力。上述直接命令实验保留其原阶段范围。

后续 [异常回执与预约恢复](TRANSPORT-FAULT-EXPERIMENT.md)为显式实验特性增加固定故障入口及未执行预约租期；最新源码的限制与两端结果见该文，不开放生产能力。
