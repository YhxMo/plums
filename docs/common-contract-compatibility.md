# 共同契约兼容与证据矩阵

日期：2026-10-07。声明符合、内部黑盒行为、真实执行边界及第三方身份是不同证据。工具和结果格式见[平台符合性](common-contract-conformance.md)。矩阵区分声明匹配、合成夹具验证和实际执行边界。

| 路径                      | 声明/匹配                             | 实际行为入口                                                                            | 直接边界                                                     | 第三方作者       |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------- |
| SDK v2 common isolate     | S01/H01                               | H02–H09、R01–R03、P01–P02；实际包内 broker/V8 isolate 与前端宿主桥                      | E02 无 Node globals；E01 实际受控命令，文件走 SecureFsSink   | 未验证，内部夹具 |
| SDK v2 controlled-node    | 同一共同声明                          | 相同套件，实际包内固定 Node 与宿主 JSONL 桥                                             | E02 真实读/写/网络/spawn 拒绝；E01 实际命令                  | 未验证，内部夹具 |
| SDK v2 独立 UI            | ui-attach 与固定需求槽                | N01–N04，实际 Electron/preload/broker/host；H04 是另一份桥证据                          | contextIsolation/sandbox、无 Node/管理桥；导航及联网拒绝     | 未验证，内部夹具 |
| 第三方策略                | org.plums.policy 1.0.0 固定槽         | 四种合成策略替换，同一消费者与最大范围                                                  | 无扩权、严格布尔确认、重启租约归零；不证明风险算法           | 未验证，内部夹具 |
| 旧 SDK v1/v2 普通桥       | 共同 1.x 保留旧接口                   | 当前实现的 runtime/protocol-routing/panels/reference-components 等回归                  | 依各旧路径规则；不升级为共同受限路径                         | 无新的第三方接入 |
| 整机 engine（兼容旧声明） | manifest 与引擎声明一致               | engine/engine-grants 与 整机入口与迁移/common 并存聚焦回归                              | 普通系统权限，各方授权独立复核，不宣称逐次隔离               | 无新的第三方接入 |
| 任意自定义业务协议        | SemVer/feature 仅匹配                 | 由作者业务规范另验；平台套件不认证正文语义                                              | 只能使用对应已验证执行路径                                   | 未验证           |
| 场景 SDK 面               | 声明匹配；公开 evidence 仍为 declared | 内部测试通过（官方底座）：19 项 SDK 矩阵；独立原型支持的 8 项执行，其余 11 项启动前拒绝 | Fake/Recording fs、exec、HTTPS；不证明真实工具链或公网互操作 | 未验证，内部原型 |

场景 SDK 行由 `scripts/scenario-sdk-conformance.mjs` 1.0.0 单独验证，记录本次选择的底座 id、版本、SHA-256、测试版本和逐项结果。报告为 `.build-cache/scenarios/scenario-foundation-builtin.json` 与 `scenario-foundation-independent.json`；两者使用相同组件摘要。覆盖 register、settings、context、character/characters、connection、fs read/write/list、exec、service request/MCP、mcpCheck、protocols status/invoke、资源 read/write、贡献 schema 和 failResponse。exec 经固定底座公开会话与真实 core 使用 RecordingExecSink；其余项经 DesktopHost。官方 exec 会话也加载该摘要对应的已验证制品，报告没有把 Fake 命令列为真实受控程序验证。

九个现有业务夹具声明实际 SDK 功能，独立原型不支持的业务组装在启动前返回 FOUNDATION_INCOMPATIBLE/not_started，未启动原型或官方会话。现有卡、聊天/酒馆/远程 MCP/整机入口与迁移 测试可用 `PLUMS_SCENARIO_FOUNDATION_ARCHIVE` 固定另一个底座制品；默认固定当前官方底座。整机入口与迁移 已验证两个整机入口与普通运行共存；该 SDK 行仍不代表 编码/完整 Agent ZIP/组合运行与进程隔离/完整项目 或全部场景已完成，也不改变 checkFoundationCompatibility 和管理界面的声明证据。

真实生产边界由独立回归验证：`controlled-execution`、`common-runtime`、`resources`、`policy`、`policy-execution`、`policy-mcp`、`policy-resources`、`workspace` 和对应原生 UI 用例。它们覆盖 supervisor/PID/RSS、取消/断连、符号链接与目录替换、HTTPS/MCP 传输前授权、资格交集与完全访问例外、真实 10 秒策略超时、窗口重开/接管/诊断及遗留兼容。内部 Fake/Recording 网络拒绝结果只证明传输前门控；直接运行时网络探针、SecureFsSink 与受控命令系统拒绝独立记录。没有把 mock 服务列成真实公网互操作。

原生验证目标为 macOS 27.0.1 arm64、固定 Node 26.5.1、pnpm 10.33.3。更早 macOS、Intel、Windows、Linux 未验证。Seatbelt 已弃用；每次启动继续探测，缺失或边界失败拒绝，不降级运行。四种策略夹具没有可靠 AI 自动审查结论；租约到期用例加速生命周期回调，不声称实等 15 分钟或 1 小时。

第三方作者、生产业务协议及跨平台兼容性需独立验证。
