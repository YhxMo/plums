# 0.0.3 双主题与原生外观验证

[证据索引](RESULTS.md) · [默认界面](../docs/UI.md) · [Android 工程](../docs/ANDROID.md) · [产物元数据](ui-android-artifacts.json)

执行日期：2026-10-15 UTC。实现、集成与原生验收负责人：Codex 主执行者。独立源码审查者：Kierkegaard，未参与实现。范围为 A3、A5–A8、A10、A12 的 M1 子集。

## 版本、范围与反例

基线为 `main` @ `8915478b5eaef3697aab4f9170f6b9bdb7566952`。差异包含三个样式文件、外壳的图标/外观偏好、原生外观桥、Android 准备和图标生成、版本及对应测试。Host、SDK、业务扩展和 MainActivity 的 Insets 算法未改。实际源码、测试、配置和图标集合见 [source-manifest.json](source-manifest.json)，共 77 文件：

`370a2889ea089c6bc8b0940d72f84042f1d5b9c5ab76abbb85c8897b629228d2`

文档和证据自身由同一阶段 Git 提交及 diff 留证，不计入源码摘要。0.0.2 的[源码集合](source-manifest-0.0.2.json)和[产物清单](ui-android-artifacts-0.0.2.json)已独立保留。

默认方向为白底橙色梅子图标，以及暖白/陶土橙、暖炭灰/柔和橙两套主题。验收失败条件包括：首次外观错误；切换丢失草稿；布局和主题互相覆盖；重启丢失偏好或已保存结果；写入失败却切换成功；系统栏与页面反差明显；图标更新未同步到已有 Android 工程；缺少资源或遇到未知插件时部分覆盖工程。授权取消、焦点、停用清理和恢复沿用既有完整流程的断言。

5 项主题测试在缺少实现时均失败，随后通过；3 项新增 Android 准备反例对基线脚本执行时均失败，另 6 项通过，当前 9 项均通过。未建立 CSS 数值镜像测试。

## 自动验证与实际渲染

| 命令或检查 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm test` | 48/48，通过 | 复用既有 45 项；新增图标刷新、缺源时不部分写入、未知外观插件拒绝 |
| `npm run test:web -- --workers=3` | 22/22，通过 | 复用既有 17 项；新增首次系统深浅模式、375/1440 切换保草稿和重启恢复、偏好写入失败 |
| `npm run native:test` | 6/6，通过 | 本机 Rust 状态、权限、命名空间及错误保留 |
| `npm run build` | 通过 | TypeScript/Vite；最终原生构建使用同一前端入口 |
| `npm run format:check` | 通过 | Prettier |
| `npm run native:check` | 通过 | 本机 Clippy，`--all-targets -- -D warnings` |
| `RUSTUP_TOOLCHAIN=nightly npm run native:fmt` | 通过 | 已有 nightly rustfmt |
| `npm run icons` | 通过 | 锁定 CLI 从同一橙色源图生成 Mac、Android 和 Web 资源；XML 换行规范化 |
| `npm run native -- build --debug --bundles app` | 通过 | macOS arm64；复用已有 Cargo 缓存/target |
| `PLUMS_ANDROID_TOOLS_ROOT=<既有工具链> npm run android:build` | 通过 | 受控准备、ARM64 Rust 编译/链接、Kotlin 插件和 APK 构建 |
| `npm run check:project`、`git diff --check` | 通过 | 内部链接、空白、清单和指定隐私模式；提交前另审精确暂存内容 |

原生桥完成后重新执行了全部 22 项浏览器与 48 项单元测试。最后的 Android Builder 显式类型补充仅处于 Android 条件编译分支；Android 已重新构建并运行，Mac 的有效代码及既有 Rust/Clippy 结果经影响评估保持适用。

Playwright 分别截取 1440 和 375 CSS px 下的浅色/深色欢迎页、授权弹窗、工作台、扩展管理与画布，已检查实际渲染与无横向溢出。弹窗居中、12px 圆角，标题、能力和操作区分层；工作台与画布使用同一语义变量，仍通过公开 `ctx.view` / `ctx.use` 挂载。切换外观不改变挂载依赖。

指定颜色组合的计算对比度如下；输入/选择框检查其实际相邻的卡片与表面颜色，未作完整可访问性认证。

| 模式 | 正文最低 | 次级文字最低 | 主按钮 | 输入/选择框边界最低 |
| --- | --- | --- | --- | --- |
| 浅色 | 12.89 | 4.72 | 5.10 | 3.10 |
| 深色 | 11.17 | 5.78 | 8.59 | 3.79 |

本地原始证据保存在忽略的 `evidence/raw/ui-android-0.0.3/`：双主题双宽度 PNG、`appearance-metrics.json`、`contrast.json`、Mac 可访问性树和 Android 最终验收记录。运行数据、截图、生成工程及签名私钥不提交。

## Mac 最终包

环境为 macOS 27.0.1 / arm64、系统 WKWebView，WebKit framework 22625 / 22625.1.29.11.28。使用 `release/Plums M1 0.0.3.app`，按完整路径绑定原生窗口；隔离数据为 `.m1-data/ui-0.0.3-appearance/`。

| 操作 | 实际结果 |
| --- | --- |
| 浅色启动、切换深色 | 图标为白底橙色，窗口与 WebView 同步，未显示原生外观调用错误 |
| 保存 `native_mac_final_003` | Rust JSON 的 output 为 `NATIVE_MAC_FINAL_003`，runs 2、revision 2 |
| 停用 workbench | 工作台停用、依赖布局等待，均为 0 资源/0 任务 |
| 重新启用并授权 | 画布及已保存输入/结果/次数恢复 |
| 退出原进程，再打开同一包并授权 | 新 PID 恢复深色、画布及上述结果；`host.shell` 为 board/dark、revision 3 |

浅色/草稿切换、授权取消与焦点在同版前端候选中分别检查；最终包重新验证受原生外观桥影响的外观、保存、启停与新进程恢复。最终 Mac 包与构建源的整包内容摘要一致，约 30.86 MiB。验证进程保留打开供本地查看，使用隔离数据；当前 PID 和路径记录在忽略的 `.cache/mac-003-runtime.json`。

## Android 最终 APK

构建复用已有 YHX 工具链：JDK 21、NDK 28.2、Gradle 9.6.1、AGP 9.3.1、compile/target SDK 37。运行采用本任务独立只读 AVD 克隆，Android 16 / API 36 / arm64-v8a / WebView 133.0.6943.137，三按钮导航。真实 ADB 触控/键盘与 WebView CDP 观察分别留证，不使用主机浏览器存储替代 Rust。

| 操作 | 实际结果 |
| --- | --- |
| 查看扩展、取消授权、再确认 | 取消不启动，确认后工作区可用 |
| 原生键盘输入、切换主题后保存 | 草稿保留；设备 Rust JSON 为 `native_android_003` / `NATIVE_ANDROID_003`，runs 1、revision 1；localStorage 为空 |
| 停用、重新启用并授权 | 工作台及受影响布局为 0 资源/0 任务，恢复已保存结果 |
| 原生选择画布、force-stop 后新进程启动并授权 | dark、board、输入与结果恢复；未出现外观调用失败提示 |
| 系统栏与 IME | 浅色系统栏为深色图标，深色为浅色图标及暖炭灰背景；WebView bounds 为 `[0,136][1080,2208]` → `[0,136][1080,1428]` → 原值；393 CSS px / DPR 2.75，视口高度 754→470→754 |

APK 的 CRC、v2 调试签名、包名 `dev.plums.m1`、版本 0.0.3 / versionCode 3、ARM64 ABI 均通过检查。已安装 APK 与最终构建和交付副本摘要相同，约 255.59 MiB。记录位于本地 `android-final/android-runtime-result.json`、`artifact-verification.json` 及对应截图。

验收后已关闭本任务模拟器及专用 ADB，核对 PID 退出与 5042/5562/5563/9232 端口关闭。AVD 克隆、原始证据和历史实验保留。

## 审查、精简与交付

独立审查覆盖主题保存/恢复、挂载不变性、生命周期入口、图标流程、原生桥和 Android 受控准备。发现的 XML 末尾换行问题已通过生成脚本规范化，并实际重新生成/检查；对 `run_mobile_plugin_async::<()>` 和 Android Builder 类型补充复核后，无剩余阻塞。审查未冒称独立重演原生操作。

精简沿外观偏好 → 状态写入 → DOM/原生外观、图标源 → 各端资源、准备 → 构建的实际路径进行。布局与模式共用一次偏好写入；删除额外桌面平台探测、无用运行态字段及前端窗口 API 依赖，原生返回直接使用 `()`。保留首次启动/停用恢复需要的 `started` 及既有视图生命周期，没有新增主题框架或业务私有 API。无需要确认行为取舍的精简项；Host/SDK 与业务扩展未作扩展审计。

交付为 `release/Plums M1 0.0.3.app` 和 `release/plums-m1-0.0.3-android-arm64-debug.apk`，均为 debug。版本、身份、签名和复制完整性见[产物元数据](ui-android-artifacts.json)与本地 `release/CHECKSUMS.json`。校验新包、更新说明与清单后，0.0.2 副本和旧清单/说明移至 `.cache/replaced-release/0.0.2-20261015T144431Z/`，可恢复。

Android 真机、其他系统/WebView/ABI、横屏/手势导航、Windows/Linux 未验证；iOS 继续暂缓。完整 A11/A12、状态迁移、崩溃/写入中断恢复、原生丢失回执、文件/OS 授权和长期后台仍未完成。M1 保持开放，M2 未开始。
