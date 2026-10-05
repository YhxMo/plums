# 产品入口与任务范围授权实施记录

## 基线与计划（2026-10-05）

远端 main 再次核实为 090d81e90f33ee69f55c24c613be9c0ded568e0d。原环境 work 分支停在 778aa47，未修改；使用独立 worktree `/workspace/plums-scope`、分支 `feat/agent-scope-permissions`。已阅读 AGENTS.md、core 能力授权、host SDK 桥与生命周期、桌面启用/确认/组件管理及 CODE_SIMPLIFICATION_PLAN。仓库和上层未发现可读的 `.agents/skills`。

1. 实现有限期、宿主签发的任务范围及执行时复核，覆盖文件与 HTTPS。
2. 接入可信桌面开始使用、范围确认、停止/撤权；统一扩展与服务接入入口。
3. 回归范围复用、越界、拒绝、失效、隔离、升级、凭据及交互，再完成构建与全套检查。
4. 提交、推送草稿 PR，核实远端提交与 CI；不合并、不部署。

## 决策与边界

- `connector` 清单、组合字段与凭据注入资格保持兼容；仅统一产品分类为“扩展 · 服务接入”。角色卡仍为声明内容，不签发能力。
- 核心原有逐次确认是兼容默认。新增任务范围仅由可信宿主管理接口签发，SDK 不暴露；按 core/Agent 实例隔离，仅内存有效，最长一小时，停止/重启撤销。
- 范围是当前已启用组件版本、完整清单、绑定目录和明确 fs/egress 权限的快照。目录范围不扩大声明；write 不隐含 read；exec 不可加入。调用链每方均需匹配快照，MCP 批准与凭据规则继续独立复核。
- 新版本、清单变化、目录变化不能沿用旧授权。范围未覆盖的写入/联网退回单次确认，声明以外仍直接拒绝；不会允许用户越过包声明。授权等待及审计等待后再次复核，撤权不放行排队动作。
- 任务定义为一次开始使用至停止（或到期）；不是扩展可自行命名续期的任务。通用宿主不能推断业务任务结束，由用户停止结束；固定有效期在可信窗口明确展示。
- 完整 coding agent 的命令执行需要新的平台隔离后端、安全方案和单独决策；本次不注册 ExecSink、不添加 stdio MCP，不将工作目录称为 OS 沙箱。现有外装聊天/模型/工具循环/看板保留。
- 旧 HANDOFF 的 1042 与 CODE_SIMPLIFICATION_PLAN 的 1062 均为历史结果；后者另有两项原生窗口焦点待复核。本次结果另行记录，不冒充 macOS 验收。

## 验证与计划变化

待实施后追加实际命令、结果和无法验证项。仓库未配置 lint script 或 GitHub Actions workflow；按现有 tsc/build、Vitest、Prettier 和 diff 检查执行。环境默认 Node 24/pnpm 11，正在为本次验证使用仓库要求的 Node 26.5.1/pnpm 10.33.3（缓存放 /tmp，不修改系统工具）。

### 实施中调整

- 范围不是只有全选确认：可信确认窗口支持按每个 fs 操作和服务外发勾选子集，默认有效期 15 分钟，可选 1 小时。任务内取消选择的 read/list 同样回到单次确认；单次确认不会写入任务范围。
- 为防止旧预览跨会话复用及跨数据库连接的停用/再启用 ABA，指纹加入 core 随机身份、安装/同意记录及 SQLite data_version；不改数据库 schema。
- 收敛公共库与当前 Agent 的重复管理视图，改为公共库跳转 Agent 详情。组装选择器也把服务接入并入扩展，保留 `connector` 清单和依赖格式。停用从更多菜单移到组件行可见按钮。
- Linux 原构建在 host 已跳过 macOS helper 后仍无条件复制该文件；修复 desktop 构建的按平台复制，不增加 Linux 文件执行实现。生产 SecureFsSink 仍在非 macOS 拒绝执行。
- 范围确认取消必须保留配置界面；`startAgent` 返回 cancelled，不能把未打开界面当成成功收起配置。
- 环境 gh 令牌不可用，但 Git fetch 与已连接 GitHub App 可用；通过连接器处理 PR 和 CI 查询。
- 为 Linux Electron 验证安装 Electron 二进制、在 /tmp 启动 Xorg dummy 显示。没有改生产 Chromium 沙箱或原生权限控制。
- 任务审计记录选择的逻辑操作及有效期，以 taskId 关联每次执行；不记录物理路径、内容或密钥。批准审计失败不发布新授权。桌面将授权/撤销显示为任务范围记录。
- 额外回归发现：已缩小的任务到期后不能重新获得旧版默认只读免确认。core 一旦进入任务模式，撤销/到期后的未覆盖读取也需要确认，独立 core 在自身关闭前保留该行为；桌面则固定在每次构造时启用 `task-or-confirm`，策略跨内部 core 重建保留，临时 grants 随 core 销毁丢弃；新增回归锁定此行为。
- Linux 隐藏 Electron 测试窗口被平台节流（一次稳定性检查约 2 秒），导致原 20 秒用例超时。测试夹具仅在 Linux 显示窗口，不改变生产窗口或 macOS 测试行为；保留原时间预算和断言。macOS 专属按钮位置 API 的调用也作平台可用性判断，macOS 断言保留。
- `desktop:smoke` 更新入口与按钮，并增加真实看板连续文件写入不增加单次确认计数、taskId 审计检查；此脚本仍需要打包的 macOS 应用，本次不声称运行通过。

### 验证环境与实际覆盖

- Node 26.5.1 / pnpm 10.33.3；Linux x86_64；Electron 44.5.1，临时 Xorg `DISPLAY=:99`。工具与原生依赖缓存使用 `/tmp`；未更改系统 Node 或原工作目录。
- `pnpm build` 已通过：五个包的 TypeScript 编译、Vite 与 desktop broker/preload 构建。`pnpm examples:build` 已通过，`pnpm exec plums version` 为 0.2.0。
- 未配置独立 lint script。Prettier 检查新增 core 范围模块/测试、host 改动/测试、全部 desktop/src 与 desktop/test、两个改动脚本通过；既有 core 文件保留原排版，避免无关全文件格式化。`git diff --check` 与两个脚本 `node --check` 通过。
- 核心新范围测试 12 项：连续文件/HTTPS、声明外路径/域名、实例隔离、撤销/到期、有限有效期、旧预览、升级、审计期间撤权、未覆盖单次确认、调用链交集、按操作缩小、跨连接 ABA、到期/撤权不恢复隐式只读、目录实体替换。
- 宿主新集成测试：实际第三方子进程 → SDK → 核心 → HttpsSink → 模拟网络传输边缘；两次同范围 HTTPS 不弹窗，宿主覆盖伪造凭据头、输出及审计脱敏，声明外域名拒绝，撤权后重新确认，配置变化使旧预览失效。没有使用真实密钥或业务外发。macOS SecureFsSink 的真实写/读测试已添加，仅 macOS 执行。
- 桌面 13 项测试通过：四个 onboarding、八个交互、一个完整确认窗口流程（新增范围子集/期限与伪造选择拒绝），包含浅/深主题、四个宽度、失效异步响应、重复点击、取消/返回、保存失败、撤权失败重试。测试夹具随入口变化调整，不删除旧独有断言。窄屏导航聚焦增加显式滚入视野，修复已观察到的不可见焦点。
- 全量组合的最终数量与命令结果见下一节；上述中间结果不替代最终组合验证。

### 必须保留的验收边界

本云端未运行 macOS 目录句柄原生 helper、safeStorage 系统密钥存储、macOS 标题栏/焦点分支、DMG 打包或打包应用 `desktop:smoke`。Linux 的原生窗口测试通过不等于 macOS 验收；历史 CODE_SIMPLIFICATION_PLAN 的两项 macOS 原生焦点待复核仍需在 macOS 复核。新增真实文件测试在此明确跳过。没有实现 shell/exec 或 stdio MCP，没有 OS 沙箱承诺。

## 最终组合结果（2026-10-05 11:28 UTC）

| 检查                                                  | 本次结果                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISPLAY=:99 pnpm test`（Node 26.5.1 / pnpm 10.33.3） | **53 个测试文件通过；1079 passed、1 skipped，共 1080 项；0 failed**。开始 11:27:56 UTC，耗时 58.75 秒。包含完整 `pnpm build` 与全部测试项目。 |
| macOS 文件助手集成测试                                | 1 skipped：平台条件明确为 darwin，未伪造结果。                                                                                                |
| `pnpm examples:build`                                 | 通过；生成的 release/examples 未提交。                                                                                                        |
| `pnpm exec plums version`                             | `0.2.0`。                                                                                                                                     |
| 适用 Prettier / `git diff --check` / 脚本语法         | 全部通过；范围见上文，仓库无独立 lint script。                                                                                                |
| macOS 原生/DMG/打包应用 smoke                         | 未在 Linux 运行，仍需 macOS 验收；新版 smoke 已静态检查。                                                                                     |
| 最终远端 main 核对                                    | 仍为 `090d81e90f33ee69f55c24c613be9c0ded568e0d`。                                                                                             |

实际命令通过 `npm_config_cache=/tmp/plums-npm npx --yes --package=node@26.5.1 --package=pnpm@10.33.3 -c 'pnpm test'` 启动，并设置 `DISPLAY=:99`。最终完整输出在环境 `/tmp/plums-final-combined.log`；中间调试结果不替代此结果。UI 截图在被 gitignore 排除的 `.artifacts/visual-v3`，未随代码提交。

所有本次发现的代码/交互回归已修复；保留的外部验收边界为上述 macOS 原生执行与窗口行为。提交后将通过远端 PR 核对提交及 CI；仓库目前未配置 `.github/workflows`，不能把“没有 CI”写成 CI 通过。

## 提交与远端核对（2026-10-05 11:30 UTC）

- 代码提交：`f3b7d51bd121785009ed16b6f79e399bb7f29702`，已推送 `feat/agent-scope-permissions`，本地 SHA 与 `git ls-remote` 一致；原 `/workspace/plums` work 分支未改动。
- 草稿 PR：<https://github.com/YhxMo/plums/pull/32>。服务端确认 `draft: true`、`merged: false`，base `090d81e`、代码 head `f3b7d51`。未合并、未部署。
- 通过 GitHub App 查询代码提交：Actions runs `total_count: 0`，check-runs `total_count: 0`，combined statuses `[]`。当前没有远端 CI 结果，不是 CI 通过，也没有可修复的失败 job。此次文档收尾单独提交，不改变已验证代码。
- 本地完整测试与格式/构建结果见上节；唯一剩余平台验收阻塞为 macOS 原生行为，需 macOS 环境继续验收。完整命令执行后端仍需另行安全方案决策，不在本 PR 开放。

## PR #32 修复计划与决策（2026-10-05）

本轮基于既有分支 head `5fc44904833582e6197003efa2e633ab4e2b17c9`，远端 main 再核对仍为 `090d81e90f33ee69f55c24c613be9c0ded568e0d`。保留原工作目录与现有草稿 PR，不创建重复 PR。

用户指定模型职责：gpt-6-astra 审定计划与最终只读审阅；gpt-6.1-sol 负责具体实现、测试、文档与提交执行。收到要求时已在构建检查点暂停并保留未提交工作；随后按 astra 审定计划恢复，完成后先交审阅再提交。

1. P1：前端 `cancel()` 经真实 preload IPC / main / broker 撤销任务并关闭 core，但保留前端仍可 invoke；旧 core 的任务模式标志随销毁消失，使新 core 的 read/list 恢复隐式放行。改为构造期固定宿主策略 `capabilityApproval: "task-or-confirm"`，与内存 grants 分离。DesktopHost 的全部 core 构造明确启用，首次调用和停止/配置/目录/重启均保持。独立 core 的兼容默认继续保留；SDK 不暴露策略或 grant，单次同意不扩大授权。未选中的 read/list 仍单次确认，不删除任务模型。
2. P2：原 Tab 只切换两个按钮，跳过范围与期限；主进程又抢先拦截 Enter。改为可用控件 DOM 顺序正反循环，跳过 disabled/hidden/inert/负 tabindex，焦点外逸回到拒绝。任务 renderer 处理 Enter：期限 select 操作原生选项，其他位置（包括允许按钮）拒绝；非任务 Enter、所有 Escape 仍由主进程拒绝。发送者、令牌、批准延迟及关闭/失焦/加载失败规则保留。
3. 回归覆盖固定策略、有限 grants、连续读写/HTTPS、单次批准不扩大范围、撤权/到期等待复核、宿主与目录生命周期、真实前端 cancel 后继续调用以及真实键盘事件。Linux 用 I/O 边界记录器，不能把缺少 macOS 文件助手的拒绝当作权限拒绝。
4. 真桌面夹具在 Linux 发现 Agent 打开/切换路径无条件调用 macOS 标题栏 API；仅在 darwin 调用，保留 macOS 行为，允许真实 Linux IPC 回归执行。该调整不引入文件执行后端。
5. 先 build 再定向跨进程测试，最后完整 build/typecheck/测试、适用格式与 diff 检查；macOS 原生验收仍待相应平台。最终验证与审阅结果在完成后追加。

修复前公开行为回归复现：宿主撤权/目录变更后 list 被放行并到达 RecordingFsSink；真实键盘 Tab 未到达范围勾选项（`/tmp/plums-policy-red.log`、`/tmp/plums-keyboard-red.log`）。第一次 core 新回归夹具把 read 指向目录，随后修正为存在的临时文件；该夹具路径失败不计为安全问题复现。

### 修复验证中的调整

- 兼容回归直接省略 `capabilityApproval`，验证独立 core 的真正默认；非法策略值拒绝构造，避免误拼策略悄悄恢复旧行为。host 的组件事务恢复 core 也明确选择固定策略（该路径只读取安装元数据，不执行组件）。
- 第一次完整组合验证：54 文件中 53 通过，1095 passed、1 failed、1 skipped；唯一失败是外装示例模型/工具循环的旧确认计数（预期 4，实际 6）。未授任务时新增 read 与 list 各一次确认，更新断言为 6，保留工具循环、调用链、写入、导出与凭据断言；没有修改 examples 业务实现。该失败结果不能作为最终通过记录。
- 真实 frontend 测试仅在 /tmp 的打包副本注入 Recording 文件 Sink，保留真实 preload/main/broker/DesktopHost/runtime/SDK/core。取消后同一个前端再次 read/list，逐次拒绝且 Sink 仅有此前已批准的 write；撤销审计关联原 taskId。未将缺少原生 helper 的失败充作权限拒绝。
- 真键盘用例使用 Tab、Shift+Tab、Space、ArrowDown、Enter，不使用 selectOption/uncheck 代替键盘断言；期限 Enter 操作原生下拉菜单，Allow/Deny 的 Enter 拒绝，延迟 Allow 跳过后纳入循环，验证禁止控件及外逸焦点回退。IPC 取消用例的任务选择仍使用正常控件点击，与键盘专项互补。

### 修复后的最终组合验证（2026-10-05 12:23 UTC，待 astra 审阅）

| 检查                                                | 修复后的新结果                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISPLAY=:99 pnpm test`，Node 26.5.1 / pnpm 10.33.3 | **54 文件通过；1096 passed、1 skipped，共 1097 项；0 failed**。Vitest 开始 12:22:24 UTC，耗时 65.43 秒，命令包含五包完整 build/TypeScript 编译与 Electron 测试项目。日志 `/tmp/plums-fix-final-combined.log`。                                                                                                                              |
| build 后的定向 core/host/examples/真实确认与 IPC    | 5 文件通过；36 passed、1 skipped（37 项）。日志 `/tmp/plums-fix-focused5.log`；后续完整组合还包含最后更新的确认文案。                                                                                                                                                                                                                       |
| 适用 Prettier                                       | 全部通过：范围模块与 core 测试、host 两个改动源文件与两个测试、全部 desktop/src/test、Vitest 配置、AGENTS/README、confirm-copy/desktop/实施记录。日志 `/tmp/plums-fix-format-final.log`；最后追加的实施记录再单独检查。既有 core/create-core、architecture/capabilities 的紧凑代码片段保留排版，仅修改 API/行为说明，避免无关全文件格式化。 |
| lint / diff                                         | 仓库仍无独立 lint script；使用现有 TypeScript 与 Prettier 流程，`git diff --check` 通过。                                                                                                                                                                                                                                                   |
| macOS 原生与打包 smoke                              | 本轮未在 Linux 验证：真实目录句柄 helper 测试 1 skipped，safeStorage、macOS 标题栏/焦点、原生 select 行为、DMG 和打包 smoke 仍待 macOS。Linux 真实键盘通过不等于 macOS 原生验收。                                                                                                                                                           |
| 远端与提交状态                                      | main 仍 `090d81e90f33ee69f55c24c613be9c0ded568e0d`，本地/远端分支仍 `5fc44904833582e6197003efa2e633ab4e2b17c9`，所有本轮修复未提交、未推送。保留 PR #32；按用户模型流程等待 astra 只读审阅后再提交，并在新提交上核对 CI。原 `/workspace/plums` 无改动。                                                                                 |

一次中间定向命令漏设 DISPLAY，Electron 报 `Missing X server or $DISPLAY`；随后显式设置 `DISPLAY=:99` 重跑通过。该启动失败已与代码回归及最终结果分开。上面的修复后结果取代本轮中间失败，原先 1079/1 与历史 1062/1042 记录仍仅代表各自历史提交，未合并计数。

本轮保持 exec/stdio 拒绝、凭据与调用链交集、目录真实边界及 Sink 前复核；没有新增 OS 沙箱或命令执行后端。完成实现后的下一步是 astra 只读审阅当前未提交 diff，之后由 sol 执行审阅要求和既有草稿 PR 的提交/推送/CI 核对。

### astra 审阅与 sol 收尾

astra 对上述未提交 diff、周边授权/生命周期/键盘实现及 sol 的现有日志完成只读审阅，没有重新运行测试或修改代码。结论：无 P1/P2 提交阻塞；固定桌面策略覆盖所有 core 构造，兼容默认、范围快路径、调用链/Sink 前复核保持，真实 IPC 路径与键盘例外正确，AGENTS 更新仅涉及本次契约。

审阅提出两项 P3 测试增强，由 sol 执行，未修改生产实现：

1. frontend JSONL 过滤空行并解析记录，批准写入和每次拒绝读取后均精确断言 `[{operation: "write"}]`，不再把空字符串 split 后的长度 1 当作正控制。
2. 宿主等待单次 read 的确认请求审计，记录该 callId；撤权并释放迟到同意后，等待同一 callId 的 `denied / not_started / PERMISSION_DENIED` 终态审计，再断言文件 Sink 为空。外层 runtime 的 Extension stopped 不再作为宿主处理完成的唯一依据。

增强后的定向测试：2 文件通过，10 passed、1 skipped（11 项），12:28:51 UTC，耗时 6.18 秒，日志 `/tmp/plums-review-followup-focused.log`。本轮仅测试/记录增强，按已通过的 astra 审阅继续最终验证与原草稿 PR #32 的提交推送。

审阅增强后的最终提交前组合验证：`DISPLAY=:99 pnpm test`（Node 26.5.1 / pnpm 10.33.3）**54 文件通过，1096 passed、1 skipped，共 1097 项，0 failed**。Vitest 开始 12:29:57 UTC，耗时 65.71 秒，包含完整 build/TypeScript 与所有单元、集成、Electron 项目，日志 `/tmp/plums-reviewed-final-combined.log`。适用 Prettier 全通过（`/tmp/plums-reviewed-format.log`），`git diff --check` 通过。相同唯一跳过项与 macOS 原生验收边界保持；此结果包含两项审阅增强，作为本次提交的最终本地证据。

## 修复提交与远端核对（2026-10-05 12:33 UTC）

- 修复提交 `511407895963e890111434c37aa45a78bcf83b9f` 已推送原分支 `feat/agent-scope-permissions`，本地 SHA、git ls-remote 和 PR head 一致；原工作目录未改动。
- 现有 <https://github.com/YhxMo/plums/pull/32> 已更新修复行为、回归结果、模型审阅及 macOS 限制；服务端确认 open、draft=true、merged=false、mergeable=true。未创建重复 PR，未合并、未部署。
- 新修复提交的 GitHub App 查询：Actions runs total_count=0，check-runs total_count=0，combined status 的 statuses=[]（聚合 state 为 pending，未对应任何 job）。没有远端 CI 结果，不是 CI 通过，也没有可修复的失败 job。
- 最终本地验证为审阅增强后的 1096 passed / 1 skipped，完整证据见上节；macOS 原生边界仍待相应平台。此条以独立文档提交记录推送后事实，不改变已验证代码；收尾再核对文档提交对应的 PR head/CI 与干净工作区。
