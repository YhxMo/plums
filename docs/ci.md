# CI 与本地验证

`.github/workflows/ci.yml` 在 pull request、`main`/`codex/**` push 和手动触发时验证默认套件。它安装冻结锁文件、准备独立原生测试 Node、构建全部包、核对测试文件覆盖、运行所有默认 Vitest 项目、独立检查打包清单门，再核对所有 skipped/pending/todo 用例并上传 JSON。它不打包、不签名、不公证、不发布。

## 环境与版本

根 `package.json` 为 `packageManager: pnpm@10.33.3`、`engines.node: >=22`，core/CLI 可单独使用 Node 22+。桌面完整构建和原生集成测试固定 Node 26.5.1；仓库没有 `.nvmrc` 或 `.node-version`。工作流与 `scripts/prepare-test-runtime.mjs`、`scripts/package-desktop.mjs` 的精确 Node 版本由覆盖守卫一起核对。pnpm/action-setup 从根 packageManager 读取版本，不另设可漂移版本。

[Node 官方发行记录](https://nodejs.org/en/download/archive/v26.5.1)提供 26.5.1。setup-node 在托管 runner 上能否成功获取该版本仍待首次运行；无法获取会使 job 失败，不降级。独立 Node 准备脚本从官方目录下载并核对 SHA-256，不能省略：测试直接运行 Vitest，不经过 `pnpm test` 的准备步骤。

[GitHub 官方 runner 表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)列出 `macos-15` 为 M1 arm64。工作流固定该标签并打印 `sw_vers`、`uname -m`、Node 与 pnpm，断言 arm64。产品 `LSMinimumSystemVersion` 为 **27.0.1**；**CI 不是目标系统，通过不等于在 27.0.1 上通过**。不使用 macos-latest。

本机 2026-10-10 核对：macOS 27.0.1（26A434）、arm64、Node 26.5.1、pnpm 10.33.3。`pnpm install --frozen-lockfile` 退出 0；pnpm 更新通知查询遇到网络错误，依赖安装仍完成且锁文件不变。job 的 20 分钟预算按已有约 5.6 分钟全量加安装/构建余量估算，覆盖约 2–3 倍全量运行时间；这不改变任何测试预算。

## Action 固定与权限

以下 tag 经 GitHub REST `git/ref/tags/<tag>` 解析；pnpm 的 annotated tag 再用 `git/tags/<object>` 解引用为 commit。原始 API 输出在 `.artifacts/gate12/*-tag.json`。网络首次失败后重试取得全部记录。

| Action                  | Tag    | 固定 commit                                |
| ----------------------- | ------ | ------------------------------------------ |
| actions/checkout        | v4.3.1 | `34e114876b0b11c390a56381ad16ebd13914f8d5` |
| actions/setup-node      | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| pnpm/action-setup       | v4.2.0 | `41ff72655975bd51cab0327fa583b6e92b6d3061` |
| actions/upload-artifact | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

顶层权限为空，job 只读 contents；checkout 不保存凭据。工作流无 secrets，不使用 pull_request_target，不使用环境批准或发布入口。同分支新运行取消旧运行；报告上传使用 always，即使失败也保留 JSON（没有报告则上传步骤失败）。

## 测试覆盖与调度隔离

审查起点 `4618fb9`：16 个项目、164 个默认测试文件，另有 1 个实验文件。本次新增 4 个测试文件后，默认 168 文件、总 169 文件；两种实验开关下的覆盖守卫均通过。`scripts/check-test-coverage.mjs` 通过 [Vitest 3 Node API](https://v3.vitest.dev/advanced/api/vitest) 的 `createVitest`/`globTestSpecifications` 获取实际项目命中，不执行测试；独立遍历 `packages/*/test/**/*.test.ts`，检查每文件恰好命中一项目。只有 `project-members.experiments.test.ts` 在默认环境允许零命中；`PLUMS_NATIVE_EXPERIMENTS=1` 时必须只命中 experiments。

unit 使用 4 workers。13 个 Electron 文件各有项目，groupOrder 101–113，隔离共享系统焦点。local-callbacks 与 confirm-once 的独立顺序组为 200/201，各一个 worker；守卫要求它们各自仅归属对应 serial 项目，顺序不同且晚于 unit。CI 不传 `--project`，避免只运行 unit 漏掉 serial/UI 文件。JSON 时间戳在最终全量中另行验证。

这是**调度隔离，不是性能修复**。同负载测量结果见本节后续记录；并发负载下的根因未归因。`632dec2` 新增了这两个用例；`confirmOperation` 的密钥读取在该提交之前已存在，该提交只把读取异常收敛为拒绝，**没有增加读取次数，也没有证据表明它增加耗时**。

复核成本与本次调用点计数见[性能文档](performance.md#本地请求的复核成本)，口径仍为调度隔离，非性能修复。

## 平台门控

检入清单为 [`ci/expected-skips.json`](../ci/expected-skips.json)。当前条目：

- `packages/host/test/project-sandbox.test.ts::project conformance records a skip on other platforms`：该反向平台用例仅在 `!supported` 时执行；macOS arm64 改为执行同文件的支持平台用例。因此本机和 macos-15 arm64 预期跳过这一项。

初始条目来自当前源码与已有本机报告，必须由本次最终全量逐项确认。`ci-skip-report.mjs` 列出每个跳过、pending 和 todo 的文件/名称/原因；多出或缺失任意条目都失败，结果写入 job summary。runner 若出现额外跳过，先核对平台条件并在本文逐条解释，再更新数据清单；不能通过扩大门控使 CI 变绿。实验文件不在默认收集范围，覆盖守卫显式记录，不冒充回收验收。

## 托管 Electron 状态

**CI 未真实运行**；Electron UI 在 macos-15 会话中的窗口/焦点行为待首次推送后核对。本地静态检查不能证明远端行为。所有 Electron 项目仍在默认命令内，失败会使 CI 失败；没有 exclude 或 continue-on-error。若托管环境确实需要独立 desktop-ui job，应保持必过且运行全部 UI 用例，再记录实际结果。

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
