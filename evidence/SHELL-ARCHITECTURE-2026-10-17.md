# 宿主前端职责重构

日期：2026-10-17（Asia/Shanghai）。负责人：应用维护者；未参与实现的审查者独立只读核对旧实现、当前源码、测试日志及实际Mac浅深截图／坐标。范围为宿主入口与状态归属、扩展管理、工作区标题和侧栏契约；保持既有界面尺寸、数据格式、授权及生命周期入口。

## 受验源码与产物

基线为提交 `97c9818`，受验源码是其上的未提交工作区差异：

- `src/App.tsx` 改为启动入口；新增 `src/shell/`，承接配置恢复与串行保存、工作区挂载、外观、宿主导航、反馈、授权及弹窗。
- 新增 `src/features/extensions/`，承接扩展清单、详情、诊断、安装、配置与卸载；编辑草稿归各表单所有。
- `modules/sdk/index.ts` 及新增 `modules/sdk/workspace-chrome.ts` 提供可选 View.chrome；`modules/extension-host/host.ts` 仅在视图有贡献时透传，旧查询形状保持。
- `src/agent-ui.tsx`、`src/components/AgentWorkspace.tsx` 改用工作区订阅，移除私有全局事件和对应镜像状态。
- `tests/web/agent-flow.spec.ts` 修正格式并补标题／详情状态断言；新增 `tests/workspace-chrome.test.ts` 与 `tests/web/workspace-chrome.spec.ts`。
- 保留既有 `src-tauri/tauri.conf.json` 的 trafficLightPosition 修正。CSS、依赖清单和锁文件没有变更；文档按实际职责和验收结果同步。

本地 `.cache/shell-refactor/source.patch` 保留上述基线到最终工作区的内容差异，包含新增文件；原始日志、截图和数据保持忽略。普通构建输出为 `src-tauri/target/debug/bundle/macos/Plums M1.app`，原生运行副本为 `.cache/shell-refactor/native/Plums M1.app`。生产入口资源为 `index-Bv2Sjo1v.js` 和 `index-DrHoTW6h.css`。本次没有替换 release 或提交 Git。

## 结构与行为

App 从1854行缩至35行，只保存启动结果。Workbench为96行，装配各责任域，不再持有扩展编辑表单、主题副作用或工作区挂载流程。ExtensionManager为274行，持有管理页选中项及互斥弹窗；配置、安装、卸载各自管理输入及返回焦点。安装框关闭保留已输入路径，配置取消重建草稿，管理返回保留业务挂载，均沿用原有使用条件。

标题与默认详情状态由当前工作区发布。上下文侧栏依次按实体扩展所有者、工作区所有者选择，其他扩展不能全局抢占；没有匹配贡献时使用工作区默认详情。可选元数据不要求旧视图迁移，也没有把 Agent 类型加入通用 Host。

## 失败证据与独立复审

初始格式检查复现 agent-flow.spec.ts 不符合 Prettier。普通外部工作区发布标题的新增回归在修改前失败，顶栏仍显示布局标签。

独立审查发现并修复三个 P2：

1. chrome 快照或订阅抛错进入 React 后会破坏宿主界面。新增 snapshot 失败回归修改前失败；修复后读取、订阅、通知与操作均在 shell 消费边界处理，失败按视图 ID 与 generation 进入现有回退，旧代不会排除新代。
2. Agent ID 可能发给其他实体的工作区。新增普通任务工作区回归修改前失败；修复后导航须匹配 entityType，非匹配接收者的 Agent 跳转禁用并提供原因。
3. 移动默认详情转桌面或动态贡献上下文侧栏时可能同时显示两份详情。新增 resize／dynamic 回归覆盖普通外部 Agent 提供者；默认 inline 详情会关闭，移动 dialog 的本地行为保留。

独立只读复审确认三项闭环，未发现新的实质阻塞；未由审查者重跑测试或操作原生窗口。

## 已执行验证

| 检查 | 结果与范围 |
| --- | --- |
| `npm test` | 35文件、271项通过，含替代挂载清理、独立订阅、稳定失败快照与迟到通知 |
| `npx playwright test --workers 4` | 100项通过，含授权、配置失败、卸载、启动恢复、草稿、释放，以及7项工作区chrome场景 |
| `npm run format:check` | 通过 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 通过 |
| `npm run native -- build --debug --bundles app` | TypeScript、Vite生产资源和普通Mac debug app构建通过 |
| `npm run check:project`、`git diff --check` | 文档链接、清单、空白及指定隐私模式检查通过 |
| Vite生产预览实际运行 | 无pageerror；浅深、管理页及草稿保留通过，实际查看渲染 |
| 真实Mac包运行与冷恢复 | 下述限定路径通过 |

日志为 `.cache/shell-refactor/final-{unit,web,format,types,mac-build}.log`。生产预览在1180×820逻辑尺寸测得：顶栏48px、左栏256px、详情内宽268px且四角14px、正文14px、顶栏工具32px；CSS未改。首次浏览器深色捕获处于颜色过渡中，不用于最终外观结论；最终外观以已查看的真实Mac浅深窗口图为准。

## 真实 Mac 窗口

Mac arm64、系统WKWebView。直接运行上述普通候选包的可执行文件，隔离数据为 `.m1-data/shell-refactor-2026-10-17/`，仅含合成角色和会话。

原生AX验证当前会话标题、详情展开／关闭及顶栏开关同步、管理页返回保留草稿和详情、新会话与发送后的标题更新、本地文本结果保存。新进程恢复深色外观、会话消息与标题。使用 macOS 窗口截图取得两张2360×1640 PNG，原生红绿灯可见；系统按钮中心距顶端24逻辑px，品牌及主题按钮23.5px，误差0.5px。

原始证据在 `.cache/shell-refactor/native/`：`native-light.png`、`native-dark.png`、`native-manager.png`、两种主题几何记录、各步AX与checks.json。早期锁屏使AX不可读及初始窗口为空白；解锁后同一候选正常呈现并完成操作，冷进程复验通过。没有改动系统安全设置或签名配置。

本次未重新执行Android构建／模拟器路径、Rust测试、完整原生窗口操作和原生外部上下文侧栏贡献替换；Rust业务实现没有变更。浏览器与Mac结果各自有效，其他平台与M2完整退出继续按当前阶段计划验收。
