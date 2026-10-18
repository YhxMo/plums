<h1 align="center">Plums</h1>

<p align="center">以插件组合服务、界面与业务的通用应用本体。</p>

## 这是什么

Plums 是一个可以被扩展自由组装的应用本体。本体只负责通用机制：扩展的加载与生命周期、依赖、注册与释放、权限、凭据作用域、状态持久化和诊断。服务、界面、业务流程、模型适配、角色卡解析，以及新的扩展点，都由扩展提供。

整个应用界面也是扩展：主题、布局、导航、页面和交互方式都可以被替换，内核不固定聊天布局。默认安装提供一个 Agent 对话界面，但它只是默认组合之一。目标是面向普通用户开箱即用，同时让开发者只凭公开 SDK 和文档就能写扩展。

技术栈：Tauri 2、React/TypeScript 前端与 Rust 平台层；先做 macOS 与 Android，最终覆盖 iOS、Windows、Linux。

## 现在能做什么

当前是 0.0.4 debug 原型，SDK 仍是实验版本，接口会变。

- **默认 Agent 界面**：创建或导入角色卡、特别关注、多会话。回复目前由本地示例服务生成，还**没有接入真实模型**。
- **扩展管理**：查看扩展的来源、能力、权限与资源，启用、停用、卸载；从文件选择或拖入单文件扩展导入，开发时也可按同源模块路径安装。
- **界面替换样板**：文本工作台、画布、独立嵌套页面、公开主题，用来验证非聊天界面与布局替换，见 [PAGES](docs/PAGES.md)、[THEMES](docs/THEMES.md)。
- **平台能力样板**：会话内只读打开所选文档（[说明](docs/SELECTED-DOCUMENT.md)）；在原生面板录入模型 API 密钥并配置连接（[说明](docs/CREDENTIAL-BINDINGS.md)）。密钥已能安全保存，但用于发送请求的路径尚未接通。
- **尚未实现**：真实模型调用、MCP 连接器、多 Agent 协作、扩展市场、按扩展隔离。

接下来的方向和顺序见[当前阶段](docs/spec/milestone.md)与[整体计划](docs/spec/total.md)。

## 快速开始

需要 Node.js 20.19+ 或 22.12+。

```sh
npm ci
npm test
npm run dev
```

浏览器打开 `http://127.0.0.1:1420`。从“添加”创建本地 Agent，或导入 JSON 角色卡；顶栏菜单可打开扩展管理、设置与诊断。浏览器预览使用 localStorage，不能代表原生能力。

原生开发需要 Rust 与对应平台工具链：

```sh
npm run native -- dev --no-watch    # 原生开发窗口
npm run verify                      # Web + 原生全部检查
npm run native -- build --debug --bundles app
```

实验数据写入项目内 `.dev-data/`，不接触既有应用资料或凭据。Android 构建、Mac 本地打包与交付目录见 [Android 工程](docs/ANDROID.md) 和[开发流程](docs/DEVELOPMENT.md#本地交付目录)；当前交付包见 [HANDOFF](HANDOFF.md)。

## 写一个扩展

扩展是一个 ESM 模块，默认导出 `manifest`（ID、版本、配置、提供与依赖的服务、所需能力）和 `activate(ctx)`。通过 `ctx.provide`/`ctx.use` 提供或使用服务，`ctx.view` 挂载界面，`ctx.platform` 调用平台能力，`ctx.onDispose` 登记清理。入门与样板见 [SDK-AUTHORING](docs/SDK-AUTHORING.md)，完整契约见 [EXTENSION-CONTRACTS](docs/EXTENSION-CONTRACTS.md)。

## 信任边界

扩展是本地可信代码，与宿主在同一个 WebView 中运行，没有安全沙箱。能力声明、应用内授权与 Rust 侧状态作用域约束的是正常调用路径；恶意扩展仍可能直接访问 DOM 或原生桥接；导入文件时其代码在确认页之前就会执行。只安装你信任来源的扩展。开放扩展市场之前，项目会先实现按扩展隔离与来源签名。

## 文档

- [文档导航](docs/README.md)：所有当前文档的索引
- [HANDOFF](HANDOFF.md)：工程状态与交付包
- [架构](docs/ARCHITECTURE.md)、[开发流程](docs/DEVELOPMENT.md)、[经验](LESSONS.md)

第三方依赖通过锁文件固定，必要许可证与版权声明须保留。平台技术资料以 [Tauri 2](https://v2.tauri.app/) 官方文档为准。
