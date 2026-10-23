# Android 本地构建与系统栏适配

[快速开始](../README.md) · [默认界面](UI.md) · [当前证据](../evidence/RESULTS.md)

状态：**冻结**（2026-10-21）：项目当前只做 macOS 应用本体，Android 不再随改动验收，下文构建流程与适配保留为恢复时的起点，可能已落后于源码；原 2026-10-18 核实的内容见下。系统 Back 适配已接入开发候选，构建与设备结果按平台分别留证。

在既有 YHX Android 工具链目录设置 `PLUMS_ANDROID_TOOLS_ROOT`，然后从项目根目录执行：

```sh
npm run android:init
npm run android:build
```

`android:init` 只用于尚未生成 Android 工程的工作副本；已有 `src-tauri/gen/android` 时使用 `npm run android:prepare`。`android:build` 每次都会先准备工程，再构建 ARM64 调试 APK。产物位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。原生安装运行验证通过后，按[交付约定](DEVELOPMENT.md#本地交付目录)更新根 `release/`。

## 工程与环境的所有权

[scripts/android.mjs](../scripts/android.mjs) 在子进程中加载工具链的 `env.sh`，复用现有 JDK、SDK、NDK、Rust、Cargo 源码缓存与 Gradle 缓存。它不修改全局 profile，不运行 iOS，也不自动安装 SDK、接受许可、安装 APK 或启动设备。

Rust 编译输出固定到本项目 `.cache/android/target/`。Tauri 的 Android 构建会生成带包名和工程路径的 Kotlin 文件，这部分输出必须归属当前工作副本；不同工程共用旧 `target` 曾导致缺少 `TauriActivity`。YHX 工具链及下载缓存仍可复用。

桌面环境中的 `PLUMS_DATA_DIR` 在 Android 子进程中移除。设备通过应用自己的数据目录保存状态。调试签名首次构建时生成于 `.cache/android/debug.keystore`，后续复用；生成 Gradle 文件只通过环境变量引用它。密钥和机器路径均不进入版本控制。

## 维护适配源码，按需生成工程

[MainActivity.kt](../native/android/MainActivity.kt) 是受版本控制的系统栏适配源码；`{{PACKAGE}}` 从 Tauri 的 `identifier` 生成。它在内容根节点合并 system bars、display cutout 和 IME 的 Insets，并请求初次应用，使 WebView 避开系统栏，键盘出现时缩小可用视口。[AppearancePlugin.kt](../native/android/AppearancePlugin.kt) 通过 Tauri 原生插件同步深浅模式的根背景和系统栏图标亮度，关闭导航栏的额外对比遮罩；Insets 的计算仍由 MainActivity 负责。

[CredentialsPlugin.kt](../native/android/CredentialsPlugin.kt)接收应用内填写的 API Key，以 Android Keystore AES-GCM 加密后写入 noBackup 文件；命令只返回状态，不向 WebView 交付密钥。源码由同一准备流程生成，未知既有插件代码会拒绝覆盖；实际秘密操作与网络请求的验证范围见[凭据管理](CREDENTIAL-BINDINGS.md)。写入线程内的失败按 unknown，不记录秘密。

[scripts/android-project.mjs](../scripts/android-project.mjs) 在写入前核对所有目标：

- MainActivity 必须是锁定 CLI 的原模板或当前已适配版本。
- 从既有 Insets-only MainActivity 升级时，仅额外接受已知完整旧模板；其他改动仍拒绝覆盖。
- 外观、文档和凭据插件由同一流程从受控源码生成，未知既有代码停止准备；外观插件接受已知前版深浅背景色，凭据插件接受已知前版面板失败状态，两者均升级到当前模板。
- Gradle 回调转换为从 Rust 目录调用项目锁定的 Node CLI，覆盖直接 Node 和 npm 初始化两种已知模板。
- 调试签名使用本地环境变量；未知既有签名配置停止准备。
- 保留生成模板的兼容标志，增加无常驻 daemon、最多 4 workers 的本地资源设置。
- Gradle 9.6.1 wrapper 使用 YHX 已有归档，并固定已验证的归档校验值；未知版本或校验值停止准备。
- 将 `src-tauri/icons/android/` 的启动器资源同步到已有生成工程，覆盖换图标后仍沿用旧资源的路径。

模板变更会报出需要复核的具体对象；所有检查通过后才写入。准备操作可重复执行。生成工程仍按 `/src-tauri/gen/` 忽略，重新初始化后会重新准备，不提交生成物或机器路径。生成目录中的本地 Gradle URL 仅适用于对应工具链位置，不能把整个生成目录作为可移植工程分发；新工作副本从上述入口生成。

替换 `src-tauri/icons/source.png` 后执行 `npm run icons`，再执行 `npm run android:build`。图标生成入口复用项目锁定 CLI；只将 Mac、Android 与 Web 所需资源接入源码，iOS 工作继续暂缓。Android 自适应图标的前景层不沿用 Mac 圆角底板：脚本只取橙色标记、去掉底板与阴影，按画布 46% 居中，保证落在启动器遮罩必显示的 66dp 安全区内；背景层为白色。旧版启动器（API 24–25）仍使用完整底板图标。

## 已验证条件与边界

### 系统 Back

MainActivity 通过 AndroidX 生命周期回调处理系统返回：IME 可见时先收键盘；否则向当前 WebView 发送可取消的 `plums:back` 事件。外壳依次取消顶层菜单/弹窗、关闭管理页、调用当前工作区的可选 `chrome` 快照 `back()`。没有可返回层时才交回 Android 默认导航。返回管理页不卸载工作区，未发送草稿保留；回调失败走现有视图恢复路径，不能继续调用失效工作区。

原生只在 WebView 明确返回“未消费”时执行系统返回，结果未知时记录无正文诊断并留在应用。同一原生请求未回执前不重复派发。弹窗沿用 cancel/Escape 和焦点恢复；工作区自己负责返回后的焦点，默认 Agent 回到相应列表入口。该桥接属于共享 WebView 的合作式 UI 机制，不提供恶意扩展隔离。

当前交付的源码已包含此 Back 桥接；0.2.0 的实际受验范围见[交付证据](../evidence/RELEASE-0.2.0-2026-10-20.md)，不能据源码推定全部返回路径均已验证。Android 冻结，恢复验收时覆盖 IME、管理页、嵌套弹窗、菜单、工作区与顶层返回；手势预测动画、其他系统/WebView 和真机仍未验。

### 构建和设备

本流程固定 npm/Cargo 锁文件，构建参数为 `android build --debug --target aarch64 --apk -- --locked`。现有环境为 macOS arm64、JDK 21、NDK 28.2、Gradle 9.6.1、AGP 9.3.1、compile/target SDK 37；实际运行使用 API 36 ARM64 AOSP 模拟器。版本与当前产物的运行结果见证据。

触摸：全局 `touch-action: manipulation` 免去双击缩放等待，并关闭 WebView 默认点击高亮，按钮以自身的按下状态反馈。

准备操作测试覆盖幂等性、两种构建回调、图标刷新、缺少图标源时不部分写入，以及未知模板/签名/分发/外观插件的拒绝；编译、签名、安装、真实 WebView、系统栏和键盘仍以原生运行分别验收。清单 minSdk 24 不是最低支持版本已验收的声明。真机、其他 ABI、手势导航、其他系统/WebView 以及长期后台仍未验证；iOS 继续暂缓，M2 整体尚未退出。
