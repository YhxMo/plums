import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const serialConfirmationTests = [
  "packages/host/test/local-callbacks.test.ts",
  "packages/host/test/confirm-once.test.ts",
];
const platformTests = [
  "common-runtime",
  "controlled-execution",
  "platform-conformance",
  "policy-execution",
  "policy",
  "task-scope",
  "local-authorization",
  "project-container",
  "project-members",
  "project-members-variants",
  "project-sandbox",
  "project-creation",
  "project-support-plan",
  "project-config-files",
  "sdk-capability-controls",
].map((name) => `packages/host/test/${name}.test.ts`);
platformTests.push("packages/host/test/scenarios/foundation.test.ts");
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
    // Electron and timing-sensitive host files run in separate ordered groups.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Real Node children and OS sandbox probes share machine resources.
          // Bound file concurrency while keeping assertions and runtime budgets unchanged.
          maxWorkers: process.env.CI ? 2 : 4,
          include: ["packages/*/test/**/*.test.ts"],
          exclude: [
            ...platformTests,
            ...serialConfirmationTests,
            ...electronTests.map(
              (name) => `packages/desktop/test/${name}.test.ts`,
            ),
            "packages/host/test/project-members.experiments.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "platform",
          include: platformTests,
          maxWorkers: 1,
        },
      },
      ...serialConfirmationTests.map((file, index) => ({
        extends: true as const,
        test: {
          name: index === 0 ? "local-callbacks-serial" : "confirm-once-serial",
          include: [file],
          maxWorkers: 1,
          // Separate groups guarantee no overlap, including under a root worker override.
          sequence: { groupOrder: 200 + index },
        },
      })),
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
          setupFiles: ["packages/desktop/test/support/electron-ready.ts"],
          // Vitest 3 sorts group numbers lexically: keep all native groups at
          // equal width so adding a tenth suite preserves the declared order.
          sequence: { groupOrder: index + 101 },
        },
      })),
    ],
  },
  resolve: {
    alias: {
      "@plumsjs/core": path.join(root, "packages/core/src/index.ts"),
      "@plumsjs/sdk/settings": path.join(root, "packages/sdk/src/settings.ts"),
      "@plumsjs/sdk": path.join(root, "packages/sdk/src/index.ts"),
    },
  },
});
