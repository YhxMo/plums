# Plums 工程状态

核对日期：2026-10-15 UTC。0.0.2 基于 `main` @ `ea0bdb7a6e0cceb39ec63bbe5567326095223727` 完成；阶段提交后的版本以本地 Git HEAD 为准。未推送或部署。

## 当前可用结果

整体 UI 已统一工作区、扩展管理、授权、运行状态和启停恢复。桌面工作区/管理侧栏分别滚动，窄屏切页保留草稿；默认工作台及画布使用公开实验契约，仍可整体替换。设计与所有权见 [UI](docs/UI.md)、[架构](docs/ARCHITECTURE.md)及[扩展契约](docs/EXTENSION-CONTRACTS.md)。

Android 构建回调、独立调试签名、受控生成准备和系统栏/IME Insets 已纳入主项目，复用既有 YHX 工具链。维护受版本控制的 `native/android/MainActivity.kt` 及脚本；生成工程继续忽略。iOS 暂缓，M1 保持开放，M2 未开始。

## 复现与交付入口

先执行 README 的前端命令。Mac 使用既有 `npm run native -- build --debug --bundles app`；原生实验使用隔离数据。Android 设置 `PLUMS_ANDROID_TOOLS_ROOT` 后，首次执行 `npm run android:init`，后续 `npm run android:build`；已有生成工程可单独 `npm run android:prepare`。缓存、签名、工具版本和模板变更处理见 [ANDROID](docs/ANDROID.md)。

根 `release/` 当前包含：

| 平台 | 当前交付 | 身份 |
| --- | --- | --- |
| Apple Silicon Mac | `Plums M1 0.0.2.app` | Plums M1 / dev.plums.plums |
| Android ARM64 | `plums-m1-0.0.2-android-arm64-debug.apk` | Plums M1 / dev.plums.plums |

均为 0.0.2 / M1 调试原型。先查看本地扩展，再发起并确认授权，运行合成文本；管理页可检查状态、停用和重新授权恢复。包、使用说明、校验清单集中于 release；公开元数据见 [产物记录](evidence/ui-android-artifacts.json)。

已确认的 0.0.1 旧交付副本及其说明/清单移至 `.cache/replaced-release/0.0.1-20261015T124113Z/`，保留恢复路径和原实验产物。原先打开的旧 Mac 应用进程未终止；新版本从带 0.0.2 名称的包打开。本任务 Mac 验证进程、Android 模拟器及专用 ADB 已退出，相关端口已核对关闭。

## 验证与证据

[当前证据](evidence/UI-ANDROID-0.0.2.md)绑定 54 文件集合 `bee72fd6058978056caca4305379183a3f4ce1f1f677e8eb0bd2756ca86f2b77`，记录基线/差异、执行命令、平台、原生结果与独立审查范围。45 项单元、17 项浏览器、6 项 Rust、构建、Prettier、Clippy、rustfmt 与工程检查通过；独立源码审查未发现阻塞问题。旧结果保留于 [M1 索引](evidence/RESULTS.md) 的 0.0.1 历史部分及历史源码清单。

Mac 最终包分别验证授权取消/焦点、Rust 保存、停用零资源/任务、恢复及画布冷启动。Android 最终包在 API 36 / ARM64 / WebView 133.0.6943.137 单配置模拟器验证同一路径，并核对真实系统栏/键盘几何。模拟器与真机范围分开；浏览器结果不替代原生。

本地原始证据位于忽略的 `evidence/raw/ui-android-0.0.2/`，两端最终构建日志在 `.cache/`。Android 隔离运行克隆保存在 `.cache/android/runtime/`。旧 0.0.1 外置实验及 Insets 复现配方仍见 [历史实验记录](docs/M1-EXPERIMENTS.md#android-隔离构建记录)，当前包使用新的正式入口。

## 后续条件与缺口

工程维护者接续时先核对实际文件和当前 HEAD。Android 真机、其他系统/WebView/ABI、横屏/手势导航尚无运行证据；需具备对应设备/配置后按 [验收矩阵](docs/ACCEPTANCE.md) 分别验证。iOS 环境未就绪且继续暂缓；恢复推进时再补早期原生实验。Windows/Linux 无原生运行证据。

提供者选择和整套组合配置不持久化；完整状态迁移、写入中断/崩溃恢复、多进程并发、凭据服务、文件/OS 授权及长期后台仍未完成。M1 剩余门槛是 iOS 早期实验与依据现有证据收敛的选型/限制结论，详见 [阶段边界](docs/M1-EXPERIMENTS.md#阶段边界与记录)。
