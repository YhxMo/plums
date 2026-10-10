import { it, expect } from "vitest";
import { compareSkips, skipSummary } from "../../../scripts/ci-skip-report.mjs";
const expected = [
  {
    file: "packages/host/test/a.test.ts",
    name: "suite platform case",
    reason: "Synthetic platform condition",
  },
];
const report = (status: string) => ({
  testResults: [
    {
      name: "/synthetic/packages/host/test/a.test.ts",
      assertionResults: [{ fullName: "suite platform case", status }],
    },
  ],
});
it("accepts an exact skip list and includes the reason in the summary", () => {
  const result = compareSkips(report("skipped"), expected, "/synthetic");
  expect(result.ok).toBe(true);
  expect(skipSummary(result)).toContain(
    "packages/host/test/a.test.ts::suite platform case (skipped)",
  );
  expect(skipSummary(result)).toContain(expected[0]!.reason);
});
it("rejects an additional pending or todo test", () => {
  for (const status of ["pending", "todo"]) {
    const result = compareSkips(report(status), [], "/synthetic");
    expect(result.ok).toBe(false);
    expect(result.extra).toHaveLength(1);
  }
});
it("rejects a missing expected skip", () => {
  const result = compareSkips(report("passed"), expected, "/synthetic");
  expect(result.ok).toBe(false);
  expect(result.missing).toEqual(expected);
  expect(skipSummary(result)).toContain("MISSING:");
});
it("rejects duplicate entries and missing reasons", () => {
  expect(() =>
    compareSkips(report("skipped"), [...expected, ...expected], "/synthetic"),
  ).toThrow("Duplicate");
  expect(() =>
    compareSkips(
      report("skipped"),
      [{ ...expected[0], reason: "" }],
      "/synthetic",
    ),
  ).toThrow("reason");
});
