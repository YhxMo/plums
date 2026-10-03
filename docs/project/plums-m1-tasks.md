# 里程碑 1 任务表(依据技术方案 v0.1 第 10 节)

## 当前状态（2026-10-03 实测）

下面的原任务与变更记录保留历史；其中派工、待合并和授权措辞不自动成为当前指令。核查起点 main 为 `7590b09367906d22782cafe197fbb8949a7d3439`，最终 main 为 `7347457c18571e308659cc4e4a334874cbd7f6dd`，本地主线已快进且干净。M1 主功能与 #1–#23、#25、#28、#26、#24 均已合并。

| 工作 | 提交 / 验证 | 当前状态 |
| --- | --- | --- |
| M1 主线 | `7590b093`，29 文件 / 803 条 | 已合并，实际运行通过 |
| #26 C1 代码清理 | 最终 `f5b5d851`，29 / 805 | 独立复核通过，已合并 |
| #24 C1 测试去重 | 最终 `5661b2d8`，30 / 807 | 合入真实 main、解决冲突、独立复核后已合并 |
| #28 权限复核与密钥清理失败恢复 | 实现 `247adc35` 全量31 / 811；最终 `17cf8b8b` 文案复核与7条密钥测试 | 独立复核通过，已合并 |
| 最终 main | `7347457c`，30 / 807 | 冻结安装、构建、全量及版本命令通过 |
| #27 交接文档 | 以 GitHub 当前 head 为准 | 同步现状、设置规则和角色卡示例 |
| 格式版本常量 | `task-package-format-version.md` | 待开发，保留传入版本及同 major 往返行为 |

本次用户明确授权独立审阅通过后普通 merge：#28 → #26 → 更新后的 #24。已按顺序完成，#24更新后重新审阅/测试，最终main全量通过。#27保持文档草稿。

正常更新清理移除字段的密钥已经实现；残留缺口是清理失败后旧引用丢失。#28 以数据库 schema 3 持久化历史引用，失败错误脱敏，重启后可通过后续版本更新或重试卸载清理。只保存引用，不保存值；旧内核拒绝 schema 3，也无法恢复升级前丢失的引用。

实测环境 macOS、Node 24.19.0、pnpm 10.33.3；冻结锁文件安装和测试构建通过，main/#28/组合/最终main版本命令为 `0.1.0`。与下文作者自述、历史只读审阅分开。无 CI，Windows 尚未验证，POSIX FIFO 用例与原生构建告警有环境限制。

后续：交接草稿审阅 → 格式常量小任务 → M2 能力总线。C1及两项修复已收口。延后风险为更新备份崩溃恢复、首次建表竞争和安装记录/目录发布短窗口；C2 与 858 行 MCP 契约测试拆分需先列清单/方案。完整边界和验证见 HANDOFF.md。

## 原任务与历史变更记录


目标:主线跑通并全部可测。导入包 → inspect 看权限清单 → 同意并启用 → 卸载;另含越权拦截、更新增权、密钥脱敏、分享、MCP 哈希。
不在本里程碑:V2/V3 适配器、Agent Skills 导入(里程碑 2)、签名校验、第三方代码沙箱、任何界面。

## 前置(需 Plums)
T0 仓库(已完成):https://github.com/YhxMo/plums ,private。后端 T1 已于 10-02 交给云端 agent 开做。
   完成标准:空仓库存在,许可证文件已放入,后端和测试都能向其提 PR。

## 后端(顺序执行,每项一个 PR)
T1 骨架:pnpm 单仓库,`@plums/core` 与 `plums` 命令行空壳;createCore({dataDir,model,egress,confirm,secrets});四个接口 ModelProvider/EgressSink/Confirm/SecretStore;PlumsError 与九个固定错误码;脱敏函数;自带 FakeModelProvider、RecordingEgressSink、内存 SecretStore、脚本化 Confirm。
   完成:`pnpm build` 和 `pnpm test` 通过;冒烟测试创建 core 并用假实现跑通;九个错误码可被导入断言。依赖:T0。
T2 包格式与导入导出:信封 JSON Schema(Ajv)校验;zip 读写;payload 原样保存和导出;未知字段保留;高 major 返回 FORMAT_UNSUPPORTED。对应验收 1。
   完成:合法包导入成功,坏包返回正确错误码与字段路径,导出再导入内容一致。依赖:T1。
T3 inspect:不安装就返回权限清单,每条含 level 与 reason。对应验收 2。依赖:T2。
T4 同意与启用/卸载:SQLite 保存安装状态和同意记录;未同意启用返回 CONSENT_REQUIRED;卸载清除数据、设置、同意记录、密钥引用,可重新安装;依赖缺失返回 DEPENDENCY_MISSING。对应验收 3、7。依赖:T3。
T5 权限检查与外发:每个动作执行前统一检查声明和同意;越权返回 PERMISSION_DENIED;write 和 egress 每次确认,没有 confirm 或被拒返回 CONFIRMATION_DENIED,且 RecordingEgressSink 无记录。对应验收 4。依赖:T4。
T6 更新增权:比较新旧权限,新增而未重新同意则拒绝(CONSENT_REQUIRED),旧版保持不变。对应验收 5。依赖:T5。
T7 密钥:secretRef、SecretStore 接入、settingsSchema 里 x-secret 字段只存引用;日志、错误、导出统一脱敏;SECRET_NOT_FOUND。对应验收 6。依赖:T2,可与 T3-T6 并行。
T8 分享:文件与 https 链接导出导入;链接下载只走 EgressSink;失败返回 SHARE_FETCH_FAILED。对应验收 8。依赖:T2、T5。
T9 MCP 连接器:每个工具名称加描述记哈希,哈希变化要重新同意;手动添加的服务标"未验证",默认只读。对应验收 9。依赖:T5、T6。
T10 命令行:薄封装,只调用库的公开 API,覆盖主线(import、inspect、enable、uninstall、export、share)。依赖:T4 起可逐步加,T9 后收尾。
每个后端 PR 都要附:对真实运行的验证结果,以及给测试看的公开 API 说明(函数签名、错误码、字段路径)。

## 测试
TT1 夹具与示例包(与 T1 并行):自制的最小合法包(character/extension/connector 各一个)、故意写错的包(缺字段、版本不对、设置项类型不对、高 major)、越权的恶意示例扩展、含假密钥字符串的包。全部自制,放进仓库。
   真实角色卡和其他许可证未确认的夹具:只在本地测试,不进仓库;里程碑 1 不需要它们,留给里程碑 2。
TT2 契约测试:每个后端任务一合并或提 PR 就按其公开 API 说明写用例,断言错误码和字段路径。
TT3 主线测试:T4 完成后写端到端(导入 → inspect → 同意启用 → 卸载 → 重装),此后任何 PR 都不能让它变红。
TT4 验收套件:验收 1-9 各至少一条测试,断言真实可观察的结果;密钥用全文搜索日志、报错、导出包。全部通过才算里程碑 1 完成。
缺陷:测试报告给我,我转给后端修。

## 前端
本里程碑无任务。

## 里程碑 1 完成标准
第 10 节 9 条验收全部有测试且通过,主线测试绿,命令行可手动走通主线。

## 工作约定(里程碑 1 起生效)
1. 清理轮:每个里程碑结束后加一个"只清理、不加功能"的任务(C1)。先列出死代码和重复逻辑的清单,Plums 确认后才改。
2. 范围限制:每个任务只读指定模块,不扫整个仓库。单文件超过 800 行,先出拆分方案,不动代码。写进每个后端任务说明。
3. 规则文件(AGENTS.md 等,仓库建好后加):每条规则都要写一句"为什么要它";代码里已不存在的旧规矩在清理轮删掉。
4. 模型分配(Plums 指定):在 Cursor 里,较复杂、容错低的任务和 spec(规格/方案)类任务,交给 sonnet 5.5。里程碑 1 中按此归类:T2、T4、T5、T6、T7、T9(格式校验、权限、同意、密钥、MCP 哈希,出错代价高)和所有 API 说明/spec 文档用 sonnet 5.5;T1、T3、T8、T10 等相对简单的任务用云端 agent 默认模型。拿不准的任务按复杂任务处理。

## 流程(里程碑 1 起生效)
1. 后端或测试提 PR,附目的、验证结果和给测试看的 API 说明。
2. 审阅给出通过或需修改(写明审的是哪个提交)。需修改的打回作者。
3. 通过后由 Plums 决定合并。审阅和测试都不合并。
4. 后端 PR 堆叠成一条链(#2→#3→#4→#5→#6→#7→#9→#10),必须按顺序审、按顺序合并。上游改动后下游依次变基。
5. 后端不等审阅全部通过就继续做下一个任务,但审阅打回的问题优先于新任务。
6. 测试发现的缺陷报给 PM,PM 转给作者。
7. 无权决定的事(合并、方案取舍、许可证、范围变更)汇总给 Plums。Plums 休息期间,方案类待定点交给云端 Sonnet 5.5 决策(Plums 在 2026-10-02 授权),结论记入"变更记录",Plums 事后审查;合并和许可证不在授权范围内。

## 变更记录
- 2026-10-02 外发 target 规则(架构师蛋定稿)并入 T5,验收 9 条扩为 12 条:target 只写主机名(可带端口),只允许 https,拒绝 IP 字面量和带用户名密码的网址;不匹配返回 PERMISSION_DENIED(/request/url);manifest 里 target 不合法返回 MANIFEST_INVALID(/permissions/{i}/target)。
- 2026-10-02 Sonnet 5.5 决策(报告:https://cursor.com/agents/bc-cdd8b162-256b-55a2-ac90-b0aa904abe1e),Plums 事后审查:
  1. target 主机部分至少两级域名,禁 `*.com`。
  2. 重定向:内核不跟随,send 只调一次,结果原样返回,调用方想继续须再调一次 runAction 重走检查(验收 12 改为此表述);分享下载遇重定向返回 SHARE_FETCH_FAILED。
  3. 旧写法 egress 权限运行时拒绝,不迁移。
  4. 更新规则确认:consent 参数;kind 变化拒绝(IMPORT_INVALID,/kind);更新时检查新版依赖(DEPENDENCY_MISSING)。CONSENT_REQUIRED 的 details.added 列全部新增权限。
  5. 反向依赖里程碑 1 不检查,写入 README 已知限制。
  6. write 内核只检查放行,不执行写入;宿主每次写入前必须先调 runAction。
  7. 内核不加日志;验收 6 断言错误对象、导出包每个文件、console 和 stdout/stderr。
  8. 里程碑 1 不抽存储接口。
  9. 前端不做演示界面;确认弹窗文案由内核统一生成(不含完整 URL),另写 docs/confirm-copy.md 文案规范。
  10. 真实外发实现须在 DNS 解析后拒绝回环、内网、链路本地地址(写入 EgressSink 接口注释)。
- 2026-10-02 03:20 审阅后的七个取舍点,由 PM(Grok)决定(云端 Sonnet 决策 agent 因 Cursor 额度用尽无法启动),Plums 事后审查:
  1. 通配符 target:只允许开头的 `*.`,后面至少两级域名,匹配子域不匹配根域,其他写法 MANIFEST_INVALID。
  2. 已安装 id 再导入:IMPORT_INVALID,details.reason=ALREADY_INSTALLED;升级走 updatePackage。
  3. EgressRequest 不加 maxBytes/timeoutMs;分享下载按 20MiB 校验;接口注释要求真实实现自行限制。
  4. details.url 保持去 query 和用户信息。
  5. 内核拒绝 `localhost` 和 `*.localhost`(字符串判断),target 声明和分享下载两处都拒。
  6. 卸载后同 id 重装允许,等同全新安装。
  7. setSettings 保留。
- 2026-10-02 03:25 T9(PR #13)三个开放点,PM(Grok)决定,Plums 事后审查:指纹由宿主在用户同意后显式调 approveMcpTools 写入,不自动记;未验证服务的 write/egress 返回 PERMISSION_DENIED(UNVERIFIED_READ_ONLY);不加清除指纹接口,但卸载必须清掉指纹和同意记录。
- 2026-10-02 03:58 T9 指纹范围,PM(Grok)决定,Plums 事后审查:选 B,指纹哈希 name + description + inputSchema(稳定序列化);只改 inputSchema 也返回 CONSENT_REQUIRED(TOOL_CHANGED)。与架构文档"名称加描述"字面不同,需架构师蛋在文档里补一句。
- 2026-10-02 04:10 云端只读复核 agent(默认模型,https://cursor.com/agents/bc-f91e4b4b-be72-5f01-9454-a7d799d27e1f)逐条复核上面十条取舍,全部同意,行为不改;两处文字待改:PR #1 架构文档第 5 节和验收 9(指纹含 inputSchema),PR #13 store.ts 指纹注释。工具从列表消失后旧指纹留到卸载,保持现状。
- 2026-10-02 04:45 审阅后的拍板,PM(Grok)决定,Plums 事后审查:details.url 去掉 fragment;body 含 >0xFF 字符拒绝(NOT_A_ZIP);CLI 不做 mcp approve;卸载崩溃窗口和 approveMcpTools 绑定指纹不做,写入 README 已知限制;真实 EgressSink 和持久化 SecretStore 里程碑 1 不补(README 写明密钥仅内存、无真实外发),留到里程碑 2 单独做、单独审;里程碑 1 完成标准中"命令行可手动走通主线"改为不含 share import(范围变更,待 Plums 确认)。
- 2026-10-02 04:40 Plums 确认:真实 EgressSink、持久化 SecretStore 和 share import 留到里程碑 2;里程碑 1 完成标准中"命令行走通主线"不含 share import。
- 2026-10-02 04:41 Plums 决定:MCP 工具从列表消失后指纹和同意作废,再出现需重新同意(TOOL_ADDED);推翻此前"保留到卸载"。涉及 #13、#14、#15、PR #1 第 5 节。
- 2026-10-02 4:50 PM定:命令行管道输入的 y 算同意(不要求 TTY,README 写明);enable --yes 表示同意 manifest 声明的全部权限并在输出里列出;share import / share export 专用分支删除,按未知命令退出码 2。
- 2026-10-02 4:50 PR #1 最新两处文档修改(尾点、fragment、>0xFF、工具消失即作废、命令行不含 share import)因云端 GitHub 令牌过期未推上,远程仍为 0af26b1,待 Plums 重新连接 GitHub 后由架构师蛋推送。
- 2026-10-02 4:57 Plums 明确:第一阶段只做内核,内核完善后才基于内核做应用。已请架构师蛋出'内核路线图'(带代码扩展隔离、扩展挂载点、权限模式底线、存储抽象等,分里程碑 2/3 排序),里程碑 1 照常收口。
- 2026-10-02 4:58 后端三层终号:#10 acbe36f(347 测试)、#13 60b4d3b(385,含工具消失即作废)、#16 b7a10ad(393)。审阅一次性复核三层,测试追基线后写 CLI 契约测试(基线 b7a10ad)。
- 2026-10-02 4:59 架构师蛋交付内核路线图 v0.1(plums-kernel-roadmap-v0.1.md):M2 能力总线/exec/fs/挂载点/审计/真实 Egress 等,M3 Wasm 带代码扩展。四点待 Plums 拍板:隔离选 Wasm、命令隔离交宿主、带代码扩展放 M3 并 M2 末两周可行性验证、权限模式放宿主内核守三条底线。已汇总发 Plums。
- 2026-10-02 5:05 审阅复核结论:#10 acbe36f 需修改(>0xFF 用例无区分度)、#13 60b4d3b 通过、#16 b7a10ad 通过带小必须改(超时 10s)。PM 拍板:#10 加 TRAILING_DOT reason 并删冗余;#13 不改名 checkMcpTools,README 补完整列表契约和已知限制;#16 采纳全部删减项。三层一次改完再报终号。

- 2026-10-02 06:16 后端三层终号:#10 c157e47d(351)、#13 e264d1be(390)、#16 a7c0a194(398),均 build/test 通过,grok-4.7。审阅复审中;测试对齐 #11/#12/#14/#15/#17 到新基线待做。PR #1 已推 a58450c(含 3447b91),路线图第 8 节补无人值守降级与按来源分档,路线图四点仍待 Plums 拍板。

- 2026-10-02 06:38 后端三层第二轮终号:#10 f7e209d8(351)、#13 f2628ad6(390)、#16 7eca83b3(397),build/test 通过,grok-4.7。已含审阅两条必须改和全部可选项;Windows 未验证。待审阅复核两条必须改、测试对齐 #11/#12/#14/#15/#17 到新基线,再审测试 PR 和 PR #1。

- 2026-10-02 06:55 PM 拍板:卸载中途崩溃后“记录已删、文件还在”,同 id 重装会沿用残留 data/<id>/settings.json(后端真实运行核实,packages/<id> 会被覆盖)。不修,写进 README 已知限制和 lifecycle.uninstall JSDoc,不加测试;随 #13 提交,#16 合入时保留。

- 2026-10-02 06:55 后端第三轮终号:#10 515970a8(352)、#13 43d5be88(391)、#16 b79ea86c(398),build/test 退出码 0,grok-4.7。#13 README+JSDoc 含孤儿目录限制句,#16 合入后保留。待审阅复核 #16 README 两句和可选项、测试对齐 #12/#14/#17。

- 2026-10-02 06:59 审阅第三轮复核:#10 515970a8、#13 43d5be88、#16 b79ea86c 全部通过,无必须改项。4 条可选项记入 C1 清理清单,不改现有 PR:(1)#13 说明里“必须是数组”只对 check/approve 两个入口成立;(2)残留 settings.json 是否绕过新包 settingsSchema 校验,C1 里真实运行核实;(3)#16 CLI 段 uninstall 删除清单与内核段重复,vitest.config.ts 注释中英文统一;(4)#10 PR 描述把 x.com. 在分享链接路径(SHARE_FETCH_FAILED/TRAILING_DOT)与 manifest target(MANIFEST_INVALID)分开写。待测试对齐 #12/#14/#15/#17 后审阅复审测试 PR 和 PR #1,再向 Plums 汇报合并顺序。

## 第三轮终号(2026-10-02 6:54)
- #10 515970a8 (352) / #13 43d5be88 (391) / #16 b79ea86c (398),build/test 均 0。孤儿目录按 PM 写入已知限制,不改行为。
- 审阅 4 条可选项记入 C1 清单,不改 #10/#13/#16。C1 待办:用真实运行查清"残留 settings.json 是否绕过新包 settingsSchema 校验"(PM 要求,先不写进限制)。

- 2026-10-02 09:16 测试对齐第三轮终号:#12 8c887ea(421)、#14 6641b7d(454)、#15 7d4f45d(419)、#17 aeb1d00(407),#11 b3fa4b8(486)、#8 245bef9 不变,build/test 退出码 0。架构师蛋:PR #1 无待办,待 Plums 同意转正式并合并;路线图新增第 9 节(M2 验收 A–E:应用可只靠 describeSettings 自动生成设置界面),并请审阅复审时核对 M1 清单格式的设置项是否含 key、类型、默认值、标签、说明。审阅复审中。

- 2026-10-02 09:25 审阅复审测试 PR:#17 通过;#8、#11、#12、#14、#15 需修改(测试已在改);PR #1 缺已知限制一节、TRAILING_DOT reason 码、已安装 id 再导入被拒。PM 拍板:测试 PR 不合并共用 helper,各自自包含并在 PR 描述写明,泄漏检查统一用 serializeError;必改项全照改;#17 可选项留 C1;PR #1 由架构师蛋补三处。审阅发现 M1 清单格式:settingsSchema 有 key、type(必填)、description(可选)、title(可选,无 label 字段),default 只在 TS 类型里不校验,setSettings 只校验 x-secret 字段、不按 type/required 校验也不回填 default。路线图第 9 节 A–E 是否提进 M1 属范围变更,待架构师蛋出补充方案后交 Plums 拍板。

- 2026-10-02 09:27 架构师蛋给出“设置项校验提进 M1”最小方案(清单 settingsSchema 必填 type/title/description、default 与 type 一致;setSettings 按 schema 校验并回填默认值;describeSettings/渲染器/未知类型报错留 M2;#10 后加一个小 PR,#13/#16 样例需 rebase,约半天到一天)。属范围变更,已私聊 Plums 请拍板,期间 M1 不动。

## C1 清单(2026-10-02 9:24,基线 #16 b79ea86c,只列未改)
共 9 条,7 条低风险。原文见 /workspace/c1-list-raw.jsonl。
- 核实:残留 data/<id>/settings.json 绕过新包 schema 校验(import/inspect/grantConsent/enable/resolveSettings 全部静默通过,五种情形实测,退出码 0);setSettings 也不按 type/required 校验。建议在 install/settings.ts 抽校验函数,setSettings 写入前与 importPackage/updatePackage 在记安装记录前调用,失败用 IMPORT_INVALID(path /settings/<key>),并同步改 README 45 行与 uninstall JSDoc。非低风险。
- 死代码:PACKAGE_FORMAT_VERSION(types.ts:85 + index.ts:59 再导出,公开导出);shareMessage 的 ?? 兜底(share.ts:142)。
- 重复:settings 路径拼两次(settings.ts:46/56);包 id 规则两遍(schema.ts ID_PATTERN / tools.ts MANUAL_ID)。
- 审阅四条:(1)TypeError 只覆盖 check/approve,把 Array.isArray 挪到这两个入口;(3)README 第 34 行 uninstall 删除清单收成指回第 44 行,vitest.config.ts:11 注释改英文;(4)#10 PR 描述把分享链接(SHARE_FETCH_FAILED/TRAILING_DOT)与 manifest target(MANIFEST_INVALID/TRAILING_DOT)分开写。
- 最长文件 mcp-tools.test.ts 585 行,无超 800 行。

- 2026-10-02 09:30 审阅对 M1 设置项校验方案补两点(待 Plums 拍板后并入方案):(1) x-secret 字段白名单仍是 type/title/description/x-secret,default 只对非 secret 字段开放;(2) “必填”指 settingsSchema 的 required 数组,并写明回填 default 与必填校验的先后顺序。
- 2026-10-02 09:33 PR #1 补完 fc6c9e5(第 14 节已知限制、TRAILING_DOT、ALREADY_INSTALLED),待审阅复核。后端 C1 清单 9 条(基线 #16 b79ea86c):真实运行证实残留 settings.json 会绕过新包校验(五种情形均 enable 成功),建议并入 M1 设置校验任务做;死代码 PACKAGE_FORMAT_VERSION、shareMessage 的 ?? 兜底;重复逻辑 settings 路径拼两次、包 id 规则两遍;README/注释/PR 描述小改。待 Plums 确认:全做/只做低风险 7 条/残留 settings 并入 M1 设置校验。

- 2026-10-02 09:36 架构师蛋意见:残留 settings.json 绕过校验架构上必须修,并入 M1 设置校验任务,修好后 PR #1 第 14 节改为“导入时按新 schema 重新校验,失败拒绝并回滚”;校验顺序写死:先按 required 与类型校验,再回填 default,default 本身也要过校验。PACKAGE_FORMAT_VERSION 先别删(M2 要靠它对旧版应用报未知格式),若 exportPackage 未写入,应改成导出导入都用它。PM 暂定:C1 清单第 1 条改为“保留常量,是否让导出导入使用它随设置校验任务一并评估”,其余 8 条无异议,仍等 Plums 选方案。

- 2026-10-02 09:40 审阅复审 PR #1 fc6c9e5d:需修改,必须改两条(§13 尾点三条路径的 code/path/reason:runAction 为 PERMISSION_DENIED /request/url URL_NOT_ALLOWED,manifest 为 MANIFEST_INVALID /permissions/{i}/target TRAILING_DOT,分享链接为 SHARE_FETCH_FAILED /url TRAILING_DOT 且先于 LOCALHOST;details 与实现一致)。PM 拍板可选项全做(反向依赖只留一处、去掉“可写”、§14 补密钥已删仍显示已安装),孤儿 settings 条等 Plums 对设置校验拍板后再同步。

- 2026-10-02 09:45 架构师蛋 PR #1 新提交 a0d4f5e5(两条必须改加三条可选已改,孤儿 settings 条未动),审阅复核中。

- 2026-10-02 09:50 审阅复核 PR #1 a0d4f5e5:通过,无必须改。待 Plums 决定转正式并合并,设置校验进 M1 定后孤儿 settings 条目要同步改。测试 PR 待测试报新号。

- 2026-10-02 11:30 Plums 选方案1:设置校验提进 M1,残留 settings 一起修,C1 清理8条一起做(第1条保留 PACKAGE_FORMAT_VERSION)。测试第四轮号:#8 0a78eee、#11 d02c0dd、#12 5cf4ee7、#14 3fd8021、#15 5756116、#17 2ec1236,待审阅复审。已通知架构师蛋出任务说明,后端/测试待命。

- 2026-10-02 11:35 Plums 拍板:带代码扩展隔离用 V8 隔离(isolated-vm 类),不选 Wasm。路线图其余三点待确认。

- 2026-10-02 11:36 Plums 确认路线图四点全部定稿:V8 隔离、命令执行交宿主、带代码扩展放 M3(M2 末可行性验证)、权限模式放宿主+三条底线。

- 2026-10-02 11:40 架构师蛋出设置校验任务说明(task-m1-settings-validation.md),路线图更新为 v0.2(四点已确认,候选库维护状态未核实,列入 M2 末验证)。后端已开工:在 #10(515970a8)上开新分支和小 PR,同批做设置校验、残留 settings 回滚、C1 其余7条、PACKAGE_FORMAT_VERSION 核对。建议合并顺序改为 #10 → 设置校验PR → #13 → #16,待转 Plums。PR #1 §14 孤儿 settings 条架构师蛋已让云端 agent 改。测试 #12/#15 在按审阅意见改。

- 2026-10-02 11:55 PR #1 新提交 e4997a2a(§14 孤儿 settings 改为已由导入校验覆盖,新增 §15 设置项声明与校验),审阅复核中。§15 描述的是设置校验小 PR 目标行为,实现出来后需再对一遍。

- 2026-10-02 12:00 审阅复审:#12 fde24c52、#15 f32ee58a 通过,至此测试 PR #8/#11/#12/#14/#15/#17 全部通过审阅。PR #1 e4997a2a 需修改(文字):§15/§14 标"M1目标行为,基线未实现"、§14 孤儿条补 updatePackage 与非法JSON与无schema情形、§15 补 default 违反规则/path/不含secret、澄清必填含义。PM 决定:setSettings 校验失败沿用基线已有错误码,没有则新增 SETTINGS_INVALID(path /settings/<key>),IMPORT_INVALID 只用于导入/更新残留校验;后端在 PR 描述写实际用码。

- 2026-10-02 12:05 残留 settings 处理定为:残留文件非法 JSON,或新包无 settingsSchema 但残留文件还在,一律 IMPORT_INVALID(path /settings)并回滚。后果:无 settingsSchema 的包在崩溃残留后重装前需手动删 data/<id>/settings.json(罕见情形,后端在 README 和 PR 描述写明)。向 Plums 汇总时提示这点,他若觉得对非程序员不友好,可改为自动清理。

- 2026-10-02 12:10 PR #1 新提交 c5e4de73(按审阅1-5条改完;setSettings 失败码定为新增 SETTINGS_INVALID,因基线只有 SECRET_NOT_FOUND),审阅复核中。后端按 SETTINGS_INVALID 实现,错误码清单 9→10。

- 2026-10-02 12:15 审阅复核 PR #1 c5e4de73:需修改三处小问题(§9 错误码清单补 SETTINGS_INVALID;§10 新第10条与 §13 编号冲突并补验收内容;§14 孤儿条普通校验失败 path 应为 /settings/<key>)。架构师蛋改。后端加 SETTINGS_INVALID 时 errors.ts 码表和 errors 测试清单要同步。

- 2026-10-02 12:25 后端设置校验 PR #18(草稿,base=#10 分支,head 98c26d8f,365测试,grok-4.7)出,审阅审查中。PM 决定:PACKAGE_FORMAT_VERSION 不并进 #18,现状保持(导出不写版本,导入接受1.7拒2.0),作为 M1 合并后、M2 开始前的后续小任务,架构师蛋届时出说明。建议合并顺序:#10 → #18 → #13 → #16;#13 合并 #18 并做 C1-4/5,#16 随后做 C1-7。测试基于 #18 补 #11/#14 设置校验用例。

- 2026-10-02 12:10 PR #1 新提交 a2a956bd(§9/§10/§13/§14/§15 按审阅改完),待审阅复核。#13 终号 e88f9bc2(已合并 #18 98c26d8f,404 测试,含 C1-4/5),待审阅复核;#16 将合并 #13 并做 C1-7。测试基于 e88f9bc2 对齐 #14,#11 合 #18。

- 2026-10-02 12:20 审阅结论:#18(98c26d8f)通过无必改;PR #1(a2a956bd)通过;#13(e88f9bc2)通过;#16 新终号 822ff710 待审阅复核 merge 部分。PM 决定(U1):import 遇孤儿 settings 仍拒绝(IMPORT_INVALID /settings);update 遇无 settingsSchema 的新版只忽略文件不读不删、更新成功(改写此前"无 schema 一律拒"的决定,仅保留于 import)。后端做 U1、S1-S5、S7-S9、T1-T3,不做 S6(任务说明要求 Ajv)和"无 schema 包只接受空对象";#18 出单一终号后 #13、#16 各再 merge。架构师蛋同步 §14/§10/§15。测试等终号再对齐。向 Plums 汇总时需说明:import 时孤儿文件仍需手删,update 不再卡。

- 2026-10-02 12:25 PR #1 新提交 b1a87368(U1、NOT_JSON、§15 details、§10 拆 10.1-10.5),待审阅复核;#18 终号待后端出。

- 2026-10-02 12:30 #18 终号 f36f89f6(371测试,含U1/S1-S5/S7-S9/T1-T3),审阅复核中;PR #1 b1a87368 审阅通过。PM 决定:minimum/maximum 用在非数字属性上的 MANIFEST_INVALID path 以实现为准,即 /settingsSchema/properties/<key>/minimum|maximum,文档改。后端让 #13 再 merge 新号,#16 随后,再 @测试 对齐。

- 2026-10-02 12:35 #18 f36f89f6 审阅通过,号码定下不再改;审阅 3 条可选项(去 reject/ignore 参数、重复 JSDoc)入 C1 清单,"无schema再升级到有schema"用例测试已在 #11 补。#13 终号 0ddb05db(410测试)待审阅复核;PR #1 8545a81f 待复核;#16 待合并 0ddb05db。风险登记(待决,M1不改):新版去掉 x-secret 字段后卸载只按当前清单删密钥,旧密钥残留于 SecretStore,与"卸载后密钥引用全部清除"冲突;非 #18 引入,向 Plums 汇总时说明,M2 前处理。

- 2026-10-02 12:40 #13 0ddb05db 审阅通过;PR #1 8545a81f 审阅通过(4条文档可选项照改);#16 终号 8dd30b08(420测试)待审阅复核 merge 部分;#13 uninstall JSDoc 重复入 C1,不再动号。测试对齐 #11(f36f89f6)、#14(0ddb05db)、#17(8dd30b08)中。

- 2026-10-02 12:45 #16 8dd30b08 审阅通过(3条可选项入C1,号不再动);PR #1 aec74f69 待审阅复核;后端链 #10 515970a8 → #18 f36f89f6 → #13 0ddb05db → #16 8dd30b08 均已过审。待测试 #11/#14/#17 新号。

- 2026-10-02 12:50 PR #1 终号 aec74f69(审阅通过,不再改)。等测试 #11/#14/#17 终号与复核后向 Plums 汇总合并。

- 2026-10-02 14:32 测试终号:#11 b57cc6fc(合并#18 f36f89f6,550)、#14 89f7e0b6(基线#13 0ddb05db,480)、#17 31137b7b(基线#16 8dd30b08,435),build/test 退出码0,无缺陷,审阅复审中。PM 决定:#11 基线为 T7 不在 #13 线上,接受合并 #18(带入 T8 分享实现),不改基;合并顺序 #10→#18 在 #11 之前,复审只看测试自身改动。

- 2026-10-02 14:39 审阅通过测试 #11 b57cc6fc、#14 89f7e0b6、#17 31137b7b(无必改项,只读审)。三条精简建议(#11/#14/#17 合并重复用例)不再动号,入 C1 清单。合并顺序 #10→#18→#11(先合 #11 会带进 #10/#18 的 src)。待 Plums 拍板合并。

- 2026-10-02 14:45 Plums 决定:宿主开发指南和上手说明先不排;不做演示界面;路线图入库为 docs/roadmap.md(交后端开只含文档的小草稿 PR,审阅复核,合并由 Plums 定)。

- 2026-10-02 14:50 Plums 授权按序合并审阅通过的 PR。PR #1 已合入 main(合并提交 6b472174)。其余未合:#2–#7、#9 PR 上无审阅记录(待审阅确认通过终号);#8 head 为 32c00fae,与通过号 0a78eee 不符(待测试说明、审阅复核);实际栈:main←#2←#3←#4←#5←#6←#7←#9←#10;#8 base=t1;#11 base=t7;#13 base=t8;#18 base=t8;#16 base=t9。合并时需逐个把 base 改成 main。仓库无 CI。

- 2026-10-02 14:55 审阅:#2–#7、#9 无通过终号记录,按现 head 全部补审;#8 的 32c00fae 是测试推的一个夹具提交(为 #18 必填 title/description 补字段,无 src/断言改动),审阅只复核 0a78eee→32c00fae。路线图入库已派后端(云端,基线 main,只加 docs/roadmap.md)。补审出结论前不合 #2–#9。

- 2026-10-02 15:00 路线图 PR #19(052aab07,只加 docs/roadmap.md,sha256 与原文一致,审阅通过)已合入 main,合并提交 644b362b。待补审后再合 #2–#9 链。C1 清单追加:roadmap §9 的 setSetting 应为 setSettings;D、B 已由 #18 实现,验收可标完成。

- 2026-10-02 15:03 审阅补审通过 #2–#7、#9(终号见群)及 #8 32c00fae;合并顺序 #2→#8→#3→#4→#5→#6→#7→#9→#10→#18→#11→其余,merge commit 不 squash,每合一个把下一个 base 改 main。已派执行(Plums 授权)。C1 追加:redact 同对象二次引用误判循环(#9 已改)、Core 暴露项(#9 已删)、#3/#4 validatePackage/inspectPackage 独立导出与 core 方法重复、#5 store.recordInstall 先 DELETE 在 #10 后不可达、#6 redact(err,[]) 空操作(#9 已删)。风险登记:#9 guard 在 knownSecrets 本身失败时抛未脱敏原始错误(测试已明写);updatePackage 遇上次崩溃留下的 .backup-<id> 会先删,崩溃窗口无测试。

- 2026-10-02 15:08 已合入 main:#1 6b472174、#19 644b362b、#2 941093a4、#8 c026ff48、#3 db25c852、#4 79cd709a、#5 09d63a77、#6 0ce8b0aa、#7 6785b2ab、#9 4b1f1f2f、#10 c4ff1e3d、#18 21ca1522、#11 02f50f78、#13 5b50d258(main 当前)。#12 与 main 夹具 add/add 冲突(带 #8 旧版夹具),已请测试把 main 合进来、夹具取 main 版本,审阅只复核该 merge。继续合 #14、#15、#16、#17。

- 2026-10-02 15:12 再合入 main:#14 b6946b31、#16 4e9937ef、#17 7f4a3f22(main 当前)。仅剩测试 #12(fde24c52)、#15(f32ee58a)因夹具 add/add 冲突未合,已请测试把 main 合入、夹具取 main 版本,审阅复核该 merge。

- 2026-10-02 15:25 Plums 本机独立审阅 main(5b50d25) 发现 6 问题,M1 内全修:P1 ① guard 在 knownSecrets 读取失败时原样重抛未脱敏错误 ② CLI bin 指向未构建的 dist,干净安装缺 plums 入口;P2 ③ 文件名大小写碰撞覆盖(含 manifest) ④ 同 ID 并发导入绕过已安装检查 ⑤ share 导出丢 `__proto__` 文件 ⑥ export 可导出内核自己导入不了的 ZIP。已派后端修复(P1/P2 各一 PR),测试补回归,审阅复核。#12/#15 照常收尾。
- 2026-10-02 15:28 Plums 提供的审阅复现脚本存于 /workspace/plums-review-repro/(concurrency、paths、repro 三份,import 路径为 ../packages/core/dist/index.js,需放在仓库下子目录运行)
- 2026-10-02 15:42 修复 PR:P1 #20(42c99551,guard 脱敏+CLI bin)、P2 #21(38095ca3,大小写/并发/__proto__/导出冲突)均已出,审阅中。#12 新终号 785daa71、#15 因恢复 #frag 一行待新终号。合并顺序:#12、#15 → #20 → #21 → 测试回归 PR。
- 2026-10-02 15:48 已合入 main:#20 bbe844bc、#21 8e5637df(merge commit,审阅均通过,head 核对一致)。main 最新 8e5637dfcbc6396bce4f7f66a2b3be397d396c18。测试 #12、#15 与回归 PR 改按此 main 做,终号出后审阅复核再合。审阅给 #21 的可选项记入 C1:跨进程同 ID 导入撞主键会 rm 已装目录、p2 一条弱用例、read-zip 冲突检查 O(n²)、install.ts 重复检查位置、importQueue 键含 dataDir、导出错误 path 不一致、NFC/NFD 与 Windows 保留名未覆盖、文档(IMPORT_INVALID path 约定、JSDoc、installPackage 注释)待架构师蛋同步。
- 2026-10-02 15:50 后端自述:main 8e5637df 干净检出 install/build/test(695 个)/plums --version 均退出 0;install 时有 better-sqlite3 构建脚本被 pnpm 忽略的警告(测试仍通过),记入 C1 核对是否需要在 package.json 配 onlyBuiltDependencies。
- 2026-10-02 15:54 架构师蛋文档对齐 PR #22(草稿,base 8e5637df,仅 docs/architecture.md,终号 e1c48994)审阅中;通过后转 ready 按序合,与回归 PR 互不依赖。


## 2026-10-02 晚 追加

- 合并状态:#22、#12、#15 由 Plums 本人合入(main 到 34880739);#23(测试回归 PR,head aefde484)审阅通过后由 PM 合入,merge commit 079d640f06db9841b3d420143bb46962172fce2f。里程碑 1 全部 PR 已合。
- 远程分支:已清理 19 个已合并 PR 的远程分支;剩余已合并分支待再清理一次。
- 待办:后端在 079d640f 上干净检出,跑 pnpm install --frozen-lockfile / build / test / plums --version 并报结果;之后启动 C1 只清理轮,先列清单给 Plums 确认,确认前不改代码。
- C1 清单(要点):
  - #21:跨进程同 id 并发导入时,catch 里 rm(installDir) 可能删掉对方已装好的目录,应把主键冲突当 ALREADY_INSTALLED 且不删目录;read-zip.ts 冲突检查 O(n²);install.ts 重复检查挪到 mkdir(root) 前;importQueue 键改 dataDir+id;导出错误 path 不一致;toLowerCase 与真实文件系统不完全一致;JSDoc/注释过期。
  - #22 措辞:§10.1 加「同一进程内」,§9 补读取密钥失败会替换 guard 方法原错误,§12 补目录条目去尾斜杠。
  - #23 的 6 条精简:C1 并发用例与 p2 重复可删;F 与 #20 cli.test.ts 重复;B1/B3/E 与 p2 重复,仅保留 Dir//dir/、Manifest.json/ 别名、导出 Dir/x 与 dir/x、拒绝后仍能导出;D 里两处恒真断言可删;辅助代码重复;C2 轮询 .staging-* 目录名耦合。
  - 更早条目:#11/#14/#17 合并重复用例;#18 acceptResidualSettings 参数与重复 JSDoc;#13 uninstall JSDoc 与 README 重复;#16 SETTINGS_INVALID spy 用例,以及 CLI 卸载确认补列密钥/MCP 批准;#3/#4 独立导出 validatePackage/inspectPackage 与 core 方法重复;#5 store.recordInstall 先 DELETE 已不可达;better-sqlite3 构建脚本被 pnpm 忽略,需核对 onlyBuiltDependencies;#12/#15 PR 描述基线过期。
- 风险登记(M1 不改):新版去掉 x-secret 字段后,卸载不删旧密钥;updatePackage 遇上次崩溃留下的 .backup-<id> 会先删,崩溃窗口无测试。
