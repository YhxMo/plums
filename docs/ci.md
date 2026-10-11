# 本地测试与 CI

完整桌面构建使用 Node.js 26.5.1、pnpm 10.33.3 和 Xcode Command Line Tools。
桌面目标为 macOS 27.0.1 Apple Silicon（arm64）。macOS 15 arm64 CI 验证部分平台路径，不能替代目标系统测试。

## 本地运行

```sh
pnpm install --frozen-lockfile
node scripts/prepare-test-runtime.mjs
node scripts/prepare-electron.mjs
pnpm build
pnpm test
```

`pnpm test` 会准备固定运行时、构建工作区并运行默认测试。
定向测试先构建，再执行 `pnpm exec vitest run <测试文件>`。
Electron 准备脚本校验固定 ZIP、恢复运行时许可证并为测试副本生成本地 ad-hoc 签名。
Node 归档须同时匹配仓库固定摘要与官方校验清单；这不等于发布者签名验证。

## 测试分组

| 分组          | 内容与调度                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `unit`        | core、CLI、SDK、宿主与脚本回归；本地最多 4 个 worker，CI 最多 2 个。两个时序敏感文件单独顺序运行。 |
| `platform`    | 真实受控执行、授权与原生边界；单 worker 运行，避免平台资源竞争。                                   |
| `electron`    | 14 个桌面界面项目按顺序运行，共享系统焦点。                                                        |
| `experiments` | 未接入生产的成员校准与全后代回收实验，仅由 `pnpm test:experiments` 显式运行。                      |

分组与文件归属定义在 [ci/tests.json](../ci/tests.json)。
`node scripts/check-test-coverage.mjs` 检查覆盖范围；不能删除断言、增加静默跳过或降低预算。

## CI 运行

[ci.yml](../.github/workflows/ci.yml) 仅通过 `workflow_dispatch` 手动运行。
推送或打开 PR 不会启动 CI。
各测试分组执行 `node scripts/ci-run-group.mjs <unit|platform|electron>`。
`node scripts/ci-aggregate.mjs` 汇总报告，检查缺失、重复、失败、非预期跳过和提交一致性。
工作流保留平台诊断及报告上传；报告不能代替测试结果。

发布工作流保持 tag 与手动触发，并要求同一提交的 CI 成功。
它分别构建、生成来源证明和创建草稿预览发布，结构由 `scripts/check-release-workflow.mjs` 检查。

<a id="controlled-command-platform-gate"></a>

## 受控命令平台门控

macOS 低于 27 的系统拒绝部分重签后的 arm64e 系统程序；验签成功不证明可以执行。
受控命令仍使用固定程序与原有沙箱保证，不以替换程序或降低断言规避此限制。
[ci/expected-skips.json](../ci/expected-skips.json) 的四个受控命令条目仅在 macOS 主版本低于 27 时允许跳过。
macOS 27 上必须收集并执行这些用例；缺失或跳过均失败。
其他平台条件遵循测试中的 `runIf`/`skipIf`，包括非 macOS arm64 原生路径和 Windows 上的 POSIX FIFO。

11 项项目成员实验另受显式实验开关与 macOS 27 条件限制。
记录型成员探针照常运行并报告校准结论；测试成功不表示容器可用。
项目档位仍返回 `TIER_UNAVAILABLE`，不得回退整机或无沙箱运行。
