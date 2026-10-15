import { defineConfig } from "vitest/config";
export default defineConfig({
  publicDir: "extensions",
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
