# 0.3.0 交付（2026-10-27）

状态：当前 Mac 交付证据；第 1 级“认识你的联系人”（Mac 第一版）的退出交付。结果只证明下列提交与平台。

## 来源

- 受验提交 `9d2327d3b9cea296a7d6f86c2654eebb6effc71f`，`source.patch` 为空；macOS arm64，release 档位（保留网页检查工具），ad-hoc 签名，未公证；包内附 AGPL-3.0 `LICENSE` 与 `THIRD-PARTY-NOTICES.txt`。
- 构建：`npm run release:mac -- --stage` 产出候选 `release/.mac-GgRaQt`；所有者实测后执行 `npm run release:mac -- --publish release/.mac-GgRaQt`，发布前核对候选的 `source.patch` 为空、其提交到当时 HEAD 之间只改了 `HANDOFF.md` 与证据；发布后 `codesign --verify --deep --strict` 通过。
- 入口 `release/mac/Plums.app`；被替换的 0.2.0（源码 `6668ce7`，标签 `v0.2.0`）整份存档于 `.cache/archive/releases/mac-VIqa8V/mac`。
- 相对 0.2.0 的主要变化见 [HANDOFF](../HANDOFF.md#当前交付)，逐项改动见 `git log v0.2.0..9d2327d`。

## 自动化

| 检查 | 结果 |
| --- | --- |
| `npm run verify:web` | `9d2327d` 上通过（构建、1016 项单元、Prettier、项目检查与导入边界、行数、ESLint） |
| `npm run verify:native` | `4c90bb4`（0.3.0 版本号）上通过；之后只改了许可证文本与元数据，`notices:check` 在 `9d2327d` 上通过 |
| `npm run verify:e2e`（Chromium） | `0e71dca` 上 312 项全部通过；之后的提交未改界面，只有“关于”的版本号断言在 `4c90bb4` 上单独重跑通过 |
| GitHub Actions | 最近一次全绿在 `3852f7d`（三项）；本交付提交随发布一同推送，结果见 HANDOFF |

## 打包应用实测

- 所有者在最终候选上以隔离 `HOME` 完成内置模型连接对 DeepSeek 的一次真实回复，并报告扩展卡片页与中文输入法正常（[记录](MAC-REAL-REPLY-2026-10-27.md)）。
- 更早候选上的实测仍有效于其覆盖的行为：[检查点](MAC-CHECKPOINT-2026-10-24.md)（改名前数据迁移、真实调用）、[记忆](MAC-MEMORY-2026-10-25.md)、[抽查](MAC-SPOTCHECK-2026-10-25.md)、[输入法](MAC-INPUT-LAYOUT-2026-10-23.md)、[作者检验](CONNECTOR-AUTHOR-2026-10-26.md)，以及第 6 项菜单与外观（HANDOFF）。

## 独立审查

2026-10-27 由未参与实现的会话只读审查（代码 177 个提交、文档与证据，运行 `check:project`、`npm test`、`lint`），结论“有条件可以”：未发现发布阻塞缺陷；阻塞项为最终候选未在 HEAD 上构建与实测、版本号未变，均已处理（`0e84810` 发布前核对来源、`4c90bb4` 0.3.0 与升级说明、最终候选实测）。非阻塞项记入 HANDOFF 的未验范围。

## 按所有者决定收窄的退出条件

- 空白会话写的连接器：链路打通到服务端即算通过（OpenCode Go 因缺会话头拒绝，未得到回复）。
- 真实服务兼容：只做一次真实回复；输出上限、长上下文、图片与思考强度不逐一实测，列为[已知限制](../docs/INSTALL.md#已知限制)。所有者认为做好上下文管理后不需要输出上限。
- VoiceOver 不验收。

## 未验

见 [HANDOFF 未验范围](../HANDOFF.md#未验范围)；其中与本交付直接相关的：替换、卸载、不兼容版本拒绝与复制失败弹窗只有单元和浏览器回归；扩展卡片页、拖放分区、`.plums` 导出导入与 `file.save` 在打包应用中只有所有者的整体报告或未走过；统一日志无密钥未被正面证明；正式签名与公证。
