import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

// Manual research only. No global PID scan, broadcast signal, or production readiness.
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("This probe requires macOS arm64.");
const output = path.resolve(
  process.argv[2] ?? ".build-cache/native-diagnostics/project-trust.json",
);
await mkdir(path.dirname(output), { recursive: true });
const root = await mkdtemp("/private/tmp/plums-signal-path-");
const children = [];
const report = {
  ready: false,
  signal: "SIGCONT",
  cases: [],
  cleanupCompleted: false,
};
const source = path.resolve("packages/host/test/fixtures/signal-path-probe.c");
const binary = path.join(root, "caller"),
  trusted = path.join(root, "trusted"),
  hook = path.join(root, "hook.dylib");
async function until(check) {
  const deadline = Date.now() + 4000;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw Error("Synthetic probe did not reach its assertion.");
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function start(mode, file, target, sandbox) {
  const profile = `(version 1)(deny default)(allow file-read* (literal "/") (subpath "${root}") (subpath "/usr") (subpath "/System") (subpath "/private/etc") (literal "/dev/null"))(allow file-write* (subpath "${root}"))(allow sysctl-read)(allow process-exec (literal "${binary}") (literal "${trusted}"))(allow signal (target same-sandbox))(allow signal (process-path "${trusted}"))`;
  const args = [mode, file, String(target), trusted, hook];
  const child = spawn(
    sandbox ? "/usr/bin/sandbox-exec" : binary,
    sandbox ? ["-p", profile, binary, ...args] : args,
    { env: {}, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => {
    stdout += b;
  });
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  await until(() => {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error("Synthetic child exited before readiness: " + stderr);
    return stdout.includes("ready");
  });
  return child;
}
try {
  for (const file of [binary, trusted])
    execFileSync("/usr/bin/clang", ["-O2", source, "-o", file], {
      env: {},
      timeout: 10000,
    });
  execFileSync(
    "/usr/bin/clang",
    ["-O2", "-DPLUMS_TEST_HOOK", "-dynamiclib", source, "-o", hook],
    { env: {}, timeout: 10000 },
  );
  const sentryFile = path.join(root, "sentry");
  const sentry = await start("sentry", sentryFile, 0, false);
  for (const mode of ["request", "reexec"]) {
    const file = path.join(root, mode);
    const before = await readFile(sentryFile, "utf8");
    await start(mode, file, sentry.pid, true);
    const body = await readFile(file, "utf8");
    const permitted = body.includes("0 errno 0");
    if (permitted)
      await until(
        async () => (await readFile(sentryFile, "utf8")).length > before.length,
      );
    else assert.equal(await readFile(sentryFile, "utf8"), before);
    report.cases.push({
      mode,
      output: body.trim(),
      permitted,
      sentryContinued:
        (await readFile(sentryFile, "utf8")).length > before.length,
    });
  }
  assert.equal(
    report.cases[0].permitted,
    false,
    "The untrusted caller must be a negative control.",
  );
  report.verdict = report.cases[1].permitted
    ? "PATH_IDENTITY_INSUFFICIENT"
    : "INCONCLUSIVE";
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }
  await rm(root, { recursive: true, force: true });
  report.cleanupCompleted = children.every(
    (c) => c.exitCode !== null || c.signalCode !== null,
  );
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report));
