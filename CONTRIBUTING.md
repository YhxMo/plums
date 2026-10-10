# Contributing to Plums

Read [AGENTS.md](AGENTS.md) before changing code. It defines the contribution
contract for authorization, audit redaction, rechecks, tier boundaries, package
validation, and isolated Agent data. Update affected contract text and meaningful
regression coverage in the same commit as behavior or configuration changes.

## Environment and commands

The complete desktop build and native acceptance target is macOS 27.0.1 on Apple
Silicon (arm64), Node.js 26.5.1, pnpm 10.33.3, and Xcode Command Line Tools.
CI runs on macOS 15 arm64; its supported groups and platform gates are documented
in [docs/ci.md](docs/ci.md). CI success does not replace target-system acceptance.
Other platforms cannot run this desktop target or all native/Electron tests.

From the repository root:

```sh
pnpm install --frozen-lockfile
node scripts/prepare-test-runtime.mjs
pnpm build
pnpm test
```

The test command prepares the runtime and builds again before running the suite.
For a targeted change, build first and select the affected test file:

```sh
pnpm build
pnpm exec vitest run packages/host/test/readme-claims.test.ts --maxWorkers=1
```

For desktop development or packaging:

```sh
pnpm desktop:dev
pnpm desktop:package
```

Core and CLI declare Node.js 22+ support; this full-workspace validation procedure
uses the pinned desktop runtime. Use [the core guide](docs/core-guide.md) for their API.

## Pull requests

- Keep each commit focused on one change and describe its public behavior.
- Reproduce a fix through public behavior and retain existing unique assertions.
- Do not weaken assertions, execution budgets, timeouts, or security gates.
- Do not add silent skips or `continue-on-error`.
- Run the affected checks after the final combined changes.
- Keep English and Chinese READMEs aligned with the implementation.
- Do not commit credentials, personal paths, generated output, or runtime data.
- Use synthetic data in examples and reproductions.

DCO sign-off is not required. CODEOWNERS is not configured.

## Component and fixture policy

This repository delivers the application, host, public SDK, and official foundation.
It does not accept specific third-party character cards, business extensions, or
copyrighted assets. Independently maintained components belong in separate projects.
Only original synthetic test fixtures belong here; see the
[fixture policy](packages/host/test/fixtures/extensions/README.md).
Do not copy code from AGPL/GPL projects. Compatibility work must use public specifications.

## Reporting

Use the issue forms for ordinary defects and feature requests. Follow
[SECURITY.md](SECURITY.md) for security problems, and do not disclose them in public
issues. Community participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
