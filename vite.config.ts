import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { developmentFiles } from "./scripts/dev-extensions.mjs";

/**
 * Files under extensions/ that only the development server serves, at the
 * site root; releases are built from public/ alone.
 */
export const developmentOnly = [
  "catalog.dev.json",
  "contracts.d.ts",
  "examples",
  "samples",
  "services",
  "ui",
];
export default defineConfig({
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        // Libraries in their own chunks; rarely opened pages load on demand.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 2,
            },
            { name: "vendor", test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
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
      name: "plums-development-extensions",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use(
          developmentFiles(
            resolve(import.meta.dirname, "extensions"),
            developmentOnly,
          ),
        );
      },
    },
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
