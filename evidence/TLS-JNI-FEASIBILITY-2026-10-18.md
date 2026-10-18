# M2.3.1 TLS/JNI 可行性实验

日期：2026-10-18（Asia/Singapore）。状态：限定实验完成。平台维护者实施，独立审查者未参与实现。基线 `7003d92`，实现绑定 [350 文件清单](source-manifest-4ee2bde310ef848e2f37d0fc328fb83577f82b45affecd41857d2818fac00f9d.json)；差异和新增原件保存于 `.cache/m2-3-1/source.patch` 与 `source-new-files/`。

## 结论与生产门槛

继续首选 **reqwest + rustls 平台验证器 / Android JNI**。独立 Mac/Android 候选完成受控 TLS 正反例；Android 的 Rust 创建线程可读取并清理 JVM 合成 byte[]。未触发整套 Kotlin 原生传输回退。

正式 Android verifier 使用 AndroidCAStore，不接受应用 NetworkSecurityConfig 或 reqwest 的额外根合并。受控证书正例改用上游官方进程内测试信任库，生产仍使用正式 companion / OS 根。生产系统根联网正例、真实秘密与 Tauri 句柄适配未验。

**M2.3.4 前置：OS 证书验证的辅助联网边界。** 上游源码存在 OCSP/CRL 或根获取路径，不自动受 reqwest 的 DNS 固定、`no_proxy`、代理和超时配置约束。这是源码核对所得，未由本次夹具测量。平台维护者须先证明可强制的路由、DNS、取消和总时限，再决定实现或经审查修订支持声明；无法满足则重新评估方案，不关闭 TLS 或静默放宽约束。

## 候选、信任库与许可

`tests/tls-jni/` 是独立能力 probe，不是普通 Plums 应用；主应用 Cargo.toml/Cargo.lock、原生命令与默认构建未修改。复现入口 `tests/tls-jni/README.md`（R5 已删除，可从提交 `b27af7b` 取回）和[产物记录](m2-3-1-artifacts.json)分别保存命令与 APK/可执行文件摘要、设备、最终布尔结果。

| 项目 | 锁定选择与实际条件 |
| --- | --- |
| Rust | reqwest 0.13.5，默认特性关闭，仅 rustls/blocking；rustls 0.23.46、platform-verifier 0.7.1、zeroize 1.9.1 |
| Mac | macOS arm64 本机可执行候选；Security.framework 验证；测试 CA 仅合并到单个客户端，系统根客户端不合并 |
| Android | 全新 API36 ARM64 模拟器；独立 dev.plums.tlsprobe debug APK；jni 0.22.4，NDK28.2/JDK21/Gradle9.6.1/AGP9.3.1 |
| companion | 正式 AAR / Rust shim 0.2.0；最终测试组件原样编译上游提交 252e25161a91af476cbea620e29d277592d27ec7 的 CertificateVerifier.kt，官方 BuildConfig.TEST=true |
| 根来源与更新 | Mac Security.framework、Android AndroidCAStore / X509TrustManagerExtensions，由 OS 管理；Android 有进程级信任管理器/根缓存，实时轮换未验，后续核对重启重载 |
| 请求 | 仅向 127.0.0.1 HTTPS 夹具 GET /probe；.invalid 名称固定回环，Android 通过独立 ADB reverse；无认证头或假秘密 |

[依赖与许可清单](m2-3-1-dependencies.json)记录可达的 Mac 113 / Android 122 个第三方 Cargo 包及声明许可，另列 Kotlin stdlib 2.2.10 和 annotations 13.0。reqwest/JNI/verifier 为 MIT OR Apache-2.0，rustls 为 Apache-2.0 OR ISC OR MIT，zeroize 为 Apache-2.0 OR MIT；以清单字段为准。companion 的 MIT/Apache 原件随测试 APK assets 保留。声明核对不替代 M2.4 最终分发产物的完整通知审计。

原始资料：[平台与根说明](https://docs.rs/crate/rustls-platform-verifier/0.7.1)、[Android 实现](https://github.com/rustls/rustls-platform-verifier/blob/252e25161a91af476cbea620e29d277592d27ec7/android/rustls-platform-verifier/src/main/java/org/rustls/platformverifier/CertificateVerifier.kt)、[Apple 实现](https://github.com/rustls/rustls-platform-verifier/blob/252e25161a91af476cbea620e29d277592d27ec7/rustls-platform-verifier/src/verification/apple.rs)。

## 首次失败与修正

- 接受脚本先因结果不存在而失败；这是缺少实现/结果，不计作行为断言失败。
- Mac 首轮拒绝目标均无 HTTP，但分类器漏掉 io::Error 内层的证书错误，报告三个 false。新增回归为 **1 失败/1 通过**；修后 **2/2 通过**，保留“连接失败不能冒充证书拒绝”的断言。
- Android 正式 companion 首轮为 JNI 六项通过、trusted=false、三个拒绝 true，目标零 HTTP。`android-default-companion.apk` 与 `android-first-result.json` 保留该反例；源码核对确认它使用 AndroidCAStore，推翻应用域名 CA 注入假设。
- 最终采用官方测试机制：系统根拒绝 → addMockRoot 注入进程内测试库 → 正例/错名/过期 → clearMockRoots → 再次拒绝。不修改系统根，不关闭证书或主机名验证。官方 TEST 模式在 mock 根且无 stapled OCSP 时跳过吊销检查，正例不能证明生产吊销路径。

依赖下载的沙箱 DNS、外部临时目录权限、NDK ar 配置和未缓存 Gradle 插件标记均按日志修正：复用既有工具链、项目临时目录、显式 LLVM 工具和已有 AGP classpath，不视为 TLS/JNI 产品缺陷。结果页在系统栏下不可读，修正 Insets/滚动文本后重打包、重跑并查看最终原生截图。

## 最终验证

| 验收 | Mac | Android |
| --- | --- | --- |
| 有效证书，固定响应 probe-ok | 通过 | 官方测试信任库下通过 |
| 系统根拒绝临时 CA | 通过 | 通过 |
| 错误主机名拒绝 | 通过 | 通过 |
| 过期证书拒绝 | 通过 | 通过 |
| 移除测试信任后再次拒绝 | 新系统根客户端通过 | clearMockRoots 后通过 |

Android JNI **六项通过**：假 byte[] 内容核对、Java 数组归零、Rust 原始切片非空且归零、null 拒绝、Java 异常拒绝、清异常后再次读取恢复。Rust 缓冲使用 Zeroizing；Java 临时数组复制后清理，不承诺 JVM/HTTP 内部副本完全归零。

最终 Android 服务端增量为 trusted **+1**，untrusted/mismatch/expired **各 0**，异常请求形状/Authorization **0**；清根后没有额外 HTTP。JNI 假字节不传给网络函数；probe 不含 WebView。该实验进程日志无合成哨兵；原生界面空闲后的文本和截图已检查。

- 独立 crate：Mac build/run、两项单元、cargo fmt、Mac Clippy --all-targets -- -D warnings 通过；Android build --lib --target aarch64-linux-android 零警告、最终 Gradle 构建和设备接受脚本通过。
- Android 工具链没有 cargo-clippy 组件，该目标 Clippy 未执行；未安装或更改工具链。Mac Clippy 不替代 Android 目标的该项检查。
- 主工程构建/类型、52 文件 **584 单元**、格式通过；首次项目检查在证据未落盘时报告缺链接，补齐后检查项目/边界、行数、lint 和差异空白。未重跑普通应用浏览器或原生验收。
- 独立审查覆盖最终 probe、信任隔离、源码/产物绑定、Android 新鲜结果与计数、许可及生产限制；修正 rustls 许可摘要的连接词后，无剩余发现，可按限定范围归档。

## 材料与未验范围

材料根 `.cache/m2-3-1/`：mac-first-result.json、mac-result.json、classifier-before.log、unit-final.log、两端 build/run/Clippy 日志、android-first-result.json、android-result.json、android-before-server-counts.json、android-after-server-counts.json、android-screen.png、android-view.xml、gradle-dependencies.log。初始正式候选和最终测试 APK 分开保留；日志、截图、CA/私钥、上游下载和运行数据不提交。

系统/用户信任库与真实秘密库未修改，未请求模型或账户 API；release 未替换、不推送、不自动提交。本阶段未验：生产系统根联网正例、OCSP/CRL/根获取、实际秘密与签名/失效、Tauri jni 0.21 与本次 jni 0.22 句柄适配、API24–25、真机、其他 ABI/OS 和完整受限传输；由 M2.3.2–M2.3.7 与平台门槛继续承担。
