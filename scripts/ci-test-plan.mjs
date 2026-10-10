import { readFileSync } from "node:fs";

export const testPlan = JSON.parse(
  readFileSync(new URL("../ci/tests.json", import.meta.url), "utf8"),
);
export const groups = Object.fromEntries(
  ["unit", "platform", "electron"].map((group) => [
    group,
    testPlan.projects
      .filter((project) => project.group === group)
      .map((project) => project.name),
  ]),
);
export const requiredTests = testPlan.required;
