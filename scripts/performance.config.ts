import base from "../vitest.config.js";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/performance/local-callbacks.bench.ts"],
    environment: "node",
    maxWorkers: 1,
    testTimeout: 20_000,
  },
  resolve: base.resolve,
});
