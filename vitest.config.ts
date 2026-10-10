import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const electronTests = [
  "foundation-ui",
  "common-runtime-ui",
  "workspace-ui",
  "platform-conformance-ui",
  "policy-ui",
  "local-permissions-ui",
  "resources-ui",
  "onboarding-ui",
  "interaction-ui",
  "confirm-window",
  "frontend-scope",
  "panels",
  "scenario-chat-ui",
];

export default defineConfig({
  test: {
    environment: "node",
    // Test timeout sits above the child process's 10s limit.
    testTimeout: 20_000,
    // Native fullscreen and blur-to-deny confirmation share the OS focus.
    // Run each Electron file in its own group; other suites remain parallel.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Real Node children and OS sandbox probes share machine resources.
          // Bound file concurrency while keeping assertions and runtime budgets unchanged.
          maxWorkers: 4,
          include: ["packages/*/test/**/*.test.ts"],
          exclude: [
            ...electronTests.map(
              (name) => `packages/desktop/test/${name}.test.ts`,
            ),
            "packages/host/test/project-members.experiments.test.ts",
          ],
        },
      },
      ...(process.env.PLUMS_NATIVE_EXPERIMENTS === "1"
        ? [
            {
              extends: true as const,
              test: {
                name: "experiments",
                include: [
                  "packages/host/test/project-members.experiments.test.ts",
                ],
                maxWorkers: 1,
              },
            },
          ]
        : []),
      ...electronTests.map((name, index) => ({
        extends: true as const,
        test: {
          name,
          include: [`packages/desktop/test/${name}.test.ts`],
          // Vitest 3 sorts group numbers lexically: keep all native groups at
          // equal width so adding a tenth suite preserves the declared order.
          sequence: { groupOrder: index + 101 },
        },
      })),
    ],
  },
  resolve: {
    alias: {
      "@plums/core": path.join(root, "packages/core/src/index.ts"),
      "@plums/sdk/settings": path.join(root, "packages/sdk/src/settings.ts"),
      "@plums/sdk": path.join(root, "packages/sdk/src/index.ts"),
    },
  },
});
