import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["scripts/performance/local-callbacks.bench.ts"],
    environment: "node",
    maxWorkers: 1,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@plumsjs/core": path.resolve("packages/core/src/index.ts"),
      "@plumsjs/sdk/settings": path.resolve("packages/sdk/src/settings.ts"),
      "@plumsjs/sdk": path.resolve("packages/sdk/src/index.ts"),
    },
  },
});
