<h1 align="center">Plums</h1>

<p align="center">以插件组合服务、界面与业务的通用应用本体。</p>

## 当前状态

当前为 0.0.4 / M1 调试原型：Tauri 2 + React/TypeScript/Vite、Rust 平台层、本地 ESM 扩展宿主，以及框架无关的可替换 DOM 布局。默认界面采用白底橙色梅子图标、深浅主题与 Agent 列表/会话/详情布局，支持添加、角色卡导入、特别关注和多会话管理；扩展、设置与诊断由顶栏菜单进入。Android 构建、图标同步、系统栏与键盘适配已纳入项目入口。当前不是稳定 SDK 或可分发产品。

通用底座管理生命周期、依赖、资源与平台能力契约；业务循环、模型协议和角色卡解析留在扩展。默认 UI 也通过公开实验契约提供。后期重点是多 Agent 合作，角色卡优先帮助人类理解 Agent，同时作为联系协作媒介。

已执行的测试、源码摘要、平台覆盖与限制见 [M1 证据](evidence/RESULTS.md)。当前受验版本、独立审查与两端运行范围按证据分别记录。Android 真机、iOS、Windows、Linux 及完整 A11/A12 尚未验收，iOS 继续暂缓。

M1 已按 Mac＋Android 限定风险实验范围收敛；iOS 最小验证移至接口正式稳定前，五端目标保留。实验作者可从 [SDK 作者入口](docs/SDK-AUTHORING.md)运行服务、非聊天界面与无 UI 事件样板。扩展管理支持手动安装项的“卸载（保留数据）”，两端限定原生结果见 [卸载验收](evidence/UNINSTALL-2026-10-15.md)。

## 快速开始（Quick Start）

前端需要 Node.js 20.19+ 或 22.12+；已执行版本为 Node.js 26.5.1。原生需要 Rust 和对应平台工具链，环境范围见 [M1 实验](docs/M1-EXPERIMENTS.md)。

```sh
npm ci
npm test
npm run build
npm run dev
```

浏览器打开回环地址 `http://127.0.0.1:1420`。首次可从“添加”创建本地 Agent，或选择 JSON 角色卡导入。进入角色后发送文本，在详情查看实际能力、特别关注和多会话；顶栏菜单的“角色卡设置”可集中编辑名称与说明、导入文件。顶栏太阳/月亮按钮切换并保存外观。当前内置示例仅处理本地文本，模型与 MCP 连接器仍需扩展实现。角色卡的实验格式、同源链接限制和交互说明见 [UI](docs/UI.md)。

从顶栏菜单打开扩展管理，检查来源、能力与资源，再启用或停用。诊断工具保留原文本工作台、授权/撤权、服务替换和故障注入；启动后可从应用设置切换工作台、画布和默认 Agent 界面。浏览器明确标为预览，localStorage 不能证明 Rust 或原生能力。

```sh
npm run native -- dev --no-watch
npm run native:test
npm run native:check
npm run native -- build --debug --bundles app
```

原生命令默认将实验数据写入项目 `.dev-data/`，构建缓存和数据均不提交。直接启动调试包时使用独立应用标识 `dev.plums.plums` 的实验数据目录；不接入既有应用资料、模型、邮箱或凭据。

Android 复用既有 YHX 工具链。将 `PLUMS_ANDROID_TOOLS_ROOT` 设置为含 `env.sh` 的工具链目录，首次执行 `npm run android:init`，随后执行 `npm run android:build`；已有生成工程使用 `npm run android:prepare`。系统栏和键盘适配从受控模板生成，具体环境与维护入口见 [Android 工程](docs/ANDROID.md)。

图标源为 `src-tauri/icons/source.png`；执行 `npm run icons` 可重新生成 Mac、Android 和 Web 所需资源。默认界面与可替换布局共用语义颜色变量，所有权见 [UI](docs/UI.md)。

本地查看包统一放在根 `release/`，当前为 `Plums M1 0.0.4.app` 和 `plums-m1-0.0.4-android-arm64-debug.apk`；使用范围与摘要见该目录的 `README.md`、`CHECKSUMS.json`。当前普通包包含 SDK 样板和完整外壳卸载流程，源码以 `80d77af` 基线加 114 文件集合摘要绑定，见 [卸载与交付证据](evidence/UNINSTALL-2026-10-15.md)。目录名不代表发布模式构建。

## 文档索引

| 任务 | 文档 |
| --- | --- |
| 了解架构、选型与待验证风险 | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| 查看公开实验契约与生命周期语义 | [EXTENSION-CONTRACTS](docs/EXTENSION-CONTRACTS.md) |
| 按验收、测试、实现和独立审查开展工作 | [DEVELOPMENT](docs/DEVELOPMENT.md) |
| 查看可扩展本体的目标验收矩阵 | [ACCEPTANCE](docs/ACCEPTANCE.md) |
| 查看完整能力路线、依赖与阶段验收 | [整体实现计划](docs/spec/total.md) |
| 查看正在执行及紧接准备执行的阶段 | [当前阶段计划](docs/spec/milestone.md) |
| 按阶段查找计划与验收入口 | [ROADMAP](docs/ROADMAP.md) |
| 查看 M1 决策、风险与回退方案 | [M1-EXPERIMENTS](docs/M1-EXPERIMENTS.md) |
| 了解桌面/移动界面、状态路径与 UI 所有权 | [UI](docs/UI.md) |
| 使用既有工具链构建 Android、维护 Insets 适配 | [ANDROID](docs/ANDROID.md) |
| 查看验证证据与源码版本 | [RESULTS](evidence/RESULTS.md) |
| 恢复当前工程状态 | [HANDOFF](HANDOFF.md) |
| 查看经验与防再犯措施 | [LESSONS](LESSONS.md) |

完整愿景唯一保存于本地 [goal.md](goal.md)，该文件不随 Git 分发；缺少它不影响使用公开工程文档。

## 信任边界

扩展在同一个 WebView JavaScript 环境执行，不依赖运行时 Node.js，也不构成恶意代码安全沙箱。能力声明、应用内授权与 Rust 状态作用域约束正常调用路径；同环境代码仍可能直接访问 DOM 或原生桥接。状态文件仅是小规模实验方案，迁移、崩溃恢复和跨平台行为尚未完整验证。

## 技术资料

[Tauri 2](https://v2.tauri.app/) 是平台技术核查入口。工作流资料见 [Magpie AGENTS](https://github.com/yetone/magpie/blob/main/AGENTS.md)、[LESSONS](https://github.com/yetone/magpie/blob/main/LESSONS.md) 和 [code-standards](https://github.com/yetone/magpie/blob/main/docs/code-standards.md)。这些资料不构成 Plums 的验证证据。第三方依赖通过锁文件固定；必要许可证与版权声明须保留。
