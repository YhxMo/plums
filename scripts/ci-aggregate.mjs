import { groups, requiredTests } from "./ci-test-plan.mjs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectGroups,
  assertCoverage,
  inspectCoverage,
} from "./check-test-coverage.mjs";
import {
  compareRequiredTests,
  compareSkips,
  readReports,
  requiredSummary,
  skipSummary,
} from "./ci-skip-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fileURLToPath(import.meta.url);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

export function assessGroup(group, pending, status, report, log = "") {
  const failures = [];
  const crashed = Boolean(pending && (!report || status?.signal));
  if (!pending) failures.push("group did not write its pending marker");
  if (!status) failures.push("group did not write its completion status");
  if (!report) failures.push("missing Vitest JSON");
  if (status?.signal) failures.push(`signal ${status.signal}`);
  if (status && (status.exitCode !== 0 || status.spawnError))
    failures.push(
      `exit ${status.exitCode}; spawn error ${status.spawnError ?? "none"}`,
    );
  if (
    report &&
    (!report.success ||
      report.numFailedTests ||
      report.numFailedTestSuites ||
      report.testResults?.some((file) => file.status === "failed"))
  )
    failures.push("Vitest reported failed tests or suites");
  const rss = log.match(/(\d+)\s+maximum resident set size/);
  return {
    group,
    state: crashed ? "crashed" : failures.length ? "failed" : "passed",
    failures,
    signal: status?.signal ?? null,
    commit: pending?.commit ?? null,
    nodeOptions: pending?.nodeOptions ?? null,
    heapLimitMiB: pending?.heapLimitMiB ?? null,
    memoryBytes: pending?.memoryBytes ?? null,
    total: report?.numTotalTests ?? null,
    passed: report?.numPassedTests ?? null,
    failed: report?.numFailedTests ?? null,
    durationSeconds:
      pending && status
        ? (Date.parse(status.endedAt) - Date.parse(pending.startedAt)) / 1000
        : null,
    rssBytes: rss ? Number(rss[1]) : null,
    ...(crashed ? { logTail: log.split("\n").slice(-50).join("\n") } : {}),
  };
}

export function assertGroupFiles(
  group,
  report,
  specifications,
  groups,
  base = root,
) {
  for (const file of report?.testResults ?? []) {
    const relative = (
      path.isAbsolute(file.name) ? path.relative(base, file.name) : file.name
    )
      .split(path.sep)
      .join("/");
    const hits = specifications.filter((spec) => spec.file === relative);
    if (hits.length !== 1 || !groups[group].includes(hits[0].project))
      throw Error(`${relative}: report belongs to the wrong CI group ${group}`);
  }
}
export async function aggregate(directory, groups, expected, required) {
  const optional = async (file) => {
    try {
      return await json(path.join(directory, file));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  const results = [];
  const reports = [];
  for (const [group, projects] of Object.entries(groups)) {
    const pending = await optional(`${group}.pending.json`);
    const status = await optional(`${group}.status.json`);
    const report = await optional(`${group}.json`);
    let log = "";
    try {
      log = await readFile(path.join(directory, `${group}.log`), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const result = assessGroup(group, pending, status, report, log);
    if (
      pending &&
      JSON.stringify(pending.projects) !== JSON.stringify(projects)
    )
      result.failures.push("pending project list differs from ci/tests.json");
    if (result.failures.length && result.state === "passed")
      result.state = "failed";
    results.push(result);
    if (report) reports.push(report);
  }
  const report = {
    testResults: reports.flatMap((report) => report.testResults ?? []),
  };
  const skips = compareSkips(report, expected);
  const migrations = compareRequiredTests(report, required);
  const commits = new Set(results.map((result) => result.commit));
  const ok =
    results.every((result) => result.state === "passed") &&
    commits.size === 1 &&
    !commits.has(null) &&
    skips.ok &&
    migrations.ok;
  return {
    ok,
    groups: results,
    skips,
    migrations,
    commitMismatch: commits.size !== 1 || commits.has(null),
  };
}

export function aggregateSummary(result) {
  const lines = [
    "## CI group evidence",
    "",
    `Result: ${result.ok ? "PASS" : "FAIL"}`,
    "",
    "| Group | State | Passed/total | Seconds | Peak RSS bytes | Signal |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.groups.map(
      (group) =>
        `| ${group.group} | ${group.state} | ${group.passed ?? "?"}/${group.total ?? "?"} | ${group.durationSeconds ?? "?"} | ${group.rssBytes ?? "?"} | ${group.signal ?? "—"} |`,
    ),
  ];
  for (const group of result.groups) {
    for (const failure of group.failures)
      lines.push(`- ${group.group}: ${failure}`);
    if (group.logTail)
      lines.push(
        `\n### ${group.group} crash log (last 50 lines)\n\n\`\`\`text\n${group.logTail}\n\`\`\``,
      );
  }
  if (result.commitMismatch)
    lines.push(
      "- Reports are missing commit identities or belong to different commits.",
    );
  return (
    lines.join("\n") +
    "\n\n" +
    skipSummary(result.skips) +
    "\n" +
    requiredSummary(result.migrations)
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const result = await aggregate(
      path.join(root, "reports"),
      groups,
      await json(path.join(root, "ci/expected-skips.json")),
      requiredTests,
    );
    const coverage = await inspectCoverage();
    try {
      for (const group of Object.keys(groups)) {
        const report = await json(path.join(root, `reports/${group}.json`));
        assertGroupFiles(group, report, coverage.specifications, groups);
      }
      if (
        process.env.GITHUB_SHA &&
        result.groups.some((group) => group.commit !== process.env.GITHUB_SHA)
      )
        throw Error("Report commit differs from the workflow commit");
      assertProjectGroups(coverage.projects, groups);
      assertCoverage({
        ...coverage,
        specifications: (
          await readReports(
            Object.keys(groups).map((group) =>
              path.join(root, `reports/${group}.json`),
            ),
          )
        ).testResults.map((file) => {
          const relative = (
            path.isAbsolute(file.name)
              ? path.relative(root, file.name)
              : file.name
          )
            .split(path.sep)
            .join("/");
          const specification = coverage.specifications.find(
            (spec) => spec.file === relative,
          );
          return {
            file: relative,
            project: specification?.project ?? "unknown",
          };
        }),
      });
    } catch (error) {
      result.ok = false;
      result.coverageFailure = error.message;
    }
    await mkdir(path.join(root, "reports"), { recursive: true });
    await writeFile(
      path.join(root, "reports/aggregate.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    const summary =
      aggregateSummary(result) +
      (result.coverageFailure
        ? `\nCoverage FAIL: ${result.coverageFailure}\n`
        : "\nCoverage PASS\n");
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
