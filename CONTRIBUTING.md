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
node scripts/prepare-electron.mjs
pnpm build
pnpm test
```

The test command prepares the Node and Electron runtimes and builds again before running the suite.
Electron preparation verifies the pinned development ZIP, restores its runtime
licenses, and applies a local ad-hoc signature before native UI tests.
The desktop development and packaging commands also prepare Electron explicitly.
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

## Version check

All workspace packages and the core/CLI version are `0.1.0` preview.
Run `node scripts/check-versions.mjs` before packaging.
The npm scope is `@plumsjs`. Use the source build procedure above.

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

Component authors can follow [the local author path](docs/component-author-guide.md)
for declarations, a temporary Agent, trusted approvals, diagnostics, and explicit updates.

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

## Pre-public checks

After packaging, run the tracked-document link check and the separate readiness gate:

```sh
node scripts/check-doc-links.mjs
node scripts/check-public-ready.mjs --denylist "$PUBLIC_READY_DENYLIST"
```

Set `PUBLIC_READY_DENYLIST` to a private regex list outside the checkout; do not
commit the list or its matched values. The gate reports locations and counts only.
Reviewed false positives are recorded in `scripts/privacy-allowlist.json` by
exact file path, SHA-256 of the original line, and character spans. They cover
third-party copyright contacts, synthetic fixture paths, member access in test
reports, and metadata rejection syntax. A changed line loses its exception;
matches outside the recorded spans still fail. Review each source span before
updating its digest. The allowlist does not exempt whole files or patterns.
It checks public files, unresolved metadata/Gatekeeper text, known private strings,
licenses, documented target/runtime, package and installer versions, fresh bundled
notices, the release guard, package inventory and npm scope. It is not part of
default CI. Run it separately after packaging. External document links are listed
without network requests. These checks do not replace full history or artifact audits.
