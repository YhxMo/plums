# 最小扩展状态迁移与失败恢复验收

日期：2026-10-15 UTC。负责人：SDK 与状态维护者；独立作者仅按公开 SDK 编写样板，独立审查者复核实现及证据。范围对应 A7/A9 的单跳迁移子集，M2 整体未完成。

基线 `9865bf5`；新增可选 SDK 助手、独立作者夹具、单元和原生测试页；既有源码仅 SDK index 增加导出。Host、平台适配、Rust 存储、默认业务入口均未修改。受验 147 文件摘要 `61a11fd9ea78da8f84d0b69050d8aa4ddfd7aee5237e9a00d46ba0749fc7d152`，见 [源码清单](source-manifest-61a11fd9ea78da8f84d0b69050d8aa4ddfd7aee5237e9a00d46ba0749fc7d152.json)；[结构化证据](state-migration-2026-10-15.json)绑定实际产物、日志、文件和页面报告。

## 验收定义与实现

合成旧 value 为 `{version:1,data:{label:"plum"}}`，目标为 `{version:2,data:{labels:["plum"]},previous:原StoredState}`。转换/目标校验归独立扩展；SDK 只校验通用 JSON/版本并用现有修订号提交。源副本与候选副本分离；一次写入同时包含新值和旧快照，备份计入 64 KiB 上限。没有自动初始化、重试未知写、回滚、历史删除或真实状态迁移。完整边界见 [设计](../docs/STATE-MIGRATION.md)。

先添加契约测试，因缺少 state-migration 模块失败，原始 red.log 保留；实现后回归通过。独立作者从公开接口创建 read/seed/migrate 服务，不读取宿主私有实现。精简检查围绕读取→转换→校验→一次 CAS 提交，保留必要 JSON 快照及源备份，没有引入迁移注册表、后台任务或业务 schema 分支。

## 两端实际路径

Mac arm64 专用应用标识 dev.plums.m1.statemigrationprobe；Android 16/API 36 ARM64 隔离软件渲染模拟器、包名 dev.plums.m1。均为默认 Rust 特性构建，普通 PlatformAdapter，经实际原生存储执行。未使用回环传输实验，也未访问真实账户或用户状态。

| 条件与结果 | Mac | Android 模拟器 |
| --- | --- | --- |
| v1 写旧状态，stop/uninstall 后同 ID 安装 v2 并重新授权 | 迁移成功，previous 等于原 StoredState；再次调用不写 | 相同 |
| 未知版本、坏源、转换抛错、目标无效 | 拒绝且原状态/修订号保持 | 相同 |
| 源仍可存，但迁移目标加备份超过 64 KiB | 原生拒绝，原状态保持 | 相同 |
| 操作取消、Host stop 发生在转换中 | 不写，旧状态保持；停用释放任务 | 相同 |
| 转换期间另一个写入更新修订号 | 迁移 CAS 拒绝，保留并发写入值 | 相同 |
| 人为创建隔离 .pending 目录，真实 Broker 无法创建临时文件 | not-committed，旧文件保持 | 相同 |
| 其他 owner 同时有状态 | 内容及修订号不变 | 相同 |
| 转换回调已进入、尚未写入时终止专用进程 | SIGKILL 后原文件不变；重启可迁移并保留原快照 | force-stop 后同样验证 |
| 移除自建空 .pending 目录后重启 | 原值仍在，迁移恢复成功且备份匹配 | 相同 |
| 冷启动读取已迁移目标 | sample/other/stop 三份文件字节不变；sample.previous.value 与 v1 原值一致 | 相同 |

每端第一进程有 11 项页面检查，第二进程有 3 项恢复检查；关键结论同时核对原生文件。Mac AX 显示真实窗口报告，Android CDP 读取实际 WebView 并保存截图。中断标记在迁移回调内部发布，避免把“调用前已显示”当作转换中中断。进程终止后、再次启动前逐字节比较五个 owner 的文件；重启后再次比较目标/无关状态，并核对恢复后的 previous 等于中断前完整文档。

初次原生夹具因 JSON 键顺序使用字符串比较误报，未据此宣称通过；改为按对象内容比较，保留初次实验记录，最终两端重建并使用新合成状态运行。没有因此修改生产持久化逻辑。

## 命令、产物与影响

- `npm test`：185 项通过，其中 10 项迁移测试；未知写回执与提交后取消仅在单元适配器验证，未冒充原生竞态。
- `npm run build`、`npm run format:check` 通过。普通前端仍为 index-CG6r5Owt.js 与 index-DyHk32xC.css，与前一普通入口产物相同。
- Vite 专项构建使用 tests/state-migration 与 `.cache/state-migration/dist`；Mac Tauri `build --debug --bundles app`、Android `android build --debug --target aarch64 --apk`，隔离配置、locked/offline，均通过。Rust 未改，本阶段不重跑旧 Rust 单元/Clippy，也不把旧结果当新版重验。
- APK 安装取回摘要等于最终构建，v2 签名验证通过。两端专项产物独立保存在 `.cache/state-migration/artifacts/`。源码、产物及原始日志摘要见结构化记录。
- 普通 release 全文件及清单重新核验未变；默认业务未采用迁移助手，普通包无需更新。生成构建目录是专项包，不能误当普通交付。

自建 Mac/模拟器/ADB 与端口 5060/5598/5599/9250 已清理，临时 forward 删除。原应用 PID 1951 仍运行。收尾时原开发服务 PID 59947 已不在且 1420 无监听；本阶段未对该进程发终止命令，退出原因未确认，未擅自重启。原始过程仅保存于忽略目录。

最终独立复审无阻塞：复算 147 源码、41 份原始记录、两端实验产物及普通 release，均匹配；独立核对恢复备份与跨重启文件比较。提交前精确检查 17 个暂存 UTF-8 文件及全部源码索引摘要，未发现所检查的私人路径、凭据模式、原始运行数据或对话记录；goal.md 保持忽略且未跟踪。该检查不代表排除所有潜在隐私风险。

## 未覆盖范围

只验证 1→2 单跳、自有合成数据和指定两端配置。未知回执仅单元测试；没有写提交段崩溃、断电、父目录 fsync、遗留 pending 自动修复、多进程并发、多跳链、通用包升级事务、自动回退/历史裁剪。回调外部副作用不能回滚，备份恢复 UI 未实现。Android 真机、其他配置、iOS/Windows/Linux 未验；接口仍实验版，iOS 稳定门槛不变。
