import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function compareSkips(report, expected, root = repository) {
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
  const actualKeys = actual.map(key),
    expectedKeys = expected.map(key);
  if (
    new Set(actualKeys).size !== actualKeys.length ||
    new Set(expectedKeys).size !== expectedKeys.length
  )
    throw Error("Duplicate skip entries");
  const extra = actual.filter((e) => !expectedKeys.includes(key(e))),
    missing = expected.filter((e) => !actualKeys.includes(key(e)));
  return {
    ok: !extra.length && !missing.length,
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
    lines.push(`- MISSING: ${entry.file}::${entry.name} — ${entry.reason}`);
  if (!result.actual.length && !result.missing.length)
    lines.push("No skipped, pending or todo tests.");
  return lines.join("\n") + "\n";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw Error(
        "Usage: node scripts/ci-skip-report.mjs <Vitest JSON report>",
      );
    const result = compareSkips(
      JSON.parse(await readFile(process.argv[2], "utf8")),
      JSON.parse(
        await readFile(path.join(repository, "ci/expected-skips.json"), "utf8"),
      ),
    );
    const summary = skipSummary(result);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
