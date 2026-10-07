<h1 align="center">Plums</h1>

<p align="center">可自由组装 Agent 的桌面应用，提供独立的管理、授权与执行宿主。</p>

## 应用与交付范围

Plums 是 Apache-2.0 的 TypeScript 工作区。桌面应用负责公共组件库、Agent 组装、可信管理界面和安全执行；聊天、模型协议与业务页面由用户另行导入的组件提供。

本仓库交付应用、core、CLI、公开 SDK、宿主和官方执行底座。业务扩展示例、真实角色卡、个人助理项目与 Agent 整合包独立维护，不包含在当前源码交付中。安装包、签名私钥和运行数据不进入 Git。

- 按内容摘要保存不可变组件，Agent 固定具体版本并隔离设置、密钥与数据。
- 文件、HTTPS 与受控命令经过声明、同意、执行范围和审计；密钥只保存在本地私有存储并向已授权目标注入。
- 第三方前端使用独立沙箱，普通业务代码使用隔离运行时；本机引擎须独立批准。

执行底座的公开声明与会话协议正在实现；当前第三方原型只覆盖明确声明的最小 SDK 子集，不能视作完整 SDK 认证。

## 快速开始

全仓构建和桌面测试使用 Node.js **26.5.1**、pnpm **10.33.3**；macOS 原生文件适配器需要 Xcode Command Line Tools。当前桌面与受控底座验收平台为 macOS Apple Silicon。单独使用 core/CLI 支持 Node.js 22+。

```sh
git clone https://github.com/YhxMo/plums.git Plums
cd Plums
pnpm install --frozen-lockfile
pnpm build
pnpm exec plums version
pnpm desktop:dev
```

版本命令打印 core/CLI 版本；桌面打开可信管理界面，可创建空 Agent，或导入组件并在统一配置、权限确认后启用。应用不自动安装业务组件。

## 开发与验证

| 命令                        | 用途                                        |
| --------------------------- | ------------------------------------------- |
| `pnpm build`                | 构建 core、CLI、SDK、host 与 desktop        |
| `pnpm test`                 | 准备本地测试 Node，构建并运行应用与安全回归 |
| `pnpm conformance:platform` | 运行共同平台契约的符合性检查                |
| `pnpm desktop:dev`          | 启动桌面开发应用                            |
| `pnpm desktop:package`      | 生成 macOS arm64 安装包至忽略的 `release/`  |
| `pnpm bench:performance`    | 运行性能基准                                |

定向集成测试先运行 `node scripts/prepare-test-runtime.mjs` 和 `pnpm build`，再执行 `pnpm exec vitest run <测试文件>`。部分 CLI、子进程及 Electron 测试加载构建后的 dist。原生窗口测试按配置顺序运行。

## 版本与边界

桌面、宿主与 SDK 稳定线为 **1.0.0**，core 与 CLI 为 **0.2.0**。新包默认格式 **2.0**，读取 1.x/2.x 并保留同 major 的未知字段和传入格式版本。版本号不代表已完成所有第三方互操作验收。

CLI 只调用 core 的公开 API，目前使用内存密钥存储和 RecordingEgressSink；没有真实联网或持久化密钥。真实文件、HTTPS 与 Agent 私有本地密钥由桌面宿主提供。CLI 启用需要 `--yes`，应先 inspect 权限。

能力失败报告 callId、阶段和执行状态；unknown/completed 不自动重试。卸载、设置残留、数据库迁移和密钥清理的具体契约见内核参考。桌面不提供任意本机 shell 或本地 stdio MCP。

## 文档

| 任务                | 文档                                            |
| ------------------- | ----------------------------------------------- |
| 安装、导入与管理    | [安装、导入与管理](docs/desktop.md)             |
| 能力调用与确认      | [能力调用与确认](docs/capabilities.md)          |
| SDK v2 与连接器边界 | [SDK v2 与连接器边界](docs/sdk-v2.md)           |
| 内核与 CLI 参考     | [内核与 CLI 参考](docs/core-guide.md)           |
| 本机引擎与长期授权  | [本机引擎与长期授权](docs/engine.md)            |
| 共同契约与受控运行  | [共同契约与受控运行](docs/common-contract.md)   |
| 兼容、备份与恢复    | [兼容、备份与恢复](docs/desktop-recovery.md)    |
| 执行底座公开契约    | [执行底座公开契约](docs/foundation-contract.md) |

## 许可证

[Apache-2.0](LICENSE)。
