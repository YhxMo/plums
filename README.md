<h1 align="center">Plums</h1>

<p align="center">以插件组合服务、界面与业务的通用应用本体。</p>

## 当前状态

Mac 最小原型实现与独立定向审查已完成：Tauri 2 + React/TypeScript/Vite、Rust 平台层、本地 ESM 扩展宿主，以及框架无关的可替换 DOM 布局。当前不是稳定 SDK 或可分发产品。

通用底座管理生命周期、依赖、资源与平台能力契约；业务循环、模型协议和角色卡解析留在扩展。默认 UI 也通过公开实验契约提供。后期重点是多 Agent 合作，角色卡优先帮助人类理解 Agent，同时作为联系协作媒介。

已执行的测试、源码摘要、平台覆盖与限制见 [M1 证据](evidence/RESULTS.md)。最终 macOS 调试包已验证保存、依赖停用/恢复及重启；隔离原生夹具包另验证组合依赖失效与清理失败；相关变更已通过独立定向复审。iOS、Android、Windows、Linux 未通过原生验收。

## 快速开始（Quick Start）

前端需要 Node.js 20.19+ 或 22.12+；已执行版本为 Node.js 26.5.1。原生需要 Rust 和对应平台工具链，环境范围见 [M1 实验](docs/M1-EXPERIMENTS.md)。

```sh
npm ci
npm test
npm run build
npm run dev
```

浏览器打开回环地址 `http://127.0.0.1:1420`，点击“授予实验能力并启动”。输入示例文本，运行并保存，然后切换“画布”布局、替换服务、撤销写入或测试故障布局。浏览器明确标为预览，其 localStorage 不能证明 Rust 或原生能力。

```sh
npm run native -- dev --no-watch
npm run native:test
npm run native:check
npm run native -- build --debug --bundles app
```

原生命令默认将实验数据写入项目 `.dev-data/`，构建缓存和数据均不提交。直接启动调试包时使用独立应用标识 `dev.plums.plums` 的实验数据目录；不接入既有应用资料、模型、邮箱或凭据。

## 文档索引

| 任务 | 文档 |
| --- | --- |
| 了解架构、选型与待验证风险 | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| 查看公开实验契约与生命周期语义 | [EXTENSION-CONTRACTS](docs/EXTENSION-CONTRACTS.md) |
| 按验收、测试、实现和独立审查开展工作 | [DEVELOPMENT](docs/DEVELOPMENT.md) |
| 查看可扩展本体的目标验收矩阵 | [ACCEPTANCE](docs/ACCEPTANCE.md) |
| 查看阶段范围与门槛 | [ROADMAP](docs/ROADMAP.md) |
| 查看 M1 决策、风险与回退方案 | [M1-EXPERIMENTS](docs/M1-EXPERIMENTS.md) |
| 查看验证证据与源码版本 | [RESULTS](evidence/RESULTS.md) |
| 恢复当前工程状态 | [HANDOFF](HANDOFF.md) |
| 查看经验与防再犯措施 | [LESSONS](LESSONS.md) |

完整愿景唯一保存于本地 [goal.md](goal.md)，该文件不随 Git 分发；缺少它不影响使用公开工程文档。

## 信任边界

扩展在同一个 WebView JavaScript 环境执行，不依赖运行时 Node.js，也不构成恶意代码安全沙箱。能力声明、应用内授权与 Rust 状态作用域约束正常调用路径；同环境代码仍可能直接访问 DOM 或原生桥接。状态文件仅是小规模实验方案，迁移、崩溃恢复和跨平台行为尚未完整验证。

## 技术资料

[Tauri 2](https://v2.tauri.app/) 是平台技术核查入口。工作流资料见 [Magpie AGENTS](https://github.com/yetone/magpie/blob/main/AGENTS.md)、[LESSONS](https://github.com/yetone/magpie/blob/main/LESSONS.md) 和 [code-standards](https://github.com/yetone/magpie/blob/main/docs/code-standards.md)。这些资料不构成 Plums 的验证证据。第三方依赖通过锁文件固定；必要许可证与版权声明须保留。
