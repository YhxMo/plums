<h1 align="center">Plums</h1>

<p align="center">用可复用组件组装和运行 Agent 的桌面工作空间。</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-22C55E?style=flat-square" alt="许可证：Apache-2.0"></a> <a href="./tsconfig.base.json"><img src="https://img.shields.io/badge/Language-TypeScript-3776AB?style=flat-square" alt="开发语言：TypeScript"></a> <a href="./docs/desktop.md"><img src="https://img.shields.io/badge/Node.js-26.5.1-3776AB?style=flat-square" alt="桌面构建环境：Node.js 26.5.1"></a> <a href="./package.json"><img src="https://img.shields.io/badge/pnpm-10-3776AB?style=flat-square" alt="包管理器：pnpm 10"></a> <a href="./docs/desktop.md"><img src="https://img.shields.io/badge/macOS-arm64-4B5563?style=flat-square" alt="桌面目标平台：macOS arm64"></a>
</p>

## 简介

Plums 将角色卡、功能扩展和服务连接器放进同一个桌面工作空间。你可以导入完整 Agent，也可以按需组装组件，选择自己的工作界面。

桌面应用负责组件管理、配置、权限和运行；聊天、模型接入及其他工作流程由独立维护的扩展和连接器提供。

`plums` 是 Plums 的源码仓库。

## 主要特性

- **导入即用，按需组装。** 支持完整 Agent ZIP，也支持组合独立组件；角色卡可选。
- **组件复用。** 在公共库中管理组件，为每个 Agent 选择具体版本。
- **独立工作空间。** 每个 Agent 分别保存配置、凭据、权限和运行数据。
- **访问由你决定。** 在桌面应用中查看声明权限、批准任务范围并管理访问；本机引擎需要单独的信任授权。
- **便携分享。** 导出 Agent ZIP，不携带设置值、凭据、授权或运行数据。

## 安装

当前桌面目标平台为 macOS 27.0.1、Apple Silicon（arm64）。

从源码运行前，请安装：

- Node.js **26.5.1**
- pnpm **10**
- Xcode Command Line Tools

```sh
git clone https://github.com/YhxMo/plums.git
cd plums
pnpm install --frozen-lockfile
```

单独使用 core 或 CLI 时，也支持 Node.js 22 及后续版本。

## 快速开始

在仓库根目录启动桌面应用：

```sh
pnpm desktop:dev
```

命令会构建工作区并打开 Plums 管理界面。

使用完整 Agent：

1. 选择或拖入 Agent ZIP，选择「这是完整的 Agent，直接使用」。
2. 填写组件需要的配置，例如模型名称、Base URL 和 API Key。
3. 点击「开始使用」，在 Plums 确认窗口中查看并同意所需权限。
4. 按提示批准本次任务范围，进入 Agent 的工作界面。

没有 Agent ZIP 时，也可以直接创建空 Agent。需要自行组装时，先将 Plums 组件 ZIP、角色 JSON 或包含角色数据的 PNG 导入公共库，再选择组件创建 Agent。

应用自带官方执行底座；业务扩展和角色卡需要独立安装。没有工作界面的 Agent 会打开资源管理页。

配置、组件更新和日常操作见[桌面使用指南](./docs/desktop.md)。

## 文档

详细指南目前以简体中文提供。

| 主题                   | 指南                                              |
| ---------------------- | ------------------------------------------------- |
| 安装、配置和使用 Agent | [桌面使用指南](./docs/desktop.md)                 |
| 开发扩展与服务连接器   | [SDK v2](./docs/sdk-v2.md)                        |
| 连接组件与工作界面     | [扩展协议](./docs/extension-protocols.md)         |
| 管理执行底座           | [桌面底座管理](./docs/foundation-desktop.md)      |
| 开发执行底座           | [底座作者指南](./docs/foundation-author-guide.md) |
| 使用内核与 CLI         | [内核与 CLI 指南](./docs/core-guide.md)           |
| 了解权限与能力调用     | [能力调用接口](./docs/capabilities.md)            |
| 升级和恢复本地数据     | [兼容与恢复](./docs/desktop-recovery.md)          |

## 开发

在仓库根目录执行：

```sh
pnpm build
pnpm test
pnpm desktop:package
```

`pnpm test` 包含构建。桌面打包面向 macOS Apple Silicon，应用和 DMG 输出至 `release/`。

## 许可证

本项目采用 [Apache-2.0](./LICENSE) 许可证。
