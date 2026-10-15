# Plums 工程状态

核对日期：2026-10-15 UTC。0.0.3 基于 `main` @ `8915478b5eaef3697aab4f9170f6b9bdb7566952` 完成；阶段提交后的版本以本地 Git HEAD 为准。未推送或部署。

## 当前可用结果

当前默认方向为白底橙色梅子图标、暖白/陶土橙浅色、暖炭灰/柔和橙深色。顶栏可切换模式，首次取系统外观，手动选择与布局共同持久化；切换保留草稿。桌面工作区/管理侧栏分别滚动，窄屏切页保留已挂载工作区。默认工作台及画布仍使用公开实验契约，可整体替换。设计与所有权见 [UI](docs/UI.md)及[架构](docs/ARCHITECTURE.md)。

Android 构建继续复用既有 YHX 工具链。系统栏/IME Insets 由 MainActivity 管理，新增外观插件同步根背景与系统栏图标亮度；现有生成工程也会刷新启动器图标。图标只有一个橙色源，`npm run icons` 生成 Mac、Android 和 Web 资源。受控源码与脚本纳入 Git，生成工程继续忽略。iOS 暂缓，M1 保持开放，M2 未开始。

## 复现与交付入口

先执行 README 的前端命令。Mac 使用既有 `npm run native -- build --debug --bundles app`；原生实验使用隔离数据。Android 设置 `PLUMS_ANDROID_TOOLS_ROOT` 后，首次执行 `npm run android:init`，后续 `npm run android:build`；已有生成工程可单独 `npm run android:prepare`。缓存、签名、工具版本和模板变更处理见 [ANDROID](docs/ANDROID.md)。

根 `release/` 当前包含：

| 平台 | 当前交付 | 身份 |
| --- | --- | --- |
| Apple Silicon Mac | `Plums M1 0.0.3.app` | Plums M1 / dev.plums.plums |
| Android ARM64 | `plums-m1-0.0.3-android-arm64-debug.apk` | Plums M1 / dev.plums.plums |

均为 0.0.3 / M1 调试原型。先查看本地扩展，再发起并确认授权，运行合成文本；管理页可检查状态、停用和重新授权恢复。包、使用说明、校验清单集中于 release；公开元数据见 [产物记录](evidence/ui-android-artifacts.json)。

新包验收和清单更新后，已确认的 0.0.2 旧交付及说明/清单移至 `.cache/replaced-release/0.0.2-20261015T144431Z/`。0.0.1 恢复目录和历史实验原件保留。

最终 Mac 包保留打开，数据为 `.dev-data/ui-0.0.3-appearance/`，当前进程信息位于 `.cache/mac-003-runtime.json`；原生 UI 绑定完整应用路径。Android 专用模拟器及 ADB 已关闭，5042/5562/5563/9232 端口已核对退出；克隆保留在 `.cache/android/runtime-003/`。

## 验证与证据

[当前证据](evidence/UI-ANDROID-0.0.3.md)绑定 77 文件集合 `370a2889ea089c6bc8b0940d72f84042f1d5b9c5ab76abbb85c8897b629228d2`。48 项单元、22 项浏览器、6 项 Rust、两端构建、Prettier、Clippy、rustfmt 与工程检查通过；独立源码审查无剩余阻塞。历史结果与对应版本清单保留于 [M1 索引](evidence/RESULTS.md)。

浏览器实际截图覆盖深浅两套外观、1440/375 宽度和主要页面。Mac 最终包验证外观同步、Rust 保存、停用零资源/任务、恢复与新进程读取 dark/board/结果；Android 最终 APK 在 API 36 / ARM64 / WebView 133.0.6943.137 模拟器验证同一路径，以及授权取消、真实系统栏和键盘几何。具体候选和最终包覆盖分列于证据。

本地原始证据位于忽略的 `evidence/raw/ui-android-0.0.3/`，Android 最终结果位于其 `android-final/`。旧外置实验及 Insets 配方见 [历史实验记录](docs/M1-EXPERIMENTS.md#android-隔离构建记录)。

早期预览曾使用默认实验目录，缺少前后状态快照；该次预览是否写入授权状态无法确认，未据猜测覆盖或恢复数据。最终验收使用上述独立目录与 AVD 克隆。

## 后续条件与缺口

工程维护者接续时先核对实际文件和当前 HEAD。Android 真机、其他系统/WebView/ABI、横屏/手势导航尚无运行证据；需具备对应设备/配置后按 [验收矩阵](docs/ACCEPTANCE.md) 分别验证。iOS 环境未就绪且继续暂缓；恢复推进时再补早期原生实验。Windows/Linux 无原生运行证据。

提供者选择和整套组合配置不持久化；完整状态迁移、写入中断/崩溃恢复、多进程并发、凭据服务、文件/OS 授权及长期后台仍未完成。M1 剩余门槛是 iOS 早期实验与依据现有证据收敛的选型/限制结论，详见 [阶段边界](docs/M1-EXPERIMENTS.md#阶段边界与记录)。
