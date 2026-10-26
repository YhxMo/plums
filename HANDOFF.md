# Plums 工程状态

核对日期：2026-10-26。当前只收口 macOS arm64 应用本体，Android 冻结。分支 `feat/ui-refresh` @ `edf2103`（之后只有文档与移出 Android 工程文件的提交），已推送为 GitHub [YhxMo/plums](https://github.com/YhxMo/plums) 的 `main`。2026-10-23 起统一使用 `dev.plums.plums` 命名，此前构建的包与本地数据仍是旧名，迁移见[应用数据目录](docs/ARCHITECTURE.md#应用数据目录)。

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
| Web | `edf2103` 上 `npm run verify:web` 通过 |
| 原生逻辑 | `40f3fa0` 上 `npm run verify:native` 通过；之后没有原生改动 |
| Chromium | `edf2103` 上 `npm run verify:e2e` 全部通过。`chat-follow.spec.ts` 的“on a 2x screen › a sent message reaches the end…”会间歇失败，去掉本次改动后同样复现（重复 3 次失败 1 次），尚未修 |
| WebKit | 界面改造后未重跑；改造前 `eaa1380` 的结果见[抽查记录](evidence/MAC-SPOTCHECK-2026-10-25.md) |
| 打包应用 | 审查修复（撤销后重启的消息顺序、默认头像导出、头像残留、导入框长文本）所有者在 `0343426` 包中实测通过。`86f8857` 包所有者手测中、未回报；`edf2103` 包已构建、未抽查。更早的实测见[抽查](evidence/MAC-SPOTCHECK-2026-10-25.md)、[检查点](evidence/MAC-CHECKPOINT-2026-10-24.md)、[记忆](evidence/MAC-MEMORY-2026-10-25.md)、[输入法](evidence/MAC-INPUT-LAYOUT-2026-10-23.md)记录 |

## 未验范围

各子系统文档只记录契约与回归测试，平台和打包应用的未验项统一列在这里；已交付包的受验范围见[交付入口](evidence/RESULTS.md)；Android 冻结方式见[整体路线](docs/spec/total.md#平台范围先做好-mac-应用本体)。

- **最近的界面调整**：设置弹窗、去掉行“…”、消息操作右对齐、列表拖入导入只有浏览器回归；WKWebView 中的 HTML 拖放（列表导入与会话附件分区）未在打包应用中验证。
- **界面规范改造**：毛玻璃叠色与 0.5px 线条在 2 倍屏上的效果、`file.save` 保存面板（取消、覆盖同名）、打包应用中 `.plums` 导出导入、WebKit 下的新页面；导出 PNG 未在酒馆软件中打开。
- **边界整理**：`AgentStore`、Agent 界面与记忆的模块拆分行为不变，只有单元与浏览器回归。
- **设定与记忆**：重启后补整理、整理提示与撤销、过期显示、另选整理模型与关闭记忆、WebKit 下的记忆页（含 `datetime-local`）；整理提示词在更长对话和更多模型上的效果未评估。
- **数据与存储**：版本 1 库升级到版本 2（本机无此类库）、复制失败弹窗；断电与写入中途崩溃的一致性。
- **窗口**：换屏（无第二块屏幕）；过大保存尺寸收回屏幕只有单元测试；窗口按钮避让、WKWebView 焦点环与遮罩、明暗抽查、启动耗时；VoiceOver 第一版不验收。
- **模型与凭据**：带输出上限的真实调用、当前版本新填密钥后的调用、长上下文与图片和思考强度的兼容；统一日志无密钥未被正面证明。实际账户调用须先确认目标、次数和输出上限。
- **平台能力**：会话内文档选择未在当前源码的打包应用中重验；`link.open` 只在 macOS 打包应用中实测。
- **分发**：正式签名与公证。

## 进行中与下一步

当前是[路线阶梯](docs/spec/total.md#路线阶梯)第 1 级（Mac 第一版），顺序与剩余内容只在[当前阶段](docs/spec/milestone.md#第-1-级mac-第一版)维护。

- **当前焦点**：等所有者在打包候选中手测并回报；之后是第 6 项外观与快捷键。
- **遗留**：`modules/agents/store.ts`、`modules/agents/memory/store.ts`、`AgentWorkspace.tsx`、`ProviderForm.tsx` 超过 400 行提示线；应用外壳的导航与管理入口仍由 `Workbench` 固定组装；`View.icon` 无效原因是英文提示；拖放提示层用 2px 虚线；早先导入的单文件扩展的源码分片（`host.shell` 的 `x-` 文档）不再读取也不自动清理。

## 当前交付与恢复

保留的候选：`release/.mac-KlOFGp`（`edf2103`，最新）、`release/.mac-v5XHrD`（`86f8857`）、`release/.mac-fSDXo2`（`0343426`），均为 0.2.0 arm64 debug / ad-hoc；更早的候选已删除，证据记录中的源码提交可重建。直接打开候选会使用正式数据目录；隔离数据须用设置了 `HOME` 或 `PLUMS_DATA_DIR` 的命令行启动包内可执行文件。新候选一律 `npm run release:mac -- --stage`。

已交付 0.2.0 来自 `40a7382`，Mac 入口 `release/mac/Plums.app`，未替换；Android 包仅保留原受验范围。[交付证据](evidence/RELEASE-0.2.0-2026-10-20.md)及包旁的 `build-info.json`、`source.patch` 用于核对来源。0.0.4 恢复包在 `.cache/archive/releases/mac-uIizKK/mac` 与 `.cache/archive/releases/android-JS89ll/android`，不自动回滚数据，规则见[开发流程](docs/DEVELOPMENT.md#本地交付目录)。
