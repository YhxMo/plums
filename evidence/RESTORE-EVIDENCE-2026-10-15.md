# 消息恢复校验与历史快照保护

2026-10-15 UTC。负责人：应用维护者（消息恢复）、工程维护者（快照）；独立审查由未参与实现的执行者承担。范围仅两项既有待办，不扩展为全仓审查，不启动 iOS 或 M2。

## 源码与行为

基线 `e6221ee177cb1e07922f8719f3b9e409ec8698c8`，开始时工作区干净。受验版本为基线加 `modules/agents/store.ts`、`scripts/snapshot.mjs` 两处修改及三个新增回归文件；不是基线本身。102 文件集合摘要 `2a8f565aa7dd3a6d5ef42355725c8ae8b3cac3f342b0f4e60fc572d244374d4a`，逐文件、源码差异、原始日志和产物摘要见 [元数据](restore-evidence-2026-10-15.json)。受验源码后仅更新文档与证据。

消息角色恢复仅接受字符串 `user` 或 `agent`，不再先执行 String 转换；数组角色不再被接受并误显示归属。坏数据拒绝恢复且原值保留，不自动转换或修复。业务校验仍在 Agent 模块，Host 与 Rust 不识别业务消息。

`npm run snapshot` 按源码内容摘要生成 `evidence/source-manifest-<sha256>.json`，使用排他创建拒绝已有目标，输出实际路径。相同源码重复运行会以非零状态明确失败，不称为幂等成功；已有文件内容异常也不会覆盖。历史固定名称及既有报告引用均保留。排他创建只保证不覆盖，不承诺进程中断时文件原子完整或完整崩溃恢复。

## 反例与回归

仅使用临时目录和合成状态；原始记录在忽略目录 `.cache/restore-evidence/`。

| 检查 | 结果与范围 |
| --- | --- |
| 修复前 `npx vitest run tests/restore-role.test.ts tests/snapshot.test.ts` | 9 项中 4 失败、5 通过：两种数组角色被接受、固定历史清单被覆盖、已有目标未受保护 |
| 修复后 `npm test` | 11 文件、82 项通过；覆盖非法消息角色拒绝且不变更原值、合法归属、新旧快照隔离与已有目标拒绝 |
| `npx playwright test --config .cache/restore-evidence/playwright.config.mts tests/web/restore-role.spec.ts tests/web/agent-flow.spec.ts` | 20 项通过：坏状态阻断启动及重载后字节保持、合法归属恢复，以及已有 Agent 流程；独立端口 1438，不是全套浏览器运行 |
| `npm run build`、`npm run format:check` | 通过 |
| `npm run native -- build --debug --bundles app` | 普通 Mac arm64 debug 包构建通过 |
| `npm run android:build`（既有工具链） | 普通 Android ARM64 debug APK 构建通过 |

历史 JSON 证据均未改写，现场摘要与基线内容一致，清单记录在元数据的 historicalEvidence。快照脚本行为通过临时目录执行验证，没有在真实历史证据上试验覆盖。Rust 源码未改，未重跑 Rust 单元、Clippy 或 rustfmt。

## 两端普通包与交付

Mac 实际原生窗口按完整候选路径绑定：独立坏状态目录 `.m1-data/restore-evidence-invalid/` 的数组角色阻断启动，重新加载仍拒绝且字节摘要不变；另一合法目录 `.m1-data/restore-evidence-valid/` 恢复两种发送方，新增消息保存为严格字符串角色，PID 46021 → 46464 后四条消息与归属恢复一致。测试夹具切换不是应用自动修复坏数据。

Android 为独立 API 36 ARM64 / WebView 133.0.6943.137 模拟器，通过 ADB/WebView 自动化验证同类坏状态拒绝、重载原字节保留、合法角色显示、新消息保存和冷进程恢复。最终应用 PID 2290 → 2427，渲染后截图与 DOM、持久化数据相符。该范围不是实际触控、真机或完整生命周期矩阵。

根 release 两端 0.0.4 普通包已更新，复制后摘要一致；APK 签名 v2、CRC、包身份/版本/ARM64 ABI 与最终实际安装包摘要匹配，Mac 全包摘要见元数据。旧 `e6221ee` 对应普通包及清单可恢复归档于 `.cache/replaced-release/0.0.4-e6221ee-20261015T210543Z/`。仅调试交付，不是公证或正式分发。

本阶段专用 Mac、模拟器、ADB 已退出；1438/5050/5578/5579/9240 无监听。原应用 PID 1951 与开发服务 PID 59947 在退出核对时保持运行，原数据未操作。

## 审查、精简与阶段边界

独立生产代码与新增回归静态复审无阻塞。精简范围仅恢复判断和快照写入；直接枚举比较及内容命名加排他创建已为最小实现，无需新增抽象或进一步重构。无需要确认的行为取舍；快照重复执行拒绝已明确记录。

最终文档/证据独立复审无阻塞；102 文件、源码差异、原始记录、13 份历史 JSON 与 release 摘要均核对一致。`npm run check:project` 和暂存差异空白检查通过；16 个精确暂存文件经指定模式和人工隐私核对，无敏感内容发现，`goal.md` 忽略且未跟踪。检查只证明该范围；原始日志、截图、运行数据和产物不提交，不推送或部署。

两项完成后停止主动扩展可靠性任务。M1 继续开放：iOS 原生实验仍暂停且是现有退出门槛，后续需决定保留该门槛等待条件，或明确修订首阶段平台范围并保留未验证声明。Android 真机、其他 WebView/ABI、Windows/Linux、完整迁移/恢复和长期后台仍按既定路线保留，不能以本阶段通过启动 M2。
