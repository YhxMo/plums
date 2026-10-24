# Plums 工程状态

核对日期：2026-10-25（Asia/Singapore）。当前只收口 macOS arm64 应用本体，Android 冻结。分支 `feat/ui-refresh`；本候选已分主题提交。2026-10-23 起历史统一使用 `dev.plums.plums` 命名，改写前的包与本地数据仍是旧名，见[历史提交与交付来源](docs/DEVELOPMENT.md#历史提交与交付来源)。

[文档导航](docs/README.md) · [当前阶段](docs/spec/milestone.md) · [整体路线](docs/spec/total.md) · [当前交付](evidence/RESULTS.md)

## 当前开发候选

相对已交付 0.2.0 的主要变化；行为细节只在所链接的文档维护。

- **命名与数据目录**：标识符改为 `dev.plums.plums`，桌面首次启动复制改名前的旧数据（[规则](docs/ARCHITECTURE.md#应用数据目录)）；Rust 单元测试与 debug 二进制在假 HOME 下的实际复制已验证。
- **API Key 存储**：改为数据根内 0600 的 `credential-secrets.json`，不使用 Keychain（[凭据契约](docs/CREDENTIAL-BINDINGS.md#填写与存储)）。
- **输入与弹窗**：密钥输入可显隐、中文输入法组词不触发发送或关闭、Option-Tab 焦点循环与 Escape 逐层关闭（[UI](docs/UI.md#列表交互与详情)；Radix 补丁见[开发流程](docs/DEVELOPMENT.md#上游依赖补丁)）。
- **扩展管理**：768px 起列表与详情两栏，补齐内置扩展的用途介绍（[UI](docs/UI.md#菜单外观与扩展管理)）。
- **默认组合**：打包只含 Agent 核心、模型连接和 Agent 界面；文本工作台、回显模型等只在开发目录。
- **联系人式回复**：回复整条送达，等待时会话头部显示“正在输入”、列表头像为橙色状态点；切走后到达的回复显示未读数并随会话保存；停止即撤回、不留消息（[UI](docs/UI.md#列表交互与详情)）。

- **回复排版与外链**：回复按 Markdown 排版，只有 https 链接可点，经宿主能力 `link.open` 在默认浏览器打开（[UI](docs/UI.md#列表交互与详情)、[平台能力](docs/EXTENSION-CONTRACTS.md#平台能力与可选助手)）。
- **审查修复**：版本 2–4 模型记录保留已存的输出上限（检查点那次“上限未生效”即因旧升级把 1024 换成了 `null`；已被那个候选保存过的记录不会恢复）；旧 JSON 首次导入在目录不可读时中止并可重试；浏览器批量写逆序回滚；损坏的扩展包可重新导入修复；扩展管理遮住会话时到达的回复计为未读。

## 本候选验证

| 范围 | 实际结果 |
| --- | --- |
| Web | Markdown 提交上 `npm run verify:web` 通过（951 单元及构建、发布内容检查、格式、项目边界、行数与 ESLint）；此前各修复提交各自在暂存内容上通过 |
| 原生逻辑 | 旧 JSON 导入修复提交 `6ca882e` 上 `npm run verify:native` 通过：IPC、格式、Clippy、87 单元；SQLite 第一步时 debug 应用在真实格式开发数据副本上导入 `host.shell`（修订 11）并在其上保存，版本 1 → 2 的原地升级只有单元验证 |
| Chromium | Markdown 提交上跑了相关的 spec（见提交说明）；此前全量 250 项中 246 通过，失败的 4 项是消息选择器，已随 Markdown 提交修正 |
| WebKit | 未读修复时 `agent-pending.spec.ts` 与 `react-view-lifecycle.spec.ts` 共 9 项通过；全量未运行；已知 agent-flow 的“dialog close is quiet…”浅深两项，界面改版前已存在，未修 |
| 浏览器视觉 | Chromium 抽查 375px 浅色与 1280px 深色的回复与草稿；Markdown 的标题、列表、代码块、表格与链接在 1100px 浅深两种外观下截图检查 |
| 打包应用 | `eb5c68b` 的检查点候选在真实改名前数据副本上完成迁移、消息转为记录、一次真实模型调用（输出上限未生效）、文件夹导入与模型窗口填写，见[打包检查点记录](evidence/MAC-CHECKPOINT-2026-10-24.md)；输入法与焦点的实测仍是改名前候选的[记录](evidence/MAC-INPUT-LAYOUT-2026-10-23.md) |

## 未验范围

各子系统文档只记录契约与回归测试，平台和打包应用的未验项统一列在这里；已交付包的受验范围见[交付入口](evidence/RESULTS.md)，Android 冻结期间的待补项见 [Android 工程](docs/ANDROID.md#构建和设备)。

- **自检查点以来的改动**：审查修复与 Markdown 都未在重新打包的应用中验证。
- **数据迁移**：已有版本 1 库升级到版本 2（只影响开发数据，本机无此类库）、复制失败弹窗。
- **存储**：断电与写入中途崩溃时的一致性依赖 SQLite，未实测；正常重启与转换前中断不证明这一点。
- **窗口与界面**：Mac 窗口按钮避让依 `platform.info`、点击后归还焦点无焦点环（WKWebView）、明暗抽查与 WKWebView 遮罩绘制、应用内启动耗时；VoiceOver 第一版不验收，列为已知限制。
- **模型与凭据**：带输出上限的真实调用；在当前版本中新填写密钥后的调用（检查点用的是迁移过来的密钥）；长上下文、图片和思考强度的服务兼容；统一日志无密钥未被正面证明（当时扫描时段无该进程条目）。实际账户调用须先确认目标、次数和输出上限。
- **平台能力**：会话内文档选择（NSOpenPanel 与文件读取）未在当前源码的打包应用中重验；`link.open` 在打包应用中交给默认浏览器只有单元验证。
- **分发**：正式签名与公证。

## 进行中与下一步

当前是[路线阶梯](docs/spec/total.md#路线阶梯)第 1 级（Mac 第一版），顺序与剩余内容只在[当前阶段](docs/spec/milestone.md#第-1-级mac-第一版)维护；自 0.2.0 以来的工作见 git log。

- **当前焦点**：当前阶段第 3 项对话体验的剩余项。打包检查点候选由所有者试用中，反馈可能调整其顺序。
- **遗留**：`AgentWorkspace.tsx` 与 `AgentDialogs.tsx` 超过 400 行提示线，`modules/agents/store.ts` 也已超过提示线；外壳右侧栏按钮的 18px 偏移与会话卡片几何耦合，随窗口框架处理；`View.icon` 无效原因是英文作者提示，在中文界面中原样显示；WebKit 下 agent-flow 的“dialog close is quiet…”两项失败（Tab 未聚焦弹窗关闭按钮），界面改版前已存在；此前导入的单文件扩展的源码分片（`host.shell` 的 `x-` 文档）不再读取，也不自动清理。

当前未推送，现有交付包未替换。

## 当前交付与恢复

当前手测候选是 `release/.mac-MxLDoZ/Plums.app`（`eb5c68b`，0.2.0 arm64 debug / ad-hoc，[检查点记录](evidence/MAC-CHECKPOINT-2026-10-24.md)）。直接打开它会使用正式数据目录，并在首次启动时复制改名前的数据；要隔离数据，就用设置了 `HOME` 或 `PLUMS_DATA_DIR` 的命令行启动包内可执行文件。`release/mac-manual-2026-10-23/` 是改名前构建的，启动脚本已失效，不再使用。

已交付 0.2.0 来自 `6668ce7`，Mac 入口 `release/mac/Plums.app`，本次未替换；Android 包仅保留其原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包保留在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`；恢复包不自动回滚数据，操作规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

既有交付的原始提交与当前历史的对应关系见[开发流程](docs/DEVELOPMENT.md#历史提交与交付来源)。
