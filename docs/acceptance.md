# 组合验收与能力边界

2026-10-11 在 macOS 27.0.1 arm64、Node 26.5.1、pnpm 10.33.3、Electron 44.5.1 上验证。Electron 内嵌 Node 为 24.21.0，与宿主独立 Node 分开记录。验收使用自造组件、数据和凭据，不认证真实外部服务或作者。

## 默认套件与独立复核

最终组合以 `9ace54f` 的代码为输入；本次收敛仅修改文档及验收摘要。完整默认测试保留原生全屏焦点用例，项目成员回收实验仍由显式实验入口单独运行。逐文件结果、条件跳过和独立复核见[组合验收摘要](verification/combined-acceptance-2026-10-11.json)。

| 运行                  | 文件与用例结果                                                   | 结论                                           |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| 完整默认首轮          | 191 文件：190 通过、1 失败；2,781 项通过、1 失败、1 平台条件跳过 | 构建通过，`pnpm test` 退出 1；没有全量通过结论 |
| 权限界面独立重跑      | 1 文件、3 项全部通过                                             | 无代码或测试修改；不证明首轮失败已解决         |
| 原生全屏/主题独立复核 | 1 项通过、3 项因名称筛选未运行                                   | 默认首轮同一原生用例也通过；不解释历史焦点失败 |

首轮唯一失败发生在 `local-permissions-ui.test.ts:87`：宽泛文案定位器同时匹配“待确认汇总”和整机组件入口的提示，Playwright 严格定位报错。该用例当轮没有继续到可信确认、进程启停与撤权；独立重跑完整走完三个用例。定位范围的歧义仍待处理，不能用重跑通过改写首轮记录。

原生全屏/主题在默认首轮与独立复核均使用原有五秒守卫通过。先前研究轮次失败及系统激活根因仍保留；本轮开发树通过不认证安装版全屏，也不承诺其他运行环境稳定通过。默认套件唯一条件跳过是非目标平台的项目符合性记录用例，属于当前 macOS arm64 环境下不适用的负分支；原生独立复核的三个名称筛选项单独统计。

完整命令先准备固定运行时并构建，再运行测试；不与构建或另一轮原生/GUI 测试重叠：

```sh
mkdir -p .build-cache/acceptance/ui .build-cache/acceptance/diagnostics
PLUMS_UI_REPORT_DIR=.build-cache/acceptance/ui \
  /usr/bin/caffeinate -dims pnpm test \
  --reporter=default --reporter=json \
  --outputFile=.build-cache/acceptance/full.json
```

诊断目录在运行前创建。首轮失败与独立重跑分别记录，单独通过不能证明首轮原因已解决；不会增加原生焦点五秒预算、模拟全屏事件或排除默认守卫。适用范围的通过项不能转换为完整 `pnpm test` 通过。

构建结束且完整默认测试退出后，再顺序运行独立复核：

```sh
PLUMS_UI_REPORT_DIR=.build-cache/acceptance/ui \
  /usr/bin/caffeinate -dims pnpm exec vitest run \
  packages/desktop/test/local-permissions-ui.test.ts \
  --reporter=json --outputFile=.build-cache/acceptance/permissions-rerun.json
PLUMS_UI_REPORT_DIR=.build-cache/acceptance/ui \
  /usr/bin/caffeinate -dims pnpm exec vitest run \
  packages/desktop/test/onboarding-ui.test.ts -t 'integrates native window' \
  --reporter=json --outputFile=.build-cache/acceptance/native-rerun.json
```

测试文件覆盖、文档链接、版本、发布工作流、修改文件格式和差异静态检查通过。代码和测试树未修改，文档收敛后只重跑相应静态检查，不重复已完成的全套运行。

## 行为与证据索引

| 范围           | 当前行为与证据                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生命周期       | 同包导入、更新、卸载共用所有权，提交复核安装身份与版本，退出进程的事务可恢复。公开行为和边界见[中断恢复](desktop-recovery.md#包更新与卸载中断)。                |
| 性能与状态     | 管理刷新合并未开始的读取并隔离旧回复；任务读取串行并随活动/可见状态调度。次数测量、独立压力和未定位的历史超时见[性能说明](performance.md)。                     |
| 准备与配置     | 宿主准备清单、字段错误定位、部分保存、详情分区与撤权入口见[管理界面](desktop.md#管理界面)和[界面验收](verification/desktop-readiness-ui-2026-10-11.json)。      |
| 恢复与交付     | 自造停机备份恢复、固定制品、密钥权限及范围清零见[恢复步骤](desktop-recovery.md#备份与回滚)。实际安装副本与打包符合性见[本地交付验收](desktop.md#本地交付验收)。 |
| 原生与外部条件 | 只读成员探针、进程组/同沙箱反例、路径注入反例、焦点及签名/公证/外部制品条件见[原生研究](native-research.md)及其逐轮摘要。                                       |

生命周期修复的初始复现为 14 项中 12 失败、2 通过；补充后共有 26 项新生命周期回归。提交 `1fe8815` 基于 `6f608e6` 的适用联合验收为 62 文件、1,335 项通过；该历史计数不代替最终默认套件结果。复现当前生命周期组合先构建，再运行：

```sh
pnpm build
pnpm exec vitest run packages/core/test packages/cli/test \
  packages/host/test/lifecycle-recovery.test.ts \
  packages/host/test/library.test.ts \
  packages/host/test/local-assembly.test.ts --maxWorkers=2
```

其余已跟踪摘要分别保留首轮、重跑、最终组合及方法限制；不依赖本地截图、缓存或过程会话才能理解结论。测试分组和默认覆盖范围见[测试说明](ci.md)。

## 安装包证据的适用范围

当前构建的桌面 `dist` 共 214 项，文件内容、权限及链接清单与[已验收安装包清单](verification/desktop-package-inventory-2026-10-11.json)完全相同，规范化 SHA-256 仍为 `6c13e4638b49d3c67aad0e9edfc6a01ad81db9791a48342010cc19d8bb68b32b`。包源码和配置也与该证据一致。

原清单输入之后增加了三个只读诊断脚本，并收紧 `scripts/package-manifest.mjs` 的实验 helper 拒绝项；完整工具输入集合因此不同。本次没有生成新 app/DMG，也没有重新认证安装、启动或打包符合性。已有安装验收仍限于原记录的应用与镜像摘要；当前源码测试、构建一致性和历史安装验证分别判断。

## 保留的未完成项

- 默认套件首轮的权限文案定位失败尚未解决；后续应缩小到预期区域，保留确认、启停和撤权断言，再验证默认组合。
- 原生全屏/主题本轮两次通过，但历史系统激活失败仍未唯一归因。有效的用户激活或 LaunchServices 对照，以及安装版原用例验收仍需独立证据。
- 项目成员实验首轮与独立重跑均为 11 失败，全部阻断于成员校准，没有进入扫描/回收。只读探针仍为 `INCONCLUSIVE`，不能证明零残留；项目启动继续返回 `TIER_UNAVAILABLE`。
- 整机和受控命令仅使用进程组清理，停止或撤权可能留下脱组后代。该限制继续显示于首次汇总确认与权限页。
- Developer ID 签名、公证和真实下载分发尚未验收；现有包是 ad-hoc，Gatekeeper 拒绝。真实服务账号、独立连接器/业务组件来源与作者符合性仍缺少外部证据。
- 历史并发超时尚未复现或唯一归因，IPC、执行和排队开销尚未独立分解；独立压力通过不构成该故障已修复的证据。

`prepared / evidence:"declared"` 只说明声明和准备条件，不授予权限或证明服务成功。授权、范围、策略、审计及完整复核保持原有契约；时序敏感回归保留 `groupOrder` 200/201，Agent 任务面板保留 `tasks:${record.instanceId}`。生命周期恢复仅覆盖进程中断，不保证断电、磁盘损坏或共享文件系统安全；密钥删除不可逆，PID 复用或状态不明仍可能阻止接管。
