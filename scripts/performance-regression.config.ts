import base from "../vitest.config.js";
import { defineConfig } from "vitest/config";

/** Deliberately removes normal scheduling isolation for timeout reproduction. */
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: "node",
    testTimeout: 20_000,
    maxWorkers: 4,
    include: [
      "packages/host/test/local-callbacks.test.ts",
      "packages/host/test/confirm-once.test.ts",
      "packages/host/test/recheck-coalescing.test.ts",
      "packages/host/test/recheck-cache.test.ts",
      "packages/host/test/onboarding.test.ts",
      "packages/host/test/engine.test.ts",
      "packages/host/test/common-tasks.test.ts",
      "packages/host/test/library.test.ts",
      "packages/host/test/local-assembly.test.ts",
    ],
  },
});
