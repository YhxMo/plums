# 阶段与实验归档索引

[文档导航](../../README.md) · [整体实现计划](../total.md) · [当前阶段](../milestone.md) · [验证索引](../../../evidence/RESULTS.md)

本目录保存已完成阶段、退役实验与设计依据的原件，默认不加载；只在追溯决策、失败或历史证据时按需读取，不重建全部历史计划。每篇归档保留结果与证据入口，证据原件见[验证索引](../../../evidence/RESULTS.md)。归档内容保持完成时的结论与范围；本次整理只更新路径和链接，不改写证据结论。

新增归档时在对应分组登记一行；阶段计划文件名沿用 `<阶段>-<主题>-<YYYY-MM-DD>.md`。

## 工程维护

| 归档 | 结果入口 |
| --- | --- |
| [阶段 A：安全网与基线](A-hardening-2026-10-17.md) | [阶段证据](../../../evidence/MAINTENANCE-2026-10-17.md#阶段-a安全网与基线) |
| [阶段 B：启动、保存与校验边界](B-runtime-validation-2026-10-17.md) | [阶段证据](../../../evidence/MAINTENANCE-2026-10-17.md#阶段-b启动保存与校验边界) |
| [C1：Agent 工作区职责拆分](C1-agent-workspace-2026-10-17.md) | [阶段证据](../../../evidence/MAINTENANCE-2026-10-17.md#c1agent-工作区职责拆分) |
| [C2：按使用方拆分样式](C2-styles-2026-10-17.md) | [阶段证据](../../../evidence/MAINTENANCE-2026-10-17.md#c2按使用方拆分样式) |
| [C3：扩展操作与组件依赖](C3-extension-actions-2026-10-17.md) | [阶段证据](../../../evidence/MAINTENANCE-2026-10-17.md#c3扩展操作与组件依赖) |
| [C4：扩展状态所有权](C4-extension-state-2026-10-17.md) | [阶段证据](../../../evidence/MAINTENANCE-2026-10-17.md#c4扩展状态所有权) |
| [D：文档职责解耦与归档整理](D-document-decoupling-2026-10-17.md) | [验证与审查记录](D-document-decoupling-2026-10-17.md#独立审查) |
| [H：防御性编程审查与收敛](H-defensive-hardening-2026-10-17.md) | [HARDENING](../../../evidence/HARDENING-2026-10-17.md) |
| [P2：IPC 单一来源](P2-ipc-contract-2026-10-18.md) | [工程前置证据](../../../evidence/ENGINEERING-PREREQUISITES-2026-10-18.md) |
| [P6/P1/P7：边界、业务所有权与 Android 返回](P6-P1-P7-foundations-2026-10-18.md) | [工程前置证据](../../../evidence/ENGINEERING-PREREQUISITES-2026-10-18.md) |
| [E：状态所有权与门禁收敛](E-ownership-gates-2026-10-17.md) | [OWNERSHIP-GATES](../../../evidence/OWNERSHIP-GATES-2026-10-17.md) |

## M1 阶段

| 归档 | 结果入口 |
| --- | --- |
| [M1 规划阶段](M1-planning-2026-10-15.md) | [RESULTS](../../../evidence/RESULTS.md) |
| [M1 普通包交付阶段](M1-delivery-2026-10-15.md) | [DELIVERY-2026-10-15](../../../evidence/DELIVERY-2026-10-15.md) |
| [M1 导入取消与扩展身份校验](M1-import-boundaries-2026-10-15.md) | [IMPORT-BOUNDARIES-2026-10-15](../../../evidence/IMPORT-BOUNDARIES-2026-10-15.md) |
| [M1 缺陷收敛](M1-reliability-2026-10-15.md) | [RELIABILITY-2026-10-15](../../../evidence/RELIABILITY-2026-10-15.md) |
| [M1 恢复校验与历史证据保护](M1-restore-evidence-2026-10-15.md) | [RESTORE-EVIDENCE-2026-10-15](../../../evidence/RESTORE-EVIDENCE-2026-10-15.md) |
| [M1 平台范围收敛](M1-scope-2026-10-15.md) | [RESTORE-EVIDENCE-2026-10-15](../../../evidence/RESTORE-EVIDENCE-2026-10-15.md) |

## M2 子阶段

[M2.3.1 TLS/JNI 可行性](M2.3.1-tls-jni-2026-10-18.md) · [证据](../../../evidence/TLS-JNI-FEASIBILITY-2026-10-18.md)

[M2.0 重新基线与两端限定交付](M2-baseline-2026-10-18.md) · [证据](../../../evidence/BASELINE-2026-10-18.md)

| 归档 | 结果入口 |
| --- | --- |
| [M2 最小组合保存与恢复](M2-composition-2026-10-15.md) | [COMPOSITION-2026-10-15](../../../evidence/COMPOSITION-2026-10-15.md) |
| [M2 损坏组合安全恢复](M2-composition-recovery-2026-10-15.md) | [COMPOSITION-RECOVERY-2026-10-15](../../../evidence/COMPOSITION-RECOVERY-2026-10-15.md) |
| [M2 非敏感扩展配置](M2-configuration-2026-10-15.md) | [CONFIGURATION-2026-10-15](../../../evidence/CONFIGURATION-2026-10-15.md) |
| [M2 凭据代用请求契约实验](M2-credential-contract-2026-10-15.md) | [CREDENTIAL-CONTRACT-2026-10-15](../../../evidence/CREDENTIAL-CONTRACT-2026-10-15.md) |
| [M2 当前版本双端验收与生产能力准备](M2-current-dual-acceptance-2026-10-17.md) | [RELEASE-2026-10-17](../../../evidence/RELEASE-2026-10-17.md) |
| [M2 弹窗初始焦点修复](M2-dialog-focus-2026-10-17.md) | [DIALOG-FOCUS-2026-10-17](../../../evidence/DIALOG-FOCUS-2026-10-17.md) |
| [M2 合成文档权限与降级设计](M2-document-contract-2026-10-16.md) | [DOCUMENT-CONTRACT-2026-10-16](../../../evidence/DOCUMENT-CONTRACT-2026-10-16.md) |
| [M2 真实文档只读闭环](M2-documents-2026-10-16.md) | [DOCUMENTS-2026-10-16](../../../evidence/DOCUMENTS-2026-10-16.md) |
| [M2 无业务视图事件服务](M2-event-service-2026-10-16.md) | [EVENT-SERVICE-2026-10-16](../../../evidence/EVENT-SERVICE-2026-10-16.md) |
| [M2 公开生命周期传输集成](M2-host-transport-2026-10-15.md) | [HOST-TRANSPORT-2026-10-15](../../../evidence/HOST-TRANSPORT-2026-10-15.md) |
| [M2 完整交互界面可替换](M2-interaction-2026-10-16.md) | [M2-NATIVE-DELIVERY-2026-10-16](../../../evidence/M2-NATIVE-DELIVERY-2026-10-16.md) |
| [M2 无凭据原生传输实验](M2-native-transport-2026-10-15.md) | [NATIVE-TRANSPORT-2026-10-15](../../../evidence/NATIVE-TRANSPORT-2026-10-15.md) |
| [M2 导航冲突与停用回退](M2-navigation-2026-10-16.md) | [NAVIGATION-2026-10-16](../../../evidence/NAVIGATION-2026-10-16.md) |
| [M2 项目收敛与 Mac 交付](M2-project-consolidation-2026-10-17.md) | [RELEASE-2026-10-17](../../../evidence/RELEASE-2026-10-17.md) |
| [M2 合成状态恢复确认界面](M2-restore-ui-2026-10-16.md) | [RESTORE-UI-2026-10-16](../../../evidence/RESTORE-UI-2026-10-16.md) |
| [M2 最小作者入口](M2-sdk-entry-2026-10-15.md) | [SDK-ENTRY-2026-10-15](../../../evidence/SDK-ENTRY-2026-10-15.md) |
| [M2 启动界面与管理返回修复](M2-startup-management-fixes-2026-10-17.md) | [UI-STARTUP-2026-10-17](../../../evidence/UI-STARTUP-2026-10-17.md) |
| [M2 最小扩展状态迁移与失败恢复](M2-state-migration-2026-10-15.md) | [STATE-MIGRATION-2026-10-15](../../../evidence/STATE-MIGRATION-2026-10-15.md) |
| [M2 单跳迁移旧快照显式恢复](M2-state-restore-2026-10-16.md) | [STATE-RESTORE-2026-10-16](../../../evidence/STATE-RESTORE-2026-10-16.md) |
| [M2 公开主题贡献与停用回退](M2-themes-2026-10-16.md) | [THEMES-2026-10-16](../../../evidence/THEMES-2026-10-16.md) |
| [M2 原生异常回执与预约恢复](M2-transport-fault-2026-10-15.md) | [TRANSPORT-FAULT-2026-10-15](../../../evidence/TRANSPORT-FAULT-2026-10-15.md) |
| [M2 最小多作者 UI 组合与恢复](M2-ui-composition-2026-10-16.md) | [UI-COMPOSITION-2026-10-16](../../../evidence/UI-COMPOSITION-2026-10-16.md) |
| [M2 外壳卸载阶段](M2-uninstall-2026-10-15.md) | [UNINSTALL-2026-10-15](../../../evidence/UNINSTALL-2026-10-15.md) |

## 退役实验与设计记录

以下文档原在 `docs/` 根与 `docs/spec/`，2026-10-17 整理时移入本目录；现行契约与实现以所列入口为准。

| 归档 | 内容与现行入口 | 证据 |
| --- | --- | --- |
| [Host 公开生命周期与隔离传输实验](M2-host-transport-experiment-2026-10-15.md) | 从 `docs/` 退休的实验说明；现行契约见[凭据请求契约](../../CREDENTIAL-REQUEST.md) | [HOST-TRANSPORT-2026-10-15](../../../evidence/HOST-TRANSPORT-2026-10-15.md) |
| [回环传输实验](M2-native-transport-experiment-2026-10-15.md) | WebView→Tauri→Rust 回环与 Host 公开调用；现行契约见[凭据请求契约](../../CREDENTIAL-REQUEST.md) | [NATIVE-TRANSPORT-2026-10-15](../../../evidence/NATIVE-TRANSPORT-2026-10-15.md) |
| [原生异常回执与预约恢复实验](M2-transport-fault-experiment-2026-10-15.md) | 未知回执、取消失败与预约租期；现行契约见[凭据请求契约](../../CREDENTIAL-REQUEST.md) | [TRANSPORT-FAULT-2026-10-15](../../../evidence/TRANSPORT-FAULT-2026-10-15.md) |
| [M2 交互与关键屏设计](M2-interaction-design-2026-10-16.md) | 已批准的交互设计依据；实现见[页面契约](../../PAGES.md) | [M2-NATIVE-DELIVERY-2026-10-16](../../../evidence/M2-NATIVE-DELIVERY-2026-10-16.md) |
