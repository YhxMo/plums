# Plums 0.1.0 preview

This is preview software for macOS 27.0.1 Apple Silicon (arm64).
Read the [changelog](https://github.com/YhxMo/plums/blob/main/CHANGELOG.md)
and [security model](https://github.com/YhxMo/plums/blob/main/docs/security-model.md).
The workspace package scope is `@plumsjs`.

## Verify before opening

Download the DMG, `SHA256SUMS`, and `THIRD_PARTY_NOTICES.txt` to one directory:

```sh
shasum -a 256 -c SHA256SUMS
gh attestation verify Plums-0.1.0-arm64.dmg --repo YhxMo/plums
```

The package is ad-hoc signed and not notarized. It has no trusted Developer ID
signature and no automatic updater. Gatekeeper prompts vary by macOS version. Source validation does not certify
the browser-download path. If available, try right-click Open or System Settings
→ Privacy & Security → Open Anyway after verification.
Removing quarantine with `xattr -dr com.apple.quarantine Plums.app` bypasses that
system check; do it only for a package whose source, hash and provenance you verified.

## Known boundaries

- Project tier remains unavailable (`TIER_UNAVAILABLE`), with no machine or unsandboxed fallback.
- Machine extensions have no Plums sandbox and may access the account's files,
  credentials, programs and network. Detached children may continue after stop or revocation.
- Runtime hard-link aliases created by unrelated processes remain an unprotected risk.
- macOS 15 CI is separate from manual macOS 27 acceptance.

This Release stays a draft until the maintainer reviews the evidence and download behavior.
