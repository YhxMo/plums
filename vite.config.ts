import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
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
  // Keep in step with tsconfig.json paths and scripts/check-boundaries.mjs.
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "@modules": resolve(import.meta.dirname, "modules"),
      "@extensions": resolve(import.meta.dirname, "extensions"),
    },
  },
  plugins: [
    tailwindcss(),
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
