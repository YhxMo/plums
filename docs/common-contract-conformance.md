# 平台符合性工具与作者接入

测试规范版本：1.0.0；共同契约：1.x；日期：2026-10-07。规范入口是[共同契约](common-contract.md)和[SDK v2](sdk-v2.md)。本工具验证通用运输、身份、资源、权限及生命周期，不验证记忆、模型、聊天、Coding 或其他业务协议的行为。

## 运行

在源码工作区安装依赖并使用 Node 26.5.1、pnpm 10。macOS 原生依赖需要 Xcode Command Line Tools。固定 Node 的路径必须指向独立运行时；受控边界探测失败时运行失败，不回退到普通权限。

```sh
pnpm build
node scripts/platform-conformance.mjs --runtime isolate --out .build-cache/conformance/isolate.json
node scripts/platform-conformance.mjs --runtime controlled-node --node /absolute/node-26.5.1/bin/node --out .build-cache/conformance/node.json
node scripts/platform-conformance.mjs --package /absolute/component.zip --out .build-cache/conformance/declaration.json
```

`pnpm conformance:platform --runtime isolate` 也会先构建。直接执行 Node 命令适合连续验证，避免重复构建。`--package` 只读取 ZIP，执行公开的 `validatePackage` 与 `desktopContribution`，不安装、不启用、不执行。合法的旧组件或无桌面声明的角色包可得到结构通过，其 `commonVersion` 为 null；这不证明共同运行能力。无效包返回失败报告和退出码 1。

完整宿主套件使用独立的内部夹具，在临时目录创建两个 Agent、两种消费者界面、两种兼容提供者、一个不兼容提供者和四种策略。每个检查重新建立场景，结束后等待 Host.close 和子进程退出，再清理临时目录。仅文件和命令用例使用合成内容；没有真实凭据或外部业务服务。

原生界面另行运行，先构建，再用项目的顺序组执行：

```sh
/usr/bin/caffeinate -dims pnpm exec vitest run packages/desktop/test/platform-conformance-ui.test.ts
```

它固定使用内部制品生成器，经真实 Electron main/preload/broker/host 验证。自定义 --adapter 不会自动替换原生夹具；作者必须另提供其 UI 的原生证据。宿主桥套件不会启动 renderer；不能把 `frontendCommon` 的通过记录当作原生 Electron 的证明。完整项目验证使用 `/usr/bin/caffeinate -dims pnpm test`，所有原生组顺序执行。Windows/Linux 的条件跳过不是支持证据。

## 可核验的结果

scenarios 的场景 SDK 矩阵使用独立运行器，所有 I/O 均为自造夹具与 Fake/Recording Sink。它验证普通 SDK v2 接口和授权门控，不替代上面的实际受控程序/执行边界套件：

```sh
pnpm build
node scripts/scenario-sdk-conformance.mjs --foundation builtin --node /absolute/node-26.5.1/bin/node --out .build-cache/scenarios/scenario-foundation-builtin.json
node scripts/scenario-sdk-conformance.mjs --foundation independent --node /absolute/node-26.5.1/bin/node --out .build-cache/scenarios/scenario-foundation-independent.json
pnpm exec vitest run packages/host/test/scenarios/foundation.test.ts --maxWorkers=1
```

同一套件有 19 项，含 场景 SDK 矩阵 全部 SDK 面和 failResponse。官方底座全部执行；独立原型仅执行声明支持的 8 项，其余 11 项必须启动前拒绝。每项记录需求、组件摘要、执行或拒绝预期与结果；报告记录精确底座选择、套件版本/摘要、环境与范围。`--case <编号>` 可重复指定部分项，报告标记 partial。vitest 将各项分开执行，遵守单项 20 秒预算，并额外检查不支持项没有启动会话或转用官方底座。CLI 在参数、断言或清理失败时退出 1，不复制异常正文或物理路径。

场景 cards/chat/tavern/mcp 测试默认显式固定当前官方底座。设置 `PLUMS_SCENARIO_FOUNDATION_ARCHIVE=/absolute/test-foundation.zip` 可在各自全新临时数据目录导入并固定另一制品，不静默回退。独立原型不支持完整业务场景，相关组装应拒绝。场景 SDK 矩阵 不证明全部业务场景的集成行为，各场景仍须独立验证；矩阵的 complete 只表示 19 项 SDK 检查完整。

CLI 将 JSON 写到 stdout；可选 `--out` 同时保存文件。通过退出 0，任何必需检查、输入或清理失败退出 1。报告包含报告/套件版本、运行器 SHA-256、适配器文件 SHA-256、实际 OS/CPU/Node、逐项编号与层级、每场景的制品摘要、结果和限制。摘要固定到本次实际输入，不代表制品拥有权限。

`status:passed` 只描述所运行的检查。公开函数支持 `caseIds` 做定向诊断，此时 `coverage:partial`；完整符合性记录必须 `coverage:complete` 且全部必需项通过。结构检查报告单独标为 `layer:structure`、`evidence:declared`、`behaviorVerified:false`。没有用单测数量或同名协议替代行为证据。

失败项保留 `id/layer/phase`，`phase` 为 setup/check/cleanup。`failure.code` 区分 ASSERTION_FAILED、CASE_TIMEOUT、ADAPTER_OR_HOST_FAILED 和 CLEANUP_FAILED；可用时 `checkLine` 指向运行器源码行。报告不复制异常文本、断言实际值、业务正文、命令输出或物理路径。初始化/参数失败为 INPUT_OR_ADAPTER_FAILED，报告目标无法写入为 REPORT_WRITE_FAILED。检查预算默认 30 秒；适配器的场景建立和 close 是可信测试驱动，需自行实现超时与退出等待。CLI 不隔离适配器代码。

`suiteDigest` 只覆盖运行器文件，`adapterDigest` 只覆盖适配器入口。提交证据时还要保存适配器依赖与宿主/SDK 的源码或构建摘要、锁文件、环境、原始命令退出码和完整日志。报告不能证明未保存的依赖或不同安装版。

绑定继续返回 `evidence:declared`。运行工具不会修改安装记录、签发证明、提升绑定证据或授予真实用户权限。内部夹具记录是 `internal-fixture`。自定义适配器 CLI 强制标记 `adapter-supplied-unverified`；`thirdPartyAuthorVerified` 始终为 false。独立第三方接入证据还需作者身份、制品来源、审阅记录和测试环境，不能由适配器自报。

## 必需用例

| 编号    | 可观察的通过条件                                                                                                   | 层级             |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ---------------- |
| S01     | 同 major 未知字段保留，非 JSON 与重复资源槽拒绝，版本/功能匹配单独检查                                             | 结构             |
| H01     | 可选未绑定槽返回 null；未声明槽拒绝；只发现兼容候选；候选句柄不能自行调用；明确选择后可调用                        | 宿主行为         |
| H02     | 两 Agent 同一实际提供者摘要并发调用，install/instance 不同；正文假身份不起作用；关 A 后 B 可用                     | 宿主行为         |
| H03     | 消费者在自身 runtime 经共同 SDK 调用；只替换提供者选择，消费者实际固定摘要不变，旧句柄拒绝                         | 宿主行为         |
| H04     | 两独立前端通过自身槽消费同一后端；真实容器不同；转交句柄拒绝；业务策略只有 status                                  | 宿主桥，原生另验 |
| H05     | 事件序号/内容次序连续；终态独立；attach 回放相同结果，后续计数证明没有重执行                                       | 宿主行为         |
| H06     | 已开始的 hold 取消后 unknown/stopped，取消幂等；另一 Agent 不能查询任务                                            | 宿主行为         |
| H07     | 后台默认拒绝；可信启用后 agent 任务跨界面关闭存活，自身重开 attach 后可停止                                        | 宿主行为         |
| H08     | 无消费生产 300 事件触发限制；回放缺口不丢终态；重启只有元数据，没有正文或重新执行                                  | 宿主行为         |
| H09     | 贡献 schema 拒绝无效输入，计数证明未执行；无效输出保留 completed，后续调用不自动重试                               | 宿主行为         |
| R01     | 双 Agent 共用空间同 revision 竞争仅一方提交；独立空间保持归属；tombstone 拒旧 revision；重启保持                   | SQLite/CAS 行为  |
| R02     | runtime 经共同资源桥写入，另一 Agent 可读；撤 A 资格使旧桥失效，B 保持可读                                         | 宿主行为         |
| R03     | 两个实际 OS 进程经公开 Host/SDK 路径竞争，仅一提交，冲突明确，重启恢复赢家                                         | 跨进程行为       |
| P01     | 同一消费者固定到 allow/deny/confirm/custom 策略；文件实际读取/拒绝，确认严格布尔，审计无合成正文/路径              | 权限与实际文件   |
| P02     | allow 不扩大未选最大范围；重启保留模式偏好而无活动租约                                                             | 权限与恢复       |
| E01     | 四种策略经实际受控 /bin/echo 路径允许/拒绝/确认；参数保持字面值，无 shell 展开；精确拒绝错误、确认次数与非布尔拒绝 | 真实命令         |
| E02     | controlled-node 直接读/写/联网/spawn 拒绝，监听器零连接且文件保持；isolate 没有 Node globals                       | 运行边界         |
| N01–N04 | 两原生界面同后端、容器身份/管理边界、真实导航/网络拒绝和跨世界事件迭代                                             | Electron 原生    |

E02 的 isolate 检查是 V8 API 暴露边界；不把它描述为 Node 系统调用探针。E01 在两 runtime 中都由宿主受控命令执行。网络监听器仅监听本地合成服务。完整网络、符号链接、RSS、信号、broker 断连与 supervisor 清理的定向生产边界用例见[证据矩阵](common-contract-compatibility.md)，按待验证源码执行；它们与黑盒报告分别记录。

## 接入自己的适配器

```sh
node scripts/platform-conformance.mjs --adapter /absolute/author-adapter.mjs --runtime isolate --out /absolute/report.json
```

模块导出异步 `open({runtime,nodePath})`，返回 `{runtime,scenario(options)}`。open 只返回工厂，不保有场景外长期资源；所有资源归 scenario.close 清理。`scenario({unbound})` 每次返回新场景；unbound=true 时两个消费者的可选 backend 槽未选择，否则明确固定 provider-one。适配器是具有本机权限的可信测试程序，只运行自己审阅过的代码，并使用临时数据。参考实现是 `scripts/platform-conformance-host.mjs`，只导入 core、SDK、host 的公开 dist 入口，不调用 CommonService/ResourceStore 等私有实现。

场景方法分成业务操作和可信驱动。业务客户端是实际 `CommonPlatformSdk`；管理方法模拟用户在可信窗口的选择，不能注入业务 SDK。自定义适配器不得用 fake invoke、复制平台判断、调用私有状态或返回预填结果替代受测实现。

| 场景接口                                     | 约定                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| metadata                                     | `{runtime,artifacts,agents}`；artifacts 包含固定角色的真实库制品 SHA-256；agents 为 `{a,b}` 的真实 Agent id                                               |
| client(name='a', component='screen-one')     | 返回 `{sdk,context,raw,close}`；raw 为真实前端共同 RPC，close 关闭它的会话；新 root 会使前 root 失效                                                      |
| views()                                      | 返回同一 Agent 的两个同时有效的独立前端客户端，组件分别 screen-one/screen-two                                                                             |
| choose(name, component, provider)            | 经可信管理固定 backend 槽，provider-one/provider-two；不能自动绑定发现结果                                                                                |
| artifact(name, component)                    | 从当前宿主安装/固定记录读取摘要，用于核对替换后消费者未变                                                                                                 |
| runtimeCall(name, {operation,input})         | 在 screen-one 的实际 runtime 中经 sdk.common 调用固定 backend，并返回共同终态                                                                             |
| grantResources(name), revokeShared(name)     | 可信选择普通资源最大范围；撤销该 Agent 的共用资源资格                                                                                                     |
| processRace(client, binding)                 | 启动实际独立 OS 进程，用另一 Agent 的公开资源桥同时 CAS；返回 `{parent,peer,independentProcess}`，每行 fulfilled/value 或 rejected/reason，等待子进程退出 |
| background(name)                             | 经可信管理启用 screen-one 后台，不能仅改声明                                                                                                              |
| policy(name, mode, include?)                 | 固定对应策略并批准 15 分钟最大范围；include 过滤可信选择项                                                                                                |
| confirm(value), confirmationCount()          | 测试可信确认返回值与实际提示次数；布尔外的值必须拒绝                                                                                                      |
| file(name), workPath(name), dataDir, audit() | 可信驱动观察合成文件、外部目录和审计，绝不作为扩展可用接口                                                                                                |
| restart(), close()                           | 等待真实宿主/进程关闭；restart 保留临时持久数据，close 清理整个测试场景                                                                                   |

合成协议 `org.plums.conformance.probe` 1.0.0 只有测试意义。需求 backend 必需 feature probe；第三个提供者声明 2.0.0，必须被排除。提供者贡献 tools/probe 接收 `{operation,input}`：echo 原样返回 input 与真实 sdk.context、实际调用 count 及 implementation one/two；events 发送 input.count 个 tick（data.index 从 0 递增），然后返回同样结构；hold 发送 ready 后等待取消；resource 按 slot/action/key/revision/value 调用资源 SDK；file 从显式 work 根读取 input.path；exec 使用受控 echo 和 input.args；probe 尝试直接系统访问并返回 E02 的布尔结果。提供者贡献附带输入/输出 schema；bad-output 返回不合 schema 的数组以验证 completed 错误。两提供者要有独立代码路径，业务语义相同。被拒的 exec 外层共同调用已进入提供者，因此为 unknown；不能将单次命令尚未启动推成整个调用 not_started。它不要求真实业务扩展改写其协议。

策略仍声明 `org.plums.policy` 1.0.0。合成 allow 总是 allow；deny 允许 tool、拒绝 I/O；confirm 允许 tool、对 I/O 请求人工；custom 允许 tool 和 allowed.txt 的 fs 操作，拒绝其他文件与命令。第四种策略通过扩展选择接入，没有增加宿主业务分支；这不证明 AI 风险判定质量。

## 作者提交证据

先检查自己的完整声明和 ZIP，再实现独立的测试适配器，跑完整宿主、目标 runtime 及实际 UI/执行边界检查。报告按失败编号定位公开规范和受测实现，修正后完整重跑。需要业务互操作时，作者另行提供其业务协议测试、数据格式版本、迁移/适配规则和两个实际作者制品记录。

业务协议的符合性由独立组件作者验证，不由平台套件代替。SDK v1/v2 普通桥在共同 1.x 保留；移除需新 major、迁移说明及至少一个稳定版本的提前通知。宿主模型适配服务不恢复；普通本机引擎单独审批且不能参与受限模式。安装包与升级测试须单独执行。

桌面、宿主与 SDK 0.1.0 预览版的版本关系、旧桥保留承诺、恢复及打包验证入口见[桌面兼容与恢复](desktop-recovery.md)。

## 打包版复验

可信包内适配器直接 fork 指定应用内未修改的 broker，使用该应用附带的固定 Node、SecureFsSink、受控 worker/probe/supervisor。夹具 ZIP 仍在临时目录生成；适配器不实现业务回复或放行结果，也不导入开发树 Host 作为执行后端。跨进程 CAS 的两方为不同的包内 broker。生成夹具用的公开 core/SDK 类型和运输客户端属于测试驱动，完整依赖摘要仍须另存。

```sh
PLUMS_CONFORMANCE_APP=/absolute/Plums.app node scripts/platform-conformance.mjs --adapter scripts/packaged-conformance-host.mjs --runtime isolate --out /absolute/isolate-package.json
PLUMS_CONFORMANCE_APP=/absolute/Plums.app node scripts/platform-conformance.mjs --adapter scripts/packaged-conformance-host.mjs --runtime controlled-node --out /absolute/node-package.json
PLUMS_TEST_APP=/absolute/Plums.app/Contents/MacOS/Plums PLUMS_CONFORMANCE_REPORT_DIR=/absolute/native-package /usr/bin/caffeinate -dims pnpm exec vitest run packages/desktop/test/platform-conformance-ui.test.ts
```

这仍是内部确定性夹具；自定义适配器 CLI 的 `adapter-supplied-unverified` 和 `thirdPartyAuthorVerified:false` 保持。包内 broker 的可信 IPC 确认响应仅验宿主路径，人工窗口由第三条原生命令另验。提交实际应用/DMG 摘要、包内文件清单与来源对照、固定 Node 版本、命令及完整日志；只写一个应用路径或声明匹配不能认证安装包。原生命令必须显示 `application.packaged:true` 及实际版本。
