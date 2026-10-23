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

结果绑定当前工作区的相关实现；浏览器、原生逻辑和实际包各自记录。

| 范围 | 实际结果 |
| --- | --- |
| Web | `npm run verify:web` 通过：859 单元，以及类型、构建、发布配置、格式、边界、行数与 lint |
| 打包源码 | `source-patch.test.ts` 覆盖超出进程缓冲上限的已跟踪与新增文件、删除项和完整回放；打包脚本将差异直接写入文件 |
| 原生逻辑 | 焦点补丁未修改 Rust；同份原生实现已有 `CARGO_BUILD_JOBS=1 RUST_TEST_THREADS=1 npm run verify:native` 的 IPC、格式、Clippy、68 单元通过结果 |
| Chromium | `npm run verify:e2e` 全量 224 项通过，1 worker |
| WebKit | 当前输入法修复下 31 项通过：input-method / dialog-keyboard / application-flow / model-connection-recovery。运行入口见[开发流程](docs/DEVELOPMENT.md#验证入口) |
| 独立审查 | 文件存储、Popover、文档清理与管理页布局已审查；FocusScope、输入法 Enter/Escape 修复和相应回归的限定只读审查无可行动发现 |
| macOS 打包应用 | macOS 27.0.1（26A434）arm64 的隔离 `Plums Review`（改名前构建，`dev.plums.m1.review`，0.2.0）构建、`codesign --verify --deep --strict` 与下述简体拼音实际验收通过；VoiceOver 暂缓 |

两份依赖补丁均经 `npm run postinstall` 成功应用；FocusScope 与 DismissableLayer 补丁均经反向还原后重应用验证，ESM/CJS 语法检查通过。

Mac 当前包默认只有 3 个正式扩展。实测 960px 默认窗口的列表与右侧介绍、两个内置介绍的切换、明暗外观、系统半屏后内联详情、恢复原尺寸时保留所选扩展，以及管理页隐藏工作区侧栏按钮、返回工作区后恢复控件。

凭据文件与 Popover 实现未再改变：此前隔离包已验证旧格式/引用、两处显隐和保存、留空编辑、退出重启及实际重构建后的三引用读取；文件为 0600，普通配置不含明文密钥，无 Keychain 授权。Popover 的点击、Enter、Escape 逐层关闭及返回焦点已在实际包验证，取消按压由浏览器回归覆盖。

授权弹窗焦点实现已在隔离 Mac 包实测：初始焦点位于标题，当前系统设置下 Tab 依次访问关闭、暂不授权、授权并启动，正反向均首尾环绕；Option-Tab 和 Shift-Option-Tab 在两端同样环绕。焦点环清晰可见，Escape 与键盘取消均返回启用按钮，三个扩展仍停用。WebKit 自动化使用 Option-Tab 遍历全部控件；真实包与自动化的键盘设置分别按实际结果记录。

简体拼音在隔离 Mac 包实测通过：组词中的 Return 确认文本后留在草稿，再次 Enter 才单次发送；Shift+Enter 换行保留，组词期间 Option-Tab 保持原字段焦点。最终包冷启动后输入 `nihao`，选择第 2 候选得到“你好”，草稿未发送；再次 Return 仅产生一条消息及一次本地回复。在“添加 Agent”名称字段输入 `ceshi`，第一次 Escape 只取消组词，弹窗保持打开且焦点留在名称；第二次 Escape 关闭弹窗并返回“添加”按钮。验收使用单独导入的无权限本地回显扩展，不连接真实服务。VoiceOver 验收暂缓，开关已恢复关闭、实用工具已退出，不记为通过。

## 收尾与下一步

输入法修复、自动化验证、独立审查与上述原生验收已完成。自动验收专用扩展、隔离数据、脚本、报告、测试包和测试应用缓存已清理；下方手测候选保留供使用。VoiceOver 暂不继续。当前未提交、未推送，现有交付包未替换。

后续真实模型调用、带密钥模型列表与 models.dev 联动、长上下文/图片/思考强度的服务兼容及正式签名分发仍未验；输入与辅助技术状态见上文。实际账户调用须先确认目标、次数和输出上限；任务顺序只在[当前阶段](docs/spec/milestone.md)维护。M2 尚未整体退出。

## 当前交付与恢复

手测候选位于 `release/mac-manual-2026-10-23/`，0.2.0 arm64 debug / ad-hoc，构建与签名校验通过。先退出其他 Plums，再打开包内 `打开手测.command`，使用独立数据（改名前构建，包内可执行文件仍为 `plums-m1`；其启动脚本指向的 `.m1-data/` 已改名为 `.dev-data/`，需按新源码重建候选后再手测）；默认只有三个正式扩展，未附带回显测试扩展。直接打开包内 `Plums.app` 则使用常规数据目录。候选的 `build-info.json` 与 `source.patch` 记录当前未提交源码，包内 README 给出手测入口；所有者手测待进行。

已交付 0.2.0 来自 `6668ce7`，Mac 入口 `release/mac/Plums.app`，本次未替换；Android 包仅保留其原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包保留在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`；恢复包不自动回滚数据，操作规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

既有交付的原始提交与当前历史的对应关系见[开发流程](docs/DEVELOPMENT.md#历史提交与交付来源)。
