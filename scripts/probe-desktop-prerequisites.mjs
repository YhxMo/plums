import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Read public signing metadata only; do not export identities, keys, or accounts.
if (process.platform !== "darwin") throw Error("This probe requires macOS.");
const application = path.resolve(process.argv[2]);
const output = path.resolve(
  process.argv[3] ?? ".build-cache/native-diagnostics/prerequisites.json",
);
const run = (command, args) =>
  spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
const identities = run("/usr/bin/security", [
  "find-identity",
  "-v",
  "-p",
  "codesigning",
]);
const signature = run("/usr/bin/codesign", ["-dvv", application]);
const assessment = run("/usr/sbin/spctl", [
  "--assess",
  "--type",
  "execute",
  application,
]);
const tool = run("/usr/bin/xcrun", ["--find", "notarytool"]);
const developer = run("/usr/bin/xcode-select", ["-p"]);
const report = {
  ready: false,
  developerIdApplicationIdentities:
    identities.status === 0
      ? (identities.stdout.match(/"Developer ID Application:/g) ?? []).length
      : null,
  signature: {
    inspected: signature.status === 0,
    adHoc: signature.stderr.includes("Signature=adhoc"),
    hardenedRuntime: /\bflags=.*\bruntime\b/.test(signature.stderr),
  },
  gatekeeperAccepted: assessment.status === 0,
  notarytoolAvailable: tool.status === 0,
  activeDeveloperTools:
    developer.status !== 0
      ? "unknown"
      : developer.stdout.includes("CommandLineTools")
        ? "command-line-tools"
        : "other",
  notarizationAuthentication:
    "not inspected; no scoped submission identity provided",
  realService: "no service or test account provided",
  independentComponent: "no independent author artifact provided",
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
