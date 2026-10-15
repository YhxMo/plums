# Plums 工程状态

核对日期：2026-10-16 CST（2026-10-15 UTC）。当前 0.0.4 受验运行源码为 `main` @ `de686c70fb5a8f08615b8377e8b847fcbf025d95`，基线为 `983c9dc9281f1aaed7e04355452c6b14338a2a24`；后续提交仅更新证据与交接，以实际 Git 状态为准。未推送或部署。

## 当前可用结果

默认 UI 已转为 Agent 列表、会话和可折叠详情；手机采用列表/会话切页，详情为模态。空状态提供角色卡导入、扩展安装，“添加”创建角色；特别关注为多个头像快捷入口加星标。白底橙色梅子图标、浅灰/白与橙色浅色主题、暖炭灰深色主题保留；外观切换保存且保留草稿。

顶栏菜单包含扩展管理、角色卡设置、应用设置、诊断工具和关于。角色卡设置可集中选择角色、编辑名称与说明、导入 JSON 文件并查看来源和能力。原工作台/画布留在设置与诊断路径；默认 UI 使用公开视图契约，扩展视图可优先替换。角色提供者通过扩展层 `agents@1` 服务与 `withAgents(ctx)` 接入，Host 和 Rust 不解析角色卡。设计与边界见 [UI](docs/UI.md)、[架构](docs/ARCHITECTURE.md)及[契约](docs/EXTENSION-CONTRACTS.md#m1-agent-服务契约)。

当前内置 Agent 只执行本地文本转换，模型/MCP 客户端和 A2A 尚未实现。角色说明不代表模型能力或授权。同源可信 ESM 安装路径可恢复；外部扩展授权与启用仍需明确操作。Agent、会话、关注、主题、布局和安装路径共用串行状态保存，未知写入回执会阻止继续写入直至重载。完整组合和提供者选择未持久化。

Android 正式入口继续复用既有 YHX 工具链。MainActivity 管理系统栏/IME Insets，外观插件同步背景与图标亮度；受控准备可升级仅浅色背景不同的已知前版，未知代码仍拒绝覆盖。图标生成维持单一橙色源。iOS 暂缓，M1 保持开放，M2 未开始。

## 复现与交付入口

前端与 Mac 命令见 [README](README.md)。Android 设置 `PLUMS_ANDROID_TOOLS_ROOT` 后使用 `npm run android:init` / `npm run android:build`，已有生成工程可单独 `npm run android:prepare`；缓存、签名与模板维护见 [ANDROID](docs/ANDROID.md)。

根 `release/` 当前包含：

| 平台 | 当前交付 | 身份 |
| --- | --- | --- |
| Apple Silicon Mac | `Plums M1 0.0.4.app` | Plums M1 / dev.plums.plums |
| Android ARM64 | `plums-m1-0.0.4-android-arm64-debug.apk` | Plums M1 / dev.plums.plums |

均为 0.0.4 / M1 debug。说明与校验清单在该目录；公开 [产物记录](evidence/ui-android-artifacts.json)绑定上述源码提交。复制完整性、APK 签名/版本/ABI 与实际安装包匹配已核验。

新包验收和清单更新后，已确认的 0.0.3 旧交付及说明/清单移至 `.cache/replaced-release/0.0.3-20261015T170430Z/`，可恢复。更早恢复目录和历史实验原件保留。

最终 Mac 包保留在角色卡设置页面，数据为 `.dev-data/ui-0.0.4-final/`，进程信息位于 `.cache/mac-004-runtime.json`；原生 UI 按完整应用路径绑定。Android 专用模拟器及 ADB 已关闭，5042/5562/5563/9232 端口已核对退出；克隆保留在 `.cache/android/runtime-004/`。

## 验证与证据

[当前证据](evidence/UI-ANDROID-0.0.4.md)记录 56 项单元、35 项浏览器、6 项 Rust、两端构建、格式、Clippy、rustfmt 与工程检查通过。最后仅会话输入焦点 CSS 改动，18 项相关浏览器测试、截图及两端重建/运行复验通过；其余结果经影响评估保留。独立源码与定向样式复核无剩余阻塞，精简已完成。历史版本在 [M1 索引](evidence/RESULTS.md)分开留证。

Playwright 覆盖 1440/375 双主题与主要页面，320/768/1024 无横向溢出。Mac 与 Android 分别验证添加、Rust 保存、关注、多会话、角色说明编辑、停用零资源/任务、恢复、诊断授权与新进程恢复。Android 为 API 36 / ARM64 / WebView 133.0.6943.137，实际键盘出现/收起时 WebView 高度随 Insets 变化，输入区可用。短时发送取消使用 WebView DOM 事件，未冒称真实触控时序或原生提交竞态通过。

本地原始证据在忽略的 `evidence/raw/ui-android-0.0.4/`，Android 最终结果位于其 `android-final/`；Mac 最终截图在工具观察中检查，运行状态保存为 JSON。旧外置实验及 Insets 配方见 [历史实验记录](docs/M1-EXPERIMENTS.md#android-隔离构建记录)。

历史早期预览曾使用默认实验目录且缺少前后快照，其授权状态写入情况无法确认，未据猜测覆盖或恢复。0.0.4 原生验收使用上述独立目录与 AVD 克隆。

## 后续条件与缺口

Android 真机、其他系统/WebView/ABI、横屏/手势导航尚无运行证据；对应设备就绪后由平台维护者按 [验收矩阵](docs/ACCEPTANCE.md)验证。iOS 环境未就绪且继续暂缓；Windows/Linux 无原生运行证据。

模型/MCP 扩展、完整角色卡标准、跨提供者集合和多 Agent 协作未实现；当前实验角色卡格式见 UI 文档。状态快照仍受 64 KiB 限制，完整迁移、写入中断/崩溃恢复、多进程并发、凭据服务、OS 文件授权及长期后台仍未完成。M1 剩余门槛和限制见 [阶段边界](docs/M1-EXPERIMENTS.md#阶段边界与记录)，不能以此次 UI 交付关闭完整 A11/A12。
