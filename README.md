<p align="center">
  <img src="./public/brand/plums.png" width="96" alt="Plums 图标：橙色梅子">
</p>

<h1 align="center">Plums</h1>

<p align="center">像通讯录里的联系人一样相处的 AI Agent，每一部分都由可替换的扩展组成。</p>

<p align="center">
  <img src="https://img.shields.io/badge/%E7%8A%B6%E6%80%81-0.3.0%20%E6%97%A9%E6%9C%9F%E5%8E%9F%E5%9E%8B-F59E0B?style=flat-square" alt="状态：0.3.0 早期原型"> <img src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-macOS%20arm64-4B5563?style=flat-square" alt="平台：macOS arm64"> <a href="https://v2.tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-3776AB?style=flat-square" alt="Tauri 2"></a> <img src="https://img.shields.io/badge/React-19-3776AB?style=flat-square" alt="React 19"> <img src="https://img.shields.io/badge/Rust-%E5%8E%9F%E7%94%9F%E5%B1%82-3776AB?style=flat-square" alt="Rust 原生层"> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0%20%2B%20%E5%95%86%E4%B8%9A%E6%8E%88%E6%9D%83-22C55E?style=flat-square" alt="License: AGPL-3.0 + 商业授权"></a>
</p>

> **当前状态**：macOS（Apple 芯片）上的早期原型，还没有可下载的安装包，需要从源码构建；和模型对话需要你自己的 API Key；扩展接口仍是实验版本，会变。

## 这是什么

在 Plums 里，每个 Agent 像通讯录里的一个人：你和它一对一聊天，它会记得你告诉过它的事。以后还会支持拉进群聊、让它独立做事、让别人加它为好友。

Agent 的每一部分都可以换：用哪个模型、怎么记忆、长什么样，都由扩展提供。整个应用界面本身也是扩展，主题、布局和页面都能替换。

## 现在能做什么

- **创建 Agent**：自己创建，或导入角色卡（JSON 或带数据的 PNG）；给它写介绍和只发给模型的设定，可以有多个会话、置顶。
- **接入你的模型**：在「模型连接」里添加 DeepSeek、OpenAI、Anthropic、Kimi 等服务或兼容接口，每个 Agent 各选一个模型。密钥只保存在本机，由原生层注入请求，网页界面读不到。
- **像联系人一样聊天**：回复整条送达，切走时有未读提示；支持 Markdown、拖入图片和文件、编辑与重新生成、撤销删除。
- **记忆**：点左上角头像写下“关于我”，所有 Agent 都会读到；每个 Agent 会在会话停下后整理它记下的事，带时间的事过期后不再提起。都可以查看、修改、删除或关闭。
- **导出与分享**：把 Agent 导出为角色卡图片，或连同设定打包成 `.plums` 文件再导入。
- **管理扩展**：查看每个扩展的来源、权限与资源，启用、停用、卸载，或拖入扩展包导入。

还没有：群聊、Agent 独立工作与好友、MCP、扩展市场、按扩展隔离。路线见[整体计划](docs/spec/total.md#路线阶梯)。

## 快速开始

需要 Node.js 20.19+ 或 22.12+。先在浏览器里看看界面：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:1420`，从“添加”创建一个 Agent 或导入角色卡。浏览器预览不能保存 API Key，开发模式下可以选不联网的“回显模型”试用对话。

要连接真实模型，需要原生窗口（另需 [Rust](https://www.rust-lang.org/tools/install) 与 Xcode 命令行工具）：

```sh
npm run native -- dev --no-watch
```

添加 Agent 时在第二步点「添加模型连接」，点「添加服务商」并填写 API Key，再为 Agent 选择模型（详见[模型连接](docs/MODELS.md)）。开发数据写在项目内的 `.dev-data/`，不会碰到其他应用的资料。

构建本地 Mac 应用（安装、升级与首次打开见[安装说明](docs/INSTALL.md)）：

```sh
npm run native -- build --debug --bundles app
```

## 写一个扩展

扩展是一个 ESM 模块，默认导出 `manifest`（ID、版本、提供与依赖的服务、所需能力）和 `activate(ctx)`。通过 `ctx.provide` / `ctx.use` 提供或使用服务，`ctx.view` 挂载界面，`ctx.platform` 调用平台能力，`ctx.onDispose` 登记清理。

| 想做什么 | 读哪篇 |
| --- | --- |
| 第一次写扩展 | [作者入门](docs/AUTHOR-QUICKSTART.md) |
| 开发样板与进阶规则 | [SDK-AUTHORING](docs/SDK-AUTHORING.md) |
| 查完整契约 | [EXTENSION-CONTRACTS](docs/EXTENSION-CONTRACTS.md) |
| 替换页面与主题 | [PAGES](docs/PAGES.md)、[THEMES](docs/THEMES.md) |
| 了解整体结构 | [架构](docs/ARCHITECTURE.md) |

全部文档见[文档导航](docs/README.md)。

## 信任边界

扩展是本地可信代码，与宿主在同一个 WebView 中运行，没有安全沙箱。能力声明、应用内授权与 Rust 侧状态作用域约束的是正常调用路径；恶意扩展仍可能直接访问 DOM 或原生桥接。导入时确认前只读取扩展清单、不执行代码；确认导入后代码即在应用内执行。只安装你信任来源的扩展。开放扩展市场之前，项目会先实现按扩展隔离与来源签名。

## 参与开发

改动前请先读[开发流程](docs/DEVELOPMENT.md)。提交前运行 `npm run verify:web`；改了原生代码再加 `npm run verify:native`，改了界面或用户路径再加 `npm run verify:e2e`。工程现状见 [HANDOFF](HANDOFF.md)。

## 许可证

双许可：

- **开源使用**：按 [AGPL-3.0-or-later](LICENSE) 免费使用与修改；分发修改版或把本项目集成进其他产品时，须以同一协议开源整份衍生作品；在服务器上运行修改版供他人通过网络使用时，也须把对应源码提供给这些使用者。
- **商业授权**：要在闭源产品中集成或分发，须另行取得商业授权，由单独签订的协议约定。
- **扩展 SDK 与示例**：[`modules/sdk`](modules/sdk/LICENSE) 和 [`extensions/examples`](extensions/examples/LICENSE) 按 MIT，为 Plums 写扩展不受上面两条约束。

改用 AGPL 之前已公开的提交仍按当时的条款提供（更早的为 MIT，之后的为 GPL-3.0-or-later）。第三方依赖各自的许可证与版权声明须保留。
