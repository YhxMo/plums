# Plums 工程状态

核对日期：2026-10-24（Asia/Singapore）。当前只收口 macOS arm64 应用本体，Android 冻结。分支 `feat/ui-refresh`；本候选已分主题提交。2026-10-23 起历史统一使用 `dev.plums.plums` 命名，改写前的包与本地数据仍是旧名，见[历史提交与交付来源](docs/DEVELOPMENT.md#历史提交与交付来源)。

[文档导航](docs/README.md) · [当前阶段](docs/spec/milestone.md) · [整体路线](docs/spec/total.md) · [当前交付](evidence/RESULTS.md)

## 当前开发候选

相对已交付 0.2.0 的主要变化；行为细节只在所链接的文档维护。

- **命名与数据目录**：标识符改为 `dev.plums.plums`，桌面首次启动复制改名前的旧数据（[规则](docs/ARCHITECTURE.md#应用数据目录)）；Rust 单元测试与 debug 二进制在假 HOME 下的实际复制已验证。
- **API Key 存储**：改为数据根内 0600 的 `credential-secrets.json`，不使用 Keychain（[凭据契约](docs/CREDENTIAL-BINDINGS.md#填写与存储)）。
- **输入与弹窗**：密钥输入可显隐、中文输入法组词不触发发送或关闭、Option-Tab 焦点循环与 Escape 逐层关闭（[UI](docs/UI.md#列表交互与详情)；Radix 补丁见[开发流程](docs/DEVELOPMENT.md#上游依赖补丁)）。
- **扩展管理**：768px 起列表与详情两栏，补齐内置扩展的用途介绍（[UI](docs/UI.md#菜单外观与扩展管理)）。
- **默认组合**：打包只含 Agent 核心、模型连接和 Agent 界面；文本工作台、回显模型等只在开发目录。
- **联系人式回复**：回复整条送达，等待时会话头部显示“正在输入”、列表头像为橙色状态点；切走后到达的回复显示未读数并随会话保存；停止即撤回、不留消息（[UI](docs/UI.md#列表交互与详情)）。

## 本候选验证

| 范围 | 实际结果 |
| --- | --- |
| Web | 最新提交上 `npm run verify:web` 通过（936 单元及类型、构建、发布配置、格式、边界、行数、lint），构建无单块体积警告 |
| 原生逻辑 | Agent 记录存储提交上 `npm run verify:native` 通过：IPC、格式、Clippy、84 单元（含 11 项记录与批量写用例）；SQLite 第一步时 debug 应用在真实格式开发数据副本上导入 `host.shell`（修订 11）并在其上保存，版本 1 → 2 的原地升级只有单元验证 |
| Chromium | 联系人式回复审查提交 `d249c04` 上 `npm run verify:e2e` 全量 241 项通过（1 worker）；7a–7c 只跑了相关的 spec，见各提交说明 |
| WebKit | 7a–7c 期间只跑了相关的 spec（见各提交说明）；已知失败：agent-flow 的“dialog close is quiet…”浅深两项，界面改版前已存在，未修 |
| 启动耗时 | 生产构建、浏览器冷启动 20 次中位数：Chrome 97.6 → 85.8 ms，WebKit 81 → 70 ms（按需加载与分块前后） |
| 打包应用 | 改名前候选的实测见[输入法、焦点与布局记录](evidence/MAC-INPUT-LAYOUT-2026-10-23.md)；改名后的源码尚未重新打包验收 |

## 未验范围

各子系统文档只记录契约与回归测试，平台和打包应用的未验项统一列在这里；已交付包的受验范围见[交付入口](evidence/RESULTS.md)，Android 冻结期间的待补项见 [Android 工程](docs/ANDROID.md#构建和设备)。改名后首个打包验收至少覆盖前两项。

- **数据迁移**：读取 `dev.plums.m1` 旧数据并保留原目录、旧 JSON 文档导入 SQLite 并移入 `legacy-json/`、已有版本 1 库升级到版本 2、真实旧 Agent 数据（version 3 消息页）在下次保存时转为记录、复制失败弹窗。
- **存储**：断电与写入中途崩溃时的一致性依赖 SQLite，未实测；正常重启与转换前中断不证明这一点。
- **窗口与界面**：Mac 窗口按钮避让依 `platform.info`、点击后归还焦点无焦点环（WKWebView）、明暗抽查与 WKWebView 遮罩绘制、应用内启动耗时；VoiceOver 暂缓。
- **模型与凭据**：应用内填写与文件存储后的真实模型调用（2026-10-17 的真实调用基于已退役的钥匙串存储，不证明当前路径）；带密钥获取模型列表与 models.dev 窗口填写；长上下文、图片和思考强度的服务兼容；统一日志无密钥未被正面证明（当时扫描时段无该进程条目）。实际账户调用须先确认目标、次数和输出上限。
- **扩展包导入**：打包应用中“选择文件夹”（`webkitdirectory`）与拖入文件夹（`webkitGetAsEntry`）在 WKWebView 中的实际行为；浏览器回归只覆盖文件夹选择、拖入 zip 与两个文件。
- **平台能力**：打包应用经 `network.read` 读取 models.dev；会话内文档选择（NSOpenPanel 与文件读取）未在当前源码的打包应用中重验。
- **分发**：正式签名与公证。

## 进行中与下一步

路线已改为按用户能做到什么排序的[四级阶梯](docs/spec/total.md#路线阶梯)；当前是第 1 级“认识你的联系人”（Mac 第一版），顺序与剩余内容只在[当前阶段](docs/spec/milestone.md#第-1-级mac-第一版)维护。

- **已完成**：规范化改造，包括统一命名与历史改写、旧数据迁移、工程小项（版本号、ESLint、别名、`public/`、Radix 补丁跟踪、断点、平台检测、按需加载）、SQLite 存储与记录能力（[SDK 参考](docs/SDK-AUTHORING.md#状态取消与演进)）、扩展包格式（[作者入门](docs/AUTHOR-QUICKSTART.md)）、界面改版（[UI](docs/UI.md)、[主题契约](docs/THEMES.md)、[页面契约](docs/PAGES.md)）、联系人式回复；对话体验的 7a–7c（列表按最近活跃排序、按会话忙碌与会话改名、只在底部时跟随滚动），行为见 [UI](docs/UI.md#列表交互与详情)。各阶段的审查结论记在阶段 U 的 `4f4bc97` 及各阶段审查提交的说明里。
- **当前焦点**：打包检查点，按当前源码重建隔离候选，在打包应用里验证迁移和真实模型调用；之后是窗口框架实验，再继续对话体验剩余项。
- **遗留**：`AgentWorkspace.tsx` 与 `AgentDialogs.tsx` 超过 400 行提示线，`modules/agents/store.ts` 接近；外壳右侧栏按钮的 18px 偏移与会话卡片几何耦合，随窗口框架处理；`View.icon` 无效原因是英文作者提示，在中文界面中原样显示；WebKit 下 agent-flow 的“dialog close is quiet…”两项失败（Tab 未聚焦弹窗关闭按钮），界面改版前已存在；此前导入的单文件扩展的源码分片（`host.shell` 的 `x-` 文档）不再读取，也不自动清理。

当前未推送，现有交付包未替换，第 1 级尚未完成。

## 当前交付与恢复

`release/mac-manual-2026-10-23/` 的手测候选已失效：它是改名前构建的，启动脚本指向的 `.m1-data/` 已改名。将由[打包检查点](docs/spec/milestone.md#第-1-级mac-第一版)按当前源码重建的候选替代，在此之前不做所有者手测。

已交付 0.2.0 来自 `6668ce7`，Mac 入口 `release/mac/Plums.app`，本次未替换；Android 包仅保留其原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包保留在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`；恢复包不自动回滚数据，操作规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

既有交付的原始提交与当前历史的对应关系见[开发流程](docs/DEVELOPMENT.md#历史提交与交付来源)。
