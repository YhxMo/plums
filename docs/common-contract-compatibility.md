# 共同契约兼容与证据矩阵

日期：2026-10-07。声明符合、内部黑盒行为、真实执行边界及第三方身份是不同证据。工具和结果格式见[平台符合性](common-contract-conformance.md)。矩阵记录阶段 7 最后冻结源码及同一 1.0.0 本地审阅安装包的实际验证。阶段关闭以阶段 7（内部验证记录）的独立审阅和交付核对为准；其他安装包不能沿用这份结果。

| 路径                      | 声明/匹配                             | 实际行为入口                                                                            | 直接边界                                                     | 第三方作者       |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------- |
| SDK v2 common isolate     | S01/H01                               | H02–H09、R01–R03、P01–P02；实际包内 broker/V8 isolate 与前端宿主桥                      | E02 无 Node globals；E01 实际受控命令，文件走 SecureFsSink   | 未验证，内部夹具 |
| SDK v2 controlled-node    | 同一共同声明                          | 相同套件，实际包内固定 Node 与宿主 JSONL 桥                                             | E02 真实读/写/网络/spawn 拒绝；E01 实际命令                  | 未验证，内部夹具 |
| SDK v2 独立 UI            | ui-attach 与固定需求槽                | N01–N04，实际 1.0.0 Electron/preload/broker/host；H04 是另一份桥证据                    | contextIsolation/sandbox、无 Node/管理桥；导航及联网拒绝     | 未验证，内部夹具 |
| 第三方策略                | org.plums.policy 1.0.0 固定槽         | 四种合成策略替换，同一消费者与最大范围                                                  | 无扩权、严格布尔确认、重启租约归零；不证明风险算法           | 未验证，内部夹具 |
| 旧 SDK v1/v2 普通桥       | 共同 1.x 保留旧接口                   | 最终组合中的 runtime/protocol-routing/panels/reference-components 等回归                | 依各旧路径规则；不升级为共同受限路径                         | 无新的第三方接入 |
| 整机 engine（兼容旧声明） | manifest 与引擎声明一致               | engine/engine-grants 与 S-F/common 并存聚焦回归                                         | 普通系统权限，各方授权独立复核，不宣称逐次隔离               | 无新的第三方接入 |
| 任意自定义业务协议        | SemVer/feature 仅匹配                 | 由作者业务规范另验；平台套件不认证正文语义                                              | 只能使用对应已验证执行路径                                   | 未验证           |
| 场景 SDK 面               | 声明匹配；公开 evidence 仍为 declared | 内部测试通过（官方底座）：19 项 SDK 矩阵；独立原型支持的 8 项执行，其余 11 项启动前拒绝 | Fake/Recording fs、exec、HTTPS；不证明真实工具链或公网互操作 | 未验证，内部原型 |

场景 SDK 行由 `scripts/scenario-sdk-conformance.mjs` 1.0.0 单独验证，记录本次选择的底座 id、版本、SHA-256、测试版本和逐项结果。报告为 `.artifacts/requirements-v1/scenario-foundation-builtin.json` 与 `scenario-foundation-independent.json`；两者使用相同组件摘要。覆盖 register、settings、context、character/characters、connection、fs read/write/list、exec、service request/MCP、mcpCheck、protocols status/invoke、资源 read/write、贡献 schema 和 failResponse。exec 经固定底座公开会话与真实 core 使用 RecordingExecSink；其余项经 DesktopHost。官方 exec 会话也加载该摘要对应的已验证制品，报告没有把 Fake 命令列为真实受控程序验证。

九个现有业务夹具声明实际 SDK 功能，独立原型不支持的业务组装在启动前返回 FOUNDATION_INCOMPATIBLE/not_started，未启动原型或官方会话。现有卡、S-A/S-C/S-D/S-F 测试可用 `PLUMS_SCENARIO_FOUNDATION_ARCHIVE` 固定另一个底座制品；默认固定当前官方底座。S-F 已验证两个整机入口与普通运行共存；该 SDK 行仍不代表 S-B/S-E/S-G/S-H 或完整 requirements-v1 已完成，也不改变 checkFoundationCompatibility 和管理界面的声明证据。

真实生产边界在最终组合中另行执行：`controlled-execution`、`common-runtime`、`resources`、`policy`、`policy-execution`、`policy-mcp`、`policy-resources`、`workspace` 和对应原生 UI 用例。它们覆盖 supervisor/PID/RSS、取消/断连、符号链接与目录替换、HTTPS/MCP 传输前授权、资格交集与完全访问例外、真实 10 秒策略超时、窗口重开/接管/诊断及遗留兼容。内部 Fake/Recording 网络拒绝结果只证明传输前门控；直接运行时网络探针、SecureFsSink 与受控命令系统拒绝独立记录。没有把 mock 服务列成真实公网互操作。

本轮实际环境仅 macOS 27.0.1（26A434）arm64、固定 Node 26.5.1、pnpm 10.33.3。更早 macOS、Intel、Windows、Linux 未验证。Seatbelt 已弃用；每次启动继续探测，缺失或边界失败拒绝，不降级运行。四种策略夹具没有可靠 AI 自动审查结论；租约到期用例加速生命周期回调，不声称实等 15 分钟或 1 小时。

阶段 0–6 原始证据保持。阶段 7 结果位于开发树 `.artifacts/common-contract/stage-7/`：最后原始全量 1,531 项通过、6 条件跳过（147.85 秒），包内两 runtime 各 17 项、恢复 8 项、原生 N01–N04 与桌面/引擎 smoke 全通过。396 项源码、433 项构建与 670 项应用文件及 DMG 对应，package-provenance 关联实际命令/环境和报告摘要。验证与关闭状态见阶段 7（内部验证记录）。第三方作者、生产业务协议及跨平台记录继续明确未验证。
