# M2.3.1 TLS/JNI 复现入口

状态：限定实验（2026-10-18）。独立 Rust crate 和 Android probe，不被 Plums 默认应用引用。结果、首次失败与生产集成限制见[实验记录](../../evidence/TLS-JNI-FEASIBILITY-2026-10-18.md)。

## 先准备本机 HTTPS 夹具

使用新目录，保留旧证据；只使用现有 Rust、OpenSSL 和 Android 工具链，不改系统信任库。以下命令从仓库根执行：

```sh
export PLUMS_TLS_PROBE_ROOT="$PWD/.cache/tls-jni-replay"
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_HOME="$PWD/.cache/cargo"
export CARGO_TARGET_DIR="$PLUMS_TLS_PROBE_ROOT/target"
python3 tests/tls-jni/fixture.py prepare "$PLUMS_TLS_PROBE_ROOT/fixtures"
cargo fetch --locked --manifest-path tests/tls-jni/Cargo.toml
python3 tests/tls-jni/fixture.py serve "$PLUMS_TLS_PROBE_ROOT/fixtures"
```

`serve` 保持前台；在另一个终端沿用上述环境。私钥、CA、端口、计数与结果仅留在忽略目录。夹具绑定 `127.0.0.1`；`.invalid` 主机名在客户端解析到回环，不做公网请求。CA 有效两天，每次独立复现重新生成。

```sh
PORT=$(python3 -c 'import json,os;print(json.load(open(os.environ["PLUMS_TLS_PROBE_ROOT"]+"/fixtures/server.json"))["port"])')
cargo run --offline --locked --manifest-path tests/tls-jni/Cargo.toml -- \
  "$PORT" "$PLUMS_TLS_PROBE_ROOT/fixtures/ca.der" "$PLUMS_TLS_PROBE_ROOT/mac-result.json"
python3 tests/tls-jni/assert-result.py "$PLUMS_TLS_PROBE_ROOT/mac-result.json"
cargo test --offline --locked --manifest-path tests/tls-jni/Cargo.toml --lib
```

Mac 使用平台验证器并为单个客户端合并测试根；系统根客户端应拒绝该证书。正例必须收到固定 `probe-ok`；拒绝必须是证书错误，连接失败不能冒充通过。

## Android 使用官方测试信任库

Android 正式 verifier 使用 `AndroidCAStore`，应用 `NetworkSecurityConfig` 不能给它注入私有测试根。实验原样构建对应上游源码的 `BuildConfig.TEST=true` companion，以官方 `addMockRoot`/`clearMockRoots` 控制进程内测试库；不修改系统或用户根。

```sh
UPSTREAM=https://raw.githubusercontent.com/rustls/rustls-platform-verifier/252e25161a91af476cbea620e29d277592d27ec7
curl -fsSL "$UPSTREAM/android/rustls-platform-verifier/src/main/java/org/rustls/platformverifier/CertificateVerifier.kt" \
  -o "$PLUMS_TLS_PROBE_ROOT/CertificateVerifier.kt"
for name in LICENSE-MIT LICENSE-APACHE; do
  curl -fsSL "$UPSTREAM/$name" -o "$PLUMS_TLS_PROBE_ROOT/$name"
done
# 设置为已有、含 env.sh 的 Android 工具链目录。
export PLUMS_ANDROID_TOOLS_ROOT=/path/to/existing/android-toolchain
zsh tests/tls-jni/build-native.sh
source "$PLUMS_ANDROID_TOOLS_ROOT/env.sh"
# env.sh 可能设置工具缓存；恢复本次独立实验根，勿使用普通生成工程。
export PLUMS_ANDROID_DEBUG_KEYSTORE="$PWD/.cache/android/debug.keystore"
python3 tests/tls-jni/build-android.py
gradle -p "$PLUMS_TLS_PROBE_ROOT/android-project" --offline --no-daemon :app:assembleDebug
```

需要已有项目调试 keystore；脚本不会创建或替换签名材料。Gradle 原样编译指定提交的 companion，许可证随 APK 保存；Cargo 锁文件须对应 verifier 0.7.1 / Android shim 0.2.0。新依赖尚未缓存时，去掉 Gradle 的 `--offline` 下载，不关闭验证。

启动专用、空数据的 API36 ARM64 模拟器后，显式选择它及独立 ADB 服务端口：

```sh
export ANDROID_SERIAL=emulator-5652
export ANDROID_ADB_SERVER_PORT=5092
python3 tests/tls-jni/run-android.py
```

运行器只重置 `dev.plums.tlsprobe` 的合成数据，安装独立 APK，并用 ADB reverse 连接本机夹具。依次验证系统根拒绝、注入后的正例/错名/过期、清根后的再次拒绝；同时验证 Rust 创建线程附加 JVM、假 byte[] 读取、null/异常拒绝、恢复与两侧缓冲清理。网络请求不接收假秘密，不含认证头；结果只包含布尔值。

测试 companion 在 mock 根且无 stapled OCSP 时跳过吊销检查，因此此结果不验证生产吊销行为或系统根正例。生产根、实际 Keystore、Tauri 集成、API24–25、真机、OS 辅助联网的 DNS/代理/时限边界仍按后续门槛验证。结束后只关闭自己启动的夹具、模拟器及 ADB 服务；保留结果和原始失败。
