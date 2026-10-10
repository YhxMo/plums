import { requiredTests } from "./ci-test-plan.mjs";
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { macosMajor } from "./macos-version.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function compareRequiredTests(report, required, root = repository) {
  if (!Array.isArray(report.testResults) || !Array.isArray(required))
    throw Error("Invalid required-test report or list");
  const failures = [];
  const seen = new Set();
  for (const entry of required) {
    if (
      !entry.file ||
      seen.has(entry.file) ||
      (entry.passed !== undefined &&
        (!Number.isInteger(entry.passed) || entry.passed < 0)) ||
      (entry.mustPass !== undefined &&
        (!Array.isArray(entry.mustPass) ||
          entry.mustPass.some((name) => typeof name !== "string")))
    )
      throw Error("Invalid or duplicate required-test entry");
    seen.add(entry.file);
    const files = report.testResults.filter(
      (file) =>
        (path.isAbsolute(file.name)
          ? path.relative(root, file.name)
          : file.name
        )
          .split(path.sep)
          .join("/") === entry.file,
    );
    if (files.length !== 1) {
      failures.push(
        `${entry.file}: expected one file report, found ${files.length}`,
      );
      continue;
    }
    const tests = files[0].assertionResults;
    const passed = tests.filter((test) => test.status === "passed").length;
    if (entry.passed !== undefined && passed !== entry.passed)
      failures.push(
        `${entry.file}: expected exactly ${entry.passed} passed, found ${passed}`,
      );
    for (const name of entry.mustPass ?? []) {
      const matches = tests.filter((test) => test.fullName === name);
      if (matches.length !== 1 || matches[0].status !== "passed")
        failures.push(
          `${entry.file}::${name}: must pass (found ${matches.map((test) => test.status).join(", ") || "missing"})`,
        );
    }
  }
  return { ok: failures.length === 0, failures };
}
export function requiredSummary(result) {
  return [
    "## Required historical migration tests",
    "",
    `Result: ${result.ok ? "PASS" : "FAIL"}`,
    ...result.failures.map((failure) => `- ${failure}`),
    "",
  ].join("\n");
}

export async function readReports(files) {
  const testResults = [];
  for (const file of files) {
    let report;
    try {
      report = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        throw Error(
          `Missing Vitest report: ${file}; the test group may have crashed before writing JSON`,
        );
      throw error;
    }
    if (!Array.isArray(report.testResults))
      throw Error(`Invalid Vitest report: ${file}`);
    testResults.push(...report.testResults);
  }
  return { testResults };
}
export function compareSkips(
  report,
  expected,
  root = repository,
  context = {
    macosMajor: macosMajor(),
    experiments: process.env.PLUMS_NATIVE_EXPERIMENTS === "1",
  },
) {
  if (!Array.isArray(report.testResults) || !Array.isArray(expected))
    throw Error("Invalid skip report or expected list");
  const actual = report.testResults.flatMap((file) => {
    if (typeof file.name !== "string" || !Array.isArray(file.assertionResults))
      throw Error("Invalid test file report");
    const relative = path.isAbsolute(file.name)
      ? path.relative(root, file.name)
      : file.name;
    return file.assertionResults
      .filter((test) => ["skipped", "pending", "todo"].includes(test.status))
      .map((test) => ({
        file: relative.split(path.sep).join("/"),
        name: test.fullName,
        status: test.status,
      }));
  });
  const key = (entry) => `${entry.file}::${entry.name}`;
  if (
    expected.some(
      (e) =>
        typeof e.file !== "string" ||
        typeof e.name !== "string" ||
        typeof e.reason !== "string" ||
        !e.reason.trim(),
    )
  )
    throw Error("Every expected skip needs a file, name and reason");
  for (const entry of expected) {
    if (
      entry.when &&
      (!Number.isInteger(entry.when.macosMajor?.lt) ||
        !entry.issue ||
        (entry.when.experiments !== undefined &&
          entry.when.experiments !== true))
    )
      throw Error(
        "Conditional skips need an OS-major bound and evidence issue",
      );
  }
  const allKeys = expected.map(key);
  const relevant = expected.filter(
    (entry) => !entry.when?.experiments || context.experiments,
  );
  const active = relevant.filter(
    (entry) =>
      !entry.when ||
      (context.macosMajor !== null &&
        context.macosMajor < entry.when.macosMajor.lt),
  );
  const actualKeys = actual.map(key),
    expectedKeys = active.map(key);
  if (
    new Set(actualKeys).size !== actualKeys.length ||
    new Set(allKeys).size !== allKeys.length
  )
    throw Error("Duplicate skip entries");
  const extra = actual.filter((e) => !expectedKeys.includes(key(e))),
    missing = active.filter((e) => !actualKeys.includes(key(e)));
  const mustRunFailures = relevant
    .filter((entry) => entry.when && !active.includes(entry))
    .flatMap((entry) => {
      const tests = report.testResults
        .filter(
          (file) =>
            (path.isAbsolute(file.name)
              ? path.relative(root, file.name)
              : file.name
            )
              .split(path.sep)
              .join("/") === entry.file,
        )
        .flatMap((file) => file.assertionResults)
        .filter((test) => test.fullName === entry.name);
      return tests.length === 1 && tests[0].status === "passed"
        ? []
        : [
            `${key(entry)}: OS gate inactive; test must run and pass (found ${tests.map((test) => test.status).join(", ") || "missing"})`,
          ];
    });
  return {
    ok: !extra.length && !missing.length && !mustRunFailures.length,
    mustRunFailures,
    macosMajor: context.macosMajor,
    gatedCount: active.filter((entry) => entry.when).length,
    actual: actual.map((e) => ({
      ...e,
      reason:
        expected.find((x) => key(x) === key(e))?.reason ?? "Unexpected skip",
    })),
    extra,
    missing,
  };
}
export function skipSummary(result) {
  const lines = [
    "## Platform skip report",
    "",
    `Result: ${result.ok ? "PASS" : "FAIL"}`,
    "",
  ];
  for (const entry of result.actual)
    lines.push(
      `- ${entry.file}::${entry.name} (${entry.status}) — ${entry.reason}`,
    );
  for (const entry of result.missing)
    lines.push(
      `- MISSING: ${entry.file}::${entry.name} — ${entry.reason}; unexpected execution: verify compatibility and update the expected-skip list`,
    );
  for (const failure of result.mustRunFailures ?? [])
    lines.push(`- MUST RUN: ${failure}`);
  if (result.gatedCount)
    lines.push(
      `macOS <27: ${result.gatedCount} gated cases did not execute; target-system acceptance requires manual evidence.`,
    );
  if (!result.actual.length && !result.missing.length)
    lines.push("No skipped, pending or todo tests.");
  return lines.join("\n") + "\n";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length < 3)
      throw Error(
        "Usage: node scripts/ci-skip-report.mjs <Vitest JSON report> [...]",
      );
    const report = await readReports(process.argv.slice(2));
    const result = compareSkips(
      report,
      JSON.parse(
        await readFile(path.join(repository, "ci/expected-skips.json"), "utf8"),
      ),
    );
    const required = compareRequiredTests(report, requiredTests);
    const summary = skipSummary(result) + "\n" + requiredSummary(required);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    if (!result.ok || !required.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
