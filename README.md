<h1 align="center">Plums</h1>

<p align="center">A desktop workspace for assembling and running Agents from reusable components.</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-22C55E?style=flat-square" alt="License: Apache-2.0"></a> <a href="./tsconfig.base.json"><img src="https://img.shields.io/badge/Language-TypeScript-3776AB?style=flat-square" alt="Language: TypeScript"></a> <a href="./docs/desktop.md"><img src="https://img.shields.io/badge/Node.js-26.5.1-3776AB?style=flat-square" alt="Desktop toolchain: Node.js 26.5.1"></a> <a href="./package.json"><img src="https://img.shields.io/badge/pnpm-10-3776AB?style=flat-square" alt="Package manager: pnpm 10"></a> <a href="./docs/desktop.md"><img src="https://img.shields.io/badge/macOS-arm64-4B5563?style=flat-square" alt="Desktop target: macOS arm64"></a>
</p>

## About

Plums brings character cards, extensions, and service connectors into one desktop workspace. Import a complete Agent, or assemble your own and choose its work interface.

The desktop app manages components, configuration, permissions, and execution. Chat, model integrations, and other workflows are provided by separately maintained extensions and connectors.

`plums` is the source repository for Plums.

## Highlights

- **Import or assemble.** Use a complete Agent ZIP or combine individual components, with or without character cards.
- **Reuse components.** Keep a shared component library and choose specific versions for each Agent.
- **Separate workspaces.** Each Agent has its own settings, credentials, permissions, and runtime data.
- **Control access.** Review declared permissions, approve task scopes, and manage access from the desktop app. Local engines require separate trust approval.
- **Share Agents.** Export an Agent ZIP without settings values, credentials, approvals, or runtime data.

## Quick Install

The current desktop target is macOS 27.0.1 on Apple Silicon (arm64).

To run from source, install:

- Node.js **26.5.1**
- pnpm **10**
- Xcode Command Line Tools

```sh
git clone https://github.com/YhxMo/plums.git
cd plums
pnpm install --frozen-lockfile
```

Core and CLI can also be used separately with Node.js 22 or later.

## Quick Start

Launch the desktop app from the repository root:

```sh
pnpm desktop:dev
```

This builds the workspace and opens the Plums management interface.

To use a complete Agent:

1. Select or drag in an Agent ZIP, then choose the direct-use option.
2. Fill in the required component settings, such as the model, Base URL, and API key.
3. Select **Start using** and review the requested permissions in Plums confirmation windows.
4. Approve the required task scope when prompted, then use the Agent's work interface.

You can also create an empty Agent without importing a ZIP. To assemble one with components, first import Plums component ZIPs, character JSON files, or PNG files containing character data into the shared library.

The app includes an official execution foundation. Business extensions and character cards are installed separately. An Agent without a work interface opens its resource management page.

See the [desktop guide](./docs/desktop.md) for configuration, component updates, and daily use.

## Documentation

The detailed guides are currently written in Simplified Chinese.

| Topic                                       | Guide                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| Install, configure, and use Agents          | [Desktop guide](./docs/desktop.md)                           |
| Develop extensions and service connectors   | [SDK v2](./docs/sdk-v2.md)                                   |
| Connect components and work interfaces      | [Extension protocols](./docs/extension-protocols.md)         |
| Manage execution foundations                | [Desktop foundation guide](./docs/foundation-desktop.md)     |
| Build an execution foundation               | [Foundation author guide](./docs/foundation-author-guide.md) |
| Use the core and CLI                        | [Core and CLI guide](./docs/core-guide.md)                   |
| Understand permissions and capability calls | [Capabilities](./docs/capabilities.md)                       |
| Upgrade and recover local data              | [Compatibility and recovery](./docs/desktop-recovery.md)     |

## Development

Run these commands from the repository root:

```sh
pnpm build
pnpm test
pnpm desktop:package
```

`pnpm test` includes a build. Desktop packaging targets macOS Apple Silicon and writes the application and DMG to `release/`.

## License

Licensed under [Apache-2.0](./LICENSE).
