# M2 工程前置：边界、业务所有权、返回与 IPC

日期：2026-10-18（Asia/Singapore）。状态：P6 → P1 → P7 → P2 已完成并经独立审查。最终源码为 `a307648` 上的工作区增量，绑定 [333 文件清单](source-manifest-1141371194a1db8ccd9dcde879fafb438e2dacdc42bf59d724ef7e05c4fc453a.json)。实现差异及新增原件保存在 `.cache/p6-p1-p7-p2-2026-10-18/final-source.patch` 和 `final-new-files/`，P7 单阶段来源另存 `p7-source.patch`/`p7-new-files/`。当前 `release/` 仍为 `015ac2d` 的 M2.0 交付，不代表本次增量。

## P6：允许名单

SDK、宿主、modules/shell、src/shell 和扩展按各自允许名单检查；业务组合留在 src/application。静态 import/export、类型导入、动态 import 和 require 继续由 TypeScript AST 解析；未知目录、目录逃逸、空集合和语法错误均拒绝。SDK barrel 不能间接把 Agent API 引回通用层。

新增未知模块/目录反例在原规则下有 9 项失败，修后通过。独立审查进一步复现裸 `import ".."` 绕过：新增 5 个越层反例修前全部失败，修后拒绝，另保留 4 个层内目录正例。全仓边界检查为 0 问题。

## P1：Agent 状态和诊断归业务

`src/application.ts` 拥有默认组合、Agent 恢复和保存接线；通用 `bootShell` 接收应用组合，不解析 Agent 数据。`host.shell` 的旧字段、串行 revision 和未知写回执锁存保持；不透明业务字段在普通偏好保存中保留。Agent 来源诊断移到 `modules/agents`，管理 feature 负责消费；通用 fallback 读取目录提供的可选视图提示。

不提供 `agents` 的替代组合在原实现被 `restoreAgents` 拒绝；现在可以启动、管理、保存、重启、停用和恢复，原不透明字段仍在。旧角色/会话、默认启动布局与草稿另有回归。

独立审查发现目录提示会把继承的 `constructor`/`toString` 当作贡献，修复为只接受自有字符串属性，并对相邻 failedImports 查找采用同一规则。4 个新反例修前全部失败；修后诊断与边界 96 项通过，独立复核关闭两项审查意见。

P1 修复目录提示前的完整 Web 门禁为 552 单元通过，目录提示修复后另增 4 项；最终总数以本次集成门禁为准。相关 Chrome E2E 50/50 通过，含 375/1180px 无 Agent 组合与旧角色/会话恢复，实际截图已检查。

## P7：Android 返回层级

旧 M2.0 普通包在新建 API36 ARM64 隔离模拟器中复现：管理页发送真实系统 Back 后，前台变为 Launcher，应用 PID 消失。新增浏览器用例在修前 4/4 失败。

开发候选通过 AndroidX 回调先收 IME，再向 WebView 派发可取消的返回事件。外壳依次处理顶层菜单/弹窗、管理页和当前工作区 View.chrome 快照中的 `back()`；根层才交回 Android。默认会话返回列表保留草稿并恢复相应行焦点；未知原生回执不执行退出。生成工程精确接受原始/已知 Insets-only/当前模板，未知修改仍拒绝。

独立审查补出回调接收者与列表返回焦点问题；新增反例修前 3 失败、3 通过，修后 6/6 通过，覆盖真实扩展回调异常隔离和停用后的旧回调释放。模板及 chrome 单元 19/19 通过。

首次普通候选已通过 IME、管理返回、嵌套弹窗、菜单、深色返回、会话/列表草稿和根层系统退出。审查修复后的普通包重新完成同一路径，另外断言返回列表的焦点；`android/final/after-result.json` 为通过结果。实际查看浅色管理返回、深色会话与嵌套关闭后的设备截图。嵌套关闭的即时截图曾捕到旧合成帧，最终以原生无障碍空闲后截取的 `after-nested-idle.png` 核对，删除确认已消失、下层详情保留。WebView DOM 与设备截图分别核对。

## P2：IPC 契约

Rust 的 `ipc_command!`/wire 声明同时产生实际命令、serde DTO 与编译导出元数据；注册和导出共享命令清单，默认 17 条、实验特性额外 6 条。`ipc:generate` 生成 TS 类型，`ipc:check` 对照编译结果而不覆盖文件。单侧命令改名实测失败，恢复后两份契约检查通过；类型反例覆盖未知命令、参数拼写/类型、缺必填参数、响应和状态漂移。

状态拒绝改为稳定 code，平台层按码显示中文，不再匹配英文句子。未知码/缺失回执继续归 unknown；既有取消、成功提交回执优先及坏数据保留回归保持。新增稳定拒绝反例在原实现被错误归为 unknown，修后按确认未提交处理。

独立审查复现包根 core 绕过、生产目录扫描遗漏及普通模块导出实验桥接：新增 15 项反例修前失败，修后通过。进一步核对当前包导出发现合法 index 别名，再补 3 个拒绝反例及非 core 正例；最终 IPC 定向 27 项通过，审查意见关闭。实验桥接物理移入 tests，生产代码不得导入该入口。检查限定为正常开发路径，不声明静态检查能隔离恶意代码。

P3 随动拆分将 documents 从 906 行降到 503 行，credential_bindings 从 601 行降到 451 行，预算分别降至 510/460；后端、DTO/政策和测试有实际职责，无新增转发层。Host 660/660 的剩余拆分仍按后续修改触发。

## 最终集成验证

macOS arm64、Node.js 26.5.1、锁定 TypeScript 7.0.2 与配置的 Chrome。Web 完整门禁在 index 别名补测前通过 580 单元及构建/类型/格式/边界/行数/lint；最终两文件修复又通过针对性类型、边界和 lint，主工作区最后全单元 **584/584**、格式及项目检查通过。日志为 `integrated-web-final.log`、`integrated-unit-final.log`、`integrated-format-final.log` 和 `ipc-index-final.log`。

完整浏览器首次 **128 通过、1 失败**：新增测试在关闭管理页后立刻派发第二个 Back，没有等待 UI 提交。改为等待扩展停用、视图释放与管理页关闭，所有行为断言保留；定向 **6/6** 通过后，完整重跑 **129/129** 通过。首次、定向和最终日志分别为 `integrated-e2e.log`、`integrated-e2e-focused.log`、`integrated-e2e-final.log`。

主工作区 `verify:native` 通过默认/实验契约漂移检查、stable rustfmt、Clippy 与默认 **33** 单元（`integrated-native.log`）。实验 feature **39** 单元在 P2 工作区执行，之后 Rust 实现与测试未变，记录为 `ipc/plums-p2-experimental.log`；此结果不代替普通包运行。

最终 Android 普通候选 `android/integrated.apk` 构建通过，在全新隔离应用数据下实际验证：未授权状态读取返回 permission-denied/not-committed，授权后保存回执 revision=1，旧修订写入返回 revision-conflict/not-committed 且保留原状态，文档能力返回布尔；随后完成 P7 全部返回/草稿/焦点路径。结果为 `android/integrated-final/ipc-result.json` 和 `after-result.json`。

首次集成设备脚本的多会话勾选没有确认，导致删除会话场景未建立；已保留失败结果，补原生界面空闲同步和勾选状态断言后，同一 APK 的完整重验通过。没有修改产品代码、放宽超时或替换失败断言。

## 本地提交前复核

工程前置与文档整理在同一次本地提交保存，父基线为 `a307648`。提交前将实现差异及 27 个新增非文档文件逐字节对照上述最终原件，均未变化；因此前述浏览器、Rust 和 Android 结果继续对应同一实现，本次没有重新执行这些平台验收。

`npm run verify:web` 重新通过：52 个测试文件、584 单元，以及构建/类型、格式、项目/边界、行数和 ESLint。精确暂存内容另经隐私、空白、忽略规则与独立审查核对，使用可核验的 GitHub noreply 身份本地提交，不推送。

目录清理仅移除闲置、可重建的 Rust/Gradle 中间产物、图标暂存和旧报告；交付包、独立候选、签名材料、运行数据及历史证据保留。当前验证页移出的历史正文原样保存于[工程维护记录](MAINTENANCE-2026-10-17.md)，引用同步更新；首次原生编译会重新生成缓存。

## 验证材料与限制

原始输出和合成截图在 `.cache/p6-p1-p7-p2-2026-10-18/`；P6/P1 日志归入其中 `boundaries/`，P7 普通包/设备记录在 `android/`，不提交原始日志或截图。Android 首次安装在首次开机服务尚未就绪时失败，启动完成后安装成功；测试脚本的标签选择和截图帧同步修正不计为产品修复。

仅 API36 ARM64 三键导航模拟器参与本次 Android 交互验收；Mac 最终普通包交互、真机、其他系统/WebView、预测返回动画及完整辅助技术未验。未访问真实秘密、账户或模型 API，不增加 M2.3/M2.4 的通过结论。现行计划已移除完成项并保留 P3/P4/P5 及后续 M2 子阶段，历史证据与旧包不删除。
