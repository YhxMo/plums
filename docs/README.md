# 文档导航

[项目介绍](../README.md) · [工程状态](../HANDOFF.md) · [经验](../LESSONS.md) · [验证索引](../evidence/RESULTS.md) · [整体计划](spec/total.md) · [当前阶段](spec/milestone.md)

本文件是 `docs/` 下当前文档的唯一索引：每篇一行说明“何时读哪篇”。各文档的时效以文首状态行或计划日期为准；已完成阶段、一次性实验与设计依据默认不加载，见[阶段与实验归档索引](spec/archive/README.md)。本文件只做导航，不介绍项目、不保存计划；项目介绍见[项目 README](../README.md)，工程状态见 [HANDOFF](../HANDOFF.md)。

## 架构与扩展契约

| 文档 | 何时读 |
| --- | --- |
| [ARCHITECTURE](ARCHITECTURE.md) | 了解目标职责、当前模块边界与 D1–D8 决策状态 |
| [EXTENSION-CONTRACTS](EXTENSION-CONTRACTS.md) | 查公开扩展契约、生命周期与失败语义（实验） |
| [SDK-AUTHORING](SDK-AUTHORING.md) | 写扩展、样板与精确版本、状态和取消规则 |
| [EXTENSION-CONFIGURATION](EXTENSION-CONFIGURATION.md) | 实现非敏感扩展配置与宿主管理接口 |
| [COMPOSITION](COMPOSITION.md) | 理解组合快照、启动恢复与失败边界 |
| [STATE-MIGRATION](STATE-MIGRATION.md) | 使用可选单跳迁移助手并验证失败路径 |
| [EVENT-SERVICE](EVENT-SERVICE.md) | 实现无业务视图的事件服务与授权恢复 |

## UI、页面与交互

| 文档 | 何时读 |
| --- | --- |
| [UI](UI.md) | 了解默认 Agent 界面、跨端布局与视觉约定 |
| [PAGES](PAGES.md) | 接入页面导航、文本工作台与公开页面契约 |
| [VIEW-TREE](VIEW-TREE.md) | 使用固定视图树挂载与清理边界 |
| [NAVIGATION](NAVIGATION.md) | 复用导航冲突选择与停用回退 |
| [THEMES](THEMES.md) | 贡献语义主题颜色与外观偏好 |
| [SELECTED-DOCUMENT](SELECTED-DOCUMENT.md) | 接入选中文档只读句柄与会话授权 |
| [STATE-RESTORE-UI](STATE-RESTORE-UI.md) | 查看合成状态恢复确认样板 |
| [LOCAL-PROOF](LOCAL-PROOF.md) | 按独立页面样板完成外部接入与交稿检查 |

## 平台、凭据与业务

| 文档 | 何时读 |
| --- | --- |
| [ANDROID](ANDROID.md) | 构建 Android 与维护系统栏/键盘 Insets 模板 |
| [DEEPSEEK](DEEPSEEK.md) | 查看 DeepSeek 协议扩展与当前可调用范围 |
| [CREDENTIAL-REQUEST](CREDENTIAL-REQUEST.md) | 实现或核对凭据代用请求与生产接入契约 |
| [CREDENTIAL-BINDINGS](CREDENTIAL-BINDINGS.md) | 配置模型连接、代理与原生凭据录入 |

## 流程、计划与验收

| 文档 | 何时读 |
| --- | --- |
| [DEVELOPMENT](DEVELOPMENT.md) | 按验证入口、工作单、审查与交付流程工作 |
| [ACCEPTANCE](ACCEPTANCE.md) | 选取 A1–A14 可证伪验收场景 |
| [ROADMAP](ROADMAP.md) | 按阶段查找计划与验收入口（仅导航） |
| [M1-EXPERIMENTS](M1-EXPERIMENTS.md) | 查 M1 决策、风险、回退方案与限制 |
| [整体实现计划](spec/total.md) | 查整体路线、能力依赖与阶段退出条件 |
| [当前阶段计划](spec/milestone.md) | 查正在执行的阶段、负责人、状态与退出条件 |
| [M2 退出清单](spec/M2-EXIT-CHECKLIST.md) | 核对 M2 退出项的限定结果与待验缺口 |

当前交付与基线证据：[M2.0 重新基线](../evidence/BASELINE-2026-10-18.md)。开发增量：[工程前置 P6/P1/P7/P2](../evidence/ENGINEERING-PREREQUISITES-2026-10-18.md)。

## 归档

已完成阶段计划、退役实验与设计依据默认不加载；只在追溯决策、失败或历史证据时按需读取，见[阶段与实验归档索引](spec/archive/README.md)。

## 维护规则

新增或移动当前文档必须同步本索引；新增归档文件必须同步归档索引；每篇当前文档在文首保留“状态：”行并更新核实日期；计划文档保留 `更新日期：`/`核对日期：`。规则与检查见[开发流程](DEVELOPMENT.md#文档职责与索引)。
