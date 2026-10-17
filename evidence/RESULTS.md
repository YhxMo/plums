# 当前验证与交付

本页维护当前交付与必要的证据入口。结果绑定各自源码、命令和平台；历史记录从 [历史验收索引](HISTORY.md) 查阅。

## 当前交付

[2026-10-17 弹窗初始焦点修复](DIALOG-FOCUS-2026-10-17.md)记录当前受验源码：关闭按钮默认无框，悬停保留反馈，Tab仍显示焦点环。112 浏览器通过；Mac 普通包与 Android API36 ARM64 模拟器的浅深主题、默认状态、Tab、表单聚焦和关闭返回均已实际验收并经独立审查。同源受验原包进入 release，旧完整目录保留，本小阶段已归档；M2 整体尚未退出。

| 平台 | 当前入口与证据范围 |
| --- | --- |
| Mac arm64 | `release/mac/Plums M1.app`，0.0.4 debug 临时签名；本期弹窗初始/键盘状态、表单与关闭返回限定验收 |
| Android ARM64 | `release/android/plums-m1-0.0.4-android-arm64-debug.apk`，0.0.4 debug；Android 16/API36 ARM64 模拟器、WebView 133.0.6943.137，本期弹窗受影响路径、44px关闭目标 |

两端目录的 build-info.json 与 source.patch 保存来源和交付校验，acceptance.json链接本期范围。[此前启动与管理修复](UI-STARTUP-2026-10-17.md)的274单元/110浏览器及冷恢复结果继续绑定其源码；本期完整浏览器包含这三项回归，未重跑未变的单元/Rust路径。[此前双端完整限定验收](M2-CURRENT-2026-10-17.md)继续绑定其源码和路径，未改 Rust/平台适配的专项证据按各自输入复用。

## 当前本地增量

[DeepSeek 协议扩展](DEEPSEEK-LOCAL-2026-10-17.md)已通过隔离平台的现有 Agent 服务接线、取消、解析失败和切回本地测试；298 项全单元及构建通过，源码经独立审查。该结果对应工作区本地增量，未改 UI 或替换交付包，不代表真实 API、秘密存储或两端原生接入完成。[生产设计](../docs/CREDENTIAL-REQUEST.md#生产接入)和[当前阶段](../docs/spec/milestone.md)继续维护生产适配及真实验收缺口，普通包不开放该能力。

[通用绑定与原生凭据管理](CREDENTIAL-BINDINGS-2026-10-17.md)记录后续工作区增量：329单元、27 Rust单元、117浏览器通过；Mac隔离配置测试包与Android API36 ARM64模拟器完成原生安全输入、取消返回和非秘密代理配置限定验证。系统秘密实际读写、请求授权/受限传输及真实模型调用继续待验，release保持当前UI交付。

## 当前源码维护验证

2026-10-17 项目精简覆盖启动/Host/SDK、平台管理、扩展样板、构建脚本、测试入口与当前文档。删除仅供自测调用的 JS 代理校验及其 8 项测试；实际配置保留 Rust 校验。Host 安装按有效配置直接解析，失败仍保留默认配置与错误；Android 插件模板共用检查流程，未知代码保护及已知前版兼容保留，拒绝测试覆盖三种插件。回环传输说明合并为[单一入口](../docs/NATIVE-TRANSPORT-EXPERIMENT.md)，当前文档统一使用现有实现与验收状态。

受验源码基于 `9c05356` 加 `.cache/simplify-2026-10-17/source/` 中的工作区差异和未跟踪原件；本次前态保存在同材料根的 before/。`npm test` 322 项、`npm run test:web -- --workers=4` 117 项、`npm run build` 和 `npm run format:check` 通过；实际 `npm run android:prepare` 通过，MainActivity 与三个插件的生成结果均与受控源码一致。日志分别为 unit.log、browser.log、build.log、format.log 和 android-prepare.log，生成核对见 android-generated.json。独立审查未发现 P1/P2。Rust/Kotlin、UI 源码和样式未改，未重建或替换原生交付包；原生与真实连接器的剩余范围按各自记录继续维护。

## 相关基线

| 验证对象 | 对应记录 |
| --- | --- |
| 此前项目精简、Mac基线与历史整理 | [项目收敛与交付](RELEASE-2026-10-17.md) |
| 双卡片欢迎页与手机列表条件 | [欢迎页修复](WELCOME-2026-10-17.md) |
| 宿主状态所有权与工作区chrome边界 | [宿主前端重构](SHELL-ARCHITECTURE-2026-10-17.md) |
| 原生红绿灯位置专项 | [Mac窗口核对](MAC-TITLEBAR-2026-10-17.md) |
| 此前两端普通包与独立页面接入 | [2026-10-16交付](M2-NATIVE-DELIVERY-2026-10-16.md) |

## 契约与历史范围

状态、授权、生命周期、文档与扩展样板的历史受验版本保存在 [历史索引](HISTORY.md)。源码清单、第三方许可证和平台依赖核对原件继续保留；它们只证明各自版本及范围。

当前验收目标见 [ACCEPTANCE](../docs/ACCEPTANCE.md)，M2未完成项见 [退出清单](../docs/spec/M2-EXIT-CHECKLIST.md)。浏览器、构建、原生开发进程、打包应用、模拟器及真机分别留证；Android真机、iOS、Windows/Linux、完整辅助技术和正式签名分发未因此通过。
