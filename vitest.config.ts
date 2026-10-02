import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    // Test timeout sits above the child process's 10s limit.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@plums/core": path.join(root, "packages/core/src/index.ts"),
    },
  },
});
