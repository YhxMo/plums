import { readFile } from "node:fs/promises";

// This guard checks the intentionally fixed workflow structure without a YAML dependency.
export function assertReleaseWorkflow(text) {
  const require = (condition, message) => {
    if (!condition) throw Error(message);
  };
  require(/^permissions: \{\}\s*$/m.test(
    text,
  ), "Top-level permissions must be empty");
  require(!/pull_request(?:_target)?\s*:/.test(
    text,
  ), "PR triggers are forbidden");
  require(/^  workflow_dispatch:\s*$/m.test(text) &&
    /^    tags:\s*\n\s+- ["']v\*["']/m.test(
      text,
    ), "Tag and manual triggers required");
  const actions = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
  require(actions.length > 0 &&
    actions.every((action) =>
      /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/.test(action),
    ), "Actions must use full commit SHAs");
  require(!/continue-on-error|--latest|gh release edit|\bnpm publish\b|\bpnpm publish\b/.test(
    text,
  ), "Publishing or bypass commands are forbidden");
  const jobText = text.slice(text.indexOf("\njobs:\n"));
  const jobs = Object.fromEntries(
    [
      ...jobText.matchAll(
        /^  ([\w-]+):\s*\n([\s\S]*?)(?=^  [\w-]+:\s*$|$(?![\s\S]))/gm,
      ),
    ].map((m) => [m[1], m[2]]),
  );
  require(Object.keys(jobs).sort().join(",") ===
    "attest,build,release", "Expected only build, attest and release jobs");
  for (const permission of [
    "contents: write",
    "id-token: write",
    "attestations: write",
  ])
    require(text.split(permission).length ===
      2, `Permission must occur in exactly one job: ${permission}`);
  const { build, attest, release } = jobs;
  require(!/contents: write|id-token:|attestations:/.test(
    build,
  ), "Build cannot have write permissions");
  require(/actions: read/.test(build), "CI gate requires actions read");
  require(/--commit "\$GITHUB_SHA" --workflow ci\.yml --json conclusion --jq '\.\[0\]\.conclusion'/.test(
    build,
  ) &&
    /test "\$conclusion" = success/.test(
      build,
    ), "Same-commit successful CI gate required");
  for (const command of [
    "pnpm install --frozen-lockfile",
    "node scripts/check-versions.mjs",
    "pnpm desktop:package",
    "node scripts/package-smoke.mjs",
    "shasum -a 256",
    "SHA256SUMS",
  ])
    require(build.includes(command), `Missing build gate: ${command}`);
  require(/id-token: write/.test(attest) &&
    /attestations: write/.test(attest) &&
    !/contents: write/.test(attest), "Attestation permissions invalid");
  require(/needs: build/.test(attest) &&
    /actions\/attest-build-provenance@[a-f0-9]{40}/.test(
      attest,
    ), "Attestation dependency/action required");
  for (const subject of ["release/Plums-*.dmg", "release/SHA256SUMS"])
    require(attest.includes(subject), "Missing attestation subject");
  require(/needs: \[build, attest\]/.test(release) &&
    /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/.test(
      release,
    ), "Release must depend on attestation and only run for tags");
  require(/contents: write/.test(release) &&
    !/id-token:|attestations:/.test(release), "Release permissions invalid");
  const commands = [...text.matchAll(/gh release [^\n]+/g)].map((m) => m[0]);
  require(commands.length === 1 &&
    /gh release create/.test(commands[0]) &&
    / --draft\b/.test(commands[0]) &&
    / --verify-tag\b/.test(
      commands[0],
    ), "Exactly one draft-only Release creation required");
  require(!/gh release/.test(
    build + attest,
  ), "Release creation must stay in release job");
  return { ok: true, actions: actions.length };
}

export async function checkReleaseWorkflow(root) {
  return assertReleaseWorkflow(
    await readFile(new URL(".github/workflows/release.yml", root), "utf8"),
  );
}
