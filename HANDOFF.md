# Plums 工程状态

核对日期：2026-10-27。第 1 级（Mac 第一版）已以 0.3.0 交付，下一步是第 2 级的计划；当前只做 macOS arm64 应用本体，Android 冻结。开发在 `main` 上进行，跟踪 GitHub [YhxMo/plums](https://github.com/YhxMo/plums) 的 `main`。2026-10-23 起统一使用 `dev.plums.plums` 命名，此前构建的包与本地数据仍是旧名，迁移见[应用数据目录](docs/ARCHITECTURE.md#应用数据目录)。

[文档导航](docs/README.md) · [当前阶段](docs/spec/milestone.md) · [整体路线](docs/spec/total.md) · [当前交付](evidence/RESULTS.md)

## 当前交付

Mac 0.3.0（源码 `9d2327d`，release ad-hoc，AGPL-3.0-or-later 加商业授权，SDK 与示例 MIT），[交付证据](evidence/RELEASE-0.3.0-2026-10-27.md)。相对 0.2.0 的主要变化如下，逐项改动见 `git log v0.2.0..9d2327d`，行为只在所链接的文档维护。

- **命名与数据**：`dev.plums.plums`，首次启动复制改名前的数据（[规则](docs/ARCHITECTURE.md#应用数据目录)）；API Key 存于数据根内 0600 文件，不用 Keychain（[凭据契约](docs/CREDENTIAL-BINDINGS.md#填写与存储)）。
- **默认组合**：打包只含 Agent 核心、记忆、模型连接与 Agent 界面；文本工作台、回显模型只在开发目录。
- **Agent 与对话**：介绍与设定分开、内置记忆、联系人式整条回复与未读、拖放附件与撤销、编辑与重新生成、Markdown 回复与 `link.open`（[UI](docs/UI.md#会话)、[契约](docs/EXTENSION-CONTRACTS.md)）。
- **界面规范改造**：按[设计规范](docs/DESIGN.md)改造，含 `file.save`、角色卡与 `.plums` 导出导入（[作者指南](docs/SDK-AUTHORING.md)）；“Agent 设置…”弹窗、列表拖入导入；扩展管理是卡片页加详情窗口，卡片上写出使用它的 Agent；按钮高 28px、文字 12px（[UI](docs/UI.md#扩展管理)）。
- **发布与工程**：release 档位（保留检查元素）、随包许可证与第三方通知、[安装说明](docs/INSTALL.md)、GitHub 自动检查（`.github/workflows/ci.yml`）、发布前核对候选来源（[开发流程](docs/DEVELOPMENT.md#本地交付目录)）。

## 尚未落定

- **右侧栏放什么**：所有者要保留右上角按钮，内容待定（设想过展开该 Agent 的其他会话与 md 文档等标签页）。定下来之前按钮仍开关详情抽屉，与菜单里的“Agent 设置…”弹窗渲染同一个 `DetailPanel`；定下后再撤掉抽屉，不要提前删按钮。

## 交付验证

自动化、打包实测、独立审查与按所有者决定收窄的退出条件见[交付证据](evidence/RELEASE-0.3.0-2026-10-27.md)。`chat-follow.spec.ts` 的“on a 2x screen › a sent message reaches the end…”会间歇失败（`edf2103` 上重复 3 次失败 1 次），尚未修；WebKit 回归在界面改造后未重跑。

## 未验范围

各子系统文档只记录契约与回归测试，平台和打包应用的未验项统一列在这里；已交付包的受验范围见[交付入口](evidence/RESULTS.md)；Android 冻结方式见[整体路线](docs/spec/total.md#平台范围先做好-mac-应用本体)。

- **release 档位包**：能启动、数据写入 `HOME` 下的平台目录且忽略 `PLUMS_DATA_DIR`，所有者在其中导入扩展、发出凭据请求并完成真实回复；右键“检查元素”未实际点过。
- **最近的界面调整**：设置弹窗、去掉行“…”、消息操作右对齐、列表拖入导入、“添加模型连接”按连接器的 `manage` 打开页面只有浏览器回归；扩展卡片页、详情窗口与新按钮尺寸只有所有者的整体报告；WKWebView 中的 HTML 拖放（列表导入与会话附件分区）未在打包应用中验证。
- **外观与快捷键**：WebKit 下的新分段控件未专门抽查；Windows/Linux 的菜单与窗口底色随系统更新、Android 的“跟随系统”均未实现。
- **界面规范改造**：毛玻璃叠色与 0.5px 线条在 2 倍屏上的效果、`file.save` 保存面板（取消、覆盖同名）、打包应用中 `.plums` 导出导入、WebKit 下的新页面；导出 PNG 未在酒馆软件中打开。
- **边界整理**：`AgentStore`、Agent 界面与记忆的模块拆分行为不变，只有单元与浏览器回归。
- **设定与记忆**：重启后补整理、整理提示与撤销、过期显示、另选整理模型与关闭记忆、WebKit 下的记忆页（含 `datetime-local`）；整理提示词在更长对话和更多模型上的效果未评估。
- **数据与存储**：版本 1 库升级到版本 2（本机无此类库）、复制失败弹窗；断电与写入中途崩溃的一致性。
- **窗口**：换屏（无第二块屏幕）；过大保存尺寸收回屏幕只有单元测试；窗口按钮避让、WKWebView 焦点环与遮罩、明暗抽查、启动耗时；VoiceOver 第一版不验收。
- **模型与凭据**：带输出上限的真实调用、长上下文与图片和思考强度的兼容（所有者决定不逐一实测）；是否从服务读取了模型列表；统一日志无密钥未被正面证明。实际账户调用须先确认目标与次数。
- **扩展生命周期**：替换、卸载、不兼容版本被拒绝与复制失败弹窗只有单元和浏览器回归；中文输入法在界面改造后只有所有者的口头报告。
- **平台能力**：会话内文档选择未在当前源码的打包应用中重验；`link.open` 只在 macOS 打包应用中实测。
- **分发**：正式签名与公证；首次打开说明中的“仍要打开”路径未在带隔离标记的真实下载包上逐步走过（只确认 `spctl` 对 ad-hoc 包评估为 rejected）；第三方通知中 16 个发布件不带许可证文件的包只给出许可证标识与源码仓库。

## 进行中与下一步

当前是[路线阶梯](docs/spec/total.md#路线阶梯)第 2 级（群聊），计划尚未编写；顺序与前置决定在[第 2 级](docs/spec/total.md#2-群聊)，阶段安排在[当前阶段](docs/spec/milestone.md)。

- **下一步**：新会话先写第 2 级的执行计划（按 total.md 的顺序：整合包 → 实际用量 → 头像、名字与发言者 → 群聊），每项定好完成条件，计划经所有者确认后再动手。2026-10-26 与所有者对齐的方向（自主发言与默认保守的花费上限、整合包的开关与共用规则、契约可跨隔离边界、群成员不区分真人与 Agent）已写入 total.md。
- **之后**：工具与独立工作 → 共用的 Agent；语音在群聊同期或之后。
- **尚未落定**：右侧栏放什么（见上）；预算设置放在界面哪里。
- **遗留**：`modules/agents/store.ts`、`modules/agents/memory/store.ts`、`AgentWorkspace.tsx`、`ProviderForm.tsx` 超过 400 行提示线；应用外壳的导航与管理入口仍由 `Workbench` 固定组装（其中 `modules/agents/store.ts` 与 `Workbench` 随群聊处理）；`View.icon` 无效原因是英文提示；拖放提示层用 2px 虚线；早先导入的单文件扩展的源码分片（`host.shell` 的 `x-` 文档）不再读取也不自动清理。

## 当前交付与恢复

Mac 入口 `release/mac/Plums.app` 为 0.3.0（`9d2327d`），包旁的 `build-info.json`、`source.patch` 用于核对来源。被替换的 0.2.0（`6668ce7`，本地与远端标签 `v0.2.0`；历史改写后对应 `40a7382`，见[来源更正](evidence/RELEASE-0.2.0-2026-10-20.md#来源更正)）存档于 `.cache/archive/releases/mac-VIqa8V/mac`；回退到它可直接读到升级前的旧目录数据，规则见[安装说明](docs/INSTALL.md#回退)。Android 包仍是 0.2.0，仅保留原受验范围。0.0.4 恢复包在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`，不自动回滚数据，规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。

`release/` 下仍保留的旧候选：`.mac-BOsbmQ`（`bed3f49`）、`.mac-vXOQwS`（`4fb2f19`）、`.mac-aUL9Cb`（`6830c27`）、`.mac-W3z2Hk`（`0eff9d8`）、`.mac-mrL1Q8`（`1f366f6`）、`.mac-Xv7o0u`（基于 `82b9138`），都已被 0.3.0 取代，经所有者同意后可删。新候选一律 `npm run release:mac -- --stage`，发布用 `--publish <候选目录>`；隔离数据须用设置了 `HOME` 的命令行启动包内可执行文件。
