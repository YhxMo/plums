# CI 与本地验证

`.github/workflows/ci.yml` 在 pull request、`main` push 和手动触发时验证默认套件。它安装冻结锁文件、准备独立原生测试 Node、构建全部包、核对测试文件覆盖、以 unit/platform/electron 三组运行所有默认 Vitest 项目，unit 独立检查打包清单门，report 核对所有 skipped/pending/todo 用例与必过迁移并上传 JSON。它不打包、不签名、不公证、不发布。

## 独立平台诊断

CI 另设只读 `diagnostics` job，与三个测试 job 并行。它在构建后记录资源、默认 Node 堆上限、系统版本、原始 `/bin/echo` 与重签副本的架构/签名及直接/Seatbelt 执行结果，并经公开宿主/SDK 夹具调用真实 `bindControlledProgram` 路径。命令固定参数并设执行超时，探针失败原样保存在 `reports/diagnostics/profile.json` 的 status/signal/stdout/stderr 中；失败数据不代表诊断脚本自身失败，报告写入失败仍使 job 失败。

`ci-platform-profile` 在 profile 完成后立即上传，避免后续原生探针取消时丢失证据。`ci-diagnostics` artifact 保留 14 天，另收集 `members-variants.json`；成员校准的记录型用例通过不代表容器可用。默认测试的断言、执行预算和平台条件保持原样，仅补固定错误码与非 passed case id/status 的失败消息。远端 macos-15 的新诊断尚待推送运行；当前不根据本机结果推断 runner 的受控命令根因，也不新增平台跳过。

本次本机原始报告为 `.artifacts/ci/step1-local-profile.json`：macosMajor=27，hw.memsize=17179869184、hw.ncpu=10、hw.physicalcpu=10、默认 heap_size_limit=4192 MiB；`lipo -archs /bin/echo` 为 `x86_64 arm64e arm64e.x1`。副本重签后为 `Signature=adhoc`，strict 验签退出 0；直接、最小 Seatbelt、原始程序的 arm64/Seatbelt 和真实宿主路径均退出 0，宿主返回 completed/exitCode=0/failure=null。此结果只说明本机观察，不能判定 macos-15 的失败原因。

## macos-15 诊断状态

已下载 PR 头 `1b5d3387a5a1a11c76d1bab7f8fc69cc6daa89bb` 的 [pull_request run 38050045312](https://github.com/YhxMo/plums/actions/runs/38050045312) 与 [push run 38050036472](https://github.com/YhxMo/plums/actions/runs/38050036472) 失败日志，保存于 `.artifacts/ci/<runId>-failed.log`。前者原文包含 `fatal: not a tree object`（两个固定历史 core 提交）、`Downloading Electron binary...`、`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory` 和 `Command was killed with SIGABRT (Aborted)`；随后报告缺失。新增 diagnostics 的资源、架构/签名、三种执行与成员校准结果仍待远端运行，尚未选择受控命令修复或 OS 门控方案。

## 环境与版本

根 `package.json` 为 `packageManager: pnpm@10.33.3`、`engines.node: >=22`，core/CLI 可单独使用 Node 22+。桌面完整构建和原生集成测试固定 Node 26.5.1；仓库没有 `.nvmrc` 或 `.node-version`。工作流与 `scripts/prepare-test-runtime.mjs`、`scripts/package-desktop.mjs` 的精确 Node 版本由覆盖守卫一起核对。pnpm/action-setup 从根 packageManager 读取版本，不另设可漂移版本。

[Node 官方发行记录](https://nodejs.org/en/download/archive/v26.5.1)提供 26.5.1。上述真实 CI 已运行到 Vitest；无法获取固定版本仍会使 job 失败，不降级。独立 Node 准备脚本从官方目录下载并核对 SHA-256，不能省略：测试直接运行 Vitest，不经过 `pnpm test` 的准备步骤。

[GitHub 官方 runner 表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)列出 `macos-15` 为 M1 arm64。工作流固定该标签并打印 `sw_vers`、`uname -m`、Node 与 pnpm，断言 arm64。产品 `LSMinimumSystemVersion` 为 **27.0.1**；**CI 不是目标系统，通过不等于在 27.0.1 上通过**。不使用 macos-latest。

本机 2026-10-10 核对：macOS 27.0.1（26A434）、arm64、Node 26.5.1、pnpm 10.33.3。`pnpm install --frozen-lockfile` 退出 0；pnpm 更新通知查询遇到网络错误，依赖安装仍完成且锁文件不变。分组前 job 的20分钟预算属于历史配置；当前分组job预算见下节，不改变用例预算。

## Action 固定与权限

以下 tag 经 GitHub REST `git/ref/tags/<tag>` 解析；pnpm 的 annotated tag 再用 `git/tags/<object>` 解引用为 commit。原始 API 输出在 `.artifacts/gate12/*-tag.json`。网络首次失败后重试取得全部记录。

| Action                          | Tag    | 固定 commit                                |
| ------------------------------- | ------ | ------------------------------------------ |
| actions/checkout                | v4.3.1 | `34e114876b0b11c390a56381ad16ebd13914f8d5` |
| actions/setup-node              | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| pnpm/action-setup               | v4.2.0 | `41ff72655975bd51cab0327fa583b6e92b6d3061` |
| actions/upload-artifact         | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| actions/download-artifact       | v4.3.0 | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |
| actions/attest-build-provenance | v4.2.2 | `4d101475d8b20a2381f78447822ac1eab6504dd8` |

顶层权限为空，job 只读 contents；checkout 不保存凭据。工作流无 secrets，不使用 pull_request_target，不使用环境批准或发布入口。同一PR的新运行取消旧运行；main push不取消。报告上传使用 always，即使失败也保留 JSON（没有报告则上传步骤失败）。

## 测试覆盖与调度隔离

审查起点 `4618fb9`：16 个项目、164 个默认测试文件，另有 1 个实验文件。本次新增 4 个测试文件后，默认 168 文件、总 169 文件；两种实验开关下的覆盖守卫均通过。`scripts/check-test-coverage.mjs` 通过 [Vitest 3 Node API](https://v3.vitest.dev/advanced/api/vitest) 的 `createVitest`/`globTestSpecifications` 获取实际项目命中，不执行测试；独立遍历 `packages/*/test/**/*.test.ts`，检查每文件恰好命中一项目。只有 `project-members.experiments.test.ts` 在默认环境允许零命中；`PLUMS_NATIVE_EXPERIMENTS=1` 时必须只命中 experiments。

unit 本地使用4 workers，CI使用2。13 个 Electron 文件各有项目，groupOrder 101–113，隔离共享系统焦点。local-callbacks 与 confirm-once 的独立顺序组为 200/201，各一个 worker；守卫要求它们各自仅归属对应 serial 项目，顺序不同且晚于 unit。CI按groups清单传入各组全部项目，聚合器复核serial/UI文件均已执行。JSON 时间戳在最终全量中另行验证。

这是**调度隔离，不是性能修复**。同负载测量结果见本节后续记录；并发负载下的根因未归因。`632dec2` 新增了这两个用例；`confirmOperation` 的密钥读取在该提交之前已存在，该提交只把读取异常收敛为拒绝，**没有增加读取次数，也没有证据表明它增加耗时**。

复核成本与本次调用点计数见[性能文档](performance.md#本地请求的复核成本)，口径仍为调度隔离，非性能修复。

## 固定历史迁移夹具

用户确认将 schema-6/7 的真实历史 core 源码归档固定在 `packages/core/test/fixtures/historical-core/`，`sha256.json` 记录原始提交和 SHA-256。`historical-core.ts` 读取这两份 tar，仅在清单与代码内固定身份一致、归档哈希吻合时构建历史实现，不调用 Git，不以当前实现伪造旧数据库。浅克隆或 squash/rebase 合并不会使夹具消失；清单和归档同时被改写也不能绕过代码内固定哈希。checkout 恢复默认浅克隆。tar 在解包前按原始头校验路径、类型和校验和，仅允许 core/src、祖先目录与 Git 提交注释，拒绝绝对路径、上级路径和链接。归档使用 binary 属性。

`ci/required-tests.json` 要求 authentic-migration-audit 恰好 12 项通过，以及 schema-seven 的 local-authorization 迁移用例确实通过。跳过报告同时检查这些硬要求，缺文件、数量不足、skipped/pending/failed 或指定名称缺失都会失败；现有跳过集合的双向检查保留。

## 平台门控

检入清单为 [`ci/expected-skips.json`](../ci/expected-skips.json)。当前条目：

- `packages/host/test/project-sandbox.test.ts::project conformance records a skip on other platforms`：该反向平台用例仅在 `!supported` 时执行；macOS arm64 改为执行同文件的支持平台用例。因此本机和 macos-15 arm64 预期跳过这一项。

初始条目来自当前源码与已有本机报告，必须由本次最终全量逐项确认。`ci-skip-report.mjs` 列出每个跳过、pending 和 todo 的文件/名称/原因；多出或缺失任意条目都失败，结果写入 job summary。runner 若出现额外跳过，先核对平台条件并在本文逐条解释，再更新数据清单；不能通过扩大门控使 CI 变绿。实验文件不在默认收集范围，覆盖守卫显式记录，不冒充回收验收。

## 托管 Electron 状态

真实 CI 的默认运行因 Node 堆耗尽中止；上述 pull_request 日志中最后通过的 Electron 文件为 local-permissions-ui，后续套件尚无完成证据。foundation-ui 输出测试内下载 Electron。窗口/焦点行为与完整执行结果仍需后续分组报告核对。本地静态检查不能证明远端行为。所有 Electron 项目仍在默认命令内，失败会使 CI 失败；没有 exclude 或 continue-on-error。当前electron组保持必过且运行全部UI用例，远端完成证据待核对。

## 本地等价命令

```sh
pnpm install --frozen-lockfile
node scripts/prepare-test-runtime.mjs
pnpm build
node scripts/check-test-coverage.mjs
pnpm exec vitest run --reporter=default --reporter=json --outputFile=ci-report.json
pnpm exec vitest run packages/host/test/package-manifest.test.ts --maxWorkers=1
node scripts/ci-skip-report.mjs ci-report.json
actionlint .github/workflows/ci.yml
```

本机 `pnpm test` 包含运行时准备和构建，最终证据使用它。UI 测试期间不要操作鼠标键盘，避免外部焦点变化影响结果。

## 2026-10-10 同负载测量

local-callbacks 与 confirm-once 采用独立顺序调度组（groupOrder 200/201）。这是调度隔离，不是性能修复：并发负载下的根因未归因；B 条件（4 workers 竞争）下的实测为 207/207、7 文件、Vitest 110.33s（命令墙钟 110.99s）。`632dec2` 新增了这两个用例；`confirmOperation` 的密钥读取在该提交之前已存在，该提交只把读取异常收敛为拒绝，**没有增加读取次数，也没有证据表明它增加耗时**。

A 使用默认两个 serial 项目，42/42、Vitest 103.56s（墙钟 104.37s）；JSON 显示两文件间隔 547.77ms。B 只在被忽略的 `.artifacts/gate12/vitest.load.config.ts` 继承根配置，将两文件放回 unit 并移除两个 serial 项目，保持所有预算与断言；其他竞争文件为 recheck-coalescing、engine、library、scenarios/mcp、platform-conformance。执行前 `vitest list --filesOnly --json` 确认 7 文件均只归属 unit。两条件工作量不同，总耗时不能作为吞吐量比较。

| 文件或历史失败用例                                                                               |  A 秒 |  B 秒 | B 结果 |
| ------------------------------------------------------------------------------------------------ | ----: | ----: | ------ |
| local-callbacks 文件                                                                             | 85.86 | 98.88 | 26/26  |
| confirm-once 文件                                                                                | 16.39 | 19.73 | 16/16  |
| expires a nested local callback at its original common task deadline                             |  3.59 |  4.04 | 通过   |
| carries the earlier parent tool policy deadline into a local request inside a longer common task |  7.40 | 10.94 | 通过   |
| policy confirmations refresh and redact secret values in the message                             |  5.32 |  7.47 | 通过   |
| policy: a secret read failure while preparing a confirmation denies instead of throwing          |  5.41 |  5.56 | 通过   |

本次 B 没有复现历史故障，两项 confirm-once 未超过 A 的两倍；单次样本不构成稳定性或性能归因证明，因此没有触发失败后的单文件对照。原始证据：`.artifacts/gate12/measurement-A.{json,log}`、`measurement-B-final.{json,log}`、对应 meta、`load-files-final.json`、`measurement-summary.json`。第一次 B 将 MCP 路径误写为 host/test/mcp，实际只收集 6 文件；已按正确 scenarios/mcp 路径重测，表格仅采用 7 文件结果。

## 最终本机验收

2026-10-10 最终提交 `c05394eed933a11bc87f1182e6b10c32f84d5c90`：默认168文件全部运行，2513项中2512通过/0失败/1平台跳过/0todo，423.10s，含构建墙钟430.787s。两个serial组晚于unit且不重叠；跳过清单与覆盖守卫一致。20分钟job预算约为本机墙钟的2.8倍。首次全量因两处夹具准备/保存位置修复重跑一次；提交与打包证据见[本地发布验证证据](release-evidence.md)。CI仍未真实运行。

## PR #36 分组运行与崩溃证据（2026-10-10）

默认项目由 `ci/groups.json` 恰好分配给 unit/platform/electron；覆盖守卫校验配置与实际报告的文件归属。平台候选通过 `rg` 搜索 sandbox-exec、bindControlledProgram 和 darwin 条件后逐文件复核；SDK 控制用例的真实程序绑定、scenario foundation 的受控 Node 也归入 platform。core 的纯授权/迁移用例仍归入 unit，实验文件仍不属于默认组。

unit 的 CI 并发先采用计划默认值 2，本地仍为 4；两个 serial 项目仍各 1 worker，顺序200/201不变。platform 为1 worker，Electron保留13个顺序项目。当前远端 profile 缺失，不能写死一个假定 runner 内存：每个 job 读取实际 `hw.memsize`，按 `min(4096, floor(memoryMiB * 0.4))` 计算堆 MiB，只在运行测试组的 step 设置 NODE_OPTIONS。pending报告保存该值、系统内存和V8堆上限；新远端profile取得后核对资源与并发依据。

[Vitest 3 的 logHeapUsage](https://v3.vitest.dev/config/#logheapusage)输出每个文件的堆使用量。本机小子集已产生heap usage行；运行器保留默认forks池，`/usr/bin/time -l`输出最大RSS。pending/status/JSON与完整日志上传为reports-unit/platform/electron，14天保留。缺JSON或信号中止判为crashed，保留最后50行；失败、遗漏、重复文件、组归属错误和不同提交均使report失败。report在三个组结束后汇总，不替代各组自身失败结论。

unit/platform/electron的job预算分别25/25/30分钟，report为15分钟；用例20秒、平台一致性180秒及原生运行预算均不变。包清单门保留在unit。download-artifact v4.3.0的REST标签原文为 `{"sha":"d3f86a106a0bac45b974a628896c90dbdf5c8093","type":"commit"}`，workflow固定此SHA。

## macos-15 原始诊断与4B决定

push run 38054025148（头 `2b2ced91f2c6111d799cb7fb28e62f28ed4612d3`）的独立profile已下载到 `.artifacts/ci/38054025148/ci-platform-profile/profile.json`，不再依赖成员探针完成。macOS 15.7.9（24G830）、`hw.memsize=15032385536`、`hw.ncpu=5`、`hw.physicalcpu=5`、默认堆上限2144 MiB。按14 GiB实际内存计算上限为4096 MiB，V8报告4192 MiB；CI unit保持2 workers以限制多个原生子进程同时竞争，本地4不变。

原文：`lipo -archs /bin/echo` 为 `x86_64 arm64e`，无arm64切片。重签前 `Platform identifier=16`、Apple签名；重签后 `Signature=adhoc`，`codesign --verify --strict`退出0。直接运行副本status=null/signal=SIGSEGV/stderr为空；最小Seatbelt副本status=null/signal=SIGKILL/stderr为空；原始程序的arm64与Seatbelt均status=0/stdout=`hello\n`。真实受控宿主探针进程status=0，业务结果为 `{"status":"failed","executionState":"unknown","exitCode":null,"failure":{"code":"PROVIDER_FAILED","reason":null}}`。kernel日志原文：`exec_mach_imgact: not running binary "command" built against preview arm64e ABI`。

据此选择4B：系统副本失去平台身份后被15的preview arm64e ABI限制拒绝，签名验证不是执行可用性的证明；没有可提取的arm64切片。保留原始字节/重签契约，不替换程序、不改宿主保证。只对common-runtime、policy-execution的真实系统命令和两种public平台runtime的E01设macOS主版本门控，条件为darwin arm64且major>=27。27是已有目标，16–26未验证。public套件拆出E01为独立报告用例，其余case继续逐个执行；原断言与180秒预算保持，两个报告的coverage均如实为partial，组合覆盖原有case集合。

`ci/expected-skips.json`列出4个默认受控命令门控项，when.macosMajor.lt=27，附证据链接；低版本必须恰好跳过，意外执行也使门失败并提示核对后更新清单。27上必须存在并通过，跳过或缺失均失败。macOS27人工运行位置见release-evidence。一般失败关闭用例与已有macos-15实测通过的project-sandbox（17运行/1反向跳过）、project-container（8）和project-creation（1）继续运行。

项目成员的11项未验收实验仅在PLUMS_NATIVE_EXPERIMENTS=1收集；它们增加共用OS门，原因固定为 `macOS 27 acceptance only`。对应清单增加when.experiments=true，只在显式实验报告中参与双向核验，默认覆盖仍明确排除实验文件。记录型project-members-variants继续在15执行并产出verdict；绿的记录型测试不证明容器可用，项目仍TIER_UNAVAILABLE。第10步停止：4B未满足降低最低系统的证据闸门，Info.plist与最低系统措辞保持27.0.1。

## 测试前准备Electron与固定Node哈希

Electron44.5.1的index.js在path.txt/可执行文件缺失时会自行联网；electron job现在在pnpm install之后显式运行 `node scripts/prepare-electron.mjs`，ELECTRON_CACHE为runner.temp/electron-cache。脚本重建提取目录，直接调用已解析的install.js；@electron/get按照锁文件保护的Electron包内官方checksums校验ZIP，包括缓存命中，禁止切换到远端清单兜底。没有增加cache action。

本机官方ZIP SHA-256为 `1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c`，与包内checksums一致。ZIP不含\_CodeSignature资源封套，直接深度验签原文 `code has no resources but signature indicates they must be present`，不是通过。准备脚本从校验后的ZIP重建，再为测试副本生成本地ad-hoc封套，随后codesign --verify --deep通过。该签名不是发布者身份、Developer ID或公证；没有修改发布应用。它核对path.txt、可执行权限、实际--version与锁定44.5.1，再深度验签；失败使job红。

13个Electron项目的setupFiles只读检查path.txt、可执行文件与版本，先于加载测试文件执行，不导入会下载的electron/index.js；缺失即报“run node scripts/prepare-electron.mjs before the tests”。本地UI验收也需先运行此准备命令。

`ci/node-runtime.json`固定26.5.1/darwin-arm64.tar.gz/SHA-256 `f4387df0b46556516d19abf2f2d6806481ac8368aa7f9d96bafed422a56a1d01`，从[nodejs.org官方SHASUMS256](https://nodejs.org/dist/v26.5.1/SHASUMS256.txt)取得。每次准备都要求下载或缓存归档同时匹配仓库pin与实时官方清单，再提取并核对实际版本，不复用未验证的提取目录。本机无gpg：**仅同站清单 + 仓库钉死，未做签名验证**。记录signatureVerified=false，不虚称两个独立信任来源。

升级时先取得新版本官方清单；用Node发布者公钥验证SHASUMS256.txt.sig/.asc（有gpg和经过可信渠道核对的钥匙时），保存原始输出。核对归档实际sha256后同步ci/node-runtime.json、prepare-test-runtime、package-desktop和workflow的精确版本，执行哈希拒绝回归与覆盖守卫。无签名验证时必须继续披露该限制。证据step5-node-verification.log、step5-electron-verification{,-2}.log与step5-tests-final.json，本次哈希/缺Electron回归2/2。

## 触发去重

保留pull_request、main push与workflow_dispatch，取消codex/\*\* push自动触发。没有PR的分支不会自动运行CI，应手动dispatch或开PR。并发组仍绑定PR编号或ref，cancel-in-progress仅对pull_request为true；main不取消。一个PR提交不再重复消耗push与pull_request两套macOS job。去重前已触发的两个run都仍须保存原始结论。

## 固定SHA核对（PR #36，2026-10-10）

本次重新调用REST git/ref/tags；pnpm annotated tag经git/tags再次解引用。下面是object的sha/type原文，均与workflow逐字一致，无需升级。证据 `.artifacts/ci/{actions-*-tag,pnpm-action-setup-{tag,commit},download-artifact-tag}.json`。

| Action / tag                       | API object原文                                                                                                                         | 核对 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| actions/checkout / v4.3.1          | `{"sha":"34e114876b0b11c390a56381ad16ebd13914f8d5","type":"commit"}`                                                                   | 一致 |
| actions/setup-node / v4.4.0        | `{"sha":"49933ea5288caeca8642d1e84afbd3f7d6820020","type":"commit"}`                                                                   | 一致 |
| pnpm/action-setup / v4.2.0         | `{"sha":"9fd676a19091d4595eefd76e4bd31c97133911f1","type":"tag"} → {"sha":"41ff72655975bd51cab0327fa583b6e92b6d3061","type":"commit"}` | 一致 |
| actions/upload-artifact / v4.6.2   | `{"sha":"ea165f8d65b6e75b540449e92b4886f43607fa02","type":"commit"}`                                                                   | 一致 |
| actions/download-artifact / v4.3.0 | `{"sha":"d3f86a106a0bac45b974a628896c90dbdf5c8093","type":"commit"}`                                                                   | 一致 |

Dependabot仅配置github-actions、每周、最多5个PR，保留SHA旁版本注释；没有开启npm依赖更新。顶层空权限、job只读contents、checkout不保存凭据、无secrets与无pull_request_target保持。

本次不增加可选package-smoke job：平台/成员诊断尚未形成完整稳定结果，4B也使第10步证据闸门停止。没有macos-15打包冒烟通过的声明。macOS27发布前打包验收属于人工清单，仍待用户执行；未发布、上传或签名公证应用。

## 成员探针未结束的诊断补足

step3的push diagnostics job 114218707136在原15分钟预算后被取消（API结束13:20:03 UTC，启动13:00:02；包括取消清理余量），未取得新的members-variants artifact。平台组也尚未完成，不能推定其verdict或失败位置。旧default日志有NO_GO/actualProfile:false，但不能代替本次缺失报告。

为下一次远端运行加入固定命令标识的probe begin/end与cleanup begin/end标记，不记录物理路径、PID、nonce或参数内容；不会改变断言、同步调用、20秒用例预算或job预算。它使终态日志能定位最后一个原生边界；记录型测试仍实际运行，不新增跳过。本机该定向1/1，报告INCONCLUSIVE/outer sandbox or killed no-network probe，只说明本机外层环境，不能当作27人工验收。证据members-trace-local.{json,log}及members-trace-local-variants.json。

## 预览草稿发布流程

`.github/workflows/release.yml` 仅由 v\* tag 或手动触发，不接受 PR。build job 先经只读 Actions API 检查同一 GITHUB_SHA 的 ci.yml 最近一次结论必须是 success，再冻结安装、准备运行时、核对 0.1.0 与 tag、构建/打包、严格验签、临时目录启动并生成 SHA256SUMS。打包流程本身核对真实 Resources/ASAR/ZIP 清单及六个必需许可证。制品只有 DMG、校验和与第三方声明。

attest job 依赖 build，单独取得 id-token/attestations 写权限，为 DMG、SHA256SUMS 与声明生成来源证明。release job 依赖两者，仅在 tag push 时取得 contents 写权限，使用 `gh release create --draft --prerelease --verify-tag`；手动触发不创建 Release。所有 Action 固定完整 commit，checkout 不保存凭据。`check-release-workflow.mjs` 使用文本结构守卫，不引入 YAML 依赖；actionlint 独立验证 YAML 与 Actions 语义。

attest-build-provenance v4.2.2 的 GitHub git/ref/tags API 返回 commit，已直接核对完整 SHA。GitHub Free/Pro/Team 仅在公开仓库提供来源证明，私有/内部仓库需要 Enterprise Cloud；见[官方适用范围](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。当前账号是否满足私有仓库条件尚未验证，不能省略或降级 attest。若无法在私有仓库演练，公开后首发前须重新验证。

最终 SHA 的 CI 与 release 手动演练尚待批准推送后执行；新工作流必须先出现在默认分支，GitHub 才能发现 workflow_dispatch。没有创建 tag 或 Release。浏览器下载的 Gatekeeper 提示仍待用户在目标 Mac 实测，README 与发布说明保留待验标记。
