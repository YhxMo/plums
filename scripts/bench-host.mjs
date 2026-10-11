import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out")
  throw Error("Usage: pnpm bench:host --out /absolute/report.json");
const output = path.resolve(args[1]);
await access(path.dirname(output));
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "plums-host-benchmark-"),
);
const reports = [];
let failed = false;
try {
  for (const scenario of ["idle", "concurrent", "cancel", "diagnostic"]) {
    const report = path.join(temporary, scenario + ".json");
    const status = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--config",
          "scripts/performance.config.ts",
        ],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            PLUMS_BENCH_SCENARIO: scenario,
            PLUMS_BENCH_REPORT: report,
          },
        },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    failed ||= status !== 0;
    try {
      reports.push({
        scenario,
        exitCode: status,
        ...JSON.parse(await readFile(report, "utf8")),
      });
    } catch {
      reports.push({ scenario, exitCode: status, reportUnavailable: true });
    }
    await writeFile(output, JSON.stringify({ reports }, null, 2) + "\n");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
