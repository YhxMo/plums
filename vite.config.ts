import { rmSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

/** Public files that only development and tests load; releases drop them. */
export const developmentOnly = [
  "catalog.dev.json",
  "contracts.d.ts",
  "examples",
  "samples",
  "services",
  "ui",
];
export default defineConfig({
  publicDir: "extensions",
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { target: "es2022" },
  plugins: [
    {
      name: "plums-release-files",
      apply: "build",
      closeBundle() {
        for (const path of developmentOnly)
          rmSync(join("dist", path), { recursive: true, force: true });
      },
    },
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
