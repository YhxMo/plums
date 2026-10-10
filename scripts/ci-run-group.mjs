import { groups } from "./ci-test-plan.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import v8 from "node:v8";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const group = process.argv[2];
if (!Object.hasOwn(groups, group))
  throw Error("Usage: node scripts/ci-run-group.mjs <unit|platform|electron>");
if (process.env.CI && process.env.PLUMS_CI_GROUP_FILTER)
  throw Error("Local group filters are forbidden in CI");
const directory = path.join(root, "reports");
await mkdir(directory, { recursive: true });
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await writeFile(
  path.join(directory, `${group}.pending.json`),
  JSON.stringify({
    status: "started",
    commit,
    startedAt: new Date().toISOString(),
    projects: groups[group],
    memoryBytes: os.totalmem(),
    nodeOptions: process.env.NODE_OPTIONS ?? "",
    heapLimitMiB: v8.getHeapStatistics().heap_size_limit / 1048576,
  }) + "\n",
);
// Remove previous local reports so an interrupted rerun cannot reuse old evidence.
const { rm } = await import("node:fs/promises");
await Promise.all(
  ["json", "status.json"].map((suffix) =>
    rm(path.join(directory, `${group}.${suffix}`), { force: true }),
  ),
);
const args = [
  "exec",
  "vitest",
  "run",
  ...groups[group].flatMap((project) => ["--project", project]),
  "--reporter=default",
  "--reporter=json",
  `--outputFile=reports/${group}.json`,
  "--logHeapUsage",
];
if (process.env.PLUMS_CI_GROUP_FILTER)
  args.push(process.env.PLUMS_CI_GROUP_FILTER);
const log = createWriteStream(path.join(directory, `${group}.log`));
let tail = "";
const record = (data, output) => {
  log.write(data);
  output.write(data);
  tail = (tail + data.toString()).slice(-64 * 1024);
};
const child = spawn("/usr/bin/time", ["-l", "pnpm", ...args], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => record(data, process.stdout));
child.stderr.on("data", (data) => record(data, process.stderr));
let spawnError;
child.on("error", (error) => {
  spawnError = error.code ?? "SPAWN_FAILED";
});
const result = await new Promise((resolve) =>
  child.on("close", (exitCode, signal) => resolve({ exitCode, signal })),
);
const signalMatch =
  /Command was killed with (SIG[A-Z]+)/.exec(tail)?.[1] ?? null;
result.signal ??= signalMatch;
const status = {
  ...result,
  spawnError: spawnError ?? null,
  endedAt: new Date().toISOString(),
};
if (status.signal)
  record(
    Buffer.from(`\nCI group ${group} terminated with ${status.signal}\n`),
    process.stderr,
  );
await new Promise((resolve, reject) => {
  log.on("error", reject);
  log.end(resolve);
});
await writeFile(
  path.join(directory, `${group}.status.json`),
  JSON.stringify(status) + "\n",
);
process.exitCode =
  result.exitCode === 0 && !result.signal && !spawnError
    ? 0
    : result.exitCode || 1;
