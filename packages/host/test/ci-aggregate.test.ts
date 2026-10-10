import { expect, it } from "vitest";
import {
  assertGroupFiles,
  assessGroup,
} from "../../../scripts/ci-aggregate.mjs";
const pending = { commit: "synthetic", startedAt: "2026-10-10T00:00:00Z" };
const status = { exitCode: 0, signal: null, endedAt: "2026-10-10T00:00:02Z" };
const report = {
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  testResults: [{ status: "passed" }],
};
it("marks a pending group without JSON as crashed and retains its last 50 log lines", () => {
  const result = assessGroup(
    "unit",
    pending,
    status,
    null,
    Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n"),
  );
  expect(result.state).toBe("crashed");
  expect(result.logTail?.split("\n")).toHaveLength(50);
  expect(result.logTail).toContain("line 99");
});
it("marks SIGABRT as crashed even when a JSON file exists", () => {
  expect(
    assessGroup("electron", pending, { ...status, signal: "SIGABRT" }, report)
      .state,
  ).toBe("crashed");
});
it("rejects test failures and preserves a fully passed group's time and peak RSS", () => {
  expect(
    assessGroup(
      "platform",
      pending,
      { ...status, exitCode: 1 },
      { ...report, success: false, numFailedTests: 1 },
    ).state,
  ).toBe("failed");
  expect(
    assessGroup(
      "unit",
      pending,
      status,
      report,
      "123456 maximum resident set size",
    ),
  ).toMatchObject({ state: "passed", durationSeconds: 2, rssBytes: 123456 });
});

it("rejects files moved to another group even when the combined file list is complete", () => {
  const groups = { unit: ["unit"], platform: ["platform"] };
  const specifications = [{ file: "a.test.ts", project: "unit" }];
  const report = { testResults: [{ name: "a.test.ts" }] };
  expect(() =>
    assertGroupFiles("platform", report, specifications, groups),
  ).toThrow("wrong CI group");
  expect(() =>
    assertGroupFiles("unit", report, specifications, groups),
  ).not.toThrow();
});
