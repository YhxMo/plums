# 实验扩展状态迁移

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
| 目标需要业务回退 | 没有自动回滚。扩展须验证 previous 并按当前 revision 显式恢复；回退政策、UI、历史裁剪和通用升级事务不在本阶段实现 |

助手整段运行由 ctx.task 跟踪，操作信号与生命周期合并。原生派发后的提交段继承既有语义；本阶段未实现 fsync 父目录、遗留 pending 自动清理、多进程事务或断电恢复。正常重启和转换中中断不证明写入中崩溃一致性。

## 独立作者样板与运行

[独立样板](../tests/fixtures/author-migration-probe.ts)定义 v1 label → v2 labels，服务仅使用公开 SDK。它是内部独立执行者编写的测试夹具，不冒充社区反馈。Host 不认识 label/labels。测试包含停止/卸载 v1、同 ID 安装 v2、重新授权，再通过新消费者调用迁移。

[原生测试页](../tests/state-migration/probe.ts)使用普通 PlatformAdapter 与默认 Rust 存储，无传输实验特性。Vite root tests/state-migration，隔离输出 `.cache/state-migration/dist`；两端构建覆盖测试前端，Mac 名称 Plums State Migration Probe，标识 dev.plums.plums.statemigrationprobe。Android 专用 ADB 5060、模拟器 5598、CDP 9250，不接入真实设备或账户。

启动前在隔离根目录写入合成 extension.migration.blocked.json 并创建同名 .pending 目录，真实 Broker 写入因此拒绝。页面完成矩阵后在实际转换回调内显示 paused-before-write；终止该专用进程，再启动同一包，读取旧状态并完成迁移。所有原始记录与测试包保留在忽略的 `.cache/state-migration/`，不提交。

验收与源码绑定见 [专项证据](../evidence/STATE-MIGRATION-2026-10-15.md)。默认应用未调用助手，普通前端产物未变；本阶段不更新普通 release，也不自动迁移其数据。
