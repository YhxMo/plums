# Plums 工程状态

核对日期：2026-10-23（Asia/Singapore）。当前只收口 macOS arm64 应用本体，Android 冻结。分支 `feat/ui-refresh`；本候选已分主题提交。2026-10-23 起历史统一使用 `dev.plums.plums` 命名，改写前的包与本地数据仍是旧名，见[历史提交与交付来源](docs/DEVELOPMENT.md#历史提交与交付来源)。

[文档导航](docs/README.md) · [当前阶段](docs/spec/milestone.md) · [整体路线](docs/spec/total.md) · [当前交付](evidence/RESULTS.md)

## 当前开发候选

- 标识符改为 `dev.plums.plums`，数据位于平台数据目录的 `data/`。桌面首次启动把改名前 `dev.plums.m1/m1-experiment` 的数据复制过来，旧目录保留；失败时说明并退出。规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。Rust 单元测试与 debug 二进制在假 HOME 下的实际复制已验证；复制失败时的弹窗未实测，打包应用读取真实旧数据待验。
- API Key 使用数据根内独立的 0600 `credential-secrets.json`，保持 schema 1 与原生引用；文件锁内重读后原子保存，损坏或权限过宽时保留原件并拒绝读取。不使用 Keychain。格式、作用域与同用户明文边界见[凭据契约](docs/CREDENTIAL-BINDINGS.md)。
- 模型服务商与扩展凭据共用 `SecretInput`：Eye/EyeOff 只显隐当前草稿，不提交表单；保存、清空或禁用时复位，编辑已保存连接不回读密钥。
- InfoTip 使用标准 Radix Popover；DismissableLayer 的 ESM/CJS 补丁在 Escape 时核对当前最高层，安装时自动应用。维护入口见[开发流程](docs/DEVELOPMENT.md#上游依赖补丁)。
- 中文输入的 Enter 与 Escape 同时检查 `isComposing` 和 WebKit 的 229 标记：确认组词不发送消息，取消组词不关闭弹窗；正常发送与逐层关闭保留。
- 授权弹窗沿用标准 Radix Dialog。FocusScope 的 ESM/CJS 补丁补齐 macOS Option-Tab 首尾循环与输入法组合保护，保留嵌套作用域、普通 Tab 和系统快捷键；不修改系统键盘偏好。
- 保留原生 Small 红绿灯、64px 导航栏、648px 半屏列表断点和无模型时的输入卡片。模型写入恢复、角色卡提交、窄窗键盘及附件路径的既有修复保留。
- 打包默认组合仅 Agent 核心、模型连接和 Agent 界面。文本工作台、回声模型等只存在于开发目录，不恢复到正式组合。
- 扩展管理在 768px 起保留列表与右侧详情，补齐两个内置扩展的用途介绍；更窄时在所选卡片内展示。管理页不再显示控制隐藏工作区的侧栏按钮，返回后保留工作区状态与草稿。

## 本候选验证

| 范围 | 实际结果 |
| --- | --- |
| Web | 最新提交上 `npm run verify:web` 通过（877 单元及类型、构建、发布配置、格式、边界、行数、lint），构建无单块体积警告 |
| 原生逻辑 | 数据迁移提交后 `npm run verify:native` 通过：IPC、格式、Clippy、73 单元；之后未再改 Rust |
| Chromium | `npm run verify:e2e` 全量 226 项通过，1 worker |
| WebKit | focus-ring / dialog-keyboard / input-method / application-flow / model-connection-recovery / lazy-pages 共 35 项通过 |
| 启动耗时 | 生产构建、浏览器冷启动 20 次中位数：Chrome 97.6 → 85.8 ms，WebKit 81 → 70 ms（按需加载与分块前后） |
| 打包应用 | 改名前候选的实测见[输入法、焦点与布局记录](evidence/MAC-INPUT-LAYOUT-2026-10-23.md)；改名后的源码尚未重新打包验收 |

改名后首个打包验收须覆盖：读取 `dev.plums.m1` 旧数据并保留原目录、复制失败弹窗、Mac 窗口按钮避让依 `platform.info`、点击后归还焦点无焦点环（WKWebView）、应用内启动耗时。

## 进行中与下一步

按[当前阶段](docs/spec/milestone.md#规范化改造进行中)推进规范化改造。已完成：统一命名与历史改写、旧数据迁移、版本号单一来源、ESLint 全局变量、导入别名、`public/` 拆分、Radix 补丁上游跟踪、断点集中、平台检测与原生焦点环、按需加载。下一步为 SQLite 存储，其后依次为扩展包格式、联系人式回复、对话体验、外观与快捷键。当前未推送，现有交付包未替换。

后续真实模型调用、带密钥模型列表与 models.dev 联动、长上下文/图片/思考强度的服务兼容及正式签名分发仍未验；VoiceOver 暂缓。实际账户调用须先确认目标、次数和输出上限。M2 尚未整体退出。

## 当前交付与恢复

手测候选位于 `release/mac-manual-2026-10-23/`，0.2.0 arm64 debug / ad-hoc，构建与签名校验通过。先退出其他 Plums，再打开包内 `打开手测.command`，使用独立数据（改名前构建，包内可执行文件仍为 `plums-m1`；其启动脚本指向的 `.m1-data/` 已改名为 `.dev-data/`，需按新源码重建候选后再手测）；默认只有三个正式扩展，未附带回显测试扩展。直接打开包内 `Plums.app` 则使用常规数据目录。候选的 `build-info.json` 与 `source.patch` 记录构建时的源码差异，包内 README 给出手测入口；所有者手测待进行。

已交付 0.2.0 来自 `6668ce7`，Mac 入口 `release/mac/Plums.app`，本次未替换；Android 包仅保留其原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包保留在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`；恢复包不自动回滚数据，操作规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

既有交付的原始提交与当前历史的对应关系见[开发流程](docs/DEVELOPMENT.md#历史提交与交付来源)。
