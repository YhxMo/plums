<h1 align="center">Plums</h1>

<p align="center">A desktop workspace for assembling and running Agents from reusable components.</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-22C55E?style=flat-square" alt="License: Apache-2.0"></a> <a href="./tsconfig.base.json"><img src="https://img.shields.io/badge/Language-TypeScript-3776AB?style=flat-square" alt="Language: TypeScript"></a> <a href="./docs/desktop.md"><img src="https://img.shields.io/badge/Node.js-26.5.1-3776AB?style=flat-square" alt="Desktop toolchain: Node.js 26.5.1"></a> <a href="./package.json"><img src="https://img.shields.io/badge/pnpm-10-3776AB?style=flat-square" alt="Package manager: pnpm 10"></a> <a href="./docs/desktop.md"><img src="https://img.shields.io/badge/macOS-arm64-4B5563?style=flat-square" alt="Desktop target: macOS arm64"></a>
</p>

## About

**0.1.0 preview software.** Read the permission boundaries and known limitations before installing extensions.

Plums brings character cards, extensions, and service connectors into one desktop workspace. Import a complete Agent, or assemble your own and choose its work interface.

The desktop app manages components, configuration, permissions, and execution. Chat, model integrations, and other workflows are provided by separately maintained extensions and connectors.

This repository contains the source of Plums.

## Highlights

- **Import or assemble.** Use a complete Agent ZIP or combine individual components, with or without character cards.
- **Reuse components.** Keep a shared component library and choose specific versions for each Agent.
- **Separate workspaces.** Each Agent has its own settings, credentials, permissions, and runtime data.
- **Control access.** Review declared permissions, approve task scopes, and manage access from the desktop app. Each Agent has a permission tier ceiling (sandbox < project < machine, default sandbox). Components run local code only after declaring local execution, receiving your assembly approval, and staying within that ceiling.
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
pnpm desktop:package
```

Core and CLI can also be used separately with Node.js 22 or later.

The application and DMG are written to `release/`.

### Preview downloads and Gatekeeper

When a preview artifact is available, download its `SHA256SUMS` and verify the files
before opening the DMG:

```sh
shasum -a 256 -c SHA256SUMS
gh attestation verify Plums-0.1.0-arm64.dmg --repo YhxMo/plums
```

The preview uses ad-hoc signing and is not notarized. A browser download may be
blocked by Gatekeeper. Right-click **Open**, or use **System Settings → Privacy &
Security → Open Anyway**, if your macOS version offers that option.
**Gatekeeper prompts and these steps are pending user validation on the target Mac.**

`xattr -dr com.apple.quarantine Plums.app` removes the quarantine marker and bypasses
that system check. Use it only for a package whose source, checksum, and provenance
you have verified. It is not evidence of notarization or a trusted developer signature.

## Platform support

Desktop support is limited to macOS 27.0.1 on Apple Silicon (arm64), using Node.js 26.5.1 and pnpm 10 for the full source build. Other desktop platforms are unsupported. Core and CLI can be used separately on Node.js 22 or later. See [CI and platform gates](./docs/ci.md) for the official foundation and native test conditions.

The minimum follows the packaged application's system requirement. CI uses macOS
15 arm64; acceptance on macOS 27 remains a separate manual check.

## Permission tiers and known limitations

- **Sandbox (default):** no local process execution.
- **Project tier: currently unavailable.** Launch returns `TIER_UNAVAILABLE` and never falls back to machine execution or an unsandboxed process. Reliable descendant containment and escape acceptance remain incomplete; see [local execution](./docs/engine.md).
- **Machine tier:** authorized extensions have **no Plums sandbox**. They can read and modify local files accessible to your account, including Plums data and other Agents' credentials, run arbitrary programs, and access the network. After you stop or revoke this entry, children it started that are detached from its process group may continue running. Install extensions only from sources you trust.
- **Runtime hard links:** creation checks and startup validation do not form a kernel inode boundary. New aliases created at runtime by unrelated processes remain an unprotected risk for the future project tier, which is currently unavailable.
- **Local installation packages:** ad-hoc signed and not notarized; the system may block them. Verify the source and hash in its verification record before choosing to run a local build. Automatic updates are unavailable.

See the [security model](./docs/security-model.md) for authorization, revocation,
and audit boundaries. Report vulnerabilities through [SECURITY.md](./SECURITY.md).
For development and contributions, follow [CONTRIBUTING.md](./CONTRIBUTING.md).

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

## npm package scope

The workspace uses the npm organization scope `@plumsjs`: `@plumsjs/core`,
`@plumsjs/cli`, `@plumsjs/sdk`, `@plumsjs/host`, and `@plumsjs/desktop`.
The CLI command remains `plums`. npm publication is pending; use the source
build instructions above. The SDK, host, desktop, and workspace root retain
their existing `private: true` setting.

## Development

Run these commands from the repository root:

```sh
pnpm build
pnpm test
pnpm desktop:package
```

`pnpm test` includes a build. The default configuration runs multiple projects in parallel and ordered groups; see [CI and scheduling](./docs/ci.md). Desktop packaging targets macOS Apple Silicon and writes the application and DMG to `release/`.

## License

Licensed under [Apache-2.0](./LICENSE).

[NOTICE](./NOTICE) identifies the project copyright holder. Desktop packages include
production third-party license texts in `Plums.app/Contents/Resources/`:
`THIRD_PARTY_NOTICES.txt`, `LICENSE.electron`, `LICENSES.chromium.html`, and `node/LICENSE`.
