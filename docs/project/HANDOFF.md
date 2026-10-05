# HANDOFF: Plums 第二阶段交互重构

生成时间：2026-10-05 08:02（Asia/Shanghai） · 基线：main @ 338189833bb8e54436ac1d0e0f5c84d8eeafd122

最近核实：2026-10-05 15:49（Asia/Shanghai）。本次仅同步交接记录，产品源码未修改。

## 目标

用户要求继续 /local/user/.claude/plans/plums-ui-adaptive-clarke.md 的下一阶段。该文件现已被视觉 v3 覆盖；此前会话「按计划分阶段优化桌面 UI」（01a10879-509f-7191-b624-a7de161f3309）保存了原四阶段计划。本次结合原计划与已有交接，完成第二阶段尚未实施的交互与状态重构，沿用现有石墨/柠檬视觉。

## 当前状态

- DONE：组件与公共库条目独立等待/错误、同步防重复提交、配置等弹窗独立错误、切换 Agent 后丢弃过期结果、首次加载骨架与刷新失败重试。
- DONE：已有组合的名称失焦/回车保存、默认卡和工作界面即时保存；新 Agent 保持草稿直到创建。更新统一使用已导入公共库的较新版本，移除文件直更入口。
- DONE：停用与解除目录绑定先说明后果并默认取消；解除后撤销目录授权、保留文件，可重新绑定。组件页、拖放逻辑、术语及开发者原始结果已提取。
- DONE：最终组合 pnpm test 通过 48 文件/1042 项；新 App/DMG 打包与真实 I/O smoke 通过。没有正在执行的测试或实现任务。
- DONE：后续会话核对实际源码与产物，并重新运行 pnpm test，仍为 48 文件/1042 项通过。原计划第三阶段的运行顶栏/返回保留运行、第四阶段的独立安全确认窗口均已存在，不能按阶段编号重复实施。
- 既有 v3 原生拖动验收仍有证据缺口；后续会话追加 CUA 实际拖动与标准系统标题栏对照，两者均无窗口位移，未声明拖动通过，也不能据此认定 Plums 源码有故障。
- 工作区保持 main，保留原有 core/CLI/规则/文档及未跟踪 desktop/host/sdk/示例等改动。本次没有提交、推送、重置或创建 PR；git diff --stat 不包含未跟踪实现。
- 本次未修改 AGENTS.md 或 core/SDK；稳定规则仍以 AGENTS.md 为准。

## 关键决策与原因

- 等待与错误属于发起操作的条目或弹窗；仅重复的同一操作被同步拦截，其他组件与导入入口仍可用。全局 Store 仅管理数据、加载与路由，epoch 防止旧读取覆盖新选择。
- 已提交操作与随后刷新分开报告。保存/创建/导入成功后刷新失败只提供重新读取入口，不把提交标为失败或引导重复创建。配置弹窗缺少目标记录时不锁住主页面，刷新成功后显示配置。
- 已有组合逐项即时保存，成功显示「已保存」；名称失败保留输入，偏好失败恢复已有值。新建组合继续显式创建，避免草稿成为半成品。
- 组件先导入公共库，再显式更新 Agent；最高较新版本的提示忽略构建元信息，并正确比较包含连字符与长数字的预发布版本。旧版不作为更新目标。
- unbindRoot 按 Agent 串行执行，拒绝 agent-data 和非法逻辑名，停止并清除旧 session 后原子保存新的 roots；后续 core 使用新的目录授权。桌面仅通过可信管理桥调用，不向包前端暴露。
- 影响运行的操作仍走主进程恢复流程；确认、权限同意、逐次能力批准与审计保持既有语义。移除不用的管理桥分支和原生直接停用菜单，停用入口统一确认。
- Electron 原生全屏与失焦默认拒绝共用 macOS 焦点，三份 Electron 文件按 Vitest groupOrder 顺序执行，其他单元套件仍并行；未放宽失焦拒绝行为。

## 死路与坑

- macOS 未激活原生测试窗口时全屏事件不会完成。原生回归先显式 show/focus 并确认激活，事件等待有超时；全屏进入/退出和主题变化实测通过。
- 同时跑原生全屏与安全窗口测试会抢焦点，使确认正确按失焦拒绝，出现 page closed；分组后最终全量通过。
- 临时路径经 realpath 后在此机器可能从 /var 变成 /private/var；目录回归按真实路径比较。解除绑定不改变组件已有启用状态。
- 之前 v3 的 CUA drag 返回成功但窗口 bounds 无位移；CSS drag 属性、原生坐标与双击缩放不能替代实际拖动验收。
- 后续会话确认 CUA 的 macOS 坐标按 Retina 截图像素映射：点击截图上的设置标签成功切换页面。两次顶栏拖动后，真实主窗口仍为 x=145、y=33；独立默认系统标题栏窗口拖动后仍为 x=285、y=178。当前输入工具也未移动对照窗口，实际鼠标位移验收仍需要人工补测。
- 本次基线快照为 .artifacts/ui-stage2-baseline/。旧视觉快照、当前截图和 release 产物均被忽略，不作为提交内容。

## 涉及文件

路径相对 /Volumes/YHX/plums。

- packages/desktop/src/hooks/useAction.ts:4、state/ManagerStore.tsx:124、app/App.tsx:90 —— 独立操作、加载竞态、仅可见弹窗锁定背景。
- packages/desktop/src/components/ComponentRow.tsx:43、components/LibraryView.tsx:106、shared/version.ts:1 —— 条目状态和公共库更新。
- packages/desktop/src/dialogs/AssemblyEditor.tsx:131 —— 已有组合即时保存、新建草稿、失败与关闭处理。
- packages/desktop/src/views/ComponentsView.tsx:13、components/RawJson.tsx:1、hooks/useFileDrop.ts:3、components/Skeleton.tsx:1 —— 页面提取、开发者结果、拖放与加载反馈。
- packages/host/src/host.ts:831、packages/desktop/src/broker.ts:187、main.ts:443 —— 目录解绑与运行恢复。
- packages/desktop/test/interaction-ui.test.ts:1、version.test.ts:1、packages/host/test/examples.test.ts:229 —— 交互、版本与重启后目录撤权回归。
- packages/desktop/test/onboarding-ui.test.ts:982、vitest.config.ts:31 —— 原生激活/全屏与 Electron 测试顺序。
- scripts/desktop-smoke.mjs:637、docs/desktop.md:29 —— 真实打包应用验证与当前行为说明。

## 验证情况

- 环境：macOS Apple Silicon，Node 26.5.1、pnpm 10.33.3。夹具与 smoke 使用临时目录，无真实模型凭据；钥匙串测试未选择。
- 基线构建与 onboarding 4 项通过；新增公开 UI 回归先复现同一按钮同步点击两次发出两次调用，再验证修复只发一次。
- 最终 pnpm test 于 08:00 通过：48 文件、1042 项。覆盖 core/CLI/SDK/host 与桌面最终组合，不引用旧提交结果替代本次检查。
- 后续会话于 15:42 重新完成 pnpm test：48 文件、1042 项，包含构建、主题/布局矩阵、真实原生全屏/主题、6 项交互及独立安全确认回归。HEAD、Node 与 pnpm 均与交接基线一致，git diff --check 通过。
- 新增 6 项 Electron 交互回归：条目隔离/重复提交、即时偏好与名称失败重试、公共库更新/停用/解绑确认、切换后旧结果丢弃/已提交保存刷新失败、新建草稿/弹窗期间忽略拖放、已创建 Agent 刷新失败后重新读取且不重复创建。
- 宿主目录回归覆盖读前/解绑后拒绝、文件与其他根保留、启用状态保留、重启仍撤权、重新绑定恢复访问，以及保留根和非法逻辑名拒绝。
- 浅深主题 × 1180/760/375/320px 的主题/布局矩阵重新通过；查看了桌面浅色和 320px 深色组合编辑截图，固定偏好与关闭按钮可见，无整页横向溢出。原生窗口最小宽度仍为 900px。
- pnpm desktop:package 于 08:01 通过，最终 App 与 DMG 已更新；原生模块加载通过。
- pnpm desktop:smoke 于 08:02 通过：即时组合偏好、目录解绑取消/确认、解绑拒绝且原文件保留、重新绑定可读；真实 FS、HTTPS 200、DeepWiki MCP 发现/调用、9 次执行确认、直接联网拒绝、崩溃/无限循环恢复、运行返回/继续/停止/重开均通过。
- smoke 结果 release/smoke/result.json 中 immediateAssemblyPreferences 与 directoryUnbindAndRebind 均为 true，keychainEncryption 为 not-requested；不要把目录读写成功当作钥匙串验收。
- Prettier 检查 desktop 源码/测试、host 受影响文件、smoke、Vitest 配置及文档通过；git diff --check 通过。诊断代码已移除。
- 产物：release/Plums-darwin-arm64/Plums.app、release/Plums-0.1.0-arm64.dmg；截图 .artifacts/visual-v3/、release/smoke/。
- 后续会话核对 App/DMG 与 release/smoke/result.json 的时间及内容，未重新打包或重跑联网 smoke。真实拖动检查使用当前构建的 main/preload/broker、独立临时数据目录和默认 Electron；不操作用户已有 Plums 实例。两份窗口坐标观察保存在 .artifacts/native-drag-result.json 与 .artifacts/native-drag-control-result.json；临时验收进程、脚本与数据已清理。
- 未验证：实际鼠标拖动窗口位移、真实模型凭据对话、macOS 钥匙串授权、开发者签名/公证、自动更新、其他机器、Windows/Linux、200% 缩放及长期稳定性。

## 下一步

原计划第二阶段遗留的交互重构已收口；第三、四阶段的运行与安全确认也已存在并随当前组合回归。本次没有新增功能。原生窗口实际拖动验收仍缺少通过证据，当前 CUA 对照不能验证窗口移动；其他后续功能范围尚未指定。

## 新会话开场白（可直接粘贴）

> 先读 /Volumes/YHX/plums/docs/project/HANDOFF.md，对照 git status 和实际代码核实其中的每一项声明，然后等我指令。
