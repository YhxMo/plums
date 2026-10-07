import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const electronTests = [
  "common-runtime-ui",
  "workspace-ui",
  "platform-conformance-ui",
  "policy-ui",
  "resources-ui",
  "onboarding-ui",
  "interaction-ui",
  "confirm-window",
  "frontend-scope",
  "panels",
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
          include: ["packages/*/test/**/*.test.ts"],
          exclude: electronTests.map(
            (name) => `packages/desktop/test/${name}.test.ts`,
          ),
        },
      },
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
