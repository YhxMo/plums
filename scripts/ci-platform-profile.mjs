// Read-only CI observations. Failed probes are data; report write failures are fatal.
import { execFile } from "node:child_process";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseMacosMajor } from "./macos-version.mjs";
export { parseMacosMajor } from "./macos-version.mjs";

const script = fileURLToPath(import.meta.url);
const minimalProfile =
  "(version 1)(deny default)(allow process-exec*)(allow file-read*)(allow sysctl-read)(allow mach-lookup)";

export function runCommand(file, args, options = {}, execute = execFile) {
  return new Promise((resolve) => {
    const finish = (error, stdout = "", stderr = "") =>
      resolve({
        status: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
        signal: error?.signal ?? null,
        stdout: String(stdout),
        stderr: String(stderr),
        errorCode: typeof error?.code === "string" ? error.code : null,
        killed: error?.killed === true,
      });
    try {
      execute(
        file,
        args,
        {
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 8 * 1024 * 1024,
          ...options,
        },
        finish,
      );
    } catch (error) {
      finish(error);
    }
  });
}

async function recentDiagnosticReports(now) {
  const directory = path.join(os.homedir(), "Library/Logs/DiagnosticReports");
  try {
    const names = await readdir(directory);
    const files = await Promise.all(
      names.map(async (name) => {
        const info = await stat(path.join(directory, name));
        return info.isFile() && info.mtimeMs >= now - 10 * 60_000 ? name : null;
      }),
    );
    return { files: files.filter(Boolean).sort(), errorCode: null };
  } catch (error) {
    return { files: [], errorCode: error.code ?? "SCAN_FAILED" };
  }
}

export async function collectProfile({
  run = runCommand,
  sourceProgram = "/bin/echo",
  temporaryDirectory = os.tmpdir(),
  scanReports = recentDiagnosticReports,
} = {}) {
  const startedAt = new Date().toISOString();
  const commands = {};
  const probe = async (id, file, args, options) =>
    (commands[id] = { file, args, ...(await run(file, args, options)) });
  await probe("resources", "/usr/sbin/sysctl", [
    "-n",
    "hw.memsize",
    "hw.ncpu",
    "hw.physicalcpu",
  ]);
  await probe("vmStat", "/usr/bin/vm_stat", []);
  const nodeEnvironment = { ...process.env };
  delete nodeEnvironment.NODE_OPTIONS;
  await probe(
    "defaultHeapLimitMiB",
    process.execPath,
    ["-p", "require('node:v8').getHeapStatistics().heap_size_limit/1048576"],
    { env: nodeEnvironment },
  );
  await probe("availableParallelism", process.execPath, [
    "-p",
    "require('node:os').availableParallelism()",
  ]);
  await probe("systemVersion", "/usr/bin/sw_vers", []);
  await probe("productVersion", "/usr/bin/sw_vers", ["-productVersion"]);
  await probe("uname", "/usr/bin/uname", ["-a"]);
  await probe("echoArchitectures", "/usr/bin/lipo", ["-archs", sourceProgram]);
  await probe("echoFile", "/usr/bin/file", [sourceProgram]);
  await probe("echoOriginalSignature", "/usr/bin/codesign", [
    "-dv",
    "--verbose=4",
    sourceProgram,
  ]);
  await probe("trueSignature", "/usr/bin/codesign", ["-dv", "/usr/bin/true"]);
  const temporary = await mkdtemp(
    path.join(temporaryDirectory, "plums-ci-profile-"),
  );
  try {
    const snapshotDirectory = path.join(temporary, "snap");
    await mkdir(snapshotDirectory, { mode: 0o700 });
    const snapshot = path.join(snapshotDirectory, "command");
    await copyFile(sourceProgram, snapshot);
    await chmod(snapshot, 0o700);
    await probe("snapshotSignatureBefore", "/usr/bin/codesign", [
      "-dv",
      "--verbose=4",
      snapshot,
    ]);
    await probe("snapshotResign", "/usr/bin/codesign", [
      "--force",
      "--sign",
      "-",
      snapshot,
    ]);
    await probe("snapshotSignatureAfter", "/usr/bin/codesign", [
      "-dv",
      "--verbose=4",
      snapshot,
    ]);
    await probe("snapshotVerify", "/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--verbose=4",
      snapshot,
    ]);
    await chmod(snapshot, 0o500);
    await probe("snapshotDirect", snapshot, ["hello"]);
    await probe("snapshotSandbox", "/usr/bin/sandbox-exec", [
      "-p",
      minimalProfile,
      snapshot,
      "hello",
    ]);
    await probe("originalArm64", "/usr/bin/arch", [
      "-arm64",
      sourceProgram,
      "hello",
    ]);
    await probe("originalSandbox", "/usr/bin/sandbox-exec", [
      "-p",
      minimalProfile,
      sourceProgram,
      "hello",
    ]);
    await probe(
      "controlledHost",
      process.execPath,
      [script, "--controlled-probe"],
      { timeout: 30_000 },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const diagnosticReports = await scanReports(Date.now());
  await probe(
    "sandboxLog",
    "/usr/bin/log",
    [
      "show",
      "--last",
      "2m",
      "--style",
      "compact",
      "--predicate",
      'eventMessage CONTAINS "Sandbox" OR eventMessage CONTAINS "arm64e"',
    ],
    { timeout: 30_000 },
  );
  const resourceValues = commands.resources.stdout
    .trim()
    .split(/\s+/)
    .map(Number);
  const number = (value) =>
    Number.isFinite(value) && value > 0 ? value : null;
  return {
    schemaVersion: 1,
    startedAt,
    endedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      release: os.release(),
    },
    macosMajor:
      commands.productVersion.status === 0
        ? parseMacosMajor(commands.productVersion.stdout)
        : null,
    resources: {
      memsizeBytes:
        commands.resources.status === 0 ? number(resourceValues[0]) : null,
      ncpu: commands.resources.status === 0 ? number(resourceValues[1]) : null,
      physicalcpu:
        commands.resources.status === 0 ? number(resourceValues[2]) : null,
      defaultHeapLimitMiB:
        commands.defaultHeapLimitMiB.status === 0
          ? number(Number(commands.defaultHeapLimitMiB.stdout.trim()))
          : null,
      totalmemBytes: os.totalmem(),
      freememBytes: os.freemem(),
    },
    commands,
    diagnosticReports,
  };
}

export function profileSummary(profile) {
  const rows = Object.entries(profile.commands).map(
    ([id, result]) =>
      `| ${id} | ${result.status ?? "null"} | ${result.signal ?? "—"} | ${result.errorCode ?? "—"} |`,
  );
  return [
    "## Platform diagnostics (probe failures remain recorded data)",
    `macOS major: ${profile.macosMajor ?? "unknown"}; memory bytes: ${profile.resources.memsizeBytes ?? "unknown"}; CPU count: ${profile.resources.ncpu ?? "unknown"}; default heap MiB: ${profile.resources.defaultHeapLimitMiB ?? "unknown"}.`,
    "Raw stdout/stderr and signature evidence: `ci-diagnostics/profile.json`.",
    "| Probe | Status | Signal | Error code |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export async function controlledProbe(
  openAdapter = async () =>
    (await import("./platform-conformance-host.mjs")).open({
      runtime: "controlled-node",
    }),
) {
  // Reuse the public host/SDK fixture's actual bindControlledProgram path.
  let scenario;
  let observation;
  try {
    scenario = await (await openAdapter()).scenario();
    const client = await scenario.client();
    const binding = await client.sdk.binding("backend");
    const call = await client.sdk.invoke(binding.handle, "exec", {
      args: ["hello"],
    });
    const result = await call.result;
    observation = {
      status: result.outcome.ok ? "completed" : "failed",
      executionState: result.executionState,
      exitCode: result.outcome.ok ? result.outcome.value.result.exitCode : null,
      failure: result.outcome.ok
        ? null
        : { code: result.outcome.error.code, reason: null },
    };
  } catch (error) {
    // Never include exceptions, paths, arguments or outputs from the host.
    const codes = new Set([
      "CAPABILITY_FAILED",
      "NOT_AUTHORIZED",
      "SECRET_NOT_FOUND",
      "IMPORT_INVALID",
    ]);
    const reasons = new Set([
      "RUNTIME_UNAVAILABLE",
      "CANCELLED",
      "STALE_BINDING",
      "INVALID_REQUEST",
      "PROVIDER_FAILED",
      "NOT_AUTHORIZED",
      "LIMIT_EXCEEDED",
    ]);
    observation = {
      status: "failed",
      failure: {
        code: codes.has(error.code) ? error.code : "PROBE_FAILED",
        reason: reasons.has(error.details?.reason)
          ? error.details.reason
          : null,
      },
    };
  } finally {
    try {
      await scenario?.close();
    } catch {
      observation = {
        status: "failed",
        failure: { code: "PROBE_CLEANUP_FAILED", reason: null },
      };
    }
  }
  return observation;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  if (process.argv[2] === "--controlled-probe") {
    process.stdout.write(JSON.stringify(await controlledProbe()) + "\n");
  } else {
    const profile = await collectProfile();
    const directory = path.resolve("reports/diagnostics");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "profile.json"),
      JSON.stringify(profile, null, 2) + "\n",
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        profileSummary(profile),
      );
    process.stdout.write(profileSummary(profile));
  }
}
