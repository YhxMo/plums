# 实验扩展状态迁移

状态：当前有效（2026-10-17 核实）；实验迁移助手，通用多跳迁移与自动扫描未实现。

可选 SDK `migrateState` 使用现有公开 ctx.task/ctx.platform 和修订号检查，不改变 Host、Rust Broker 或存储外层 schema。业务迁移与目标校验由扩展提供；没有自动扫描或迁移用户状态，默认扩展未采用此助手。

## 输入与提交

调用方先声明 state.read/state.write 并获得授权。状态 value 使用 `{version:正整数,data:JSON值}`；外层 StoredState.revision 是存储修订号，与业务版本不同。一次调用明确 from/to（to>from），提供 migrate(data,signal) 与 validate(data)。缺少状态、未知版本、坏源数据或无效目标均拒绝；不把缺失视为需要初始化，不自动尝试多跳版本链。

migrate 收到源 data 的深拷贝，负责源业务 schema 校验和转换；validate 必须同步返回 true 才通过，收到候选副本。只接受有限数字、字符串、布尔、null、普通对象和稠密数组；undefined、函数、日期、访问器、循环、symbol、BigInt 等拒绝。转换不得发出网络请求或其他不可逆副作用；通用助手不能回滚回调自行造成的外部影响。

成功写入一次 `{revision:读时修订号,value:{version:to,data:候选,previous:读取时完整StoredState}}`。目标及旧快照共享一次存储提交；旧数据不再是当前 value，但保存在 previous 内。额外备份计入现有 64 KiB 总限额，超过即拒绝，不能为了成功静默丢弃备份。previous 可保留旧值中的已有历史，连续迁移会增长；本阶段只验证单跳，不提供历史裁剪。

当前 value.version 已是 to 时，仅做目标业务验证并返回读取结果，不写入或再次调用转换。此路径不证明任意外部写入的 previous 都有效；助手只保证自己成功提交时保留的快照。不要以目标版本号替代业务校验。

## 失败与恢复

| 条件 | 行为与恢复 |
| --- | --- |
| 转换/校验失败、取消或停用发生在写派发前 | 不提交；读取时旧状态不被此操作覆盖，可修复扩展后重新显式迁移 |
| 存储拒绝、超限、修订冲突 | 传递 not-committed；不自动重试。冲突时应重新读取并评估，当前值可能是其他写入者的新值 |
| 写派发后确认成功 | 成功回执胜出，即使随后收到取消也不能说未写入 |
| 写回执未知 | 保持 unknown，不盲目重试或宣称原文件未变；重新读取并检查版本/内容后再决定。已提交目标再次调用只读返回 |
| 转换期间进程终止 | 尚未派发写入的原文件应保留；限定原生验证另见证据 |
| 目标需要业务回退 | 显式调用 restorePreviousState，按确认 revision 恢复并保留当前目标，见下节；确认界面可参考[合成样板](STATE-RESTORE-UI.md)，历史裁剪和通用升级事务待实现 |

助手整段运行由 ctx.task 跟踪，操作信号与生命周期合并。原生派发后的提交段继承既有语义。原生 Broker 提交后同步父目录，同步失败报 `state-sync`（结果 unknown，不可盲目重试）；启动时清理超过一小时的 `.pending` 临时文件；读取前先检查文件大小。所属者只能是 `host.shell` 或 `extension.<id>`，因此无法读写同目录的凭据绑定等原生文件。多进程事务与断电恢复仍未实现并未验证。正常重启和转换中中断不证明写入中崩溃一致性。

## 独立作者样板与运行

[独立样板](../tests/fixtures/author-migration-probe.ts)定义 v1 label → v2 labels，服务仅使用公开 SDK。它是内部独立执行者编写的测试夹具，不冒充社区反馈。Host 不认识 label/labels。测试包含停止/卸载 v1、同 ID 安装 v2、重新授权，再通过新消费者调用迁移。

[原生测试页](../tests/state-migration/probe.ts)使用普通 PlatformAdapter 与默认 Rust 存储，无传输实验特性。Vite root tests/state-migration，隔离输出 `.cache/state-migration/dist`；两端构建覆盖测试前端，Mac 名称 Plums State Migration Probe，标识 dev.plums.plums.statemigrationprobe。Android 专用 ADB 5060、模拟器 5598、CDP 9250，不接入真实设备或账户。

启动前在隔离根目录写入合成 extension.migration.blocked.json 并创建同名 .pending 目录，真实 Broker 写入因此拒绝。页面完成矩阵后在实际转换回调内显示 paused-before-write；终止该专用进程，再启动同一包，读取旧状态并完成迁移。所有原始记录与测试包保留在忽略的 `.cache/state-migration/`，不提交。

验收与源码绑定见 [专项证据](../evidence/STATE-MIGRATION-2026-10-15.md)。默认应用未调用助手，普通前端产物未变；本阶段不更新普通 release，也不自动迁移其数据。

## 按确认修订号显式恢复旧快照

可选 `restorePreviousState(ctx, {revision, from, to, validate}, signal?)` 只恢复当前 value.previous 的业务 data。revision 是调用者已经检查并确认的当前存储修订号，from 是当前业务版本，to 是较低的目标业务版本；均为正安全整数，from>to。助手重新读取，确认修订号、当前版本、旧快照修订号小于当前及目标版本，目标业务 validate 必须同步返回 true。校验使用副本，不能通过修改参数悄悄改回退内容。

成功一次 CAS 写入 `{version:to,data:旧数据,previous:当前完整StoredState}`，保存被替换目标及其原有历史。只恢复目标 version/data，原快照额外字段不会自动升级为当前协议字段，但仍在保留链中。助手不初始化状态，不自动选择历史，不自动确认，不回滚包版本或外部副作用。缺快照、坏格式、过期确认、拒绝校验均不写；竞争写入由 CAS 拒绝，当前可能已经是其他写入者的值。

重复使用旧确认直接拒绝，即使第一次可能已成功也不假装重新恢复。未知写回执必须先读取并核对，不自动重试；成功回执继续胜过迟到取消。复制备份增长计入 64 KiB 总限制，容量拒绝保留当前状态。调用扩展负责展示数据和取得明确选择，可参考[合成恢复界面](STATE-RESTORE-UI.md)；默认应用不调用此助手。

仅当前快照恢复已限定验证，记录见 [恢复验收](../evidence/STATE-RESTORE-2026-10-16.md)。提交中断电、跨文件包升级事务、多进程与历史裁剪继续待验；接口仍实验性，iOS 稳定前门槛不变。
