# Agent 底座固定与切换

可信宿主为每个 Agent 保存一个精确底座绑定。选择包含 `source`、`id`、具体 `version` 和 ZIP `digest`；本地绑定另有随机 `installationId`、`bindingVersion: 1`、`enabled` 和 `dataFormat`。调用方不能用业务参数或提供者消息改写绑定。

## 创建、迁移与选择

`HostOptions.foundation` 是新 Agent 和无绑定旧记录的默认选择。省略该选项时使用当前官方 builtin 适配快照。构造时复制；已有 Agent 的绑定优先，改变应用默认不会改写它。`createAgent(name, digests, characterId, startup, protocolBindings, foundation?)` 的最后一个参数是公开 `FoundationAgent`，可显式提供 requirement 和精确 selection。ZIP 内显式底座字段同样约束导入。声明 requirement 而没有 selection 时返回 `FOUNDATION_SELECTION_REQUIRED`，不猜测默认选择。

旧 Agent 没有声明时迁移到当前默认选择，不恢复任务、策略、资源范围或前端句柄。未知本地 binding major、损坏记录和无法恢复的事务保留原始数据并阻止执行。组件更新、加入组件、新建和启动前检查 Agent 需求及所有带 runtime 的组件，包括停用组件。每份需求独立检查协议、SDK、必需功能、提供者、平台和宿主功能；不把不同 SDK 的功能合并。

没有显式组件需求时，以其 SDK 主线和 `sdk.register` 为最低要求，不能据此声称未知业务 API 全部兼容。当前 JSONL 载体仍拒绝带普通 engine 声明的组件；普通 engine 权限和长期批准保持原义。

## 可信管理 API

这些方法只属于可信宿主，不开放给业务组件、包前端或 JSONL 回调。

```ts
const plan = await host.foundationPlan(agentId, chosenSelection);
if (!plan.compatible) {
  // 显示 failure / reports，保留 Agent 数据并修复选择。
  return;
}
await host.switchFoundation(agentId, plan.fingerprint, chosenSelection);
const binding = await host.foundationStatus(agentId);
await host.setFoundationEnabled(agentId, false);
```

`foundationPlan` 返回当前绑定、候选选择、需求诊断、声明证据和 fingerprint。fingerprint 绑定当前 Agent 记录及安装状态；异步等待后复核这些状态。相关状态变化时，旧 fingerprint 返回 `FOUNDATION_SELECTION_CHANGED`。兼容结果仍为 `evidence: declared`。缺失制品或不兼容候选不会静默换成官方底座。

`setFoundationEnabled(false)` 停止并保留绑定、组件、配置和数据；再次启用重新检查当前制品和全部需求。`removeAgent` 等待清理后移除 Agent 私有安装及引用；公共库制品保持。`removeLibrary` 拒绝删除任意 Agent 当前引用的提供者，停用 Agent 也仍保留引用。同 id/version 不同摘要可以共存，更新底座就是显式切换到另一个精确选择。

## 事务与恢复

切换按以下次序执行：验证候选与 fingerprint，持久准备日志，撤销旧授权并等待清理，持久保存新绑定，准备全部组件并等待 ready，保存激活标记，激活启用组件，删除完成日志。停用组件也检查和准备，但不激活；停用整个底座只撤销、停止和保存，不要求损坏提供者可运行。

准备和就绪没有可执行的业务上下文。激活注册期间仍禁止业务 Sink；官方沿用受控的设置、角色及上下文元信息读取，第三方 JSONL 继续拒绝注册期间回调。全部候选激活成功前，新的业务调用被事务日志阻断。公开会话边界、可信身份、调用链权限交集、同意、任务/单次确认、策略、MCP、凭据注入、审计及等待后/执行前复核继续生效。

| 故障或中断位置         | 恢复选择               | 执行与授权                                     |
| ---------------------- | ---------------------- | ---------------------------------------------- |
| prepared / stopping    | 原选择                 | 原实例失效，只允许新建受控实例                 |
| committed / ready      | 原选择                 | 新候选关闭；已保存配置和数据保持               |
| activating / activated | 已提交的新选择         | 不隐式回滚、官方回退或业务重放                 |
| 真实清理失败           | 事务保持，执行阻断     | 固定 `FOUNDATION_CLEANUP_FAILED`，保留清理责任 |
| 无法验证日志/记录      | 原始数据保持，执行阻断 | 固定恢复诊断                                   |

激活标记在发送 activate 之前持久保存，它是保守的不可回滚边界。即使随后尚未发出 activate 就退出，恢复也保留新选择。切换错误记录 phase、selectionCommitted 和业务 `executionState: not_started`；它不修改已经在旧实例派发的工作凭据。旧工作若为 unknown/completed，不自动重放。

日志以私有权限写临时文件、fsync、原子 rename 和目录 fsync。每次恢复只选择本次事务的 before 或 next，不迁移业务内容。切换保留组件、设置、密钥引用、同意、默认角色、协议与资源归属；所有有限期租约、前端/资源句柄和任务授权归零。正常切换失败后的恢复没有自动续跑业务。

## 并发与进程清理

同进程按 Agent 排队，库引用变更也持有库锁。SQLite 持久协调记录让不同宿主的管理写入串行。多个宿主可以继续运行原有跨进程资源路径；另一个活跃宿主持有同一 Agent 时，切换返回 `FOUNDATION_BUSY`。协调命名空间是共享的 `dataDir`，不同数据目录互不占用。打开 Agent 会话的方法（如 `foundationStatus`、`foundationPlan`、`resources` 和运行入口）登记参与者，直到 `stopSession` 或 `close` 完成清理后释放。仅构造宿主或 `listAgents` 不取得会话占用。解除 busy 须关闭另一宿主参与该 Agent 的会话。移除 Agent、组件制品/组合变更和记录绑定变更也要求独占，避免破坏另一宿主的活跃实例。普通停用仍允许跨宿主撤权，并按原 core 状态复核使旧请求失效。宿主不能通过超时租约接管活跃进程。一个 Agent 的切换不停止另一个 Agent。

宿主记录其受控提供者、官方 worker、普通 engine supervisor 和受控命令 supervisor 的真实进程身份。进程中断后的接续在 PID/启动身份匹配的进程退出后才恢复事务；清理仍未结束返回 `FOUNDATION_CLEANUP_PENDING`。旧 isolate worker 在宿主 IPC 断连时退出；受控和 engine supervisor 保持原有进程组清理。正常切换等待会话、任务、引擎和命令的真实退出及快照清理。

受控与引擎快照在任何目录写入前登记到私有协调库，以随机 id 定位 `dataDir/foundation-snapshots` 下的宿主管理目录。只有真实删除成功才释放记录。宿主中断后，独占恢复先等待真实进程退出，再清理该 dead owner 登记的目录，保留本宿主仍在使用的快照；删除失败保留记录并阻断恢复。进程退出不等于快照清理完成。回滚写盘或日志删除失败同样保留恢复证据并返回固定诊断。

## 数据和官方制品边界

`dataFormat` 当前固定为 `org.plums.host-state/1`：数据由公共宿主管理，底座不获得直接读写业务目录的权限。提供者可声明 `dataFormats`；省略时使用当前格式。显式不支持当前格式返回 `FOUNDATION_DATA_ADAPTER_REQUIRED`，不隐式转换数据。

官方 builtin 从原始 ZIP 加载独立适配、worker 与 native 运行依赖，签名和精确 ZIP 摘要同时验证。当前应用的 canonical bundle 与编译输入另外核验。应用升级保留已有对象，受信任旧归档执行自身字节。唯一已审阅 canonical 归档有显式摘要迁移入口，其他 unsigned ZIP 不进入 builtin 路径。官方格式、签名信任、构建与迁移限制见 [桌面底座管理](foundation-desktop.md)。

固定 ZIP 缺失、损坏、签名不受信任或当前应用完整性不匹配，返回固定 FOUNDATION_UNAVAILABLE 并保留 Agent 记录。未知官方 artifact/ABI/node/platform 拒绝，不猜测迁移。管理入口可以导入原始制品，恢复应用自带的相同对象，或明确检查其他候选后切换。

第三方 library 绑定继续对注册及每次创建读取真实 ZIP，按精确摘要固定已验证入口并创建只读快照。选择中的本地安装身份不进入 Agent ZIP。显式 Agent foundation 字段的 requirement/selection 保留，默认绑定也会导出精确便携选择。选择可单独出现，显式 requirement 和同 major 未知字段保持。接收端缺失或不兼容时允许导入到停用修复状态；创建、启用和执行仍严格检查，导入不授予权限。

本轮复用已有内部原型与最小夹具。独立执行证据只覆盖 SDK 2.0.0 register/settings/context/capability 与原生 fs/list。完整 SDK 黑盒符合性、专门验证消费者扩展、可分发替代底座验收 ZIP 和 Agent 整合包仍延期到 6/7B。
