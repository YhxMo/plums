# Plums 工程状态

核对日期：2026-10-27。当前只收口 macOS arm64 应用本体，Android 冻结。开发在 `main` 上进行，跟踪 GitHub [YhxMo/plums](https://github.com/YhxMo/plums) 的 `main`；0.3.0 的最终候选来自 `9d2327d`，待所有者实测后发布。2026-10-23 起统一使用 `dev.plums.plums` 命名，此前构建的包与本地数据仍是旧名，迁移见[应用数据目录](docs/ARCHITECTURE.md#应用数据目录)。

[文档导航](docs/README.md) · [当前阶段](docs/spec/milestone.md) · [整体路线](docs/spec/total.md) · [当前交付](evidence/RESULTS.md)

## 当前开发候选

相对已交付 0.2.0 的主要变化，逐项改动见 git log，行为只在所链接的文档维护。

- **命名与数据**：`dev.plums.plums`，首次启动复制改名前的数据（[规则](docs/ARCHITECTURE.md#应用数据目录)）；API Key 存于数据根内 0600 文件，不用 Keychain（[凭据契约](docs/CREDENTIAL-BINDINGS.md#填写与存储)）。
- **默认组合**：打包只含 Agent 核心、记忆、模型连接与 Agent 界面；文本工作台、回显模型只在开发目录。
- **Agent 与对话**：介绍与设定分开、内置记忆、联系人式整条回复与未读、拖放附件与撤销、编辑与重新生成、Markdown 回复与 `link.open`（[UI](docs/UI.md#列表交互与详情)、[契约](docs/EXTENSION-CONTRACTS.md)）。
- **界面规范改造**：第 5a 项按[设计规范](docs/DESIGN.md)完成，含 `file.save`、角色卡与 `.plums` 导出导入（[作者指南](docs/SDK-AUTHORING.md)）；所有者手测中又调整了列表行操作、“Agent 设置…”弹窗、消息操作位置与列表拖入导入（[UI](docs/UI.md)）。

## 尚未落定

- **右侧栏放什么**：所有者要保留右上角按钮，内容待定（设想过展开该 Agent 的其他会话与 md 文档等标签页）。定下来之前按钮仍开关详情抽屉，与菜单里的“Agent 设置…”弹窗渲染同一个 `DetailPanel`；定下后再撤掉抽屉，不要提前删按钮。

## 本候选验证

| 范围 | 实际结果 |
| --- | --- |
| Web | 0.3.0 版本号改动上 `npm run verify:web` 通过；GitHub 自动检查最近一次全绿在 `3852f7d`，之后的提交尚未推送 |
| 原生逻辑 | 0.3.0 版本号改动上 `npm run verify:native` 通过；此前为第 6 项改动与 `3852f7d` 的云端运行 |
| Chromium | `0e71dca` 上完整 e2e 312 项全部通过（本机）。`chat-follow.spec.ts` 的“on a 2x screen › a sent message reaches the end…”会间歇失败，`edf2103` 上去掉当时改动后同样复现（重复 3 次失败 1 次），尚未修；近几轮未出现 |
| WebKit | 界面改造后未重跑；改造前 `eaa1380` 的结果见[抽查记录](evidence/MAC-SPOTCHECK-2026-10-25.md) |
| 打包应用 | 第 6 项（菜单与 ⌘, / ⌘N / ⌘F、跟随系统的实时切换、弹窗与扩展管理中命令不触发）所有者在 `release/.mac-Xv7o0u` 中实测通过。审查修复（撤销后重启的消息顺序、默认头像导出、头像残留、导入框长文本）所有者在 `0343426` 包中实测通过。更早的实测见[抽查](evidence/MAC-SPOTCHECK-2026-10-25.md)、[检查点](evidence/MAC-CHECKPOINT-2026-10-24.md)、[记忆](evidence/MAC-MEMORY-2026-10-25.md)、[输入法](evidence/MAC-INPUT-LAYOUT-2026-10-23.md)记录 |

## 未验范围

各子系统文档只记录契约与回归测试，平台和打包应用的未验项统一列在这里；已交付包的受验范围见[交付入口](evidence/RESULTS.md)；Android 冻结方式见[整体路线](docs/spec/total.md#平台范围先做好-mac-应用本体)。

- **release 档位包**：能启动、数据写入 `HOME` 下的平台目录且忽略 `PLUMS_DATA_DIR`，所有者在其中导入扩展并发出凭据请求；右键“检查元素”与其余日常路径未在该档位上走过。
- **最近的界面调整**：设置弹窗、去掉行“…”、消息操作右对齐、列表拖入导入、“添加模型连接”按连接器的 `manage` 打开页面、扩展卡片页与详情窗口、按钮缩小到 28px／12px 只有浏览器回归；WKWebView 中的 HTML 拖放（列表导入与会话附件分区）未在打包应用中验证。
- **外观与快捷键**：WebKit 下的新分段控件未专门抽查；Windows/Linux 的菜单与窗口底色随系统更新、Android 的“跟随系统”均未实现。
- **界面规范改造**：毛玻璃叠色与 0.5px 线条在 2 倍屏上的效果、`file.save` 保存面板（取消、覆盖同名）、打包应用中 `.plums` 导出导入、WebKit 下的新页面；导出 PNG 未在酒馆软件中打开。
- **边界整理**：`AgentStore`、Agent 界面与记忆的模块拆分行为不变，只有单元与浏览器回归。
- **设定与记忆**：重启后补整理、整理提示与撤销、过期显示、另选整理模型与关闭记忆、WebKit 下的记忆页（含 `datetime-local`）；整理提示词在更长对话和更多模型上的效果未评估。
- **数据与存储**：版本 1 库升级到版本 2（本机无此类库）、复制失败弹窗；断电与写入中途崩溃的一致性。
- **窗口**：换屏（无第二块屏幕）；过大保存尺寸收回屏幕只有单元测试；窗口按钮避让、WKWebView 焦点环与遮罩、明暗抽查、启动耗时；VoiceOver 第一版不验收。
- **模型与凭据**：带输出上限的真实调用、当前版本新填密钥后的调用、长上下文与图片和思考强度的兼容；统一日志无密钥未被正面证明。实际账户调用须先确认目标、次数和输出上限。
- **平台能力**：会话内文档选择未在当前源码的打包应用中重验；`link.open` 只在 macOS 打包应用中实测。
- **分发**：正式签名与公证；首次打开说明中的“仍要打开”路径未在带隔离标记的真实下载包上逐步走过（只确认 `spctl` 对 ad-hoc 包评估为 rejected）；第三方通知中 16 个发布件不带许可证文件的包只给出许可证标识与源码仓库。

## 进行中与下一步

当前是[路线阶梯](docs/spec/total.md#路线阶梯)第 1 级（Mac 第一版），顺序与剩余内容只在[当前阶段](docs/spec/milestone.md#第-1-级mac-第一版)维护。

- **当前焦点**：第 7 项交付候选与发布准备进行中。已做：许可证（AGPL-3.0-or-later 与商业授权，2026-10-27 由 GPL 改为 AGPL；SDK 与示例 MIT）、随包第三方通知、[安装说明](docs/INSTALL.md)、`release:mac` 改为 release 档位（开启 `devtools`，包体 51→20 MB）。空白会话凭公开文档写的连接器已由所有者按链路打通验收（[记录](evidence/CONNECTOR-AUTHOR-2026-10-26.md)，OpenCode Go 因缺会话头拒绝，未得到回复）。第 6a 项扩展管理已改为卡片页加详情窗口（所有者看过首版列表后要求），按钮同时缩小，只有浏览器回归。GitHub 自动检查（`.github/workflows/ci.yml`）已推送，`3852f7d` 上三项全部通过（Ubuntu 上 `verify:web` 约 1 分钟，macOS 上原生检查约 6 分钟、e2e 约 21 分钟）。内置连接的真实回复已在最终候选 `9d2327d` 上完成（DeepSeek，[记录](evidence/MAC-REAL-REPLY-2026-10-27.md)），独立审查的阻塞项已处理。待做：独立审查后按授权替换 `release/mac/`。
- **之后**：2026-10-26 与所有者对齐了第 1 级之后的路线：群聊（从整合包开始，含花费上限）→ 工具与独立工作 → 共用的 Agent，语音在群聊同期或之后，见[路线阶梯](docs/spec/total.md#路线阶梯)。
- **遗留**：`modules/agents/store.ts`、`modules/agents/memory/store.ts`、`AgentWorkspace.tsx`、`ProviderForm.tsx` 超过 400 行提示线；应用外壳的导航与管理入口仍由 `Workbench` 固定组装（其中 `modules/agents/store.ts` 与 `Workbench` 随群聊处理，见[第 2 级](docs/spec/total.md#2-群聊)）；`View.icon` 无效原因是英文提示；拖放提示层用 2px 虚线；早先导入的单文件扩展的源码分片（`host.shell` 的 `x-` 文档）不再读取也不自动清理。

## 当前交付与恢复

保留的候选：`release/.mac-GgRaQt`（`9d2327d`，0.3.0，release 档位，最终候选：独立审查后的修复、AGPL；所有者在其上完成真实回复，报告卡片页与输入法正常，[记录](evidence/MAC-REAL-REPLY-2026-10-27.md)；待授权发布）、`release/.mac-BOsbmQ`（`bed3f49`，已被取代）、`release/.mac-vXOQwS`（`4fb2f19`，首版扩展列表，已被取代，所有者不再使用后可删）、`release/.mac-aUL9Cb`（`6830c27`，release 档位）、`release/.mac-W3z2Hk`（`0eff9d8`）、`release/.mac-mrL1Q8`（`1f366f6`）、`release/.mac-Xv7o0u`（第 6 项实测用包，基于 `82b9138`），均为 0.2.0 arm64 ad-hoc，除最新三份外为 debug；更早的候选已删除，证据记录中的源码提交可重建。直接打开候选会使用正式数据目录；隔离数据须用设置了 `HOME`（debug 包也可用 `PLUMS_DATA_DIR`）的命令行启动包内可执行文件。新候选一律 `npm run release:mac -- --stage`。

已交付 0.2.0 来自 `6668ce7`（本地标签 `v0.2.0`；历史改写后对应 `40a7382`，见[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md#来源)），Mac 入口 `release/mac/Plums.app`，未替换；Android 包仅保留原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`，不自动回滚数据，规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。
