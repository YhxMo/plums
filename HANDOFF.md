# Plums 工程状态

核对日期：2026-10-24（Asia/Singapore）。当前只收口 macOS arm64 应用本体，Android 冻结。分支 `feat/ui-refresh`；本候选已分主题提交。2026-10-23 起历史统一使用 `dev.plums.plums` 命名，改写前的包与本地数据仍是旧名，见[历史提交与交付来源](docs/DEVELOPMENT.md#历史提交与交付来源)。

[文档导航](docs/README.md) · [当前阶段](docs/spec/milestone.md) · [整体路线](docs/spec/total.md) · [当前交付](evidence/RESULTS.md)

## 当前开发候选

- 标识符改为 `dev.plums.plums`，数据位于平台数据目录的 `data/`。桌面首次启动把改名前 `dev.plums.m1/m1-experiment` 的数据复制过来，旧目录保留；失败时说明并退出。规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。Rust 单元测试与 debug 二进制在假 HOME 下的实际复制已验证；复制失败时的弹窗未实测，打包应用读取真实旧数据待验。
- API Key 使用数据根内独立的 0600 `credential-secrets.json`，保持 schema 1 与原生引用；文件锁内重读后原子保存，损坏或权限过宽时保留原件并拒绝读取。不使用 Keychain。格式、作用域与同用户明文边界见[凭据契约](docs/CREDENTIAL-BINDINGS.md)。
- 模型服务商与扩展凭据共用 `SecretInput`：Eye/EyeOff 只显隐当前草稿，不提交表单；保存、清空或禁用时复位，编辑已保存连接不回读密钥。
- InfoTip 使用标准 Radix Popover；DismissableLayer 的 ESM/CJS 补丁在 Escape 时核对当前最高层，安装时自动应用。维护入口见[开发流程](docs/DEVELOPMENT.md#上游依赖补丁)。
- 中文输入的 Enter 与 Escape 同时检查 `isComposing` 和 WebKit 的 229 标记：确认组词不发送消息，取消组词不关闭弹窗；正常发送与逐层关闭保留。
- 授权弹窗沿用标准 Radix Dialog。FocusScope 的 ESM/CJS 补丁补齐 macOS Option-Tab 首尾循环与输入法组合保护，保留嵌套作用域、普通 Tab 和系统快捷键；不修改系统键盘偏好。
- 保留原生 Small 红绿灯（窄栏顶部仍为它留 44px）、652px 半屏列表断点和无模型时的输入卡片。模型写入恢复、角色卡提交、窄窗键盘及附件路径的既有修复保留。
- 打包默认组合仅 Agent 核心、模型连接和 Agent 界面。文本工作台、回声模型等只存在于开发目录，不恢复到正式组合。
- 扩展管理在 768px 起保留列表与右侧详情，补齐两个内置扩展的用途介绍；更窄时在所选卡片内展示。管理页不再显示控制隐藏工作区的侧栏按钮，返回后保留工作区状态与草稿。

## 本候选验证

| 范围 | 实际结果 |
| --- | --- |
| Web | 最新提交上 `npm run verify:web` 通过（884 单元及类型、构建、发布配置、格式、边界、行数、lint），构建无单块体积警告 |
| 原生逻辑 | SQLite 存储提交后 `npm run verify:native` 通过（界面改版未改原生代码，未重跑）：IPC、格式、Clippy、73 单元；debug 应用在真实格式开发数据副本上导入 `host.shell`（修订 11）并在其上保存 |
| Chromium | 界面改版审查提交上 `npm run verify:e2e` 全量 238 项通过，1 worker |
| WebKit | 界面改版审查提交上 application-flow / focus-ring / rail / agent-list 共 24 项通过；此前 focus-ring / dialog-keyboard / input-method / application-flow / model-connection-recovery / lazy-pages 共 35 项通过（改版前） |
| 启动耗时 | 生产构建、浏览器冷启动 20 次中位数：Chrome 97.6 → 85.8 ms，WebKit 81 → 70 ms（按需加载与分块前后） |
| 打包应用 | 改名前候选的实测见[输入法、焦点与布局记录](evidence/MAC-INPUT-LAYOUT-2026-10-23.md)；改名后的源码尚未重新打包验收 |

改名后首个打包验收须覆盖：读取 `dev.plums.m1` 旧数据并保留原目录、旧 JSON 文档导入 SQLite 并移入 `legacy-json/`、复制失败弹窗、Mac 窗口按钮避让依 `platform.info`、点击后归还焦点无焦点环（WKWebView）、应用内启动耗时。

## 进行中与下一步

按[当前阶段](docs/spec/milestone.md#规范化改造进行中)推进规范化改造。已完成：统一命名与历史改写、旧数据迁移、版本号单一来源、ESLint 全局变量、导入别名、`public/` 拆分、Radix 补丁上游跟踪、断点集中、平台检测与原生焦点环、按需加载，以及 SQLite 存储的第一步（每个所属者一个库，`state.read`/`state.write` 语义不变，旧 JSON 首次导入）。界面改版（阶段 U）已完成并通过阶段审查：布局色进入主题契约（贡献主题可提供或由外壳推导）；会话区为一块浮起卡片；列表为“选中／置顶／普通”三档、置顶排前；默认头像为扁平梅子，窄栏顶部为空白梅子用户头像（暂为图像）；`View.icon` 进入视图契约，窄栏为 68px 实心图标，应用菜单与窄栏明暗切换删除，明暗、关于、诊断在设置中，弹窗视图从扩展管理的卡片打开；两栏断点 652px。布局与配色见 [UI](docs/UI.md) 与 [主题契约](docs/THEMES.md)，图标规则见 [页面契约](docs/PAGES.md)。

阶段审查结论：①维护成本——窄栏与手机顶栏的“扩展／设置”合为一处定义（`ShellEntries`），焦点回退改用 `data-shell-entry` 而非显示文字，删除应用菜单、明暗按钮与旧侧栏色变量，拆分超长的 im-style 用例，颜色取值只在 THEMES 维护；遗留：`AgentWorkspace.tsx`（420 行）与 `AgentDialogs.tsx`（520 行）早于本阶段即超过 400 行提示线，外壳右侧栏按钮的 18px 偏移与会话卡片几何耦合（阶段 9 重做窗口框架时一并处理），`View.icon` 无效原因为英文作者提示、在中文界面中原样显示。②解耦——分层检查通过；外壳不含 Agent 专属图标或配色（气泡图标经 `View.icon`、梅子配色表在 Agent 界面扩展内）；回归确认换用贡献主题后窄栏与列表随之变色，停用 Agent 界面后窄栏不留其条目。③规范——每步先写失败用例；纯图标按钮均有 `aria-label` 与 Tooltip，当前项 `aria-current`；SVG 只作遮罩绘制、不执行；WebKit 点击不聚焦按钮，外壳弹窗改为记录发起按钮以归还焦点；审查中发现并修复诊断面板重新挂载后“注入存储写入失败”勾选显示与实际不符。未验：打包应用中的明暗抽查与 WKWebView 遮罩绘制、VoiceOver。

下一步为原子批量写与记录能力（4b），再将 Agent 消息改为记录存储，其后依次为扩展包格式、联系人式回复、对话体验、外观与快捷键、窗口框架。当前未推送，现有交付包未替换。

后续真实模型调用、带密钥模型列表与 models.dev 联动、长上下文/图片/思考强度的服务兼容及正式签名分发仍未验；VoiceOver 暂缓。实际账户调用须先确认目标、次数和输出上限。M2 尚未整体退出。

## 当前交付与恢复

手测候选位于 `release/mac-manual-2026-10-23/`，0.2.0 arm64 debug / ad-hoc，构建与签名校验通过。先退出其他 Plums，再打开包内 `打开手测.command`，使用独立数据（改名前构建，包内可执行文件仍为 `plums-m1`；其启动脚本指向的 `.m1-data/` 已改名为 `.dev-data/`，需按新源码重建候选后再手测）；默认只有三个正式扩展，未附带回显测试扩展。直接打开包内 `Plums.app` 则使用常规数据目录。候选的 `build-info.json` 与 `source.patch` 记录构建时的源码差异，包内 README 给出手测入口；所有者手测待进行。

已交付 0.2.0 来自 `6668ce7`，Mac 入口 `release/mac/Plums.app`，本次未替换；Android 包仅保留其原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包保留在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`；恢复包不自动回滚数据，操作规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

既有交付的原始提交与当前历史的对应关系见[开发流程](docs/DEVELOPMENT.md#历史提交与交付来源)。
