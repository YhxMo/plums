# M1 实验与工程决策

状态：Mac 最小原型实现、最小原生路径与相关变更的独立定向审查已完成；Android 隔离 ARM64 调试 APK 构建与包检查及限定范围独立复核通过，设备运行未验证；iOS 暂缓。Mac 源码、命令与运行结果见 [证据](../evidence/RESULTS.md)，新增构建范围见 [Android 记录](#android-隔离构建记录)。M1 仍开放，不等于稳定 SDK 或五端验收完成。

## 实验范围

| 实验 | 交付 | 可判失败条件 |
| --- | --- | --- |
| 原生外壳 | Tauri/Web/Rust 最小入口、桥接与独立实验数据作用域 | 原生调用不通，或把浏览器结果当作原生证据 |
| 扩展执行位置 | 独立本地 ESM 模块在 WebView 执行，运行时不依赖 Node.js | 必须修改私有内核入口或依赖移动端未验证的 Node.js |
| 服务生命周期 | 依赖就绪激活、提供者替换、失败撤回、取消与清理 | 依赖加载顺序、出现残留资源，或清理失败伪报成功 |
| UI 替换 | 框架无关视图整体更换布局和导航，失败与停用恢复 | 只能换色加按钮、必须改内核、恢复入口不可用 |
| 最小纵向路径 | 本地文本扩展经能力契约读写隔离状态，停用与重启恢复 | 授权拒绝假成功、损坏数据被覆盖、提交前可取消的工作仍提交，或已提交/结果未知却显示未提交 |

## 决策记录

| 主题与选项 | M1 采用方案及理由 | 风险、回退与验证范围 |
| --- | --- | --- |
| Tauri 或仅 Web 外壳 | Tauri 2 + Rust；直接验证原生平台能力边界 | macOS 编译、调试包构建和最小原生用户路径已验证；Android 仅完成隔离调试构建与包检查，其他三端未执行；原生适配保持独立 |
| React 或无框架外壳 | React/TypeScript/Vite 仅用于管理外壳，CSS 变量与 CSS Modules | 扩展不绑定 React；可替换外壳，不改扩展服务契约；浏览器交互测试覆盖当前外壳 |
| 同环境 ESM、Worker 或独立进程 | 本地可信 ESM，最少执行假设，无运行时 Node.js | 无恶意代码隔离；未来可更换宿主。移动执行、分发策略和任意下载代码均未验证 |
| 框架组件或 DOM UI 契约 | DOM 挂载与释放；布局模块及样式独立分发 | 两套导航结构与未知外部视图经浏览器测试；CSS/DOM 仍共享环境，不保证安全显示隔离 |
| JSON 或 SQLite | 系统与扩展分开命名，每所有者一个有版本和修订号的 JSON，64 KiB 实验上限；暂不引入数据库 | 单进程锁与同目录临时文件替换；不是完整迁移/崩溃恢复方案。遗留 pending 文件保留并报错；可在公共状态契约下更换存储 |
| 应用能力检查或强沙箱 | SDK 检查声明/授权，Rust 检查所有者与授权；不接真实凭据 | 同环境代码可直接调用桥接，授权接口不是恶意代码安全边界；操作系统授权未实现，应用内能力路径按实际平台留证 |
| 精确契约版本或版本范围 | API 与服务版本精确匹配，明确拒绝不兼容组合 | 属于实验契约；语义版本范围、迁移、分发与长期兼容政策留待 M2 |

依赖版本以 npm 与 Cargo 锁文件固定。[直接依赖许可证元数据](../evidence/dependency-licenses.json)已核对，分发限制单独记录；不预设项目整体许可证或已完成全量第三方分发审计。

## 平台条件

| 平台 | 已知条件与当前限制 |
| --- | --- |
| macOS | 27.0.1 / arm64；Node.js 26.5.1，Rust/cargo 1.98.1，Command Line Tools。既有 Rust 不在默认 PATH，项目命令补充搜索路径，不改全局配置 |
| iOS | 暂缓。当前活动开发目录为 Command Line Tools；`xcodebuild -version` 失败，`simctl` 及 iphoneos/iphonesimulator SDK 不可定位，无 iOS Rust target，未生成 Apple 工程。非标准安装位置、模拟器 runtime、物理设备与签名条件未知 |
| Android | 已在独立工具目录配置 JDK 21.0.12.1、SDK/NDK 与 aarch64-linux-android Rust target；隔离生成工程使用 Gradle wrapper 9.6.1 / AGP 9.3.1，ARM64 调试 APK 构建及包检查通过。本次未安装 Android Studio、Emulator 或系统镜像，未安装/启动应用；设备、WebView 和运行行为未验证 |
| Windows、Linux | 无实际原生执行证据，未交叉编译。常见 VM 应用/CLI 未发现，不据此断言所有环境不存在。Docker 客户端存在，默认 daemon 的 socket 不存在而连接失败；其他 context、VM 或远程环境未核验 |

工具与依赖增量按已确认范围执行；新增许可及设备安全授权单独核对，不更改系统安全设置。缺失环境或运行证据阻塞对应结论，其他实验可继续。

## 移动依赖静态核查

构建前核查日期：2026-10-15 UTC。基线提交 `197463aefd05454c6bd7e2ac8c325230ef4ae3fd`，49 文件源码摘要为 `39e17c8d4d81973ccaf65af54c3454351a3e786f3d395fd6c8e0e17b8b127764`。该次仅阅读项目、锁文件、安装包及既有实验副本的 Cargo registry 缓存，并执行 CLI `--help`，未补齐依赖或执行移动构建。以下保留当时的静态发现与缓存快照；后续 Android 构建已补齐实际所需依赖，见下节，不能以旧快照描述当前缓存。静态发现不构成目标平台运行通过结论。

| 检查对象与本地依据 | 静态发现 | 尚需证伪的风险 |
| --- | --- | --- |
| [npm 锁文件](../package-lock.json)、已安装包的 package.json | 生产依赖为 @tauri-apps/api 2.12.4、React/ReactDOM 19.3.1、scheduler 0.28.0；四者未声明 OS/CPU 限制。API 包无运行依赖，ReactDOM 引入 scheduler；许可证元数据分别为 Apache-2.0 OR MIT、MIT、MIT、MIT，相应许可证文件存在 | 元数据不证明移动 WebView 兼容；React 的 Node engines 字段也不代表 WebView 需要 Node |
| [前端入口](../src/main.tsx)、[宿主](../modules/extension-host/host.ts)、[扩展目录](../extensions/catalog.json)、[构建配置](../vite.config.ts) | 应用执行路径未发现 Node 内建模块导入；Node 的 fs/child_process 等仅在主机脚本与测试。Vite/CLI 是主机工具。扩展使用本地动态 import，UI 使用 DOM；现有 dist 中 7 个扩展 JS 及 1 个 CSS 与源码逐字节相同，未经过转译 | Web 构建 target 为 es2022，代码使用 Object.hasOwn、TextEncoder、AbortController 及 signal.throwIfAborted；没有显式兼容补丁。须在所选系统/WebView 检查，不能由桌面绿测外推 |
| 已安装 @tauri-apps/api/core.js、[平台适配器](../src/platform.ts) | invoke 通过 WebView 内的 Tauri 桥接调用；生产前端无需启动 Node 服务，浏览器 localStorage 路径与原生 invoke 路径分开 | 必须观察实际 Rust 调用及数据，单独“原生已连接”标签不构成验收；移动 capability 与窗口匹配未验证 |
| [Cargo 清单](../src-tauri/Cargo.toml)、[锁文件](../src-tauri/Cargo.lock)、缓存的 tauri 2.12.4 / tauri-runtime-wry 2.12.2 / wry 0.57.0 / tao 0.37.1 清单 | 依赖按 target 区分；iOS 分支包含 objc2-ui-kit，Android 分支包含 JNI/NDK，桌面 GTK/菜单等有相应条件。tauri 系列最低 Rust 元数据为 1.90，本机 1.98.1 满足该项。前三者许可证元数据为 Apache-2.0 OR MIT，tao 为 Apache-2.0，相关许可证文件存在 | 有条件分支不等于 Plums 能编译或正确初始化；未执行各移动 target 的依赖解析/编译，不把锁文件的全部包视为每端都使用 |
| 受检实验副本 Cargo registry 中的锁定包 | 407 个 registry 锁定项中，240 项有源码和归档缓存，167 项两者均缺；240 份缓存清单可读取许可证元数据。缺项包括 jni 0.21.1、ndk 0.9.0、ndk-context 0.1.1、ndk-sys 0.6.0+11769913、tao-macros 0.1.4、objc2-ui-kit 0.3.2、reqwest 0.13.5 | 即使复用该缓存，也不足以宣称移动离线构建可行；167 是整份锁文件的缺项数，不是某端实际所需下载数。缺失包的源码、许可证正文与移动实现不能在现有缓存中核验；完整传递依赖/分发义务仍未审计 |
| 缓存 wry 的 custom_protocols 文档、[资源 URL](../extensions/ui/default.js)、[CSP](../src-tauri/tauri.conf.json) | 上游文档区分 iOS 与 Android 自定义协议的 Origin 表达；目录、模块相对导入和样式均经应用资源 URL 加载 | 两端分别检查 fetch/import/CSS 的 Origin、MIME、CSP 和资源路径；不靠关闭 CSP、忽略版本冲突或启动开发服务器掩盖打包失败 |
| [Rust 入口](../src-tauri/src/lib.rs)、[状态层](../src-tauri/src/storage.rs)、[主机环境包装器](../scripts/environment.mjs) | 有 mobile_entry_point；默认状态根取 app_data_dir，缓存 Tauri 路径代码存在 Android/Apple 解析路径。读写使用 std::fs、锁、修订检查和临时文件替换。桌面包装器会设置主机 PLUMS_M1_DATA_DIR；应用没有显式前后台/检查点逻辑 | 设备必须使用实际应用数据目录，不能把主机 .dev-data 当作设备路径。挂起期间计时、取消、提交回执和进程重建仍待观察；无持续后台执行承诺 |

来源核对范围为锁文件的 npm registry URL、crates.io registry 标识和完整性字段，以及已缓存核心包的仓库/许可证元数据，不是供应链安全认证。复核入口是上述固定版本的清单、包源码及 CLI 帮助，缓存路径本身不属于分发物。许可证字段与文件存在性检查不等于已确认全部分发义务；不据缺失正文补写许可结论。本地 CLI schema 的默认最低值为 iOS 15.0、Android API 24，不是 Plums 已验证的最低支持范围。

## Android 隔离构建记录

2026-10-15 UTC，基于主项目提交 `cd6fb7c76cfd26bec0c956f55b056c0d5e064ec5` 的隔离副本完成调试构建。49 文件基线摘要仍为上节所列值；副本在该 49 文件范围内仅更改 tauri.conf.json 的应用标识、产品名与窗口标题，变体摘要为 `f8317b1f84cde4a31c90b3dcc766d70c03bcd806196bfb663f508322c49015f7`。Host、SDK、扩展、Rust 实现及 npm/Cargo 锁文件未改。

生成工程的 BuildTask.kt 从 src-tauri 工作目录运行 Node，原首参数 `tauri` 指向不存在的脚本；修正为 `../node_modules/@tauri-apps/cli/tauri.js`。隔离回归在修正前复现失败，修正后及真实 CLI 帮助通过；这是生成构建工具入口修正，未修改内核。另仅在生成工程配置独立调试签名、受限 Gradle 资源和相同版本 wrapper 的已校验本地归档；保留模板兼容标志。重新 init 后须重新审阅生成配置并应用这些调整。

| 已检查项 | 结果与边界 |
| --- | --- |
| 编译与 APK | Rust ARM64 编译/链接、Gradle 构建、ZIP 完整性和调试签名检查通过；标识 dev.plums.plums.androidcheck，minSdk 24 / targetSdk 37，实际 ABI 仅 arm64-v8a。调试产物不代表发布包优化或最低支持范围已验收 |
| 前端资源 | 13 项资源经编码解码与原生库嵌入核对；其中 7 个扩展 JS、1 个 CSS 与源码一致。APK 内原生库摘要与受检 Rust 产物一致，将资源检查绑定到该 APK；不证明 WebView 已成功加载或执行 |
| APK SHA-256 | `ca1cb7d861db671e65be8956c6ad3558e0bc470434739dda4a12a04cb1cb48f2` |
| 未执行 | 设备/模拟器安装与启动，ESM/CSP/MIME/Origin/Web API，原生桥接、状态保存及重启，依赖/布局替换与停用清理，前后台及进程重建 |

构建、配置、产物与资源证据保存在独立实验目录的 `RESULTS.md`、`evidence/BUILD-RESULT.json`、`evidence/VARIANT-SOURCE-MANIFEST.json`、`evidence/GENERATED-CONFIG-REVIEW.json`、`evidence/APK-VERIFICATION.json` 和 `evidence/NATIVE-RESOURCE-EMBEDDING.json`；这些是相对实验目录的本地记录，不属于仓库内 Mac 证据，也未随 Git 分发。独立复核报告 `INDEPENDENT-REVIEW.md` 及配套证据也保存在该实验目录；已独立核对 APK/资源、生成配置、入口正反例和两份公开文档，未发现范围内阻塞。未独立重跑完整 Android 构建、从零初始化或离线重建，不承诺重建字节相同；设备运行未验证，iOS 暂缓，M1 保持开放。

## 最小 iOS 与 Android 实验

Android 已完成构建前提及产物检查，以下安装与运行步骤尚未执行；iOS 暂缓，未执行这些步骤。两端各选一个明确的 OS/WebView 与 ABI；模拟器和真机分别记录，先做随包本地扩展，不引入远程下载代码、稳定 SDK 或新业务。实验副本使用独立标识（例如 dev.plums.plums.ioscheck / dev.plums.plums.androidcheck）及合成数据；源码变化、生成工程和最终有效配置均留摘要，不能与原 Mac 包混称。

| 步骤 | 操作与可观察结果 | 失败或阻塞判据 |
| --- | --- | --- |
| 1 环境与构建前提 | 记录开发工具、Rust target、SDK/NDK/JDK、设备/模拟器、签名条件及 WebView；审阅生成工程与有效移动配置 | 工具、许可、签名或依赖缺失记阻塞；初始化失败不能跳过后标通过 |
| 2 随包启动与加载 | 在无 Vite/Node 开发服务的条件下安装原生产物；读取 catalog，加载 ESM、相对导入和样式，启动默认组合并切换画布 | 资源、MIME/CSP、模块语法或所用 Web API 不可用，必须依赖主机服务，或只能显示静态壳，即该配置失败；记录真实 Origin 和失败 API |
| 3 原生桥接与状态 | 用现有 grant/state.read/state.write 路径保存固定文本；确认设备应用数据或原生调用返回值。若缺可观察入口，可另建公开 SDK 诊断夹具调用 platform.info，夹具属于后续实验且尚未实现 | 走浏览器适配器、只看标签、写到主机路径或回执与实际状态不一致均不能通过；无法观察则保留未验证 |
| 4 替换与释放 | 原生 UI 替换文本服务和布局，再停用提供者；消费者等待，登记资源/任务归零，恢复后重新绑定，重复一轮 | 残留调用、重复订阅、界面不可恢复，或清理失败却显示完成，判失败；本步骤不扩大为全部组合矩阵 |
| 5 拒绝与重启 | 使用现有应用内撤权/故障注入，确认失败反馈及原数据保留；恢复权限后保存，再终止并重开同一原生产物 | 拒绝时假成功、旧数据被覆盖、正常重启无法读取已确认保存的数据，判失败；不把应用内能力当 OS 授权 |
| 6 最小生命周期观察 | 在现有短任务期间切到后台再返回，并在已保存后结束进程、重开。分别记录任务是否真的跨过切换、进程是否重建、最终数据和状态 | 未实际形成时间窗口就记未覆盖；不能解释的永久运行状态、错误保存结论或数据丢失判失败。系统挂起导致任务不持续并非自动失败，但必须如实限制执行条件 |

模拟器可形成该模拟器内的原生加载/桥接证据；实际设备的前后台、系统回收、触控和授权结论不能由它替代。普通任务终止/重启也不是写入中断或完整崩溃恢复测试。所选系统的 API 缺失可导致提高候选最低条件或增加兼容适配，必须记录决策并重验，不能静默改成通过。

### 构建命令

@tauri-apps/cli 2.12.3 的 Android init/build 已在隔离副本执行；iOS 命令仍仅核对 `--help`，暂不执行。以下从实验项目根目录调用锁定 CLI；先配置该进程的 Rust、JDK、SDK/NDK 与独立缓存，取消桌面 PLUMS_M1_DATA_DIR 覆盖，不改全局设置。生成工程需先审阅，Android 的已知入口修正见构建记录。

```sh
node node_modules/@tauri-apps/cli/tauri.js ios init --skip-targets-install
node node_modules/@tauri-apps/cli/tauri.js ios build --debug --target aarch64-sim --no-sign --archive-only
node node_modules/@tauri-apps/cli/tauri.js android init --skip-targets-install
node node_modules/@tauri-apps/cli/tauri.js android build --debug --target aarch64 --apk -- --locked
```

`-- --locked` 将锁文件约束传给 Cargo；尾部参数不是 Gradle 参数，Gradle 资源设置放在生成工程的 gradle.properties。iOS 命令候选针对 Apple Silicon 模拟器，使用构建输出的实际 .app 路径安装到所选模拟器；Android aarch64 对应所选 ARM64 模拟器或已确认设备，使用实际 APK 路径安装。签名、安装、运行与退出结果分别留证，不能把无签名归档当作已安装运行。`--skip-targets-install` 只跳过 Rust target 安装，不保证初始化不下载或安装其他辅助依赖；不使用 `--ci` 自动越过交互，也不使用 `--ignore-version-mismatches`。任何额外下载、许可或设备安全授权先单独核对。

### 环境补齐的最小方案

| 平台 | 首个实验所需增量 | 仍待确认及下载量 |
| --- | --- | --- |
| iOS | 完整 Xcode 与一个所选 iOS Simulator runtime；Apple Silicon 模拟器仅先补 aarch64-apple-ios-sim。用实验进程的 DEVELOPER_DIR 选择 Xcode，不切换全局开发目录。真机实验才另补 aarch64-apple-ios、设备与签名条件 | Xcode 与主机兼容版本、辅助生成/安装工具及签名需求在执行前核对；CLI 初始化可能涉及辅助依赖，不能仅凭帮助列出完整安装清单。下载量、安装后空间均未知，需按实际选定版本确认 |
| Android | 已补齐命令行构建环境：JDK 21.0.12.1、NDK 28.2、SDK platforms 37/36、build-tools 36、platform-tools 与 ARM64 Rust target；生成 wrapper 9.6.1 / AGP 9.3.1。Tauri Android 库另需 platform 36，应用 compile/target 仍为 37 | 运行实验尚需所选且获授权的 ARM64 设备，或另行确认 Emulator 与 ARM64 system image。Android Studio 不是命令行构建必需项；设备条件、WebView、后续下载与空间增量仍待核定 |

仅安装所选 ABI 所需组件，不预装全部 Rust targets 或多个系统镜像。接受平台许可、下载额外依赖、设备配对/调试、Developer Mode、安全权限或签名账户操作均须单独确认；实验不需要发布到应用商店。iOS 环境仍未补齐；Android 命令行构建环境已就绪，设备运行条件未就绪。

### 阶段边界与记录

M1 剩余门槛是两端各自的早期原生风险实验及据此作出的选型/限制结论；Android 构建通过仅关闭编译与包检查项，运行风险仍开放；iOS 暂缓不等于免除门槛。按 [路线图](ROADMAP.md)，Windows/Linux 完整原生验收和 A11 五端能力矩阵属于后续阶段。全量迁移、写入中断后的崩溃恢复、多进程并发、实际原生丢失回执注入、文件/OS 授权与长期后台任务不作为追加的 M1 完整功能门槛；已有有限契约一旦被反例推翻，仍须修复或收紧保证。

每端记录基线/差异与单一负责人、锁定依赖及新增下载、最终配置、OS/ABI/设备或模拟器/WebView、产物摘要、安装与操作步骤、实际原生结果、失败/阻塞和未覆盖项。完成编译或执行一次正常路径不自动关闭所有条目，不以旧 Mac 绿测或本节方案替代实际记录。

## 原型限制

- 布局选择和业务状态可保存，提供者选择及整套组合配置不持久化，启动后需重新授予应用内实验能力。
- 安装管理仅加载本地目录中的模块；不存在正式包签名、远程安装市场或稳定 SDK 发布。
- 凭据服务、真实文件选择器和操作系统授权弹窗未实现；当前权限是应用内实验能力。
- 操作信号可取消合作式任务；原生状态写入派发后为不可取消提交段。成功回执必须显示已保存，回执丢失按结果未确认处理，不自动重试。详见 [失败语义](EXTENSION-CONTRACTS.md#m1-已实现的失败语义)。
- 现有状态 schema 拒绝未知版本并保留数据，尚无完整升级迁移工具；不承诺崩溃后一切自动恢复。
- macOS 仅完成证据所列的最小原生路径；移动生命周期、离线长任务与资源强制限额仍待验。角色卡与多 Agent 业务不在 M1 实现范围。

## 依赖失效原生夹具

组合路径通过测试扩展同时提供服务与视图，再建立两级消费者；仍健康的通知服务在取消时同步发布事件。失效时在任何取消监听器执行前关闭全受影响图的工作入口，再通知取消并串行释放；清理失败保留所有者诊断，不能因更换提供者而复活失败链路。

原生验证使用独立副本：保持 Host/SDK/App/Rust 内容不变，将 `tests/fixtures/` 的两个 JS 文件复制到 `extensions/fixtures/`，向目录追加夹具导出的四个 catalog 项，只修改 Tauri 产品名、窗口标题及独立标识 `dev.plums.plums.chain-check`，随后执行既有调试包构建命令。验证变体与普通候选包分别绑定摘要和观察，见 [配方与产物](../evidence/dependency-native.json) 及 [证据](../evidence/RESULTS.md)。不把测试目录项加入普通运行目录。
