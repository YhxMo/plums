import { testPlan } from "./scripts/ci-test-plan.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    environment: "node",
    // Test timeout sits above the child process's 10s limit.
    testTimeout: 20_000,
    // Native fullscreen and blur-to-deny confirmation share the OS focus.
    // Electron and timing-sensitive host files run in separate ordered groups.
    projects: testPlan.projects
      .filter(
        (project) =>
          project.name !== "experiments" ||
          process.env.PLUMS_NATIVE_EXPERIMENTS === "1",
      )
      .map(({ group: _group, groupOrder, ...project }) => ({
        extends: true as const,
        test: {
          ...project,
          ...(project.name === "unit"
            ? {
                maxWorkers: process.env.CI ? 2 : 4,
                exclude: testPlan.projects
                  .filter((item) => item.name !== "unit")
                  .flatMap((item) => item.include),
              }
            : {}),
          ...(groupOrder === undefined ? {} : { sequence: { groupOrder } }),
        },
      })),
  },
  resolve: {
    alias: {
      "@plumsjs/core": path.join(root, "packages/core/src/index.ts"),
      "@plumsjs/sdk/settings": path.join(root, "packages/sdk/src/settings.ts"),
      "@plumsjs/sdk": path.join(root, "packages/sdk/src/index.ts"),
    },
  },
});
