import { it, expect } from "vitest";
import {
  compareSkips,
  skipSummary,
  compareRequiredTests,
  readReports,
} from "../ci-skip-report.mjs";
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
it("requires exactly the pinned number of passed migration cases and the named migration", () => {
  const required = [
    {
      file: "packages/host/test/a.test.ts",
      passed: 1,
      mustPass: ["suite platform case"],
    },
  ];
  expect(
    compareRequiredTests(report("passed"), required, "/synthetic").ok,
  ).toBe(true);
  for (const status of ["skipped", "pending", "failed"])
    expect(
      compareRequiredTests(report(status), required, "/synthetic").ok,
    ).toBe(false);
  expect(
    compareRequiredTests(
      { testResults: [] },
      required,
      "/synthetic",
    ).failures.join(" "),
  ).toContain("found 0");
  expect(
    compareRequiredTests(
      report("passed"),
      [{ ...required[0], passed: 2 }],
      "/synthetic",
    ).failures.join(" "),
  ).toContain("exactly 2");
  expect(
    compareRequiredTests(
      report("passed"),
      [{ ...required[0], mustPass: ["missing"] }],
      "/synthetic",
    ).ok,
  ).toBe(false);
});
it("reports a missing JSON file as a possible group crash", async () => {
  await expect(
    readReports(["/synthetic/no-such-vitest-report.json"]),
  ).rejects.toThrow("may have crashed");
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

it("checks OS gates in both directions, including unexpected execution and missing target evidence", () => {
  const entries = [
    {
      ...expected[0],
      when: { macosMajor: { lt: 27 } },
      issue: "synthetic evidence",
    },
  ];
  const context = (macosMajor: number) => ({ macosMajor, experiments: false });
  expect(
    compareSkips(report("skipped"), entries, "/synthetic", context(15)).ok,
  ).toBe(true);
  expect(
    compareSkips(report("passed"), entries, "/synthetic", context(15)).ok,
  ).toBe(false);
  expect(
    skipSummary(
      compareSkips(report("passed"), entries, "/synthetic", context(15)),
    ),
  ).toContain("update the expected-skip list");
  expect(
    compareSkips(report("skipped"), [], "/synthetic", context(15)).ok,
  ).toBe(false);
  expect(
    compareSkips(report("skipped"), entries, "/synthetic", context(27)).ok,
  ).toBe(false);
  expect(
    compareSkips(report("passed"), entries, "/synthetic", context(27)).ok,
  ).toBe(true);
  expect(
    compareSkips({ testResults: [] }, entries, "/synthetic", context(27)).ok,
  ).toBe(false);
  const experiment = [
    { ...entries[0], when: { ...entries[0].when, experiments: true } },
  ];
  expect(
    compareSkips({ testResults: [] }, experiment, "/synthetic", context(15)).ok,
  ).toBe(true);
  expect(
    compareSkips(report("skipped"), experiment, "/synthetic", {
      macosMajor: 15,
      experiments: true,
    }).ok,
  ).toBe(true);
});
