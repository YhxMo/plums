# 0.0.2 整体 UI 与 Android 工程验证

[证据索引](RESULTS.md) · [界面](../docs/UI.md) · [Android 工程](../docs/ANDROID.md) · [产物元数据](ui-android-artifacts-0.0.2.json)

执行日期：2026-10-15 UTC。实现、集成与原生验证负责人：Codex 主执行者。独立源码审查者：Kierkegaard（独立执行者，未参与实现）。范围为 A3、A5–A8、A10、A12 的 M1 子集；完整矩阵保持未完成。

## 受验版本与失败条件

基线提交 `ea0bdb7a6e0cceb39ec63bbe5567326095223727`；在该基线上修改应用外壳与两种布局的结构/样式、授权交互、Android 主机脚本/原生模板、版本和对应测试。Host、SDK、平台适配器、Rust 运行实现未改。完整实现/测试/配置集合为 [source-manifest-0.0.2.json](source-manifest-0.0.2.json) 的 54 文件，摘要：

`bee72fd6058978056caca4305379183a3f4ce1f1f677e8eb0bd2756ca86f2b77`

文档与证据本身不在源码集合内，以同一阶段 Git 提交及实际 diff 留证。0.0.1 的旧结果仅绑定[历史清单](source-manifest-0.0.1.json)，不作为新版通过记录。

验收路径是“查看扩展 → 确认能力 → 运行保存 → 查看状态 → 停用 → 重新授权恢复”。反例包括：未确认即授权/启动、取消后仍启用、管理切页丢失草稿、停用后资源/任务残留、恢复丢失已保存结果、布局依赖私有业务 API、系统栏/键盘遮住操作，以及未知 Android 模板被覆盖。

macOS WebKit 实际暴露指针点击后焦点不能返回发起按钮。新增非聚焦激活回归先失败，再通过显式传入事件 `currentTarget` 修复；最终 Mac 包重新核对取消/Escape 的焦点返回。Android 准备脚本先验证全部目标再写入，未知模板/回调/签名/分发均拒绝；不覆盖未知生成修改。

## 覆盖盘点与自动验证

保留既有 39 项单元、12 项浏览器、6 项 Rust 的对外行为断言；浏览器用例仅适配新授权步骤、管理/诊断入口与标题。新增 6 项 Android 准备测试和 5 项应用流程测试。未为视觉 CSS 重复建立实现镜像测试。

| 命令 | 结果 | 范围 |
| --- | --- | --- |
| `npm test` | 45/45，通过 | 既有生命周期/状态/依赖反例；新增准备幂等性、两种 CLI 回调及四类未知配置拒绝 |
| `npm run test:web -- --workers=3` | 17/17，通过 | 完整启停恢复；授权取消/键盘循环/焦点；375/1280 草稿保留；320/768/1440 管理/授权无横向溢出；复用既有替换和故障恢复 |
| `npm run native:test` | 6/6，通过 | 本机 Rust 状态、授权、命名空间、冲突与损坏保留 |
| `npm run build` | 通过 | TypeScript 与 Vite；两端原生构建也执行同一前端入口 |
| `npm run format:check` | 通过 | Prettier |
| `npm run native:check` | 通过 | 本机 Clippy，`--all-targets -- -D warnings` |
| `RUSTUP_TOOLCHAIN=nightly npm run native:fmt` | 通过 | 既有 nightly rustfmt；不改默认工具链 |
| `npm run check:project`、`git diff --check` | 通过 | 文档/链接、清单、空白与指定隐私模式，另做精确暂存人工检查 |
| `npm run native -- build --debug --bundles app` | 通过 | macOS arm64 调试包，复用既有 YHX Cargo 缓存/target |
| `PLUMS_ANDROID_TOOLS_ROOT=<既有工具链> npm run android:build` | 通过 | 当前工作副本的 ARM64 APK；准备、编译/链接和 Gradle；源码输出 target 独立，下载缓存共享 |

原始本地记录在忽略的 `evidence/raw/ui-android-0.0.2/`；构建与 Rust 日志位于 `.cache/macos-build-final.log`、`.cache/macos-tests.log`、`.cache/android/build-final.log`。原始日志、截图、设备数据、生成工程和签名私钥不随 Git 分发。

## 实际渲染与原生结果

浏览器以隔离 Chrome 上下文检查 1440、768、375、320 CSS px 的授权、工作台、扩展管理与画布。桌面两列各自滚动，窄屏管理页切换保留工作区。默认布局按容器可用宽度重排；触控按钮至少 44 CSS px。实际截图已检查。主要正文、次要文字、主按钮与控件边界的计算对比度分别为 13.85、最低 5.41、7.73、3.74；这是指定颜色组合的检查，未作完整可访问性认证。

### macOS 最终包

环境：macOS 27.0.1 / arm64，系统 WKWebView；本地既有 WebKit framework 22625 / 22625.1.29.11.28。测试通过最终打包应用的原生窗口/可访问性树进行，无 Vite 开发服务依赖；数据使用 `.m1-data/ui-0.0.2/`。

| 操作 | 实际结果 |
| --- | --- |
| 查看扩展、取消/Escape 授权，再确认 | 取消不启动，焦点返回发起控件；确认后启动 |
| 输入 `Mac final 002` 并运行 | 显示已保存；Rust JSON 为输出 `MAC FINAL 002`、runs 3、revision 3 |
| 停用 workbench | workbench 已停用，依赖布局等待；各受影响扩展 0 资源/0 任务 |
| 启用 workbench 并授权 | 恢复已保存输入、结果和次数 |
| 原生选择画布、退出进程、重新打开并授权 | 画布、输入、结果与次数 3 恢复；`host.shell` 为 layout board、revision 1 |

最终包版本 0.0.2、标识 `dev.plums.m1`。受验副本与构建源及 release 副本整包内容摘要一致。本任务应用进程已退出；此前已打开的旧包进程未终止。

### Android 最终 APK

构建环境为 macOS arm64、JDK 21、NDK 28.2、Gradle 9.6.1、AGP 9.3.1、compile/target SDK 37。首次在主项目执行 init，随后由正式 `android:build` 重复准备和构建；没有将历史生成工程作为提交源码。

运行环境为 Emulator 37.2.12 / AOSP Android 16 / API 36 / arm64-v8a / WebView 133.0.6943.137。使用原 AVD 的隔离只读克隆和独立 ADB 端口，不覆盖历史实验；当前包标识 `dev.plums.m1`，与历史 androidcheck 分开。真实 ADB 触控/键盘与 WebView CDP 检查共同留证。

| 操作 | 实际结果 |
| --- | --- |
| 查看模块、取消授权、再授权 | 未确认不启动；能力及模块详情可见 |
| 原生键盘输入 `native_android_002` 并保存 | Rust 设备 JSON 的 output 为 `NATIVE_ANDROID_002`、runs 2、revision 2；localStorage 为空 |
| 停用 workbench，再启用并授权 | 受影响扩展 0 资源/0 任务，恢复已保存结果 |
| 原生下拉选择画布，force-stop 后新进程启动并授权 | 画布与保存结果恢复 |
| 系统栏与 IME | WebView bounds 从 `[0,136][1080,2208]` 变为 `[0,136][1080,1428]`，键盘关闭后恢复；393 CSS px / DPR 2.75，视口高度 754→470→754 |

APK 的 ZIP CRC、v2 调试签名、包名/版本/ABI 检查通过；设备安装 APK 与最终构建 APK 的 SHA-256 相同。minSdk 24 仅是清单声明。本配置采用三按钮导航；真机、其他导航、横屏、其他系统/WebView/ABI 未验证。

模拟器克隆的早期冷启动曾出现 “System UI isn't responding”，选择 Wait 后系统界面恢复，随后上述应用验证通过；这不构成所有模拟器冷启动均稳定的结论。本任务模拟器及专用 ADB 已关闭，PID 和 5042/5562/5563/9232 端口退出已核对，AVD 克隆与历史实验保留。

## 独立审查与精简

独立审查核对应用授权/焦点、视图挂载/恢复、管理显示、容器布局、Android 准备与文档，并实际执行 45 项单元测试。针对最终焦点修正和布局收敛再次核对，结论为无阻塞问题。其余浏览器、Rust、构建和原生操作为主执行者证据，未冒称独立重演。

精简检查沿实际调用路径核对状态与抽象：保留承载首次启动/停用后恢复语义的 `started`，复用既有 Host/SDK 和布局绑定；测试共用管理/授权辅助入口，Android 准备集中验证后写入。不新增组件框架、私有业务入口或生成工程副本。未发现需要额外实现的精简项。

## 交付与剩余范围

该版本的本地交付为 `release/Plums M1 0.0.2.app` 和 `release/plums-m1-0.0.2-android-arm64-debug.apk`，约 28.88 MiB 与 253.28 MiB，均为 debug。版本、身份、签名证书和复制完整性见[历史产物元数据](ui-android-artifacts-0.0.2.json)；后续替代后的存放状态见当前交接。0.0.2 验证并更新清单后，已确认的 0.0.1 旧副本及其清单/说明移至 `.cache/replaced-release/0.0.1-20261015T124113Z/`，可恢复；实验原件保留。

iOS 继续暂缓；Android 真机/其他配置、Windows/Linux、完整迁移、写入中断/崩溃恢复、实际原生丢失回执、文件/OS 授权和长期后台未验证。提供者选择及整套组合配置仍不持久化；可信 ESM 仍共享环境。M1 保持开放，M2 未开始。后续由工程维护者按原[阶段门槛](../docs/spec/total.md#阶段依赖与退出条件)补足真实条件后推进。
