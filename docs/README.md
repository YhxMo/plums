# 文档导航

[项目介绍](../README.md) · [工程状态](../HANDOFF.md) · [验证索引](../evidence/RESULTS.md) · [整体计划](spec/total.md) · [当前阶段](spec/milestone.md)

本页只索引现行文档；按任务读取相关契约。当前状态见 HANDOFF，交付结果见验证索引，过期过程从 Git 追溯。

## 架构与扩展契约

| 文档 | 何时读 |
| --- | --- |
| [ARCHITECTURE](ARCHITECTURE.md) | 了解当前模块边界、状态所有权与信任模型 |
| [EXTENSION-CONTRACTS](EXTENSION-CONTRACTS.md) | 查公开扩展契约、生命周期与失败语义（实验） |
| [AUTHOR-QUICKSTART](AUTHOR-QUICKSTART.md) | 第一次写扩展：单文件模板、导入与替换、常见用途 |
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

## 平台、凭据与业务

| 文档 | 何时读 |
| --- | --- |
| [ANDROID](ANDROID.md) | 构建 Android 与维护系统栏/键盘 Insets 模板 |
| [MODELS](MODELS.md) | 模型连接器、`chat@1` 与 Agent 的上下文发送 |
| [CREDENTIAL-REQUEST](CREDENTIAL-REQUEST.md) | 实现或核对凭据代用请求与生产接入契约 |
| [CREDENTIAL-BINDINGS](CREDENTIAL-BINDINGS.md) | 配置模型连接、代理与 API Key 的填写与存储 |
| [NETWORK-READ](NETWORK-READ.md) | 读取不需密钥的公开资源（声明来源、`network.read`） |

## 流程、计划与验收

| 文档 | 何时读 |
| --- | --- |
| [DEVELOPMENT](DEVELOPMENT.md) | 按验证入口、工作单、审查与交付流程工作 |
| [ACCEPTANCE](ACCEPTANCE.md) | 选取 A1–A14 可证伪验收场景 |
| [整体实现计划](spec/total.md) | 查整体路线、能力依赖与阶段退出条件 |
| [当前阶段计划](spec/milestone.md) | 查正在执行的阶段、负责人、状态与退出条件 |

## 维护规则

新增或移动当前文档须同步本索引；每篇契约保留“状态：”行，计划保留更新日期。内容在原权威位置更新，删除过期与重复文档并修复引用，不新增历史归档。当前交付来源、恢复限制与未验范围继续保留。检查规则见[开发流程](DEVELOPMENT.md#文档职责与索引)。
