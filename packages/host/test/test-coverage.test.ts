import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  assertCoverage,
  assertProjectGroups,
  EXPERIMENT_FILES,
} from "../../../scripts/check-test-coverage.mjs";

const fixture = () => ({
  files: [
    "packages/host/test/local-callbacks.test.ts",
    "packages/host/test/confirm-once.test.ts",
    "packages/core/test/a.test.ts",
    ...EXPERIMENT_FILES,
  ],
  specifications: [
    {
      file: "packages/host/test/local-callbacks.test.ts",
      project: "local-callbacks-serial",
    },
    {
      file: "packages/host/test/confirm-once.test.ts",
      project: "confirm-once-serial",
    },
    { file: "packages/core/test/a.test.ts", project: "unit" },
  ],
  projects: [
    { name: "unit", groupOrder: 0, maxWorkers: 4 },
    { name: "local-callbacks-serial", groupOrder: 200, maxWorkers: 1 },
    { name: "confirm-once-serial", groupOrder: 201, maxWorkers: 1 },
  ],
});
it("requires every default project in exactly one CI group and excludes experiments", () => {
  const projects = ["unit", "platform", "electron", "experiments"];
  const groups = {
    unit: ["unit"],
    platform: ["platform"],
    electron: ["electron"],
  };
  expect(() => assertProjectGroups(projects, groups)).not.toThrow();
  expect(() =>
    assertProjectGroups(projects, { ...groups, platform: [] }),
  ).toThrow();
  expect(() =>
    assertProjectGroups(projects, { ...groups, unit: ["unit", "platform"] }),
  ).toThrow("found 2");
  expect(() =>
    assertProjectGroups(projects, {
      ...groups,
      electron: ["electron", "experiments"],
    }),
  ).toThrow("Unexpected CI project");
});
it("every repository test belongs to exactly its intended project and CI uses the fixed runtime", () => {
  const report = JSON.parse(
    execFileSync(process.execPath, ["scripts/check-test-coverage.mjs"], {
      encoding: "utf8",
    }),
  );
  expect(report.ok).toBe(true);
  expect(report.totalFiles).toBe(report.defaultFiles + EXPERIMENT_FILES.length);
});
it("rejects an omitted test and a duplicate project assignment", () => {
  const missing = fixture();
  missing.specifications.pop();
  expect(() => assertCoverage(missing)).toThrow("expected 1 project, found 0");
  const duplicate = fixture();
  duplicate.specifications.push(duplicate.specifications[2]!);
  expect(() => assertCoverage(duplicate)).toThrow(
    "expected 1 project, found 2",
  );
});
it("requires separate ordered serial projects and an explicit experiments assignment", () => {
  const collision = fixture();
  collision.projects[2]!.groupOrder = 200;
  expect(() => assertCoverage(collision)).toThrow("different groupOrder");
  const wrongProject = fixture();
  wrongProject.specifications[0]!.project = "unit";
  expect(() => assertCoverage(wrongProject)).toThrow("must belong only");
  const experiments = fixture();
  expect(() => assertCoverage(experiments, true)).toThrow(
    "expected 1 project, found 0",
  );
  experiments.specifications.push({
    file: EXPERIMENT_FILES[0]!,
    project: "experiments",
  });
  expect(() => assertCoverage(experiments, true)).not.toThrow();
});
