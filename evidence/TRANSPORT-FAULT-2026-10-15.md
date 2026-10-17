# 原生异常回执与预约恢复验收

日期：2026-10-15 UTC。负责人：SDK 与平台维护者；实现和验收由主执行者承担，独立执行者进行源码与证据复审。范围对应 A6/A8/A10 的隔离实验子集，不代表这些整项或 M2 完成。

基线 `8d60ffe`，工作区差异为实验 Rust 预约租期/故障入口、两份新测试前端文件及文档证据；Host、SDK、普通 PlatformAdapter 和默认前端无变化。受验 142 文件摘要为 `484868157f60d400e627beb0cc1936fc4c4f35649380ec4ec3f91bee030e6285`，见 [源码清单](source-manifest-484868157f60d400e627beb0cc1936fc4c4f35649380ec4ec3f91bee030e6285.json)。[结构化记录](transport-fault-2026-10-15.json)绑定两端产物、窗口结果、命令日志、源码和清理证据摘要。

## 反例与最小修复

旧源码新增 abandoned_reservation_expires_without_revoking_owner 后失败：等待 1100ms，pending 仍为 1，预期 0；`.cache/transport-fault/red.log` 保留失败。修复仅为未开始预约的 1000ms 租期和后续命令触发回收；已开始请求仍由 800ms 总时限收尾。没有新增后台线程、依赖、生产权限或真实凭据。具体语义见 [实验设计](../docs/spec/archive/M2-native-transport-experiment-2026-10-15.md#异常回执)。

## 原生异常矩阵

两端均执行同一实际测试页。业务请求使用公开 Host、独立作者样板和 ctx.task/ctx.platform；容量、过期执行和跨 owner 检查使用原生实验命令。故障在 Rust 中注入。

| 原生异常与判据 | Mac arm64 包 | Android API 36 ARM64 模拟器 |
| --- | --- | --- |
| prepare 登记前失败 | unknown、零预约、无 echo 命中 | 相同 |
| prepare 已登记但回执丢失，cancel 成功 | unknown、零预约、无 echo 命中 | 相同 |
| prepare 与 cancel 回执均丢失，但取消已执行 | unknown、实际零预约、无 echo 命中 | 相同 |
| prepare 回执丢失且 cancel 未执行 | 即时 1 项，1100ms 后下一次观察为 0；无 echo 命中 | 相同 |
| 跨 owner 取消与过期 execute | 跨 owner 拒绝且保留原预约；过期执行拒绝，pending=0，无 echo 增量 | 相同 |
| 容量与恢复 | 16 项可观察，第 17 项拒绝；租期后新 prepare 回收，返回 echo:recovered | 相同 |
| execute 成功后丢失回执 | unknown；服务实际增加 1 次命中；预约归零 | 相同 |
| 在途 cancel 未执行 | 服务已收到请求；unknown，806ms 收尾，任务/预约归零 | 808ms，其他相同 |
| 在途 cancel 已执行但回执丢失 | 服务已收到请求；unknown，60ms 收尾，任务/预约归零 | 62ms，其他相同 |

完成后公开 stop/uninstall 清除 Host 登记。Mac 阶段服务计数 echo=2、delay=2；两端结束累计 echo=4、delay=4、report=2，无重定向目标访问。计数证明请求是否到达合成服务，不宣称撤销远端副作用。

Mac 实际窗口 AX 记录包含完整 passed=true 报告；Android 实际 WebView/CDP 报告和截图留于忽略目录。Android 16/API 36、arm64、WebView 133.0.6943.137、软件渲染；不是设备或真实触控证据。实验 APK 安装取回摘要等于构建件，v2 签名验证通过。两端实验产物独立保存于 `.cache/transport-fault/artifacts/`。

## 回归与审查

- `npm test`：175 项通过；`npm run build` 和 `npm run format:check` 通过。
- Cargo `test --locked --offline --features native-transport-experiment`：12 项通过；默认特性：6 项通过。
- Cargo `clippy --locked --offline --all-targets --features native-transport-experiment -- -D warnings`、rustfmt 检查通过。
- Tauri Mac `build --debug --bundles app` 与 Android `android build --debug --target aarch64 --apk` 均使用显式实验特性、隔离配置、locked/offline 并通过；最终构建日志绑定上述前端和源码。
- 独立源码审查无阻塞项；依建议补强过期执行后零预约及零命中断言，并以最终页面重建两端再运行。精简检查沿 prepare→execute/cancel→reap 路径，没有值得进一步合并或移除的状态；不新增定时清理框架。

原生命令新增注册仍位于 feature 条件内，默认前端构建摘要与上一阶段一致。普通 release 全文件摘要重新核对未变，无需更新普通安装包。清理记录确认自建 Mac、模拟器、ADB 与服务退出，临时 reverse/forward 删除，18765/5058/5594/5595/9248 无监听，原应用 PID 1951 和开发服务 PID 59947 保留。未推送。

最终独立证据复审无阻塞：重新核对 142 个源码摘要、21 份原始记录、两端实际页面与报告、实验产物、安装取回 APK 和普通 release，均匹配。提交前精确检查 15 个暂存 UTF-8 文件及源码索引摘要，未发现所检查的私人路径、凭据模式、原始运行数据或对话记录；goal.md 保持忽略且未跟踪。检查范围不代表排除所有潜在隐私风险。

## 未验证边界

租期是后续命令触发的惰性回收，不是无调用时准时释放；最大 16 项仍可能暂留。未模拟桥接永不返回、系统暂停时钟行为、进程崩溃或持久化恢复。没有生产 TLS/凭据/授权确认、真实资源、OAuth、Android 真机或 iOS/Windows/Linux 证据。此前原生重定向/体积测试保持其历史版本范围，本阶段没有重跑全部历史矩阵。下一阶段优先级见 [整体计划](../docs/spec/total.md)，不以用例数量代替能力验收。
