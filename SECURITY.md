# Security policy

Plums is a preview. Install extensions only from sources you trust. Read the
[execution boundaries](docs/engine.md) before approving local execution.

## Supported versions

| Version        | Security fixes                       |
| -------------- | ------------------------------------ |
| Latest preview | Fixes target the latest preview only |

Released version support will be listed here when releases are available.

## Private disclosure

Report suspected vulnerabilities through [GitHub Private Vulnerability Reporting](https://github.com/YhxMo/plums/security/advisories/new).
Do not open a public issue with vulnerability details, credentials, private
paths, or personal data. Include a minimal reproduction with synthetic data,
the Plums version or commit, platform, component declarations, and tier.

Initial acknowledgement: 7 days.

## In scope

- Sandbox and permission boundaries, Agent tier ceilings, component execution
  authorization, and bypasses of trusted confirmation windows.
- Enforcement of local execution declarations and machine/project tier boundaries.
- Credentials or business content entering logs, audit events, or exports.
- Package validation, migration, and privilege escalation.
- Unauthorized access to another Agent's data through sandboxed interfaces.

## Out of scope and known limitations

- Machine tier has no Plums sandbox. Once authorized, a component can access
  files available to the account, including home-directory files and Plums data,
  use the network, and run programs. These authorized capabilities are intended.
- Project tier is currently unavailable (`TIER_UNAVAILABLE`). Reports of an
  escape from an available project runtime do not apply; design feedback is welcome.
- Detached descendants may continue after stopping or revoking a machine entry.
  Process-group cleanup does not guarantee that all descendants stop.
- Runtime hard-link aliases created by unrelated processes are a known risk
  for the future project tier; creation checks are not a kernel inode boundary.
- Test fixtures and native probes, including `packages/host/test/fixtures/*.c`
  and project boundary experiments under `packages/host/native/project-*.c`,
  are validation specimens, not supported attack utilities.
- Gatekeeper prompts caused by ad-hoc signing and lack of notarization.

An unlisted bypass of a promised boundary remains in scope even if it involves
one of these areas. The [contribution guide](CONTRIBUTING.md) covers ordinary bugs.
